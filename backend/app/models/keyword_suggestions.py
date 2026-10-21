from typing import Literal

from pydantic import BaseModel, ConfigDict

# Where the phrases came from: the resume, the profile's job title when there is no
# resume, or nowhere (neither exists, so there is nothing to propose from).
KeywordSource = Literal["resume", "title", "none"]


class KeywordPhrases(BaseModel):
    """The model's raw reply. Deliberately unbounded: code trims and caps it afterwards."""

    # Models emit numbers where strings are expected, same as for the resume summary.
    model_config = ConfigDict(coerce_numbers_to_str=True)

    phrases: list[str] = []


class KeywordSuggestions(BaseModel):
    """Job-title phrases to search the directory for, and what they were derived from."""

    phrases: list[str]
    source: KeywordSource
