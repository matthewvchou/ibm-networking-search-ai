import logging

from app.core.exceptions import SummaryUnavailableException
from app.models.keyword_suggestions import KeywordSuggestions
from app.services.employee_service import EmployeeService
from app.services.ica_client import IcaClient
from app.services.keyword_prompt import build_resume_messages, build_title_messages, parse_phrases
from app.services.resume_client import ResumeClient
from app.services.ttl_cache import MISSING, TtlLruCache

logger = logging.getLogger(__name__)

_RESUME_TTL_SECONDS = 24 * 60 * 60
# Shorter for answers that don't come from a resume, for the same reason a "no resume"
# summary is: the person can fix it by uploading one, and a day-old answer would hide that.
_NO_RESUME_TTL_SECONDS = 60 * 60
_CACHE_MAX_ENTRIES = 500
_INVALID_OUTPUT_RETRIES = 1


class KeywordSuggestionService:
    """Proposes job-title phrases to search the directory for, from a person's resume.

    Falls back to the profile's job title and sector when there is no resume, and
    answers `source="none"` when there is neither. Results are cached per employee
    (24h from a resume, 1h otherwise); failures are never cached.
    """

    def __init__(
        self,
        employee_service: EmployeeService,
        resume_client: ResumeClient | None = None,
        ica_client: IcaClient | None = None,
        cache: TtlLruCache[KeywordSuggestions] | None = None,
    ) -> None:
        self._employees = employee_service
        self._resumes = resume_client or ResumeClient()
        self._ica = ica_client or IcaClient()
        # Phrases are derived from personal data, so this is bounded and expiring like the
        # summary cache rather than a process-lifetime reference map.
        self._cache = cache or TtlLruCache(_CACHE_MAX_ENTRIES)

    async def get_suggestions(self, employee_id: str) -> KeywordSuggestions:
        """Returns the employee's search phrases and where they came from.

        Raises SummaryUnavailableException when the resume cannot be fetched or read, or
        the model fails or answers unusably. Raises BluepagesUnavailableException if the
        directory lookup used by the job-title fallback fails.
        """
        if not self._ica.is_configured:
            # Checked up front so an unconfigured install doesn't fetch a resume it can't use.
            raise SummaryUnavailableException("not_configured", "AI suggestions are not configured (no ICA API key).")
        cached = self._cache.get(employee_id)
        if cached is not MISSING:
            return cached
        suggestions, ttl_seconds = await self._generate(employee_id)
        self._cache.set(employee_id, suggestions, ttl_seconds)
        return suggestions

    async def _generate(self, employee_id: str) -> tuple[KeywordSuggestions, int]:
        markdown = await self._resumes.get_markdown(employee_id)
        if markdown is not None:
            phrases = await self._request_phrases(build_resume_messages(markdown))
            return KeywordSuggestions(phrases=phrases, source="resume"), _RESUME_TTL_SECONDS
        employee = await self._employees.get_enriched_by_id(employee_id)
        if employee is None or not employee.title:
            return KeywordSuggestions(phrases=[], source="none"), _NO_RESUME_TTL_SECONDS
        phrases = await self._request_phrases(build_title_messages(employee.title, employee.org_unit))
        return KeywordSuggestions(phrases=phrases, source="title"), _NO_RESUME_TTL_SECONDS

    async def _request_phrases(self, messages: list[dict[str, str]]) -> list[str]:
        for _ in range(1 + _INVALID_OUTPUT_RETRIES):
            content = await self._ica.complete_json(messages)
            try:
                return parse_phrases(content)
            except ValueError as exc:
                logger.warning("Discarding invalid keyword output: %s", exc)
        raise SummaryUnavailableException("bad_output", "The AI service returned invalid suggestions.", 502)
