import httpx

from app.core.config import settings
from app.core.exceptions import SummaryUnavailableException

# ICA status -> (reason, message). 401 and 403 are documented; 429 is not, but a
# shared LLM gateway rate-limiting is likely enough to name.
_STATUS_REASONS = {
    401: ("key_invalid", "The ICA API key is missing or revoked."),
    403: ("not_entitled", "The ICA API key is not entitled to this model."),
    429: ("rate_limited", "The AI service is rate-limiting requests. Try again shortly."),
}


class IcaClient:
    """Calls IBM Consulting Advantage's OpenAI-compatible chat-models endpoint."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self._api_key = settings.ica_api_key if api_key is None else api_key
        self._base_url = base_url or settings.ica_base_url
        self._model = model or settings.ica_model
        self._http_client = httpx.AsyncClient(timeout=timeout or settings.ica_timeout_seconds)

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    async def complete_json(self, messages: list[dict[str, str]]) -> str:
        """Returns the model's reply text for `messages`, asking for a JSON object.

        `response_format` is accepted but not enforced by every model behind ICA
        (measured: Claude Haiku still wraps its JSON in a markdown fence), so callers
        must parse defensively. Raises SummaryUnavailableException on any failure.
        """
        if not self.is_configured:
            raise SummaryUnavailableException("not_configured", "AI summaries are not configured (no ICA API key).")
        body = {
            "model": self._model,
            "messages": messages,
            "stream": False,
            "response_format": {"type": "json_object"},
        }
        try:
            response = await self._http_client.post(
                f"{self._base_url}/chat-models/chat/completions",
                json=body,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
        except httpx.TimeoutException as exc:
            raise SummaryUnavailableException("ica_timeout", "The AI service timed out.", 504) from exc
        except httpx.HTTPError as exc:
            raise SummaryUnavailableException("ica_unavailable", "The AI service is unavailable.") from exc
        _raise_for_status(response)
        try:
            return response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise SummaryUnavailableException("bad_output", "The AI service returned an unexpected response.", 502) from exc


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code == 200:
        return
    if response.status_code in _STATUS_REASONS:
        reason, message = _STATUS_REASONS[response.status_code]
        raise SummaryUnavailableException(reason, message)
    if response.status_code >= 500:
        raise SummaryUnavailableException("ica_unavailable", "The AI service is unavailable.")
    # Any other 4xx is ICA rejecting this specific request (e.g. a resume past the
    # model's context window), so its own explanation is the useful part.
    raise SummaryUnavailableException(
        "ica_rejected", f"The AI service rejected the request: {_detail(response)}", 502
    )


def _detail(response: httpx.Response) -> str:
    try:
        detail = response.json().get("detail")
    except ValueError:
        detail = None
    return str(detail) if detail else f"HTTP {response.status_code}"
