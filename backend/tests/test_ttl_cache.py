from app.services.ttl_cache import MISSING, TtlLruCache


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_entry_expires_after_its_ttl():
    clock = _Clock()
    cache = TtlLruCache(10, clock=clock)
    cache.set("a", "value", ttl_seconds=60)
    clock.now = 59
    assert cache.get("a") == "value"
    clock.now = 60
    assert cache.get("a") is MISSING


def test_none_is_a_cacheable_value_distinct_from_missing():
    cache = TtlLruCache(10)
    cache.set("no-resume", None, ttl_seconds=60)
    assert cache.get("no-resume") is None
    assert cache.get("never-set") is MISSING


def test_evicts_least_recently_used_at_capacity():
    cache = TtlLruCache(2)
    cache.set("a", 1, ttl_seconds=60)
    cache.set("b", 2, ttl_seconds=60)
    cache.get("a")
    cache.set("c", 3, ttl_seconds=60)
    assert cache.get("b") is MISSING
    assert cache.get("a") == 1
    assert cache.get("c") == 3
