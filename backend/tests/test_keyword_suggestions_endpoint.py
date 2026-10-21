"""The keyword-suggestions route through the real app, with a fake service behind it."""

import httpx
import pytest

from app.api.routers import employees
from app.core.exceptions import SummaryUnavailableException
from app.main import app
from app.models.keyword_suggestions import KeywordSuggestions


class _FakeKeywordService:
    def __init__(self, result: KeywordSuggestions | None = None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[str] = []

    async def get_suggestions(self, employee_id: str) -> KeywordSuggestions:
        self.calls.append(employee_id)
        if self.error:
            raise self.error
        assert self.result is not None
        return self.result


async def _get(path: str) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.get(path)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("result", "expected"),
    [
        (KeywordSuggestions(phrases=["cloud architect"], source="resume"), {"phrases": ["cloud architect"], "source": "resume"}),
        (KeywordSuggestions(phrases=["site reliability"], source="title"), {"phrases": ["site reliability"], "source": "title"}),
        (KeywordSuggestions(phrases=[], source="none"), {"phrases": [], "source": "none"}),
    ],
)
async def test_returns_phrases_and_source(monkeypatch, result, expected):
    service = _FakeKeywordService(result=result)
    monkeypatch.setattr(employees, "_keyword_service", service)
    response = await _get("/api/employees/ABC123/suggestions/keywords")
    assert (response.status_code, response.json()) == (200, expected)
    assert service.calls == ["ABC123"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "status", "reason"),
    [
        (SummaryUnavailableException("rate_limited", "Slow down."), 503, "rate_limited"),
        (SummaryUnavailableException("ica_timeout", "Timed out.", 504), 504, "ica_timeout"),
        (SummaryUnavailableException("bad_output", "Unusable.", 502), 502, "bad_output"),
        (SummaryUnavailableException("not_configured", "No key."), 503, "not_configured"),
    ],
)
async def test_failures_answer_with_reason_and_detail(monkeypatch, error, status, reason):
    monkeypatch.setattr(employees, "_keyword_service", _FakeKeywordService(error=error))
    response = await _get("/api/employees/ABC123/suggestions/keywords")
    assert response.status_code == status
    assert response.json() == {"reason": reason, "detail": error.message}
