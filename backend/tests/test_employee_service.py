"""Name and search-filter construction.

All names here are invented - the directory these helpers read from returns real
employee data, which must not land in a fixture.
"""

from urllib.parse import quote

from app.services.employee_service import (
    TITLE_SUBSTRING_MIN_LENGTH,
    _compose_filter,
    _clean_text,
    _record_to_employee,
    _search_filter,
    _slaphapi_name,
    _title_predicate,
    _wsapi_name,
)
from app.services.slaphapi_client import _SAFE_FILTER_CHARS


def test_slaphapi_name_uses_structured_fields():
    record = {"cn": "Ada Lovelace", "sn": "Lovelace", "givenname": "Ada"}
    assert _slaphapi_name(record) == ("Ada Lovelace", "Lovelace")


def test_slaphapi_name_does_not_reverse_a_comma_bearing_cn():
    # The bug this guards: ~1-2% of live records hold a stray comma in `cn` in
    # first-then-last order, e.g. cn="Jinkwang, Kim" with sn=Kim. Anything that
    # reorders on that comma renders the name surname-first.
    record = {"cn": "Ada, Lovelace", "sn": "Lovelace", "givenname": "Ada"}
    assert _slaphapi_name(record) == ("Ada Lovelace", "Lovelace")


def test_slaphapi_name_prefers_preferred_fields():
    record = {
        "cn": "Augusta Lovelace",
        "sn": "Lovelace",
        "givenname": "Augusta A",
        "preferredfirstname": "Ada",
        "preferredlastname": "Byron",
    }
    assert _slaphapi_name(record) == ("Ada Byron", "Byron")


def test_slaphapi_name_strips_a_comma_inside_one_part():
    record = {"sn": "LOVELACE", "givenname": "ADA, MARY"}
    display_name, last_name = _slaphapi_name(record)
    assert (display_name, last_name) == ("ADA MARY LOVELACE", "LOVELACE")
    assert "," not in display_name


def test_slaphapi_name_keeps_a_multi_word_surname_intact():
    record = {"sn": "Lovelace Byron", "givenname": "Ada"}
    assert _slaphapi_name(record) == ("Ada Lovelace Byron", "Lovelace Byron")


def test_slaphapi_name_falls_back_to_cn_for_functional_ids():
    assert _slaphapi_name({"cn": "HELPDESK"}) == ("HELPDESK", "")


def test_slaphapi_name_of_an_empty_record_is_empty():
    assert _slaphapi_name({}) == ("", "")


def test_wsapi_name_splits_last_comma_first():
    assert _wsapi_name({"NAME": "Lovelace, Ada"}) == ("Ada Lovelace", "Lovelace")


def test_wsapi_name_keeps_a_multi_word_surname_intact():
    assert _wsapi_name({"NAME": "Lovelace Byron, Ada"}) == ("Ada Lovelace Byron", "Lovelace Byron")


def test_wsapi_name_passes_through_a_name_with_no_comma():
    # Word order is unknowable here, so it is left alone rather than guessed at.
    assert _wsapi_name({"NAME": "HELPDESK"}) == ("HELPDESK", "")


def test_search_filter_matches_both_name_fields_by_prefix():
    assert _search_filter("laura") == "(&(hractive=A)(|(sn=laura*)(givenname=laura*)))"


def test_search_filter_of_a_short_query_matches_exactly():
    # A one- or two-character prefix would stream tens of megabytes: SLAPHAPI
    # applies no size limit of its own.
    assert _search_filter("a") == "(&(hractive=A)(|(sn=a)(givenname=a)))"
    assert _search_filter("sm") == "(&(hractive=A)(|(sn=sm)(givenname=sm)))"


def test_search_filter_tries_both_orders_for_two_tokens():
    expected = (
        "(&(hractive=A)(|(&(givenname=ada*)(sn=lovelace*))"
        "(&(givenname=lovelace*)(sn=ada*))))"
    )
    assert _search_filter("ada lovelace") == expected
    # A comma is a separator, not part of a name, so both orderings of the query
    # reduce to the same filter.
    assert _search_filter("lovelace, ada") == _search_filter("ada lovelace")


def test_search_filter_escapes_filter_metacharacters():
    assert _search_filter("a*(b)") == r"(&(hractive=A)(|(sn=a\2a\28b\29*)(givenname=a\2a\28b\29*)))"


def test_search_filter_of_a_blank_query_is_none():
    assert _search_filter("   ") is None


def test_title_predicate_matches_a_single_token_as_a_substring():
    # Leading wildcard is deliberate: a job title is a phrase and the interesting
    # word is rarely at the start ("Senior Site Reliability Engineer").
    assert _title_predicate("architect") == "(jobresponsibilities=*architect*)"


