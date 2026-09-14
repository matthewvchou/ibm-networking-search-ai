from __future__ import annotations

from pydantic import BaseModel


class Employee(BaseModel):
    id: str
    display_name: str
    email: str | None = None
    title: str | None = None
    department: str | None = None
    location: str | None = None
    manager_id: str | None = None
    photo_url: str | None = None
    office_phone: str | None = None
    mobile_phone: str | None = None
    address: str | None = None
    org_unit: str | None = None


class OrgNode(BaseModel):
    employee: Employee
    direct_reports: list["OrgNode"] = []
    has_more_reports: bool = False
