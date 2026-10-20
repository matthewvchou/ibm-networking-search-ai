"""Caching, dedupe, retry, grading loop, regeneration and prefetch, with fake clients."""

import asyncio
import json

import pytest

from app.core.exceptions import SummaryUnavailableException
from app.models.employee import Employee
from app.services.resume_summary_service import ResumeSummaryService
from app.services.summary_generator import MAX_ATTEMPTS, SummaryGenerator
from app.services.summary_progress import ProgressBoard
from app.services.summary_verifier import SummaryVerifier

_RESUME = "# Ada Example\nDesigned hybrid cloud platforms on OpenShift.\nSkills: AWS\nCloud Architect, Example Corp, 2021"
_PROSE = json.dumps({"summary": "Designs cloud platforms."})
_EXTRACTION = json.dumps(
    {
        "skills": [{"category": "Cloud", "items": ["AWS"]}],
        "experience": [{"role": "Cloud Architect", "organization": "Example Corp", "start": "2021", "end": None}],
    }
)
_GOOD_GRADE = json.dumps(
    {"summary_claims": [{"claim": "designs platforms", "supported": True, "quote": "Designed hybrid cloud platforms"}], "checked": []}
)
# The fixture resume lets code accept 4 structured claims. Two summary claims whose quotes
# are not in the resume then make 4 supported of 6 -> 67, under the pass mark of 80.
_BAD_GRADE = json.dumps(
    {
        "summary_claims": [
            {"claim": "led a team of 40", "supported": True, "quote": "Led a team of forty engineers"},
            {"claim": "managed a large budget", "supported": True, "quote": "Managed a multi million budget"},
        ],
        "checked": [],
    }
)


def _bad_grade(bad_claims: int) -> str:
    claims = [{"claim": f"invented {n}", "supported": True, "quote": f"no such passage {n} anywhere"} for n in range(bad_claims)]
    return json.dumps({"summary_claims": claims, "checked": []})


class _FakeResumes:
    def __init__(self, markdown: str | None = _RESUME, error: Exception | None = None) -> None:
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


class _FakeSummarizer:
    """Answers prose and extraction requests (told apart by their system prompt)."""

    is_configured = True

    def __init__(self, prose: list[str] | None = None, extraction: list[str] | None = None) -> None:
        self.prose = list(prose or [])
        self.extraction = list(extraction or [])
        self.prose_calls = 0
        self.extraction_calls = 0
        self.prose_prompts: list[str] = []

    async def complete_json(self, messages: list[dict[str, str]]) -> str:
        await asyncio.sleep(0)
        if "copy structured facts" in messages[0]["content"]:
            self.extraction_calls += 1
            return self.extraction.pop(0) if self.extraction else _EXTRACTION
        self.prose_calls += 1
        self.prose_prompts.append(messages[0]["content"])
        return self.prose.pop(0) if self.prose else _PROSE

    @property
    def calls(self) -> int:
        return self.prose_calls + self.extraction_calls


class _FakeGrader:
    def __init__(self, replies: list[str | Exception] | None = None) -> None:
        self.replies = list(replies or [])
        self.calls = 0

    async def complete_json(self, messages: list[dict[str, str]]) -> str:
        self.calls += 1
        await asyncio.sleep(0)
        reply = self.replies.pop(0) if self.replies else _GOOD_GRADE
        if isinstance(reply, Exception):
            raise reply
        return reply


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


def _service(resumes=None, summarizer=None, grader=None, employees=None, progress=None) -> ResumeSummaryService:
    progress = progress or ProgressBoard()
    summarizer = summarizer or _FakeSummarizer()
    generator = SummaryGenerator(summarizer, SummaryVerifier(grader or _FakeGrader()), progress)
    return ResumeSummaryService(
        employee_service=employees or _FakeEmployees(),
        resume_client=resumes or _FakeResumes(),
        ica_client=summarizer,
        generator=generator,
        progress=progress,
    )


async def _drain_background(service: ResumeSummaryService) -> None:
    while service._background:
        await asyncio.gather(*service._background)


