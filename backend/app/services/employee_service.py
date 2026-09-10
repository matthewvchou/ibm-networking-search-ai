from app.core.config import settings
from app.models.employee import Employee
from app.services.bluepages_client import BluepagesClient


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


class EmployeeService:
    def __init__(self, client: BluepagesClient | None = None) -> None:
        self._client = client or BluepagesClient()

    async def search(self, query: str, max_results: int | None = None) -> tuple[list[Employee], bool]:
        limit = max_results or settings.search_max_results
        records = await self._client.query("allByNameFuzzy", query)
        employees = [_record_to_employee(r) for r in records]
        truncated = len(employees) > limit
        return employees[:limit], truncated

    async def get_by_id(self, employee_id: str) -> Employee | None:
        records = await self._client.query("byCnum", employee_id)
        if not records:
            return None
        return _record_to_employee(records[0])

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
