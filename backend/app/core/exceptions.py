class BluepagesUnavailableException(Exception):
    pass


class DirectoryTimeoutException(BluepagesUnavailableException):
    """A directory call exceeded its timeout.

    Subclasses BluepagesUnavailableException so existing `except` clauses (notably
    EmployeeService._lookup, which degrades a failed label lookup to "no label")
    keep catching it. It exists only so the search path can be mapped to 504
    instead of 503: a broad job-title substring is expensive enough to time out
    legitimately (`*Manager*` measured 16.9MB/6.7s against a 10s budget), and
    reporting that as "Directory service unavailable" tells the user the directory
    is down when it isn't. Registered ahead of the 503 handler in main.py.
    """
