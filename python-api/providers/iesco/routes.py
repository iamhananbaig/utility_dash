import io
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

import pandas as pd
from asyncer import asyncify
from fastapi import APIRouter, BackgroundTasks, File, Path as PathParam, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse

from .config import REFERENCE_COLUMN, MAX_REFERENCES
from .fetcher import fetch_unique_references, normalize_reference
from .schemas import FetchRequest, FetchResponse, TaskResult, TaskStatus

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/iesco", tags=["iesco"])

tasks: dict[str, dict[str, Any]] = {}
TASK_TTL_SECONDS = 30 * 60


def _cleanup_old_tasks() -> None:
    now = datetime.now(timezone.utc).timestamp()
    expired = [
        tid
        for tid, t in tasks.items()
        if now - t.get("created_at", now) > TASK_TTL_SECONDS
    ]
    for tid in expired:
        del tasks[tid]
        logger.info("Cleaned up expired task %s", tid)


def _run_fetch_task(task_id: str, references: list[str]) -> None:
    task = tasks[task_id]
    task["status"] = "running"

    try:
        def on_progress(completed: int, total: int, ref: str, status: str) -> None:
            task["completed"] = completed
            if status == "SUCCESS":
                task["success_count"] += 1
            else:
                task["fail_count"] += 1
            task["log"].append({
                "n": completed,
                "total": total,
                "ref": ref,
                "status": status,
            })

        results = fetch_unique_references(references, on_progress=on_progress)
        if not results:
            results = {}
        task["results"] = results
        task["completed"] = task["total"]
        task["status"] = "completed"
        task["has_results"] = True
        logger.info("Task %s completed: %d bills fetched", task_id, len(results))

    except Exception:
        logger.exception("Task %s failed", task_id)
        task["results"] = {}
        task["completed"] = task["total"]
        task["status"] = "completed"
        task["has_results"] = True
        task["fail_count"] = task["total"]


def _create_task(refs: list[str]) -> tuple[str, int]:
    _cleanup_old_tasks()
    task_id = uuid.uuid4().hex[:12]
    tasks[task_id] = {
        "status": "pending",
        "completed": 0,
        "total": len(refs),
        "success_count": 0,
        "fail_count": 0,
        "has_results": False,
        "log": [],
        "results": None,
        "created_at": datetime.now(timezone.utc).timestamp(),
    }
    return task_id, len(refs)


@router.post("/fetch", response_model=FetchResponse)
async def start_fetch(request: FetchRequest, background_tasks: BackgroundTasks):
    refs = [normalize_reference(r) for r in request.reference_numbers if r.strip()]
    refs = list(dict.fromkeys(refs))

    if not refs:
        return FetchResponse(task_id="", total=0)

    if len(refs) > MAX_REFERENCES:
        refs = refs[:MAX_REFERENCES]

    task_id, total = _create_task(refs)
    background_tasks.add_task(_run_fetch_task, task_id, refs)
    return FetchResponse(task_id=task_id, total=total)


@router.post("/fetch-excel", response_model=FetchResponse)
async def start_fetch_excel(
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
):
    if not file.filename:
        return FetchResponse(task_id="", total=0)

    ext = Path(file.filename).suffix.lower()
    if ext not in {".xlsx", ".xls"}:
        return FetchResponse(task_id="", total=0)

    content = await file.read()
    df = await asyncify(pd.read_excel)(io.BytesIO(content), dtype=str)

    if REFERENCE_COLUMN not in df.columns:
        return FetchResponse(task_id="", total=0)

    refs = [normalize_reference(v) for v in df[REFERENCE_COLUMN].fillna("").tolist()]
    refs = [r for r in refs if r]
    refs = list(dict.fromkeys(refs))

    if not refs:
        return FetchResponse(task_id="", total=0)

    if len(refs) > MAX_REFERENCES:
        refs = refs[:MAX_REFERENCES]

    task_id, total = _create_task(refs)
    background_tasks.add_task(_run_fetch_task, task_id, refs)
    return FetchResponse(task_id=task_id, total=total)


