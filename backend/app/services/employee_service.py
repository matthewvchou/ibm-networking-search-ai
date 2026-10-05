import asyncio
import re

from app.core.config import settings
from app.core.exceptions import BluepagesUnavailableException
from app.models.employee import Employee, OrgNode
from app.services.bluepages_client import BluepagesClient
from app.services.slaphapi_client import SlaphapiClient

_ORG_CHART_CONCURRENCY = 16
_CITY_LOOKUP_CONCURRENCY = 16

_MANAGER_DN_UID_RE = re.compile(r"uid=([^,]+)", re.IGNORECASE)

# Below this, a one-token query matches exactly instead of by prefix. SLAPHAPI
# enforces no server-side size limit, and a one- or two-character prefix is
# ruinous: (sn=a*) streamed 108MB before timing out, (sn=ma*) ~66MB, while
# three characters lands at 2-12MB.
_SEARCH_PREFIX_MIN_LENGTH = 3

# Job-title tokens are matched as *substrings*. Only the one-character case is
# actually ruinous, so the floor is 2 rather than the 3 used for name prefixes above:
# measured per-token, (jobresponsibilities=*a*) took 29s and *e* 29.6s - already over
# the 10s search budget, and those were measured with a projected attribute list, so
# the real request is far worse. Two characters are cheap (*vp* 0.8s/81 hits, *ux*
# 0.8s, *ai* 1.5s), and short real titles exist - "C#", "VP", "UX", "AI", "C++" -
# so a higher floor would reject legitimate searches for no benefit.
#
# Note this bounds nothing beyond that: a substring does not narrow as it lengthens
# the way a prefix does, and (jobresponsibilities=*Manager*) is 7 characters and
# still measured 16.9MB/6.7s. The real fix is projecting the attribute list - see
# CLAUDE.md - and until then a broad title can still time out, which is why that
# surfaces as a 504 rather than a 503.
TITLE_SUBSTRING_MIN_LENGTH = 2

# RFC 4515 escaping for values interpolated into a search filter. Search is the
# only place a user-supplied string reaches one.
_LDAP_FILTER_ESCAPES = str.maketrans(
    {"\\": r"\5c", "(": r"\28", ")": r"\29", "*": r"\2a", "\0": r"\00"}
)

# ibmperson.department is documented only as "DN of department entry" - the ED
# schema pages we have don't cover that entry's object class, so the readable
# name could live under any of these. First populated one wins.
_DEPT_NAME_ATTRS = ("description", "hrorganizationdisplay", "hrorganizationname", "ou", "cn")


def _name_part(value: str | None) -> str:
    # Commas are stripped rather than kept: dirty records put one *inside* a single
    # part (givenname="HANNAH, FONG LIN", sn="LEE"), and a comma in a name is only
    # ever read as the "Last, First" directory format.
    return " ".join(value.replace(",", " ").split()) if value else ""


def _wsapi_name(record: dict[str, str]) -> tuple[str, str]:
    # (display_name, last_name). WSAPI NAME is "Last, First" and dependably so -
    # every live record sampled had exactly one comma with the surname first.
    # HRFIRSTNAME/HRLASTNAME look like the cleaner source but are empty on ~22% of
    # records, so splitting NAME is the reliable route.
    name = record.get("NAME", "").strip()
    surname, comma, given = name.partition(",")
    surname, given = surname.strip(), _name_part(given)
    if not comma or not surname or not given:
        # Nothing to split on, so the word order is unknown - pass it through
        # rather than guess at it.
        return name, ""
    return f"{given} {surname}", surname


def _slaphapi_name(record: dict[str, str]) -> tuple[str, str]:
    # (display_name, last_name), built from the structured name attributes instead
    # of `cn`. `cn` cannot carry word order: it is usually "First Last", but ~1-2%
    # of live records hold a stray comma in first-then-last order (cn="Jinkwang,
    # Kim" where sn=Kim, givenname=Jinkwang), which is indistinguishable from the
    # "Last, First" format - so anything that reorders on the comma renders those
    # records backwards. preferred* wins over sn/givenname: both pairs are
    # near-universally populated, but givenname is sometimes multi-valued
    # (["Huan", "Huan B"]) where preferred* is not, and SlaphapiClient keeps
    # value[0] arbitrarily.
    surname = _name_part(record.get("preferredlastname") or record.get("sn"))
    given = _name_part(record.get("preferredfirstname") or record.get("givenname"))
    if surname and given:
        return f"{given} {surname}", surname
    if surname or given:
        return surname or given, surname
    # Functional IDs and partial records (cn="HELPDESK", no sn/givenname). Never
    # reordered, only cleaned.
    return _name_part(record.get("cn")), ""


