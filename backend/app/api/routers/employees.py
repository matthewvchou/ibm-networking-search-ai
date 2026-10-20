from fastapi import APIRouter, HTTPException

from app.models.employee import Employee, OrgNode
from app.models.resume_summary import ResumeSummaryResponse
from app.services.employee_service import TITLE_SUBSTRING_MIN_LENGTH, EmployeeService
from app.services.resume_summary_service import ResumeSummaryService

router = APIRouter(prefix="/api/employees", tags=["employees"])
_service = EmployeeService()
_summary_service = ResumeSummaryService(_service)


@router.get("/search")
async def search(q: str = "", title: str = "", limit: int = 50) -> dict:
    # At least one criterion is required. There is deliberately no "match everything"
    # search: a bare (hractive=A) is the whole active directory, which measured 154MB+
    # without completing.
    name, job_title = q.strip(), title.strip()
    if not name and not job_title:
        raise HTTPException(
            status_code=422, detail="Provide a name or job title to search."
        )
    if job_title and len(job_title) < TITLE_SUBSTRING_MIN_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Job title must be at least {TITLE_SUBSTRING_MIN_LENGTH} characters."
            ),
        )
    clamped_limit = max(1, min(limit, 100))
    results, truncated, total_matched = await _service.search(
        query=name, title=job_title, max_results=clamped_limit
    )
    return {"results": results, "truncated": truncated, "total_matched": total_matched}


@router.get("/{employee_id}", response_model=Employee)
async def get_by_id(employee_id: str) -> Employee:
    employee = await _service.get_enriched_by_id(employee_id)
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


@router.get("/{employee_id}/summary", response_model=ResumeSummaryResponse)
async def get_summary(employee_id: str) -> ResumeSummaryResponse:
    # Separate from /{employee_id} so the profile never waits on ICA. Failures raise
    # SummaryUnavailableException, which main.py turns into {reason, detail}.
    summary = await _summary_service.get_summary(employee_id)
    return ResumeSummaryResponse(summary=summary, resume_url=_summary_service.resume_url(employee_id))


@router.get("/{employee_id}/org-chart", response_model=OrgNode)
async def get_org_chart(employee_id: str, depth: int = 2) -> OrgNode:
    clamped_depth = max(1, min(depth, 3))
    node = await _service.get_org_chart(employee_id, clamped_depth)
    if node is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return node
