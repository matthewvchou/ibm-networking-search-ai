import asyncio
import logging
from typing import NamedTuple

from app.core.config import settings
from app.core.exceptions import BluepagesUnavailableException, SummaryUnavailableException
from app.models.resume_summary import ResumeSummary, SummaryProgress
from app.services.employee_service import EmployeeService
from app.services.ica_client import IcaClient
from app.services.resume_client import ResumeClient
from app.services.summary_generator import SummaryGenerator
from app.services.summary_progress import ProgressBoard
from app.services.summary_verifier import SummaryVerifier
from app.services.ttl_cache import MISSING, TtlLruCache

logger = logging.getLogger(__name__)

_SUMMARY_TTL_SECONDS = 24 * 60 * 60
# Shorter than a summary's: "no resume" is a real answer, but one a person can fix by
# uploading, and caching it at all is only to stop prefetch re-asking the proxy.
_NO_RESUME_TTL_SECONDS = 60 * 60
_CACHE_MAX_ENTRIES = 500
_PREFETCH_MAX_PEOPLE = 20


class RegenerationResult(NamedTuple):
    """What a manual regeneration produced and whether it replaced the cached summary."""

    summary: ResumeSummary
    replaced: bool
    attempted_score: int | None


class ResumeSummaryService:
    """Produces AI summaries of employee resumes: PDF -> Markdown -> ICA -> graded ResumeSummary.

    Summaries live in a process-lifetime cache (24h; "no resume" for 1h). Failures are
    never cached, so a transient outage isn't remembered. Concurrent requests for one
    employee share a single generation, and serving a summary quietly prefetches the
    employee's manager and direct reports, since those are the likeliest next clicks.
    """

    def __init__(
        self,
        employee_service: EmployeeService,
        resume_client: ResumeClient | None = None,
        ica_client: IcaClient | None = None,
        cache: TtlLruCache[ResumeSummary | None] | None = None,
        generator: SummaryGenerator | None = None,
        progress: ProgressBoard | None = None,
    ) -> None:
        self._employees = employee_service
        self._resumes = resume_client or ResumeClient()
        self._ica = ica_client or IcaClient()
        self._progress = progress or ProgressBoard()
        self._generator = generator or SummaryGenerator(
            self._ica, SummaryVerifier(IcaClient(model=settings.ica_verifier_model)), self._progress
        )
        # Holds personal data, unlike the directory's reference-data caches - which is
        # why it is bounded, expires, and dies with the process.
        self._cache = cache or TtlLruCache(_CACHE_MAX_ENTRIES)
        self._in_flight: dict[str, asyncio.Task[ResumeSummary | None]] = {}
        self._regenerating: dict[str, asyncio.Task[RegenerationResult]] = {}
        # Strong references, since the event loop only keeps weak ones to tasks.
        self._background: set[asyncio.Task[None]] = set()

    def resume_url(self, employee_id: str) -> str:
        return self._resumes.resume_url(employee_id)

    def get_progress(self, employee_id: str) -> SummaryProgress:
        """Returns how far the employee's current generation has got; idle if none is running."""
        return self._progress.get(employee_id)

    async def get_summary(self, employee_id: str) -> ResumeSummary:
        """Returns the employee's resume summary, then schedules prefetch of related people.

        Raises SummaryUnavailableException: "no_resume" (404) when there is no resume,
        otherwise the resume-fetch or ICA failure that prevented a summary.
        """
        self._require_configured()
        summary = await self._get_or_generate(employee_id, is_prefetch=False)
        self._schedule_prefetch(employee_id)
        if summary is None:
            raise SummaryUnavailableException("no_resume", "No resume on file.", 404)
        return summary

    async def regenerate(self, employee_id: str) -> RegenerationResult:
        """Runs a fresh generate-and-grade loop, keeping it only if it scores no lower.

        Bypasses the cache. The previous summary stays cached (and on screen) when the
        new one scores lower, so a manual retry can never make the result worse. A
        regeneration already running for the employee is joined, not duplicated.
        """
        self._require_configured()
        task = self._regenerating.get(employee_id)
        if task is None:
            task = asyncio.create_task(self._regenerate(employee_id))
            self._regenerating[employee_id] = task
            task.add_done_callback(lambda done: self._finish_regeneration(employee_id, done))
        return await asyncio.shield(task)

    def _require_configured(self) -> None:
        if not self._ica.is_configured:
            # Checked up front so an unconfigured install doesn't fetch a PDF it can't use.
            raise SummaryUnavailableException("not_configured", "AI summaries are not configured (no ICA API key).")

    async def _get_or_generate(self, employee_id: str, is_prefetch: bool) -> ResumeSummary | None:
        cached = self._cache.get(employee_id)
        if cached is not MISSING:
            return cached
        task = self._in_flight.get(employee_id)
        if task is None:
            task = asyncio.create_task(self._generate(employee_id, is_prefetch))
            self._in_flight[employee_id] = task
            task.add_done_callback(lambda done: self._finish_in_flight(employee_id, done))
        # Shielded so a browser navigating away doesn't cancel a generation that other
        # waiters share and whose result is about to be cached.
        return await asyncio.shield(task)

    def _finish_in_flight(self, employee_id: str, task: asyncio.Task[ResumeSummary | None]) -> None:
        self._in_flight.pop(employee_id, None)
        # Marks the exception retrieved: every waiter may have gone (a navigated-away
        # browser), and asyncio would otherwise log it as never retrieved.
        if not task.cancelled():
            task.exception()

    def _finish_regeneration(self, employee_id: str, task: asyncio.Task[RegenerationResult]) -> None:
        self._regenerating.pop(employee_id, None)
        if not task.cancelled():
            task.exception()

    async def _generate(self, employee_id: str, is_prefetch: bool) -> ResumeSummary | None:
        markdown = await self._resumes.get_markdown(employee_id)
        if markdown is None:
            self._cache.set(employee_id, None, _NO_RESUME_TTL_SECONDS)
            return None
        summary = await self._generator.generate(employee_id, markdown, is_prefetch, publish_draft=not is_prefetch)
        self._cache.set(employee_id, summary, _SUMMARY_TTL_SECONDS)
        return summary

    async def _regenerate(self, employee_id: str) -> RegenerationResult:
        markdown = await self._resumes.get_markdown(employee_id)
        if markdown is None:
            self._cache.set(employee_id, None, _NO_RESUME_TTL_SECONDS)
            raise SummaryUnavailableException("no_resume", "No resume on file.", 404)
        previous = self._cache.get(employee_id)
        # The old summary stays on screen, so no draft is published for the new run; its
        # text is passed along so the new prose is worded differently, not re-rolled.
        fresh = await self._generator.generate(
            employee_id,
            markdown,
            is_prefetch=False,
            publish_draft=False,
            previous_summary=previous.summary if isinstance(previous, ResumeSummary) else None,
        )
        attempted_score = fresh.verification.score if fresh.verification else None
        if isinstance(previous, ResumeSummary) and _score_of(fresh) < _score_of(previous):
            return RegenerationResult(previous, replaced=False, attempted_score=attempted_score)
        self._cache.set(employee_id, fresh, _SUMMARY_TTL_SECONDS)
        return RegenerationResult(fresh, replaced=True, attempted_score=attempted_score)

    def _schedule_prefetch(self, employee_id: str) -> None:
        task = asyncio.create_task(self._prefetch_related(employee_id))
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def _prefetch_related(self, employee_id: str) -> None:
        try:
            related_ids = await self._related_ids(employee_id)
        except BluepagesUnavailableException:
            return
        await asyncio.gather(*(self._prefetch_one(related_id) for related_id in related_ids))

    async def _related_ids(self, employee_id: str) -> list[str]:
        employee, reports = await asyncio.gather(
            self._employees.get_by_id(employee_id), self._employees.get_direct_reports(employee_id)
        )
        manager_ids = [employee.manager_id] if employee and employee.manager_id else []
        ids = dict.fromkeys([*manager_ids, *(report.id for report in reports)])
        return [related_id for related_id in ids if related_id != employee_id][:_PREFETCH_MAX_PEOPLE]

    async def _prefetch_one(self, employee_id: str) -> None:
        # Prefetched summaries don't prefetch their own relatives: that would walk the
        # whole org, all billed to one personal ICA developer key.
        try:
            await self._get_or_generate(employee_id, is_prefetch=True)
        except SummaryUnavailableException as exc:
            logger.info("Prefetch of %s skipped: %s", employee_id, exc.reason)


def _score_of(summary: ResumeSummary) -> int:
    """A summary's grade for comparison; an ungraded one ranks below any graded one."""
    verification = summary.verification
    return verification.score if verification is not None and verification.score is not None else -1
