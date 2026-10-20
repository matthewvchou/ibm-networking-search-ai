from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import employees, health
from app.core.exceptions import (
    BluepagesUnavailableException,
    DirectoryTimeoutException,
    SummaryUnavailableException,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(employees.router)
app.include_router(health.router)


# DirectoryTimeoutException subclasses BluepagesUnavailableException, and Starlette
# picks a handler by walking the exception's MRO, so this more specific handler wins
# over the 503 one below regardless of registration order. A timed-out search is an
# expected outcome for a broad job-title substring, not an outage - reporting it as
# 503 told the user the directory was down when it wasn't.
@app.exception_handler(DirectoryTimeoutException)
async def directory_timeout_handler(request: Request, exc: DirectoryTimeoutException) -> JSONResponse:
    return JSONResponse(
        status_code=504,
        content={"detail": "Search timed out. Try a more specific name or job title."},
    )


@app.exception_handler(BluepagesUnavailableException)
async def bluepages_unavailable_handler(request: Request, exc: BluepagesUnavailableException) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": "Directory service unavailable"})


# Carries a machine-readable `reason` alongside the usual `detail`, so the summary panel
# can tell "no resume on file" (a normal state) from a failure, and say why it failed.
@app.exception_handler(SummaryUnavailableException)
async def summary_unavailable_handler(request: Request, exc: SummaryUnavailableException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"reason": exc.reason, "detail": exc.message})