@router.get("/status/{task_id}", response_model=TaskStatus)
async def get_status(
    task_id: Annotated[str, PathParam(description="Task identifier")],
):
    task = tasks.get(task_id)
    if not task:
        return TaskStatus(task_id=task_id, status="not_found", completed=0, total=0)

    return TaskStatus(
        task_id=task_id,
        status=task["status"],
        completed=task["completed"],
        total=task["total"],
        success_count=task["success_count"],
        fail_count=task["fail_count"],
        has_results=task["has_results"],
        log=task["log"],
    )


@router.get("/results/{task_id}")
async def get_results(
    task_id: Annotated[str, PathParam(description="Task identifier")],
) -> dict[str, Any] | TaskResult:
    task = tasks.get(task_id)
    if not task:
        return TaskResult(error="Task not found")
    if task["status"] != "completed":
        return TaskResult(error="Task not yet completed", status=task["status"])
    results = task["results"]
    if not results:
        return TaskResult(error="No results available")
    return results


@router.get("/download/{task_id}", response_model=None)
def download_excel(
    task_id: Annotated[str, PathParam(description="Task identifier")],
) -> StreamingResponse | TaskResult:
    task = tasks.get(task_id)
    if not task or task["status"] != "completed":
        return TaskResult(error="Task not completed")

    results = task["results"]
    if not results:
        return TaskResult(error="No results")

    buf = _build_excel(results, task_id)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="iesco_bills_{task_id}.xlsx"'
        },
    )


def _build_excel(results: dict[str, dict[str, Any]], task_id: str) -> io.BytesIO:
    PREFERRED_COLUMNS = [
        "INPUT_REFERENCE_NO",
        "RETURNED_REFERENCE_NO",
        "REFERENCE_VERIFICATION",
        "BILL_MONTH",
        "READING_DATE",
        "ISSUE_DATE",
        "DUE_DATE",
        "ARREARS_RAW",
        "ARREARS_AMOUNT",
        "ENERGY_DETAILS_TOTAL",
        "TAXES_TOTAL",
        "TAXES_ON_FPA_TOTAL",
        "CALCULATED_PAYABLE_WITHIN_DUE_DATE",
        "WEBSITE_PAYABLE_WITHIN_DUE_DATE",
        "WEBSITE_PAYABLE_SOURCE",
        "PAYABLE_DIFFERENCE",
        "PAYABLE_COMPARISON",
        "HISTORY_FIRST_MONTH",
        "HISTORY_FIRST_KWH_UNITS",
        "HISTORY_FIRST_BILL_RS",
        "HISTORY_LAST_MONTH",
        "HISTORY_LAST_KWH_UNITS",
        "HISTORY_LAST_BILL_RS",
        "HISTORY_STATUS",
        "FETCHED_AT",
        "FETCH_STATUS",
        "ERROR",
    ]

    rows = list(results.values())
    df = pd.DataFrame(rows)

    ordered = [c for c in PREFERRED_COLUMNS if c in df.columns]
    remaining = [c for c in df.columns if c not in ordered and c != "_RAW_HTML"]
    df = df[ordered + remaining]

    failed_df = df[df["FETCH_STATUS"] != "SUCCESS"].copy()
    diff_df = (
        df[df["PAYABLE_COMPARISON"] == "DIFFERENCE"].copy()
        if "PAYABLE_COMPARISON" in df.columns
        else pd.DataFrame()
    )

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="IESCO Bills", index=False)
        if not failed_df.empty:
            failed_df.to_excel(writer, sheet_name="Failed Bills", index=False)
        if not diff_df.empty:
            diff_df.to_excel(writer, sheet_name="Payable Differences", index=False)

    buf.seek(0)
    return buf


@router.get("/html/{task_id}/{reference_no}", response_model=None, response_class=HTMLResponse)
def get_bill_html(
    task_id: Annotated[str, PathParam(description="Task identifier")],
    reference_no: Annotated[str, PathParam(description="Reference number")],
) -> HTMLResponse | TaskResult:
    task = tasks.get(task_id)
    if not task or task["status"] != "completed":
        return TaskResult(error="Task not completed")

    results = task["results"]
    if not results:
        return TaskResult(error="No results")

    bill = results.get(reference_no)
    if not bill:
        return TaskResult(error=f"Bill {reference_no} not found")

    raw_html = bill.get("_RAW_HTML")
    if not raw_html:
        return TaskResult(error="No HTML available for this bill")

    return HTMLResponse(content=raw_html)