@pytest.mark.asyncio
async def test_second_request_is_served_from_cache():
    summarizer, grader = _FakeSummarizer(), _FakeGrader()
    service = _service(summarizer=summarizer, grader=grader)
    assert (await service.get_summary("A")).summary == "Designs cloud platforms."
    await service.get_summary("A")
    assert (summarizer.prose_calls, summarizer.extraction_calls, grader.calls) == (1, 1, 1)


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
    summarizer = _FakeSummarizer()
    service = _service(summarizer=summarizer)
    first, second = await asyncio.gather(service.get_summary("A"), service.get_summary("A"))
    assert first == second
    assert summarizer.prose_calls == 1


@pytest.mark.asyncio
async def test_invalid_output_is_retried_once():
    summarizer = _FakeSummarizer(prose=["not json", _PROSE])
    assert (await _service(summarizer=summarizer).get_summary("A")).summary == "Designs cloud platforms."
    assert summarizer.prose_calls == 2


@pytest.mark.asyncio
async def test_invalid_output_twice_is_bad_output():
    summarizer = _FakeSummarizer(prose=["not json", "still not json"])
    with pytest.raises(SummaryUnavailableException) as exc_info:
        await _service(summarizer=summarizer).get_summary("A")
    assert (exc_info.value.reason, exc_info.value.status_code) == ("bad_output", 502)


@pytest.mark.asyncio
async def test_unconfigured_ica_fails_before_fetching_the_resume():
    resumes = _FakeResumes()
    summarizer = _FakeSummarizer()
    summarizer.is_configured = False
    with pytest.raises(SummaryUnavailableException) as exc_info:
        await _service(resumes=resumes, summarizer=summarizer).get_summary("A")
    assert exc_info.value.reason == "not_configured"
    assert resumes.calls == []


@pytest.mark.asyncio
async def test_a_passing_first_attempt_stops_the_loop():
    summarizer, grader = _FakeSummarizer(), _FakeGrader()
    summary = await _service(summarizer=summarizer, grader=grader).get_summary("A")
    assert summary.verification.score == 100
    assert summary.verification.attempts == 1
    assert grader.calls == 1


@pytest.mark.asyncio
async def test_a_failing_attempt_regenerates_prose_with_feedback_and_keeps_the_extraction():
    summarizer = _FakeSummarizer()
    grader = _FakeGrader([_BAD_GRADE, _BAD_GRADE, _GOOD_GRADE])
    summary = await _service(summarizer=summarizer, grader=grader).get_summary("A")
    assert summary.verification.score == 100
    assert summary.verification.attempts == 3
    assert summarizer.prose_calls == 3
    assert summarizer.extraction_calls == 1
    assert "led a team of 40" not in summarizer.prose_prompts[0]
    assert "led a team of 40" in summarizer.prose_prompts[1]


@pytest.mark.asyncio
async def test_when_every_attempt_fails_the_best_scoring_one_is_returned():
    # Scores: 67, 57 (three bad claims), 67, 67 - the first 67 wins, not the last attempt.
    worse = _bad_grade(3)
    summarizer = _FakeSummarizer(prose=[json.dumps({"summary": f"Draft {n}."}) for n in range(4)])
    grader = _FakeGrader([_BAD_GRADE, worse, _BAD_GRADE, _BAD_GRADE])
    summary = await _service(summarizer=summarizer, grader=grader).get_summary("A")
    assert grader.calls == MAX_ATTEMPTS
    assert summary.summary == "Draft 0."
    assert summary.verification.score == 67
    assert summary.verification.attempts == MAX_ATTEMPTS


@pytest.mark.asyncio
async def test_a_grader_failure_on_the_first_attempt_returns_the_summary_unverified():
    grader = _FakeGrader([SummaryUnavailableException("ica_timeout", "slow", 504)])
    service = _service(grader=grader)
    summary = await service.get_summary("A")
    assert summary.verification is None
    assert summary.summary == "Designs cloud platforms."
    # Cached like any summary, so the failure isn't paid for again on the next view.
    await service.get_summary("A")
    assert grader.calls == 1


