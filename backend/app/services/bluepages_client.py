import re

import httpx

from app.core.config import settings
from app.core.exceptions import BluepagesUnavailableException

_TRAILER_RE = re.compile(r"rc=(\d+),\s*count=(\d+),\s*message=(.*)")


class BluepagesClient:
    def __init__(self, base_url: str | None = None, timeout: float | None = None) -> None:
        self._base_url = base_url or settings.bluepages_base_url
        self._timeout = timeout or settings.bluepages_timeout_seconds
        # Reused across calls so concurrent org-chart requests share a connection pool
        # instead of paying a fresh TCP/TLS handshake per Bluepages call.
        self._http_client = httpx.AsyncClient(timeout=self._timeout)

    async def query(self, method: str, value: str, timeout: float | None = None) -> list[dict[str, str]]:
        url = f"{self._base_url}/wsapi"
        request_kwargs = {"params": {method: value}}
        if timeout is not None:
            # Per-request override on the shared client, e.g. for riskier queries
            # that shouldn't wait as long as the default before giving up.
            request_kwargs["timeout"] = timeout
        try:
            response = await self._http_client.get(url, **request_kwargs)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise BluepagesUnavailableException(str(exc)) from exc

        return self._parse(response.text)

    async def ping(self) -> bool:
        url = f"{self._base_url}/wsapi"
        try:
            response = await self._http_client.get(url)
            response.raise_for_status()
        except httpx.HTTPError:
            return False
        return True

    @staticmethod
    def _parse(text: str) -> list[dict[str, str]]:
        lines = text.splitlines()
        if not lines:
            raise BluepagesUnavailableException("Empty response from Bluepages")

        trailer_match = None
        record_lines: list[str] = []
        for line in lines:
            match = _TRAILER_RE.search(line)
            if match:
                trailer_match = match
            else:
                record_lines.append(line)

        if trailer_match is None:
            raise BluepagesUnavailableException(f"Unrecognized response format: {text[:200]!r}")

        rc = int(trailer_match.group(1))
        if rc != 0:
            raise BluepagesUnavailableException(f"Bluepages returned rc={rc}: {trailer_match.group(3)}")

        records: list[dict[str, str]] = []
        current: dict[str, str] | None = None
        # Employee-shaped responses (byCnum, allByNameFuzzy, directReportsOf, ...) key
        # each record's start on "CNUM:". Reference-lookup responses (workLoc, orgCodes,
        # ...) have no CNUM at all and instead repeat their own first field per record
        # (e.g. "WORKLOC:", "ORGCODE:"). Treat the first field name seen as the record
        # delimiter, since it's always the one that repeats once per record either way.
        record_key: str | None = None
        for line in record_lines:
            if not line.strip() or ":" not in line:
                continue
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            if record_key is None:
                record_key = key
            if key == record_key:
                current = {}
                records.append(current)
            if current is not None:
                current[key] = value
        return records
