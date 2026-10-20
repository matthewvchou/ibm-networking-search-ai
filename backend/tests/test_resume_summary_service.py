"""Caching, dedupe, retry and prefetch around summary generation, with fake clients."""

import asyncio
import json

import pytest

from app.core.exceptions import SummaryUnavailableException
from app.models.employee import Employee
from app.services.resume_summary_service import ResumeSummaryService

_GOOD = json.dumps({"headline": "Cloud architect", "summary": "Builds platforms."})


class _FakeResumes:
    def __init__(self, markdown: str | None = "# Ada Example", error: Exception | None = None) -> None:
        self.markdown = markdown
        self.error = error
        self.calls: list[str] = []

    def resume_url(self, employee_id: str) -> str:
        return f"https://resume.example.test/{employee_id}"

    async def get_markdown(self, employee_id: str) -> str | None:
        self.calls.append(employee_id)
        await asyncio.sleep(0)
        if self.error:
            raise self.error
        return self.markdown


class _FakeIca:
    def __init__(self, replies: list[str] | None = None, configured: bool = True) -> None:
        self.replies = list(replies or [])
        self.is_configured = configured
        self.calls = 0

    async def complete_json(self, messages: list[dict[str, str]]) -> str:
        self.calls += 1
        await asyncio.sleep(0)
        return self.replies.pop(0) if self.replies else _GOOD


def _employee(employee_id: str, manager_id: str | None = None) -> Employee:
    return Employee(id=employee_id, display_name=f"Person {employee_id}", manager_id=manager_id)


class _FakeEmployees:
    def __init__(self, manager_id: str | None = None, report_ids: list[str] | None = None) -> None:
        self.manager_id = manager_id
        self.report_ids = report_ids or []

    async def get_by_id(self, employee_id: str) -> Employee:
        return _employee(employee_id, self.manager_id)

    async def get_direct_reports(self, employee_id: str) -> list[Employee]:
        return [_employee(report_id) for report_id in self.report_ids]


def _service(resumes=None, ica=None, employees=None) -> ResumeSummaryService:
    return ResumeSummaryService(
        employee_service=employees or _FakeEmployees(),
        resume_client=resumes or _FakeResumes(),
        ica_client=ica or _FakeIca(),
    )


async def _drain_background(service: ResumeSummaryService) -> None:
    while service._background:
        await asyncio.gather(*service._background)


@pytest.mark.asyncio
async def test_second_request_is_served_from_cache():
    ica = _FakeIca()
    service = _service(ica=ica)
    assert (await service.get_summary("A")).headline == "Cloud architect"
    await service.get_summary("A")
    assert ica.calls == 1


@pytest.mark.asyncio
async def test_no_resume_is_a_404_and_is_cached():
    resumes = _FakeResumes(markdown=None)
    service = _service(resumes=resumes)
    for _ in range(2):
        with pytest.raises(SummaryUnavailableException) as exc_info:
            await service.get_summary("A")
        assert (exc_info.value.reason, exc_info.value.status_code) == ("no_resume", 404)
    assert resumes.calls == ["A"]


@pytest.mark.asyncio
async def test_failures_are_not_cached():
    resumes = _FakeResumes(error=SummaryUnavailableException("resume_unavailable", "down"))
    service = _service(resumes=resumes)
    for _ in range(2):
        with pytest.raises(SummaryUnavailableException):
            await service.get_summary("A")
    assert resumes.calls == ["A", "A"]


@pytest.mark.asyncio
async def test_concurrent_requests_share_one_generation():
    ica = _FakeIca()
    service = _service(ica=ica)
    first, second = await asyncio.gather(service.get_summary("A"), service.get_summary("A"))
    assert first == second
    assert ica.calls == 1


@pytest.mark.asyncio
async def test_invalid_output_is_retried_once():
    ica = _FakeIca(replies=["not json", _GOOD])
    assert (await _service(ica=ica).get_summary("A")).headline == "Cloud architect"
    assert ica.calls == 2


@pytest.mark.asyncio
async def test_invalid_output_twice_is_bad_output():
    ica = _FakeIca(replies=["not json", "still not json"])
    with pytest.raises(SummaryUnavailableException) as exc_info:
        await _service(ica=ica).get_summary("A")
    assert (exc_info.value.reason, exc_info.value.status_code) == ("bad_output", 502)


@pytest.mark.asyncio
async def test_unconfigured_ica_fails_before_fetching_the_resume():
    resumes = _FakeResumes()
    with pytest.raises(SummaryUnavailableException) as exc_info:
        await _service(resumes=resumes, ica=_FakeIca(configured=False)).get_summary("A")
    assert exc_info.value.reason == "not_configured"
    assert resumes.calls == []


@pytest.mark.asyncio
async def test_prefetches_manager_and_reports_capped_at_ten():
    resumes = _FakeResumes()
    employees = _FakeEmployees(manager_id="M", report_ids=[f"R{i}" for i in range(12)])
    service = _service(resumes=resumes, employees=employees)
    await service.get_summary("A")
    await _drain_background(service)
    assert resumes.calls[0] == "A"
    assert resumes.calls[1:] == ["M", *(f"R{i}" for i in range(9))]


@pytest.mark.asyncio
async def test_prefetched_summary_is_a_cache_hit_and_does_not_prefetch_further():
    ica = _FakeIca()
    service = _service(ica=ica, employees=_FakeEmployees(manager_id="M"))
    await service.get_summary("A")
    await _drain_background(service)
    calls_after_prefetch = ica.calls
    await service.get_summary("M")
    assert ica.calls == calls_after_prefetch == 2
