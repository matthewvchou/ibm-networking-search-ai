import httpx

from app.core.config import settings
from app.core.exceptions import BluepagesUnavailableException


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
    ) -> list[dict[str, str]]:
        # SLAPHAPI's query string isn't standard key=value pairs - it's a single
        # opaque expression: {object_class}/{filter}.list[,{params}]/byjson?{attributes}.
        # Built manually rather than via httpx's params= to preserve that shape.
        # search_params are comma-delimited SLAPHAPI search parameters (e.g. "base"
        # to treat object_class as a search base rather than an object class).
        verb = ".list" + (f",{search_params}" if search_params else "")
        url = f"{self._base_url}/slaphapi?{object_class}/{filter_expr}{verb}/byjson?{attributes}"
        try:
            response = await self._http_client.get(url)
            response.raise_for_status()
            payload = response.json()
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
