import asyncio

from app.core.config import settings
from app.core.exceptions import BluepagesUnavailableException
from app.models.employee import Employee, OrgNode
from app.services.bluepages_client import BluepagesClient

_ORG_CHART_CONCURRENCY = 16


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


async def _none() -> None:
    return None


def _format_address(record: dict[str, str]) -> str | None:
    street = ", ".join(p for p in (record.get("ADDRESS1"), record.get("ADDRESS2")) if p)
    city_state_zip = " ".join(p for p in (record.get("CITY"), record.get("STATE"), record.get("ZIPCODE")) if p)
    parts = [p for p in (street, city_state_zip, record.get("C")) if p]
    return ", ".join(parts) or None


class EmployeeService:
    def __init__(self, client: BluepagesClient | None = None) -> None:
        self._client = client or BluepagesClient()

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
        records = await self._client.query("byCnum", employee_id)
        if not records:
            return None
        record = records[0]
        employee = _record_to_employee(record)

        work_loc = record.get("WORKLOC")
        org_code = record.get("ORGCODE")
        address, org_unit = await asyncio.gather(
            self._resolve_address(work_loc) if work_loc else _none(),
            self._resolve_org_unit(org_code) if org_code else _none(),
        )

        employee.office_phone = record.get("XPHONE") or None
        employee.mobile_phone = record.get("CELLULAR") or None
        employee.address = address
        employee.org_unit = org_unit
        return employee

    async def _resolve_address(self, work_loc: str) -> str | None:
        try:
            records = await self._client.query("workLoc", work_loc)
        except BluepagesUnavailableException:
            # Secondary lookup for the profile card only — degrade gracefully
            # rather than failing the whole employee detail request.
            return None
        if not records:
            return None
        return _format_address(records[0])

    async def _resolve_org_unit(self, org_code: str) -> str | None:
        try:
            records = await self._client.query("orgCodes", org_code)
        except BluepagesUnavailableException:
            return None
        if not records:
            return None
        return records[0].get("ORGDISPLAY") or None

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
