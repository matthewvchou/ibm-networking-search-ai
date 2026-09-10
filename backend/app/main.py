from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import employees, health
from app.core.exceptions import BluepagesUnavailableException

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(employees.router)
app.include_router(health.router)


@app.exception_handler(BluepagesUnavailableException)
async def bluepages_unavailable_handler(request: Request, exc: BluepagesUnavailableException) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": "Directory service unavailable"})
