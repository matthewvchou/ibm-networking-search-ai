import asyncio
import re

from app.core.config import settings
from app.core.exceptions import BluepagesUnavailableException
from app.models.employee import Employee, OrgNode
from app.services.bluepages_client import BluepagesClient
from app.services.slaphapi_client import SlaphapiClient

_ORG_CHART_CONCURRENCY = 16

_MANAGER_DN_UID_RE = re.compile(r"uid=([^,]+)", re.IGNORECASE)

# ibmperson.department is documented only as "DN of department entry" - the ED
# schema pages we have don't cover that entry's object class, so the readable
# name could live under any of these. First populated one wins.
_DEPT_NAME_ATTRS = ("description", "hrorganizationdisplay", "hrorganizationname", "ou", "cn")


def _record_to_employee(record: dict[str, str]) -> Employee:
    return Employee(
        id=record.get("CNUM", ""),
        display_name=record.get("NAME", ""),
        email=record.get("INTERNET") or None,
        title=record.get("JOBRESPONSIB") or None,
        department=record.get("DEPT") or None,
        location=record.get("COUNTRY") or None,
        manager_id=record.get("MNUM") or None,
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
    return Employee(
        id=record.get("uid", ""),
        display_name=record.get("cn", ""),
        email=record.get("mail") or None,
        title=record.get("jobresponsibilities") or None,
        department=record.get("dept") or None,
        location=record.get("co") or None,
        manager_id=_manager_id_from_slaphapi(record),
        office_phone=record.get("telephonenumber") or None,
        mobile_phone=record.get("mobile") or None,
    )


async def _none() -> None:
    return None


def _format_address(record: dict[str, str]) -> str | None:
    street = ", ".join(p for p in (record.get("ADDRESS1"), record.get("ADDRESS2")) if p)
    city_state_zip = " ".join(p for p in (record.get("CITY"), record.get("STATE"), record.get("ZIPCODE")) if p)
    parts = [p for p in (street, city_state_zip, record.get("C")) if p]
    return ", ".join(parts) or None


def _format_address_slaphapi(record: dict[str, str], building: str | None = None) -> str | None:
    street = ", ".join(
        p
        for p in (f"Building {building}" if building else None, record.get("address1"), record.get("address2"))
        if p
    )
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

    async def search(self, query: str, max_results: int | None = None) -> tuple[list[Employee], bool]:
        limit = max_results or settings.search_max_results

        # allByNameFuzzy only matches last name for a single bare word ("Laura" finds
        # people surnamed Laura, not people named Laura). A second word paired with a
        # literal "%" leaks through to an LDAP substring filter that matches first name
        # instead, so a single-token query is unioned with that first-name lookup too,
        # run concurrently with its own shorter timeout. Multi-token queries
        # ("Last, First" / "First Last") already cross-match both fields, so they skip
        # this and just do the one call.
        if len(query.split()) == 1:
            last_name_records, first_name_records = await asyncio.gather(
                self._client.query("allByNameFuzzy", query),
                self._query_firstname_matches(query),
            )
            records = self._merge_records(last_name_records, first_name_records, limit)
        else:
            records = await self._client.query("allByNameFuzzy", query)

        employees = [_record_to_employee(r) for r in records]
        truncated = len(employees) > limit
        return employees[:limit], truncated

    async def _query_firstname_matches(self, query: str) -> list[dict[str, str]]:
        try:
            return await self._client.query(
                "allByNameFuzzy",
                f"{query} %",
                timeout=settings.bluepages_firstname_timeout_seconds,
            )
        except BluepagesUnavailableException:
            # Slow/huge/erroring wildcard match — silently fall back to just the
            # last-name results rather than failing or delaying the whole search.
            return []

    @staticmethod
    def _merge_records(
        base_records: list[dict[str, str]], extra_records: list[dict[str, str]], limit: int
    ) -> list[dict[str, str]]:
        seen_ids = {r.get("CNUM") for r in base_records}
        merged = list(base_records)
        for record in extra_records[:limit]:
            cnum = record.get("CNUM")
            if cnum and cnum not in seen_ids:
                seen_ids.add(cnum)
                merged.append(record)
        return merged

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
        address, org_unit, employee_type, company, department_name = await asyncio.gather(
            self._resolve_address(work_loc, building) if work_loc else _none(),
            self._resolve_org_unit(org_code) if org_code else _none(),
            self._resolve_employee_type(type_code) if type_code else _none(),
            self._resolve_company(company_code) if company_code else _none(),
            self._resolve_department_name(department_dn) if department_dn else _none(),
        )

        employee.address = address
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

    async def _resolve_address(self, work_loc: str, building: str | None = None) -> str | None:
        record = await self._lookup("ibmworklocation", f"workLoc={work_loc}")
        if record is None:
            return None
        return _format_address_slaphapi(record, building)

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