@pytest.mark.asyncio
async def test_a_grader_failure_mid_loop_keeps_the_best_graded_attempt():
    summarizer = _FakeSummarizer(prose=[json.dumps({"summary": "Draft 0."}), json.dumps({"summary": "Draft 1."})])
    grader = _FakeGrader([_BAD_GRADE, SummaryUnavailableException("rate_limited", "later")])
    summary = await _service(summarizer=summarizer, grader=grader).get_summary("A")
    assert summary.summary == "Draft 0."
    assert summary.verification.score == 67


@pytest.mark.asyncio
async def test_progress_is_idle_before_and_done_after_a_run():
    service = _service()
    assert service.get_progress("A").status == "idle"
    await service.get_summary("A")
    progress = service.get_progress("A")
    assert (progress.status, progress.phase, progress.scores) == ("done", "finished", [100])
    assert progress.draft is None


@pytest.mark.asyncio
async def test_the_first_draft_is_published_before_it_is_graded():
    seen: list[tuple[str, bool]] = []
    progress = ProgressBoard()

    class _Spy(_FakeGrader):
        async def complete_json(self, messages):
            snapshot = progress.get("A")
            seen.append((snapshot.draft.summary if snapshot.draft else "", snapshot.is_draft_verified))
            return await super().complete_json(messages)

    await _service(grader=_Spy(), progress=progress).get_summary("A")
    assert seen == [("Designs cloud platforms.", False)]


@pytest.mark.asyncio
async def test_a_failed_generation_leaves_no_progress_behind():
    service = _service(summarizer=_FakeSummarizer(prose=["x", "y"]))
    with pytest.raises(SummaryUnavailableException):
        await service.get_summary("A")
    assert service.get_progress("A").status == "idle"


@pytest.mark.asyncio
async def test_regenerate_replaces_the_cached_summary_when_the_new_score_is_not_lower():
    grader = _FakeGrader([_BAD_GRADE] * MAX_ATTEMPTS + [_GOOD_GRADE])
    service = _service(grader=grader)
    assert (await service.get_summary("A")).verification.score == 67
    result = await service.regenerate("A")
    assert result.replaced is True
    assert result.attempted_score == 100
    assert (await service.get_summary("A")).verification.score == 100


@pytest.mark.asyncio
async def test_regenerate_keeps_the_previous_summary_when_the_new_score_is_lower():
    worse = _bad_grade(3)
    grader = _FakeGrader([_BAD_GRADE] * MAX_ATTEMPTS + [worse] * MAX_ATTEMPTS)
    service = _service(grader=grader)
    first = await service.get_summary("A")
    result = await service.regenerate("A")
    assert result.replaced is False
    assert result.attempted_score == 57
    assert result.summary == first
    assert await service.get_summary("A") == first


@pytest.mark.asyncio
async def test_concurrent_regenerations_share_one_run():
    summarizer = _FakeSummarizer()
    service = _service(summarizer=summarizer)
    await service.get_summary("A")
    before = summarizer.prose_calls
    await asyncio.gather(service.regenerate("A"), service.regenerate("A"))
    assert summarizer.prose_calls - before == 1


@pytest.mark.asyncio
async def test_prefetches_manager_and_reports_capped_at_twenty():
    resumes = _FakeResumes()
    employees = _FakeEmployees(manager_id="M", report_ids=[f"R{i}" for i in range(25)])
    service = _service(resumes=resumes, employees=employees)
    await service.get_summary("A")
    await _drain_background(service)
    assert resumes.calls[0] == "A"
    assert sorted(resumes.calls[1:]) == sorted(["M", *(f"R{i}" for i in range(19))])


@pytest.mark.asyncio
async def test_prefetched_summary_is_a_cache_hit_graded_and_does_not_prefetch_further():
    summarizer, grader = _FakeSummarizer(), _FakeGrader()
    service = _service(summarizer=summarizer, grader=grader, employees=_FakeEmployees(manager_id="M"))
    await service.get_summary("A")
    await _drain_background(service)
    calls_after_prefetch = summarizer.calls
    assert (await service.get_summary("M")).verification.score == 100
    assert summarizer.calls == calls_after_prefetch == 4
    assert grader.calls == 2
    # Prefetch caches the result but publishes no draft for anyone to poll.
    assert service.get_progress("M").draft is None
