import asyncio
import logging

from app.core.exceptions import BluepagesUnavailableException, SummaryUnavailableException
from app.models.resume_summary import ResumeSummary
from app.services.employee_service import EmployeeService
from app.services.ica_client import IcaClient
from app.services.resume_client import ResumeClient
from app.services.summary_prompt import build_messages, parse_summary
from app.services.ttl_cache import MISSING, TtlLruCache

logger = logging.getLogger(__name__)

_SUMMARY_TTL_SECONDS = 24 * 60 * 60
# Shorter than a summary's: "no resume" is a real answer, but one a person can fix by
# uploading, and caching it at all is only to stop prefetch re-asking the proxy.
_NO_RESUME_TTL_SECONDS = 60 * 60
_CACHE_MAX_ENTRIES = 500
_ICA_CONCURRENCY = 3
# Below _ICA_CONCURRENCY, so prefetch can never hold every slot: an on-screen request
# always finds one free rather than queueing behind summaries nobody asked for.
_PREFETCH_ICA_CONCURRENCY = 2
_PREFETCH_MAX_PEOPLE = 10
_INVALID_OUTPUT_RETRIES = 1


class ResumeSummaryService:
    """Produces AI summaries of employee resumes: PDF -> Markdown -> ICA -> ResumeSummary.

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
    ) -> None:
        self._employees = employee_service
        self._resumes = resume_client or ResumeClient()
        self._ica = ica_client or IcaClient()
        # Holds personal data, unlike the directory's reference-data caches - which is
        # why it is bounded, expires, and dies with the process.
        self._cache = cache or TtlLruCache(_CACHE_MAX_ENTRIES)
        self._in_flight: dict[str, asyncio.Task[ResumeSummary | None]] = {}
        self._ica_slots = asyncio.Semaphore(_ICA_CONCURRENCY)
        self._prefetch_slots = asyncio.Semaphore(_PREFETCH_ICA_CONCURRENCY)
        # Strong references, since the event loop only keeps weak ones to tasks.
        self._background: set[asyncio.Task[None]] = set()

    def resume_url(self, employee_id: str) -> str:
        return self._resumes.resume_url(employee_id)

    async def get_summary(self, employee_id: str) -> ResumeSummary:
        """Returns the employee's resume summary, then schedules prefetch of related people.

        Raises SummaryUnavailableException: "no_resume" (404) when there is no resume,
        otherwise the resume-fetch or ICA failure that prevented a summary.
        """
        if not self._ica.is_configured:
            # Checked up front so an unconfigured install doesn't fetch a PDF it can't use.
            raise SummaryUnavailableException("not_configured", "AI summaries are not configured (no ICA API key).")
        summary = await self._get_or_generate(employee_id, is_prefetch=False)
        self._schedule_prefetch(employee_id)
        if summary is None:
            raise SummaryUnavailableException("no_resume", "No resume on file.", 404)
        return summary

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

    async def _generate(self, employee_id: str, is_prefetch: bool) -> ResumeSummary | None:
        markdown = await self._resumes.get_markdown(employee_id)
        if markdown is None:
            self._cache.set(employee_id, None, _NO_RESUME_TTL_SECONDS)
            return None
        summary = await self._summarize(markdown, is_prefetch)
        self._cache.set(employee_id, summary, _SUMMARY_TTL_SECONDS)
        return summary

    async def _summarize(self, markdown: str, is_prefetch: bool) -> ResumeSummary:
        messages = build_messages(markdown)
        for _ in range(1 + _INVALID_OUTPUT_RETRIES):
            content = await self._complete(messages, is_prefetch)
            try:
                return parse_summary(content)
            except ValueError as exc:
                logger.warning("Discarding invalid summary output: %s", exc)
        raise SummaryUnavailableException("bad_output", "The AI service returned an invalid summary.", 502)

    async def _complete(self, messages: list[dict[str, str]], is_prefetch: bool) -> str:
        if is_prefetch:
            async with self._prefetch_slots, self._ica_slots:
                return await self._ica.complete_json(messages)
        async with self._ica_slots:
            return await self._ica.complete_json(messages)

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
