import re

import httpx

from app.core.config import settings
from app.core.exceptions import BluepagesUnavailableException

_TRAILER_RE = re.compile(r"rc=(\d+),\s*count=(\d+),\s*message=(.*)")


class BluepagesClient:
    def __init__(self, base_url: str | None = None, timeout: float | None = None) -> None:
        self._base_url = base_url or settings.bluepages_base_url
        self._timeout = timeout or settings.bluepages_timeout_seconds

    async def query(self, method: str, value: str) -> list[dict[str, str]]:
        url = f"{self._base_url}/wsapi"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(url, params={method: value})
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise BluepagesUnavailableException(str(exc)) from exc

        return self._parse(response.text)

    async def ping(self) -> bool:
        url = f"{self._base_url}/wsapi"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(url)
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
        for line in record_lines:
            if not line.strip() or ":" not in line:
                continue
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            if key == "CNUM":
                current = {}
                records.append(current)
            if current is not None:
                current[key] = value
        return records
