"""The grader: code-matched claims, quote checking, scoring arithmetic and invalid replies."""

import json

import pytest

from app.core.exceptions import SummaryUnavailableException
from app.models.resume_summary import Certification, Education, Experience, ResumeSummary, SkillGroup
from app.services.summary_verifier import SummaryVerifier, enumerate_claims, remove_unsupported

_RESUME = """# Ada Example
Cloud Architect, Example Corp, 2021 - present
Designed hybrid cloud platforms on OpenShift and AWS.
Skills: AWS, OpenShift
BSc Computer Science, University of Nowhere, 2011
Certified Kubernetes Administrator 2023
"""


class _FakeIca:
    def __init__(self, replies: list[str]) -> None:
        self.replies = list(replies)
        self.calls = 0

    async def complete_json(self, messages: list[dict[str, str]]) -> str:
        self.calls += 1
        return self.replies.pop(0)


def _summary(**overrides) -> ResumeSummary:
    base = {
        "summary": "Designs hybrid cloud platforms. Works with OpenShift.",
        "skills": [SkillGroup(category="Cloud", items=["AWS", "OpenShift"])],
        "experience": [Experience(role="Cloud Architect", organization="Example Corp", start="2021", end=None)],
        "education": [Education(degree="BSc Computer Science", institution="University of Nowhere", year="2011")],
        "certifications": [Certification(name="Certified Kubernetes Administrator", year="2023")],
    }
    return ResumeSummary(**{**base, **overrides})


def _reply(summary_claims: list[dict], checked: list[dict] | None = None) -> str:
    return json.dumps({"summary_claims": summary_claims, "checked": checked or []})


def _ok(claim: str, quote: str) -> dict:
    return {"claim": claim, "supported": True, "quote": quote}


@pytest.mark.asyncio
async def test_code_matched_items_need_no_model_verdict_and_score_is_arithmetic():
    ica = _FakeIca([_reply([_ok("designs cloud platforms", "Designed hybrid cloud platforms on OpenShift")])])
    grade = await SummaryVerifier(ica).verify(_RESUME, _summary())
    assert ica.calls == 1
    assert grade.unsupported == []
    assert grade.verification.score == 100
    assert grade.verification.supported_claims == grade.verification.total_claims


@pytest.mark.asyncio
async def test_a_quote_that_is_not_in_the_resume_makes_the_claim_unsupported():
    ica = _FakeIca([_reply([_ok("led a team of 40", "Led a team of forty engineers")])])
    grade = await SummaryVerifier(ica).verify(_RESUME, _summary())
    assert [c.text for c in grade.unsupported] == ["led a team of 40"]
    assert grade.verification.score < 100
    assert grade.verification.flagged_claims[0].section == "summary"


@pytest.mark.asyncio
async def test_quote_matching_ignores_case_and_whitespace_and_punctuation():
    ica = _FakeIca([_reply([_ok("designs platforms", "DESIGNED hybrid   cloud platforms on  openshift and AWS.")])])
    assert (await SummaryVerifier(ica).verify(_RESUME, _summary())).verification.score == 100


@pytest.mark.asyncio
async def test_a_model_written_score_is_ignored():
    reply = json.loads(_reply([_ok("x", "no such passage anywhere")]))
    reply["score"] = 100
    grade = await SummaryVerifier(_FakeIca([json.dumps(reply)])).verify(_RESUME, _summary())
    assert grade.verification.score < 100


@pytest.mark.asyncio
async def test_a_skill_missing_from_the_resume_goes_to_the_model_and_is_removed_when_rejected():
    summary = _summary(skills=[SkillGroup(category="Cloud", items=["AWS", "Kubernetes Federation"])])
    claim_id = next(c.id for c in enumerate_claims(summary) if "Federation" in c.text)
    reply = _reply([_ok("designs platforms", "Designed hybrid cloud platforms")], [{"id": claim_id, "supported": False, "quote": ""}])
    grade = await SummaryVerifier(_FakeIca([reply])).verify(_RESUME, summary)
    assert [c.section for c in grade.unsupported] == ["skills"]
    cleaned, dropped = remove_unsupported(summary, grade.unsupported)
    assert cleaned.skills[0].items == ["AWS"]
    assert dropped == 1


@pytest.mark.asyncio
async def test_an_unanswered_claim_counts_as_unsupported_after_one_retry():
    summary = _summary(skills=[SkillGroup(category="Cloud", items=["Kubernetes Federation"])])
    silent = _reply([_ok("designs platforms", "Designed hybrid cloud platforms")])
    ica = _FakeIca([silent, silent])
    grade = await SummaryVerifier(ica).verify(_RESUME, summary)
    assert ica.calls == 2
    assert [c.section for c in grade.unsupported] == ["skills"]


@pytest.mark.asyncio
async def test_a_fenced_reply_is_accepted():
    good = _reply([_ok("designs platforms", "Designed hybrid cloud platforms")])
    grade = await SummaryVerifier(_FakeIca([f"```json\n{good}\n```"])).verify(_RESUME, _summary())
    assert grade.verification.score == 100


@pytest.mark.asyncio
async def test_an_invalid_reply_is_retried_once_then_fails():
    ica = _FakeIca(["not json", "still not json"])
    with pytest.raises(SummaryUnavailableException) as exc_info:
        await SummaryVerifier(ica).verify(_RESUME, _summary())
    assert exc_info.value.reason == "bad_output"
    assert ica.calls == 2


@pytest.mark.asyncio
async def test_a_non_boolean_verdict_is_invalid():
    bad = _reply([{"claim": "x", "supported": "yes", "quote": "Designed hybrid cloud platforms"}])
    ica = _FakeIca([bad, bad])
    with pytest.raises(SummaryUnavailableException):
        await SummaryVerifier(ica).verify(_RESUME, _summary())


@pytest.mark.asyncio
async def test_a_reply_with_no_summary_claims_is_invalid_when_there_is_a_summary():
    ica = _FakeIca([_reply([]), _reply([_ok("designs platforms", "Designed hybrid cloud platforms")])])
    grade = await SummaryVerifier(ica).verify(_RESUME, _summary())
    assert ica.calls == 2
    assert grade.verification.score == 100


@pytest.mark.asyncio
async def test_nothing_to_check_makes_no_call_and_has_no_score():
    ica = _FakeIca([])
    grade = await SummaryVerifier(ica).verify(_RESUME, ResumeSummary())
    assert ica.calls == 0
    assert grade.verification.score is None


def test_a_missing_employer_clears_the_field_but_keeps_the_role():
    summary = _summary(experience=[Experience(role="Cloud Architect", organization="Nonexistent Inc", start="2021")])
    claim = next(c for c in enumerate_claims(summary) if c.field == "organization")
    cleaned, dropped = remove_unsupported(summary, [claim])
    assert cleaned.experience[0].role == "Cloud Architect"
    assert cleaned.experience[0].organization == ""
    assert dropped == 0
