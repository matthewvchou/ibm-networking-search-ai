import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Generic, TypeVar

V = TypeVar("V")

# Returned by `get` for an absent or expired key, since None is a legitimate value.
MISSING = object()


class TtlLruCache(Generic[V]):
    """An in-memory map whose entries expire, evicting least-recently-used at capacity.

    Each `set` carries its own TTL, so one cache can hold entries of different
    lifetimes. `clock` is injectable for tests.
    """

    def __init__(self, max_entries: int, clock: Callable[[], float] = time.monotonic) -> None:
        self._max_entries = max_entries
        self._clock = clock
        self._entries: OrderedDict[str, tuple[float, V]] = OrderedDict()

    def get(self, key: str) -> V | object:
        """Returns the live value for `key`, or MISSING if absent or expired."""
        entry = self._entries.get(key)
        if entry is None:
            return MISSING
        expires_at, value = entry
        if self._clock() >= expires_at:
            del self._entries[key]
            return MISSING
        self._entries.move_to_end(key)
        return value

    def set(self, key: str, value: V, ttl_seconds: float) -> None:
        self._entries[key] = (self._clock() + ttl_seconds, value)
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)
