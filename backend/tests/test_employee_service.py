"""Name and search-filter construction.

All names here are invented - the directory these helpers read from returns real
employee data, which must not land in a fixture.
"""

from app.services.employee_service import (
    _search_filter,
    _slaphapi_name,
    _wsapi_name,
)


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
