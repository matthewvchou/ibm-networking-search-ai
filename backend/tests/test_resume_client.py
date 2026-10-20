"""Resume fetch and Markdown conversion, against synthetic files only."""

import httpx
import pytest
import respx

from app.core.exceptions import SummaryUnavailableException
from app.services.resume_client import ResumeClient
from tests.resume_fixtures import make_docx, make_pdf

_BASE = "https://resume.example.test/v3/resume"


def _client() -> ResumeClient:
    return ResumeClient(base_url=_BASE, timeout=5)


@pytest.mark.asyncio
async def test_converts_the_pdf_to_markdown():
    pdf = make_pdf(["Ada Example", "Cloud Architect at Example Corp"])
    with respx.mock:
        respx.get(f"{_BASE}/000000ABC").respond(200, content=pdf, headers={"content-type": "application/pdf"})
        markdown = await _client().get_markdown("000000ABC")
    assert "Cloud Architect at Example Corp" in markdown


@pytest.mark.asyncio
async def test_converts_a_docx_served_as_octet_stream():
    # Measured live: an uploaded DOCX can arrive as application/octet-stream, so the
    # filename in content-disposition is what identifies the format.
    headers = {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; fileName="Ada Example Bio.docx"',
    }
    with respx.mock:
        respx.get(f"{_BASE}/000000ABC").respond(200, content=make_docx(["Platform engineer at Example Corp"]), headers=headers)
        markdown = await _client().get_markdown("000000ABC")
    assert "Platform engineer at Example Corp" in markdown


@pytest.mark.asyncio
async def test_unsupported_format_is_unreadable():
    headers = {"content-type": "application/msword", "content-disposition": 'attachment; fileName="cv.doc"'}
    with respx.mock:
        respx.get(f"{_BASE}/000000ABC").respond(200, content=b"\xd0\xcf\x11\xe0 not really a doc", headers=headers)
        with pytest.raises(SummaryUnavailableException) as exc_info:
            await _client().get_markdown("000000ABC")
    assert (exc_info.value.reason, exc_info.value.status_code) == ("unreadable_resume", 422)


@pytest.mark.asyncio
async def test_404_means_no_resume():
    with respx.mock:
        respx.get(f"{_BASE}/000000ABC").respond(404)
        assert await _client().get_markdown("000000ABC") is None


@pytest.mark.asyncio
async def test_pdf_without_text_is_unreadable():
    with respx.mock:
        respx.get(f"{_BASE}/000000ABC").respond(200, content=make_pdf([]))
        with pytest.raises(SummaryUnavailableException) as exc_info:
            await _client().get_markdown("000000ABC")
    assert (exc_info.value.reason, exc_info.value.status_code) == ("unreadable_resume", 422)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [httpx.Response(500), httpx.ConnectError("down")])
async def test_proxy_failure_is_resume_unavailable(failure):
    with respx.mock:
        route = respx.get(f"{_BASE}/000000ABC")
        if isinstance(failure, Exception):
            route.side_effect = failure
        else:
            route.return_value = failure
        with pytest.raises(SummaryUnavailableException) as exc_info:
            await _client().get_markdown("000000ABC")
    assert exc_info.value.reason == "resume_unavailable"


def test_resume_url_escapes_the_id():
    assert _client().resume_url("a/b") == f"{_BASE}/a%2Fb"
