import asyncio
import io
import re
import ssl
from urllib.parse import quote

import httpx
import truststore
from markitdown import MarkItDown, MarkItDownException, StreamInfo

from app.core.config import settings
from app.core.exceptions import SummaryUnavailableException

# The uploaded file's original name, e.g. attachment; fileName="Bio 9.14.22.docx".
_FILENAME_EXTENSION_RE = re.compile(r'filename\*?="?[^";]*?(\.[A-Za-z0-9]+)"?\s*(?:;|$)', re.IGNORECASE)
_SUPPORTED_EXTENSIONS = frozenset({".pdf", ".docx"})
_MIMETYPE_EXTENSIONS = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}


class ResumeClient:
    """Fetches an employee's resume from the w3 profile proxy as Markdown.

    The proxy needs no auth and answers 404 for an employee with no resume. Despite the
    route's name the file is whatever the employee uploaded: measured over 80 people,
    12 had one - 9 PDF, 2 DOCX, 1 legacy DOC (which MarkItDown cannot read).
    """

    def __init__(self, base_url: str | None = None, timeout: float | None = None) -> None:
        self._base_url = base_url or settings.resume_base_url
        # Shared for the instance's lifetime, like BluepagesClient: prefetch fires
        # several resume fetches back to back. The OS trust store, not certifi, because
        # this *.cirrus.ibm.com host is signed by an internal IBM CA that certifi lacks
        # (CERTIFICATE_VERIFY_FAILED otherwise, while curl succeeds).
        self._http_client = httpx.AsyncClient(
            timeout=timeout or settings.resume_timeout_seconds,
            verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT),
        )

    def resume_url(self, employee_id: str) -> str:
        return f"{self._base_url}/{quote(employee_id, safe='')}"

    async def get_markdown(self, employee_id: str) -> str | None:
        """Returns the resume as Markdown, or None when the employee has no resume.

        Raises SummaryUnavailableException ("resume_unavailable") when the proxy is
        unreachable, and ("unreadable_resume", 422) when the file is an unsupported
        format or holds no extractable text, e.g. a scanned image.
        """
        response = await self._fetch(employee_id)
        if response is None:
            return None
        extension = _resume_format(response)
        if extension is None:
            raise SummaryUnavailableException(
                "unreadable_resume", "This resume's file format is not supported (PDF or DOCX only).", 422
            )
        # MarkItDown is synchronous and CPU-bound; off the event loop so a conversion
        # doesn't stall every other request.
        markdown = await asyncio.to_thread(_to_markdown, response.content, extension)
        if not markdown.strip():
            raise SummaryUnavailableException(
                "unreadable_resume", "This resume has no readable text (it may be a scanned image).", 422
            )
        return markdown

    async def _fetch(self, employee_id: str) -> httpx.Response | None:
        try:
            response = await self._http_client.get(self.resume_url(employee_id))
        except httpx.HTTPError as exc:
            raise SummaryUnavailableException("resume_unavailable", "The resume service is unavailable.") from exc
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise SummaryUnavailableException(
                "resume_unavailable", f"The resume service answered {response.status_code}."
            )
        return response


def _resume_format(response: httpx.Response) -> str | None:
    """Returns ".pdf" or ".docx" for a supported resume file, otherwise None.

    An allowlist rather than letting MarkItDown decide, because MarkItDown doesn't
    reject what it can't parse: it falls back to decoding the raw bytes as text, which
    would send a legacy .doc to the model as binary garbage. The filename's extension
    comes first because one DOCX arrived as a generic application/octet-stream.
    """
    match = _FILENAME_EXTENSION_RE.search(response.headers.get("content-disposition", ""))
    if match:
        extension = match.group(1).lower()
        return extension if extension in _SUPPORTED_EXTENSIONS else None
    mimetype = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if mimetype in _MIMETYPE_EXTENSIONS:
        return _MIMETYPE_EXTENSIONS[mimetype]
    if response.content.startswith(b"%PDF"):
        return ".pdf"
    return None


def _to_markdown(content: bytes, extension: str) -> str:
    try:
        result = MarkItDown().convert_stream(io.BytesIO(content), stream_info=StreamInfo(extension=extension))
    except MarkItDownException as exc:
        raise SummaryUnavailableException(
            "unreadable_resume", "This resume's file format could not be read.", 422
        ) from exc
    return result.text_content or ""
