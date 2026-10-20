"""ICA chat-completion calls and the mapping of each failure to a summary reason."""

import httpx
import pytest
import respx

from app.core.exceptions import SummaryUnavailableException
from app.services.ica_client import IcaClient

_BASE = "https://ica.example.test/v1"
_URL = f"{_BASE}/chat-models/chat/completions"
_MESSAGES = [{"role": "user", "content": "hi"}]


def _client(api_key: str = "test-key") -> IcaClient:
    return IcaClient(api_key=api_key, base_url=_BASE, model="test-model", timeout=5)


async def _reason_for(response: httpx.Response | Exception) -> tuple[str, int]:
    with respx.mock:
        route = respx.post(_URL)
        if isinstance(response, Exception):
            route.side_effect = response
        else:
            route.return_value = response
        with pytest.raises(SummaryUnavailableException) as exc_info:
            await _client().complete_json(_MESSAGES)
    return exc_info.value.reason, exc_info.value.status_code


@pytest.mark.asyncio
async def test_returns_message_content_and_sends_auth_model_and_json_mode():
    with respx.mock:
        route = respx.post(_URL).respond(200, json={"choices": [{"message": {"content": "{}"}}]})
        assert await _client().complete_json(_MESSAGES) == "{}"
    request = route.calls.last.request
    assert request.headers["Authorization"] == "Bearer test-key"
    body = httpx.Response(200, content=request.content).json()
    assert body["model"] == "test-model"
    assert body["response_format"] == {"type": "json_object"}
    assert body["stream"] is False


@pytest.mark.asyncio
async def test_missing_key_is_not_configured_without_calling_ica():
    with respx.mock:
        route = respx.post(_URL)
        with pytest.raises(SummaryUnavailableException) as exc_info:
            await _client(api_key="").complete_json(_MESSAGES)
    assert exc_info.value.reason == "not_configured"
    assert not route.called


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "reason", "http_status"),
    [
        (401, "key_invalid", 503),
        (403, "not_entitled", 503),
        (429, "rate_limited", 503),
        (500, "ica_unavailable", 503),
        (400, "ica_rejected", 502),
    ],
)
async def test_maps_error_statuses_to_reasons(status, reason, http_status):
    assert await _reason_for(httpx.Response(status, json={"detail": "nope"})) == (reason, http_status)


@pytest.mark.asyncio
async def test_rejection_message_carries_icas_detail():
    with respx.mock:
        respx.post(_URL).respond(400, json={"detail": "context length exceeded"})
        with pytest.raises(SummaryUnavailableException) as exc_info:
            await _client().complete_json(_MESSAGES)
    assert "context length exceeded" in exc_info.value.message


@pytest.mark.asyncio
async def test_timeout_is_a_504():
    assert await _reason_for(httpx.ReadTimeout("slow")) == ("ica_timeout", 504)


@pytest.mark.asyncio
async def test_connection_error_is_unavailable():
    assert await _reason_for(httpx.ConnectError("down")) == ("ica_unavailable", 503)


@pytest.mark.asyncio
async def test_unexpected_response_shape_is_bad_output():
    assert await _reason_for(httpx.Response(200, json={"choices": []})) == ("bad_output", 502)
