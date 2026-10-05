from __future__ import annotations

from pydantic import BaseModel


class Employee(BaseModel):
    id: str
    # "First Last" on every endpoint. The surname is carried separately because it
    # can't be recovered from the display name - real records have multi-word
    # surnames ("Nguyen Duc") - and the UI sorts search results by it.
    display_name: str
    last_name: str = ""
    email: str | None = None
    title: str | None = None
    department: str | None = None
    location: str | None = None
    manager_id: str | None = None
    # From WSAPI's MGR (Y/N), so the org chart can show an expand affordance only on
    # people who actually manage someone. The SLAPHAPI path leaves it False: the LDAP
    # record carries no equivalent flag. Note MGR is an HR manager indicator, so a Y
    # with zero current reports is legitimate - the UI handles that case.
    is_manager: bool = False
    photo_url: str | None = None
    office_phone: str | None = None
    mobile_phone: str | None = None
    address: str | None = None
    org_unit: str | None = None
    city: str | None = None
    state: str | None = None
    building: str | None = None
    # Resolved from codes on the ibmperson record; only populated on the enriched
    # single-employee endpoint, so `department` stays the raw code.
    employee_type: str | None = None
    company: str | None = None
    department_name: str | None = None


class OrgNode(BaseModel):
    employee: Employee
    direct_reports: list["OrgNode"] = []
    has_more_reports: bool = False
