import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from providers.iesco.routes import router as iesco_router
from providers.vcard.routes import router as vcard_router

app = FastAPI(title="Bill Extractor API")

cors_origins = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(iesco_router)
app.include_router(vcard_router)


@app.get("/")
async def root() -> dict[str, object]:
    return {"status": "ok", "providers": ["iesco", "vcard"]}
