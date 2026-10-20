import asyncio
import logging
from collections.abc import Callable
from typing import TypeVar

from app.core.exceptions import SummaryUnavailableException
from app.models.resume_summary import (
    MAX_FLAGGED_CLAIMS,
    FlaggedClaim,
    ResumeExtraction,
    ResumeSummary,
    SummaryProse,
    Verification,
)
from app.services.ica_client import IcaClient
from app.services.summary_progress import ProgressBoard
from app.services.summary_prompt import (
    build_extraction_messages,
    build_prose_messages,
    parse_extraction,
    parse_prose,
)
from app.services.summary_verifier import Claim, Grade, SummaryVerifier, remove_unsupported

logger = logging.getLogger(__name__)

T = TypeVar("T")

VERIFICATION_PASS_SCORE = 80
# One cold attempt plus up to three regenerations.
MAX_ATTEMPTS = 4
_ICA_CONCURRENCY = 4
# Below _ICA_CONCURRENCY, so prefetch can never hold every slot: an on-screen request
# always finds the two it needs (prose and extraction run in parallel) rather than
# queueing behind summaries nobody asked for.
_PREFETCH_ICA_CONCURRENCY = 2
_VERIFY_CONCURRENCY = 3
_INVALID_OUTPUT_RETRIES = 1
# More dropped items than this means the extraction itself went wrong, not one stray
# skill, so the next attempt re-extracts instead of reusing the cleaned list.
_MAX_DROPPED_BEFORE_REEXTRACT = 3


class SummaryGenerator:
    """Writes a resume summary and grades it, regenerating until it passes or attempts run out.

    Each attempt writes the two-sentence prose and (first time only) extracts the
    structured facts, in parallel; a second model then grades the result. Under
    VERIFICATION_PASS_SCORE the prose is rewritten with the rejected claims as feedback,
    and structured items the grader rejected are dropped. The best-scoring attempt wins.
    A grader failure ends the loop and never fails the summary.
    """

    def __init__(self, ica_client: IcaClient, verifier: SummaryVerifier, progress: ProgressBoard) -> None:
        self._ica = ica_client
        self._verifier = verifier
        self._progress = progress
        self._ica_slots = asyncio.Semaphore(_ICA_CONCURRENCY)
        self._prefetch_slots = asyncio.Semaphore(_PREFETCH_ICA_CONCURRENCY)
        # Its own pool, so a slow grading never holds a generation slot.
        self._verify_slots = asyncio.Semaphore(_VERIFY_CONCURRENCY)

    async def generate(
        self, employee_id: str, resume_markdown: str, is_prefetch: bool, publish_draft: bool
    ) -> ResumeSummary:
        """Returns the best summary found, with its verification (None if never graded).

        `publish_draft` shows the first, ungraded attempt on the progress board; a manual
        regeneration passes False because the previous summary stays on screen. Raises
        SummaryUnavailableException if the first attempt cannot be written.
        """
        self._progress.start(employee_id, MAX_ATTEMPTS)
        try:
            summary = await self._attempt_loop(employee_id, resume_markdown, is_prefetch, publish_draft)
        except BaseException:
            self._progress.clear(employee_id)
            raise
        self._progress.finish(employee_id)
        return summary

    async def _attempt_loop(
        self, employee_id: str, markdown: str, is_prefetch: bool, publish_draft: bool
    ) -> ResumeSummary:
        best: ResumeSummary | None = None
        feedback: list[str] = []
        extraction: ResumeExtraction | None = None
        removed: list[FlaggedClaim] = []
        scores: list[int | None] = []
        attempts_used = 0
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._progress.update(employee_id, attempt=attempt, phase="summarizing")
            try:
                summary = await self._compose(markdown, is_prefetch, feedback, extraction)
            except SummaryUnavailableException:
                if best is None:
                    raise
                break
            attempts_used = attempt
            if publish_draft and best is None:
                self._progress.update(employee_id, draft=summary, is_draft_verified=False)
            self._progress.update(employee_id, phase="verifying")
            try:
                grade = await self._grade(markdown, summary)
            except SummaryUnavailableException as exc:
                logger.info("Grading failed (%s); keeping %s", exc.reason, "best attempt" if best else "unverified draft")
                scores.append(None)
                self._progress.update(employee_id, scores=list(scores))
                return _finalize(best or summary, attempts_used)
            cleaned, dropped = remove_unsupported(summary, grade.unsupported)
            # Items dropped earlier are gone from `summary`, so the grader never sees them;
            # they are added back to the tally so dropping an item is not a way to score higher.
            verification = _with_removed(grade.verification, removed)
            removed = [*removed, *_removed_flags(grade)]
            candidate = cleaned.model_copy(update={"verification": verification})
            scores.append(verification.score)
            self._progress.update(employee_id, scores=list(scores))
            if best is None or _rank(candidate) > _rank(best):
                best = candidate
                if publish_draft:
                    self._progress.update(employee_id, draft=best, is_draft_verified=True)
            if verification.score is None or verification.score >= VERIFICATION_PASS_SCORE:
                break
            feedback = [claim.text for claim in grade.unsupported if claim.section == "summary"]
            must_reextract = dropped > _MAX_DROPPED_BEFORE_REEXTRACT
            if must_reextract:
                extraction, removed = None, []
            else:
                extraction = _extraction_of(cleaned)
            if not feedback and not must_reextract:
                # Only structured items failed and they are already out; another prose
                # draft cannot change the score.
                break
        assert best is not None
        return _finalize(best, attempts_used)

    async def _compose(
        self, markdown: str, is_prefetch: bool, feedback: list[str], extraction: ResumeExtraction | None
    ) -> ResumeSummary:
        prose_call = self._request(build_prose_messages(markdown, feedback), parse_prose, is_prefetch)
        if extraction is not None:
            prose = await prose_call
            return _combine(prose, extraction)
        prose, extracted = await asyncio.gather(
            prose_call, self._request(build_extraction_messages(markdown), parse_extraction, is_prefetch)
        )
        return _combine(prose, extracted)

    async def _request(self, messages: list[dict[str, str]], parse: Callable[[str], T], is_prefetch: bool) -> T:
        for _ in range(1 + _INVALID_OUTPUT_RETRIES):
            content = await self._complete(messages, is_prefetch)
            try:
                return parse(content)
            except ValueError as exc:
                logger.warning("Discarding invalid summary output: %s", exc)
        raise SummaryUnavailableException("bad_output", "The AI service returned an invalid summary.", 502)

    async def _complete(self, messages: list[dict[str, str]], is_prefetch: bool) -> str:
        if is_prefetch:
            async with self._prefetch_slots, self._ica_slots:
                return await self._ica.complete_json(messages)
        async with self._ica_slots:
            return await self._ica.complete_json(messages)

    async def _grade(self, markdown: str, summary: ResumeSummary) -> Grade:
        async with self._verify_slots:
            return await self._verifier.verify(markdown, summary)