# Some live records carry the literal four-character string "null" in a free-text
# field - measured on JOBRESPONSIB - which renders as a job title of "null" unless it
# is treated as absent here. Only "null" is listed because only "null" was observed;
# don't add speculative sentinels that might swallow a real value.
_PLACEHOLDER_TEXT = {"null"}


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped or stripped.casefold() in _PLACEHOLDER_TEXT:
        return None
    return stripped


def _record_to_employee(record: dict[str, str]) -> Employee:
    display_name, last_name = _wsapi_name(record)
    return Employee(
        id=record.get("CNUM", ""),
        display_name=display_name,
        last_name=last_name,
        email=record.get("INTERNET") or None,
        title=_clean_text(record.get("JOBRESPONSIB")),
        department=record.get("DEPT") or None,
        location=record.get("COUNTRY") or None,
        manager_id=record.get("MNUM") or None,
        is_manager=record.get("MGR", "").strip().upper() == "Y",
    )


def _manager_id_from_slaphapi(record: dict[str, str]) -> str | None:
    # "manager" is a DN ("uid=6D9496897,c=us,..."); "managerserialnumber" alone
    # truncates the trailing country-code digits, so prefer the DN's uid.
    manager_dn = record.get("manager")
    if manager_dn:
        match = _MANAGER_DN_UID_RE.search(manager_dn)
        if match:
            return match.group(1)
    return record.get("managerserialnumber") or None


def _slaphapi_record_to_employee(record: dict[str, str]) -> Employee:
    display_name, last_name = _slaphapi_name(record)
    return Employee(
        id=record.get("uid", ""),
        display_name=display_name,
        last_name=last_name,
        email=record.get("mail") or None,
        title=_clean_text(record.get("jobresponsibilities")),
        department=record.get("dept") or None,
        location=record.get("co") or None,
        manager_id=_manager_id_from_slaphapi(record),
        office_phone=record.get("telephonenumber") or None,
        mobile_phone=record.get("mobile") or None,
    )


def _name_predicate(query: str) -> str | None:
    # Commas are separators here, not part of a name, so "Smith, Laura" and
    # "Laura Smith" reduce to the same two tokens. None means "no name to match on".
    tokens = [t.translate(_LDAP_FILTER_ESCAPES) for t in query.replace(",", " ").split()]
    if not tokens:
        return None
    if len(tokens) == 1:
        token = tokens[0]
        pattern = f"{token}*" if len(token) >= _SEARCH_PREFIX_MIN_LENGTH else token
        # sn and givenname are both first-class: the old WSAPI allByNameFuzzy
        # matched surnames only for a bare word, and reached first names solely
        # through a wildcard quirk.
        return f"(|(sn={pattern})(givenname={pattern}))"
    # Both orders, since the query may be given either way. Middle names are
    # ignored rather than guessed at. The pair is sorted only to keep the filter
    # canonical - it already matches either order, so "Ada Lovelace" and
    # "Lovelace, Ada" should produce one identical filter, not two.
    a, b = sorted((tokens[0], tokens[-1]))
    return (
        f"(|(&(givenname={a}*)(sn={b}*))"
        f"(&(givenname={b}*)(sn={a}*)))"
    )


def _title_predicate(title: str) -> str | None:
    # One assertion per token, ANDed, rather than one assertion for the whole
    # phrase: "(&(..=*senior*)(..=*architect*))" matched 133 live records where
    # "(..=*senior architect*)" matched 18, because the tokens may be separated by
    # anything ("Senior Software Architect") or given in either order. Repeated
    # assertions on one attribute are legal RFC 4515 and verified to work here.
    tokens = [t.translate(_LDAP_FILTER_ESCAPES) for t in title.split()]
    if not tokens:
        return None
    assertions = "".join(f"(jobresponsibilities=*{t}*)" for t in tokens)
    # A lone assertion needs no (&...) wrapper; keeping it bare makes the single-token
    # case - by far the common one - readable in a log.
    return assertions if len(tokens) == 1 else f"(&{assertions})"


def _compose_filter(query: str = "", title: str = "") -> str | None:
    # Predicate order is part of this function's contract: hractive, then name, then
    # title. Tests assert exact filter strings, so reordering is a breaking change.
    # None means "nothing to search" - the caller must not fall back to a bare
    # (hractive=A), which matches the entire active directory.
    predicates = [p for p in (_name_predicate(query), _title_predicate(title)) if p]
    if not predicates:
        return None
    # hractive=A keeps results to current employees, and trims the payload of a
    # broad query by ~20% on the way.
    return f"(&(hractive=A){''.join(predicates)})"


def _search_filter(query: str) -> str | None:
    # Name-only shim, kept so the measured prefix rules above stay covered by their
    # original tests verbatim.
    return _compose_filter(query=query)


async def _none() -> None:
    return None


