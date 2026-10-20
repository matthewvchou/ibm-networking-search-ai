import time
from collections.abc import Callable
from typing import Any

from app.models.resume_summary import SummaryProgress

# Long enough for a poller that missed the last tick to still see "done" and then fall
# back to the cached result; short enough that finished runs don't pile up.
_FINISHED_TTL_SECONDS = 60


class ProgressBoard:
    """Tracks where each employee's summary generation is, for the panel to poll.

    In-memory and per-process, like the summary cache. A finished run lingers briefly and
    is swept the next time any run starts, so people nobody polls don't accumulate.
    `clock` is injectable for tests.
    """

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._runs: dict[str, SummaryProgress] = {}
        self._finished_at: dict[str, float] = {}

    def start(self, employee_id: str, max_attempts: int) -> None:
        self._sweep()
        self._finished_at.pop(employee_id, None)
        self._runs[employee_id] = SummaryProgress(status="running", attempt=1, max_attempts=max_attempts)

    def update(self, employee_id: str, **changes: Any) -> None:
        run = self._runs.get(employee_id)
        if run is not None:
            self._runs[employee_id] = run.model_copy(update=changes)

    def finish(self, employee_id: str) -> None:
        # The draft is dropped: once done, the result comes from the summary request.
        self.update(employee_id, status="done", phase="finished", draft=None)
        self._finished_at[employee_id] = self._clock()

    def clear(self, employee_id: str) -> None:
        self._runs.pop(employee_id, None)
        self._finished_at.pop(employee_id, None)

    def get(self, employee_id: str) -> SummaryProgress:
        """Returns the run's progress, or an idle one when there is none."""
        self._sweep()
        return self._runs.get(employee_id) or SummaryProgress()

    def _sweep(self) -> None:
        now = self._clock()
        expired = [key for key, at in self._finished_at.items() if now - at > _FINISHED_TTL_SECONDS]
        for key in expired:
            self.clear(key)
