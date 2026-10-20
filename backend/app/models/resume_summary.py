from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SUMMARY_MAX_SENTENCES = 3
MAX_FLAGGED_CLAIMS = 10

_SENTENCE_END_RE = re.compile(r"[.!?]+(?:\s+|$)")


class _ModelOutput(BaseModel):
    # Models emit years as JSON numbers (2023) despite the schema saying "YYYY"
    # strings - measured live, and it failed every retry the same way.
    model_config = ConfigDict(coerce_numbers_to_str=True)


class Experience(_ModelOutput):
    role: str
    organization: str = ""
    # "YYYY" or "YYYY-MM" as the resume states it; `end` None means the current role.
    start: str | None = None
    end: str | None = None


class SkillGroup(_ModelOutput):
    category: str
    items: list[str] = []


class Education(_ModelOutput):
    degree: str
    institution: str = ""
    year: str | None = None


class Certification(_ModelOutput):
    name: str
    year: str | None = None


class SummaryProse(_ModelOutput):
    """The short written part of a summary: what this person does, in two sentences."""

    summary: str = ""

    @field_validator("summary")
    @classmethod
    def _summary_is_short(cls, value: str) -> str:
        if count_sentences(value) > SUMMARY_MAX_SENTENCES:
            raise ValueError(f"summary exceeds {SUMMARY_MAX_SENTENCES} sentences")
        return value


class ResumeExtraction(_ModelOutput):
    """The structured part of a summary, copied out of the resume rather than composed."""

    skills: list[SkillGroup] = Field(default=[], max_length=5)
    experience: list[Experience] = Field(default=[], max_length=8)
    education: list[Education] = []
    certifications: list[Certification] = []


class FlaggedClaim(BaseModel):
    """One claim the grader could not tie to the resume."""

    section: str
    claim: str
    # True when the claim was a skill, role, degree or certification that the grader
    # explicitly rejected, so it was taken out of the summary rather than just flagged.
    removed: bool = False


class Verification(BaseModel):
    """A second model's check of how faithfully a summary reflects its resume.

    `score` is computed in code as the share of claims supported, never taken from the
    model. It is None when there was nothing to check.
    """

    score: int | None
    supported_claims: int
    total_claims: int
    flagged_claims: list[FlaggedClaim] = Field(default=[], max_length=MAX_FLAGGED_CLAIMS)
    # How many generate-and-grade rounds ran in total, including the first.
    attempts: int = 1


class ResumeSummary(SummaryProse, ResumeExtraction):
    """An AI-generated summary of one employee's resume.

    Every field may be empty: a sparse resume yields empty fields rather than invented
    ones. The list limits are enforced here, not trusted to the prompt, so output that
    overruns them fails validation and is retried. `verification` is None when the
    grader failed or was never run ("Not verified").
    """

    verification: Verification | None = None


class ResumeSummaryResponse(BaseModel):
    summary: ResumeSummary
    # The original PDF, so the UI can link to the source the summary was drawn from.
    resume_url: str
    # Only meaningful for a manual regeneration: whether the new run was good enough to
    # replace the previous summary, and what it scored either way.
    replaced: bool = True
    attempted_score: int | None = None


class SummaryProgress(BaseModel):
    """Where a summary generation currently is, polled by the panel while it waits."""

    status: Literal["idle", "running", "done"] = "idle"
    attempt: int = 0
    max_attempts: int = 0
    phase: Literal["summarizing", "verifying", "finished"] = "summarizing"
    # One entry per graded attempt so far; None marks an attempt the grader failed on.
    scores: list[int | None] = []
    # The best summary so far, shown before it is graded; None while there is none yet,
    # and always None for a manual regeneration, which keeps the old summary on screen.
    draft: ResumeSummary | None = None
    is_draft_verified: bool = False


def count_sentences(text: str) -> int:
    """Counts sentences by terminal punctuation; a trailing fragment counts as one."""
    stripped = text.strip()
    if not stripped:
        return 0
    return len(_SENTENCE_END_RE.findall(stripped)) + (0 if stripped[-1] in ".!?" else 1)
