from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

HEADLINE_MAX_WORDS = 20


class _ModelOutput(BaseModel):
    # Models emit years as JSON numbers (2023) despite the schema saying "YYYY"
    # strings - measured live, and it failed every retry the same way.
    model_config = ConfigDict(coerce_numbers_to_str=True)


class Specialty(_ModelOutput):
    name: str
    # A short pointer into the resume ("Cloud Architect, 2021-present"), not a quote,
    # so a reader can check the claim against the source.
    evidence: str = ""


class AskThemAbout(_ModelOutput):
    topic: str
    evidence: str = ""


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


class CvDigest(_ModelOutput):
    experience: list[Experience] = Field(default=[], max_length=8)
    skills: list[SkillGroup] = Field(default=[], max_length=5)
    education: list[Education] = []
    certifications: list[Certification] = []


class ResumeSummary(_ModelOutput):
    """An AI-generated summary of one employee's resume.

    Every field may be empty: a sparse resume yields empty fields rather than invented
    ones. The list limits are enforced here, not trusted to the prompt, so output that
    overruns them fails validation and is retried.
    """

    headline: str = ""
    summary: str = ""
    specialties: list[Specialty] = Field(default=[], max_length=5)
    ask_them_about: list[AskThemAbout] = Field(default=[], max_length=3)
    cv: CvDigest = CvDigest()

    @field_validator("headline")
    @classmethod
    def _headline_is_short(cls, value: str) -> str:
        if len(value.split()) > HEADLINE_MAX_WORDS:
            raise ValueError(f"headline exceeds {HEADLINE_MAX_WORDS} words")
        return value


class ResumeSummaryResponse(BaseModel):
    summary: ResumeSummary
    # The original PDF, so the UI can link to the source the summary was drawn from.
    resume_url: str
