from fastapi import APIRouter, HTTPException

from app.models.employee import Employee, OrgNode
from app.services.employee_service import EmployeeService

router = APIRouter(prefix="/api/employees", tags=["employees"])
_service = EmployeeService()


@router.get("/search")
async def search(q: str, limit: int = 50) -> dict:
    results, truncated = await _service.search(q, limit)
    return {"results": results, "truncated": truncated}


@router.get("/{employee_id}", response_model=Employee)
async def get_by_id(employee_id: str) -> Employee:
    employee = await _service.get_by_id(employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return employee


@router.get("/{employee_id}/direct-reports")
async def get_direct_reports(employee_id: str) -> dict:
    reports = await _service.get_direct_reports(employee_id)
    return {"reports": reports}


@router.get("/{employee_id}/manager-chain")
async def get_manager_chain(employee_id: str) -> dict:
    chain = await _service.get_manager_chain(employee_id)
    return {"chain": chain}


@router.get("/{employee_id}/org-chart", response_model=OrgNode)
async def get_org_chart(employee_id: str, depth: int = 2) -> OrgNode:
    clamped_depth = max(1, min(depth, 3))
    node = await _service.get_org_chart(employee_id, clamped_depth)
    if node is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return node