def _combine(prose: SummaryProse, extraction: ResumeExtraction) -> ResumeSummary:
    return ResumeSummary(**prose.model_dump(), **extraction.model_dump())


def _extraction_of(summary: ResumeSummary) -> ResumeExtraction:
    return ResumeExtraction(
        skills=summary.skills,
        experience=summary.experience,
        education=summary.education,
        certifications=summary.certifications,
    )


def _removed_flags(grade: Grade) -> list[FlaggedClaim]:
    """The structured claims a grading rejected, as flags to carry into later attempts."""
    return [
        FlaggedClaim(section=claim.section, claim=claim.text, removed=claim.is_primary)
        for claim in grade.unsupported
        if claim.section != "summary"
    ]


def _with_removed(verification: Verification, earlier_removed: list[FlaggedClaim]) -> Verification:
    """Counts items dropped in earlier attempts as unsupported, so removing them is not a free pass."""
    if not earlier_removed:
        return verification
    total = verification.total_claims + len(earlier_removed)
    flagged = [*earlier_removed, *verification.flagged_claims][:MAX_FLAGGED_CLAIMS]
    return verification.model_copy(
        update={
            "total_claims": total,
            "score": round(100 * verification.supported_claims / total),
            "flagged_claims": flagged,
        }
    )


def _rank(summary: ResumeSummary) -> int:
    verification = summary.verification
    return verification.score if verification is not None and verification.score is not None else -1


def _finalize(summary: ResumeSummary, attempts_used: int) -> ResumeSummary:
    if summary.verification is None:
        return summary
    return summary.model_copy(update={"verification": summary.verification.model_copy(update={"attempts": attempts_used})})
