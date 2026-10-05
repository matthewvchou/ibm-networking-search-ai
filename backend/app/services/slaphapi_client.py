from urllib.parse import quote

import httpx

from app.core.config import settings
from app.core.exceptions import BluepagesUnavailableException, DirectoryTimeoutException


# Structural characters of an LDAP filter expression, left unescaped by quote() so
# that only the interpolated values are percent-encoded.
_SAFE_FILTER_CHARS = "()&|=!*,"


class SlaphapiClient:
    def __init__(self, base_url: str | None = None, timeout: float | None = None) -> None:
        self._base_url = base_url or settings.bluepages_base_url
        self._timeout = timeout or settings.bluepages_timeout_seconds
        # Reused across calls, same rationale as BluepagesClient: avoid a fresh
        # TCP/TLS handshake per Bluepages call.
        self._http_client = httpx.AsyncClient(timeout=self._timeout)

    async def query(
        self,
        object_class: str,
        filter_expr: str,
        attributes: str = "*",
        search_params: str | None = None,
        timeout: float | None = None,
    ) -> list[dict[str, str]]:
        # SLAPHAPI's query string isn't standard key=value pairs - it's a single
        # opaque expression: {object_class}/{filter}.list[,{params}]/byjson?{attributes}.
        # Built manually rather than via httpx's params= to preserve that shape.
        # search_params are comma-delimited SLAPHAPI search parameters (e.g. "base"
        # to treat object_class as a search base rather than an object class).
        # `attributes` is "*" or an &-delimited list ("cn&sn&uid"). A *comma*-separated
        # list is accepted and then silently answered with an empty attribute array,
        # which is why projection once looked impossible; it isn't, it was the wrong
        # delimiter. Callers still pass "*" - switching to projection is a deliberate
        # separate change (~9x smaller payloads). See CLAUDE.md.
        verb = ".list" + (f",{search_params}" if search_params else "")
        # The filter is percent-encoded before it reaches the URL, because this is a
        # query string and the filter carries user input. Raw values break it in two
        # ways that are easy to miss: "+" is decoded back to a space server-side
        # (a title search for "C++" answered 14 where the correct answer is 16), and
        # "#" truncates the URL as a fragment, so SLAPHAPI never sees the trailing
        # /byjson and replies in the wrong format. _SAFE_FILTER_CHARS keeps the
        # filter's own grammar intact so only the values are escaped.
        safe_filter = quote(filter_expr, safe=_SAFE_FILTER_CHARS)
        url = f"{self._base_url}/slaphapi?{object_class}/{safe_filter}{verb}/byjson?{attributes}"
        # Per-request timeout override on the shared client, for queries whose
        # payload can legitimately run to megabytes (see the search filter).
        request_kwargs = {} if timeout is None else {"timeout": timeout}
        try:
            response = await self._http_client.get(url, **request_kwargs)
            response.raise_for_status()
            payload = response.json()
        except httpx.TimeoutException as exc:
            # Distinct from the generic failure below so search can answer 504
            # rather than claiming the directory is unavailable.
            raise DirectoryTimeoutException(str(exc)) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise BluepagesUnavailableException(str(exc)) from exc

        return self._parse(payload)

    @staticmethod
    def _parse(payload: dict) -> list[dict[str, str]]:
        search = payload.get("search")
        if search is None:
            raise BluepagesUnavailableException(f"Unrecognized SLAPHAPI response: {payload!r}"[:200])

        result = search.get("return", {})
        code = result.get("code")
        if code != 0:
            raise BluepagesUnavailableException(
                f"SLAPHAPI returned code={code}: {result.get('message')}"
            )

        records: list[dict[str, str]] = []
        for entry in search.get("entry", []):
            # SLAPHAPI's own attribute-name casing is inconsistent across records
            # (e.g. "hrorganizationcode" vs "hrCompanyCode" vs "workLoc" in the
            # same payload) - normalize to lowercase so lookups don't need to guess.
            record = {
                attr["name"].lower(): attr["value"][0]
                for attr in entry.get("attribute", [])
                if attr.get("value")
            }
            records.append(record)
        return records