def test_title_predicate_ands_one_assertion_per_token():
    # Not a single "*senior architect*" assertion: the tokens may be separated by
    # other words and given in either order. Measured on live data, this form matched
    # 133 records where the single-phrase form matched 18.
    assert _title_predicate("senior architect") == (
        "(&(jobresponsibilities=*senior*)(jobresponsibilities=*architect*))"
    )


def test_title_predicate_preserves_token_order():
    # Unlike the name predicate, token order is not normalized - an AND already
    # matches either order, so sorting would only obscure the user's input.
    assert _title_predicate("architect senior") == (
        "(&(jobresponsibilities=*architect*)(jobresponsibilities=*senior*))"
    )


def test_title_predicate_escapes_filter_metacharacters():
    assert _title_predicate("a*(b)") == r"(jobresponsibilities=*a\2a\28b\29*)"


def test_title_predicate_of_a_blank_title_is_none():
    assert _title_predicate("   ") is None


def test_compose_filter_combines_name_and_title():
    # Predicate order is part of the contract: hractive, then name, then title.
    assert _compose_filter(query="laura", title="architect") == (
        "(&(hractive=A)(|(sn=laura*)(givenname=laura*))(jobresponsibilities=*architect*))"
    )


def test_compose_filter_of_a_title_alone_omits_the_name_predicate():
    assert _compose_filter(title="architect") == (
        "(&(hractive=A)(jobresponsibilities=*architect*))"
    )


def test_compose_filter_with_no_criteria_is_none():
    # Never a bare (hractive=A): that is the whole active directory, which measured
    # 154MB+ without completing.
    assert _compose_filter() is None
    assert _compose_filter(query="  ", title="  ") is None


def test_search_filter_is_a_name_only_shim_over_compose_filter():
    assert _search_filter("laura") == _compose_filter(query="laura")


def test_title_minimum_length_admits_real_two_character_titles():
    # The router rejects below this; the predicate itself stays dumb. Only the
    # one-character case is ruinous (*a* measured 29s), while two characters are cheap
    # and are real titles - "C#", "VP", "UX", "AI". A higher floor would reject those
    # for no benefit. See the constant's comment.
    assert TITLE_SUBSTRING_MIN_LENGTH == 2


def test_filter_quoting_escapes_characters_that_break_a_url():
    # "+" would be decoded back to a space server-side (a search for "C++" answered
    # 14 where the correct answer is 16), and "#" would truncate the URL as a
    # fragment so SLAPHAPI never sees the trailing /byjson.
    quoted = quote(_title_predicate("C++"), safe=_SAFE_FILTER_CHARS)
    assert quoted == "(jobresponsibilities=*C%2B%2B*)"
    assert quote(_title_predicate("C#"), safe=_SAFE_FILTER_CHARS) == (
        "(jobresponsibilities=*C%23*)"
    )
    assert quote(_title_predicate("R&D"), safe=_SAFE_FILTER_CHARS) == (
        "(jobresponsibilities=*R&D*)"
    )


def test_filter_quoting_preserves_the_filter_grammar():
    # The structural characters must survive, or the filter stops being a filter.
    composed = _compose_filter(query="ada lovelace", title="project manager")
    quoted = quote(composed, safe=_SAFE_FILTER_CHARS)
    assert quoted == composed.replace(" ", "%20")
    for char in "()&|=*":
        assert char in quoted


def test_record_to_employee_reads_the_manager_flag():
    # WSAPI spells the flag MGR and answers Y/N on every employee record.
    assert _record_to_employee({"CNUM": "000000001", "MGR": "Y"}).is_manager is True
    assert _record_to_employee({"CNUM": "000000002", "MGR": "N"}).is_manager is False


def test_record_to_employee_defaults_the_manager_flag_to_false():
    # A record without MGR degrades to "no expand affordance" rather than offering one
    # that resolves to nothing.
    assert _record_to_employee({"CNUM": "000000003"}).is_manager is False


def test_clean_text_drops_the_literal_null_placeholder():
    # Measured on live JOBRESPONSIB values: a record whose job title is the string
    # "null" must read as having no title, not a title of "null".
    assert _clean_text("null") is None
    assert _clean_text("NULL") is None
    assert _clean_text("  ") is None
    assert _clean_text(None) is None
    # A real title containing the substring is untouched.
    assert _clean_text("Nullsoft Engineer") == "Nullsoft Engineer"


def test_record_to_employee_blanks_a_null_job_title():
    assert _record_to_employee({"CNUM": "000000004", "JOBRESPONSIB": "null"}).title is None