def _format_address(record: dict[str, str]) -> str | None:
    street = ", ".join(p for p in (record.get("ADDRESS1"), record.get("ADDRESS2")) if p)
    city_state_zip = " ".join(p for p in (record.get("CITY"), record.get("STATE"), record.get("ZIPCODE")) if p)
    parts = [p for p in (street, city_state_zip, record.get("C")) if p]
    return ", ".join(parts) or None


def _place_from_work_location(record: dict[str, str]) -> tuple[str | None, str | None]:
    # City and the state/province that always follows it. "st" is the full name
    # ("North Carolina"), and is legitimately empty for countries without states.
    return record.get("l") or None, record.get("st") or None


def _format_address_slaphapi(record: dict[str, str]) -> str | None:
    # Purely postal, with no building prefix: this string is only ever used as a
    # Google Maps query and as the location link's hover title, and an internal
    # building number degrades Google's geocoding. The building name is carried
    # separately on Employee.building.
    street = ", ".join(p for p in (record.get("address1"), record.get("address2")) if p)
    city_state_zip = " ".join(p for p in (record.get("l"), record.get("st"), record.get("postalcode")) if p)
    parts = [p for p in (street, city_state_zip, record.get("c")) if p]
    return ", ".join(parts) or None


class EmployeeService:
    def __init__(
        self,
        client: BluepagesClient | None = None,
        slaphapi_client: SlaphapiClient | None = None,
    ) -> None:
        self._client = client or BluepagesClient()
        self._slaphapi_client = slaphapi_client or SlaphapiClient()
        # workLoc -> (city, state), for the process lifetime. Office locations are immutable
        # reference data carrying no personal data, so memoizing them is safe, and
        # search resolves the same handful of offices over and over. This is a
        # deliberate, narrow exception to the "no cache in v1" rule in CLAUDE.md.
        self._place_cache: dict[str, tuple[str | None, str | None]] = {}

    async def search(
        self, query: str = "", title: str = "", max_results: int | None = None
    ) -> tuple[list[Employee], bool, int]:
        limit = max_results or settings.search_max_results

        # One SLAPHAPI query against sn/givenname and/or jobresponsibilities, which
        # is also the profile endpoint's source - so a person's name is built the
        # same way whichever screen it lands on. SLAPHAPI applies no size limit of
        # its own, hence the client-side truncation below and the length guards in
        # _name_predicate / _title_predicate.
        search_filter = _compose_filter(query=query, title=title)
        if search_filter is None:
            # Defence in depth: the router rejects this case with a 422 first. A bare
            # (hractive=A) would match the whole active directory, which measured
            # 154MB+ without completing, so never let one be built.
            return [], False, 0
        records = await self._slaphapi_client.query(
            "ibmperson",
            search_filter,
            timeout=settings.slaphapi_search_timeout_seconds,
        )

        employees = [_slaphapi_record_to_employee(r) for r in records]
        # The pre-truncation count is reported so the UI can say "50 of 4,109" - a
        # broad title filter collapses thousands of people into an arbitrary 50, and
        # a bare "truncated" flag reads as the directory being nearly empty.
        total_matched = len(employees)
        truncated = total_matched > limit
        page = employees[:limit]
        # Cities are attached after truncation so we only look up offices we show.
        await self._attach_places(page, records[:limit])
        return page, truncated, total_matched

    async def get_by_id(self, employee_id: str) -> Employee | None:
        records = await self._client.query("byCnum", employee_id)
        if not records:
            return None
        return _record_to_employee(records[0])

    async def get_enriched_by_id(self, employee_id: str) -> Employee | None:
        records = await self._slaphapi_client.query("ibmperson", f"uid={employee_id}")
        if not records:
            return None
        record = records[0]
        employee = _slaphapi_record_to_employee(record)

        work_loc = record.get("workloc")
        building = record.get("buildingname")
        org_code = record.get("hrorganizationcode")
        type_code = record.get("employeetype")
        company_code = record.get("hrcompanycode")
        department_dn = record.get("department")
        work_location, org_unit, employee_type, company, department_name = await asyncio.gather(
            self._lookup("ibmworklocation", f"workLoc={work_loc}") if work_loc else _none(),
            self._resolve_org_unit(org_code) if org_code else _none(),
            self._resolve_employee_type(type_code) if type_code else _none(),
            self._resolve_company(company_code) if company_code else _none(),
            self._resolve_department_name(department_dn) if department_dn else _none(),
        )

        if work_location:
            employee.city, employee.state = _place_from_work_location(work_location)
            employee.address = _format_address_slaphapi(work_location)
        employee.building = building or None
        employee.org_unit = org_unit
        # employeetype may not be a code at all - fall back to the raw value.
        employee.employee_type = employee_type or type_code or None
        employee.company = company
        employee.department_name = department_name
        return employee

    async def _lookup(
        self, object_class: str, filter_expr: str, search_params: str | None = None
    ) -> dict[str, str] | None:
        # Shared plumbing for the code -> readable-label lookups that enrich the
        # profile card. These are all secondary to the main ibmperson record, so a
        # directory error degrades to "no label" rather than failing the whole
        # employee detail request. Note this also swallows malformed-filter errors
        # (rc 904/923), which then look identical to "no such entry" — re-raise
        # here temporarily when developing a new filter.
        try:
            records = await self._slaphapi_client.query(
                object_class, filter_expr, search_params=search_params
            )
        except BluepagesUnavailableException:
            return None
        return records[0] if records else None

    async def _resolve_place(self, work_loc: str) -> tuple[str | None, str | None]:
        # (city, state). Cached because search resolves the same handful of offices
        # over and over; see the cache note in __init__.
        if work_loc in self._place_cache:
            return self._place_cache[work_loc]
        record = await self._lookup("ibmworklocation", f"workLoc={work_loc}")
        place = _place_from_work_location(record) if record else (None, None)
        if place[0]:
            # Successes only. Caching a miss from a transient directory outage
            # would poison every later search that touches this office.
            self._place_cache[work_loc] = place
        return place

    async def _attach_places(self, employees: list[Employee], records: list[dict[str, str]]) -> None:
        # Person records carry the office code but no city or state, so both have to
        # come from the ibmworklocation table. Resolved once per distinct office
        # rather than once per person - a full result page usually spans far fewer
        # offices - so this is one extra round-trip of depth, not one call per row.
        codes = sorted({wl for r in records if (wl := r.get("workloc"))})
        if not codes:
            return
        semaphore = asyncio.Semaphore(_CITY_LOOKUP_CONCURRENCY)

        async def resolve(code: str) -> tuple[str | None, str | None]:
            async with semaphore:
                return await self._resolve_place(code)

        places = dict(zip(codes, await asyncio.gather(*(resolve(c) for c in codes))))
        for employee, record in zip(employees, records):
            employee.city, employee.state = places.get(record.get("workloc") or "", (None, None))

    async def _resolve_org_unit(self, org_code: str) -> str | None:
        record = await self._lookup("ibmorganization", f"hrOrganizationCode={org_code}")
        if record is None:
            return None
        return record.get("hrorganizationdisplay") or record.get("hrorganizationname") or None

    async def _resolve_employee_type(self, type_code: str) -> str | None:
        # ibmperson.employeetype may already hold a readable string rather than a
        # code, in which case this lookup simply misses and the caller falls back
        # to the raw value.
        record = await self._lookup("ibmemployeetype", f"employeeTypeCode={type_code}")
        if record is None:
            return None
        # `title` is the short user-facing label ("IBM employee, Regular");
        # `description` is a paragraph of internal notes about the code, so it is
        # not a usable fallback for display.
        return record.get("title") or None

    async def _resolve_company(self, company_code: str) -> str | None:
        record = await self._lookup("ibmcompany", f"hrCompanyCode={company_code}")
        if record is None:
            return None
        return record.get("hrcompanyname") or None

    async def _resolve_department_name(self, department_dn: str) -> str | None:
        # Keyed by DN, not by code: the DN goes in the object position with the
        # "base" search parameter, which scopes the search to that entry alone and
        # means we don't need to know its object class.
        record = await self._lookup(department_dn, "objectclass=*", search_params="base")
        if record is None:
            return None
        return next((record[attr] for attr in _DEPT_NAME_ATTRS if record.get(attr)), None)

    async def get_direct_reports(self, employee_id: str) -> list[Employee]:
        records = await self._client.query("directReportsOf", employee_id)
        return [_record_to_employee(r) for r in records]

    async def get_manager_chain(self, employee_id: str) -> list[Employee]:
        self_employee = await self.get_by_id(employee_id)
        if self_employee is None:
            return []
        records = await self._client.query("managerChainFor", employee_id)
        chain = [_record_to_employee(r) for r in records]
        return [self_employee, *chain]

    async def get_org_chart(self, employee_id: str, depth: int = 2) -> OrgNode | None:
        root_employee = await self.get_by_id(employee_id)
        if root_employee is None:
            return None
        semaphore = asyncio.Semaphore(_ORG_CHART_CONCURRENCY)
        return await self._build_org_node(root_employee, depth, semaphore)

    async def _build_org_node(
        self, employee: Employee, remaining_depth: int, semaphore: asyncio.Semaphore
    ) -> OrgNode:
        async with semaphore:
            reports = await self.get_direct_reports(employee.id)
        if remaining_depth <= 0:
            return OrgNode(employee=employee, direct_reports=[], has_more_reports=len(reports) > 0)
        children = await asyncio.gather(
            *(self._build_org_node(r, remaining_depth - 1, semaphore) for r in reports)
        )
        return OrgNode(employee=employee, direct_reports=list(children), has_more_reports=False)
