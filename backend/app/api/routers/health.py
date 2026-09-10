from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services.bluepages_client import BluepagesClient

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> JSONResponse:
    reachable = await BluepagesClient().ping()
    if not reachable:
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return JSONResponse(status_code=200, content={"status": "ok"})
