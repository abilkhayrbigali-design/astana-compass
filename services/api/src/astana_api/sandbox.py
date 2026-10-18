"""Small same-origin API workbench, packaged with the backend wheel."""
from importlib.resources import files

from fastapi import APIRouter, HTTPException
from starlette.responses import HTMLResponse, RedirectResponse, Response


HEADERS = {
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
}
ASSETS = {"sandbox.css": "text/css", "sandbox.js": "text/javascript"}


def sandbox_router():
    router = APIRouter(include_in_schema=False)

    @router.get("/")
    async def home():
        return RedirectResponse("/sandbox", status_code=307)

    @router.get("/sandbox", response_class=HTMLResponse)
    async def sandbox():
        content = files("astana_api").joinpath("static/sandbox.html").read_text(encoding="utf-8")
        return HTMLResponse(content, headers=HEADERS)

    @router.get("/sandbox-assets/{asset_name}")
    async def asset(asset_name: str):
        if asset_name not in ASSETS:
            raise HTTPException(status_code=404)
        content = files("astana_api").joinpath("static", asset_name).read_bytes()
        return Response(content, media_type=ASSETS[asset_name], headers=HEADERS)

    return router
