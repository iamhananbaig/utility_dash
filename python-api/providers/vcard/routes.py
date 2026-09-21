from __future__ import annotations

import io
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

import pandas as pd
from asyncer import asyncify
from fastapi import APIRouter, BackgroundTasks, File, Form, Path as PathParam, UploadFile
from fastapi.responses import StreamingResponse

from .config import ALLOWED_EXTENSIONS, MAX_ROWS, TASK_TTL_SECONDS
from .processor import (
    clean_name,
    clean_phone,
    classify_status,
    detect_duplicates,
    detect_headers,
    generate_error_report,
    generate_summary,
    generate_vcf,
    parse_file,
    resolve_pattern,
    suggest_mappings,
)
from .schemas import AnalyseResponse, FieldPattern, ProcessRequest, TaskResult, TaskStatus, VCardRow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vcard", tags=["vcard"])

tasks: dict[str, dict[str, Any]] = {}


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


def _create_task(
    content: bytes,
    filename: str,
    default_country: str,
    contact_type: str,
    total_rows: int,
) -> str:
    _cleanup_old_tasks()
    task_id = uuid.uuid4().hex[:12]
    tasks[task_id] = {
        "status": "uploaded",
        "completed": 0,
        "total": total_rows,
        "file_content": content,
        "filename": filename,
        "default_country": default_country,
        "contact_type": contact_type,
        "mappings": None,
        "rows": None,
        "summary": None,
        "created_at": datetime.now(timezone.utc).timestamp(),
    }
    return task_id


def _run_process_task(
    task_id: str,
    mappings: dict[str, str | None],
    patterns: dict[str, FieldPattern] | None = None,
) -> None:
    task = tasks[task_id]
    task["status"] = "processing"

    try:
        content: bytes = task["file_content"]
        filename: str = task["filename"]
        default_country: str = task["default_country"]
        contact_type: str = task["contact_type"]
        patterns = patterns or {}

        df = parse_file(content, filename)
        total_rows = len(df)

        name_col = mappings.get("name")
        phone_col = mappings.get("phone")
        org_col = mappings.get("organization")
        title_col = mappings.get("job_title")
        email_col = mappings.get("email")
        city_col = mappings.get("city")
        notes_col = mappings.get("notes")

        if not name_col and "name" not in patterns:
            task["status"] = "completed"
            task["rows"] = []
            task["summary"] = generate_summary([], total_rows).model_dump()
            task["completed"] = total_rows
            return

        rows: list[VCardRow] = []

        for i, (_, df_row) in enumerate(df.iterrows()):
            source_row = i + 2

            if "name" in patterns:
                orig_name = resolve_pattern(patterns["name"].template, df_row)
            else:
                orig_name = str(df_row.get(name_col, "")) if name_col and pd.notna(df_row.get(name_col)) else ""

            if "phone" in patterns:
                orig_phone = resolve_pattern(patterns["phone"].template, df_row)
            else:
                orig_phone = str(df_row.get(phone_col, "")) if phone_col and pd.notna(df_row.get(phone_col)) else ""

            corrected_name, name_corrections, name_warnings = clean_name(orig_name)
            orig_phone_out, corrected_phone, detected_country, phone_corrections, phone_warnings = (
                clean_phone(orig_phone, default_country, contact_type)
            )

            corrections = name_corrections + phone_corrections
            warnings = name_warnings + phone_warnings

            if "organization" in patterns:
                org_val = resolve_pattern(patterns["organization"].template, df_row).strip() or None
            else:
                org_val = str(df_row.get(org_col, "")).strip() if org_col and pd.notna(df_row.get(org_col)) else None

            if "job_title" in patterns:
                title_val = resolve_pattern(patterns["job_title"].template, df_row).strip() or None
            else:
                title_val = str(df_row.get(title_col, "")).strip() if title_col and pd.notna(df_row.get(title_col)) else None

            if "email" in patterns:
                email_val = resolve_pattern(patterns["email"].template, df_row).strip() or None
            else:
                email_val = str(df_row.get(email_col, "")).strip() if email_col and pd.notna(df_row.get(email_col)) else None

            if "city" in patterns:
                city_val = resolve_pattern(patterns["city"].template, df_row).strip() or None
            else:
                city_val = str(df_row.get(city_col, "")).strip() if city_col and pd.notna(df_row.get(city_col)) else None

            if "notes" in patterns:
                notes_val = resolve_pattern(patterns["notes"].template, df_row).strip() or None
            else:
                notes_val = str(df_row.get(notes_col, "")).strip() if notes_col and pd.notna(df_row.get(notes_col)) else None

            status = classify_status(corrections, warnings, orig_name, orig_phone)

            rows.append(
                VCardRow(
                    source_row=source_row,
                    original_name=orig_name,
                    corrected_name=corrected_name,
                    original_phone=orig_phone_out,
                    corrected_phone=corrected_phone,
                    normalized_phone=corrected_phone if corrected_phone.startswith("+") else "",
                    detected_country=detected_country,
                    status=status,
                    corrections=corrections,
                    warnings=warnings,
                    included_in_export=status not in ("invalid", "duplicate"),
                    organization=org_val or None,
                    job_title=title_val or None,
                    email=email_val or None,
                    city=city_val or None,
                    notes=notes_val or None,
                )
            )
            task["completed"] = i + 1

        rows = detect_duplicates(rows)
        summary = generate_summary(rows, total_rows)

        task["rows"] = [r.model_dump() for r in rows]
        task["summary"] = summary.model_dump()
        task["status"] = "completed"
        task["completed"] = total_rows
        logger.info("Task %s completed: %d rows processed", task_id, len(rows))

    except Exception:
        logger.exception("Task %s failed", task_id)
        task["status"] = "completed"
        task["rows"] = []
        task["summary"] = generate_summary([], task.get("total", 0)).model_dump()
        task["completed"] = task.get("total", 0)


@router.post("/upload", response_model=AnalyseResponse)
async def upload_file(
    file: Annotated[UploadFile, File()],
    default_country: Annotated[str, Form()] = "PK",
    contact_type: Annotated[str, Form()] = "mobile-only",
):
    if not file.filename:
        return AnalyseResponse(task_id="", headers=[], suggested_mappings={}, total_rows=0)

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return AnalyseResponse(task_id="", headers=[], suggested_mappings={}, total_rows=0)

    content = await file.read()

    try:
        df = await asyncify(parse_file)(content, file.filename)
    except Exception:
        logger.exception("Failed to parse file %s", file.filename)
        return AnalyseResponse(task_id="", headers=[], suggested_mappings={}, total_rows=0)

    if len(df) > MAX_ROWS:
        df = df.head(MAX_ROWS)

    headers = detect_headers(df)
    mappings = suggest_mappings(headers)
    total_rows = len(df)

    sample_data = []
    for _, row in df.head(3).iterrows():
        sample_row = {}
        for h in headers:
            val = row.get(h, "")
            sample_row[h] = str(val) if pd.notna(val) else ""
        sample_data.append(sample_row)

    task_id = _create_task(content, file.filename, default_country, contact_type, total_rows)

    return AnalyseResponse(
        task_id=task_id,
        headers=headers,
        suggested_mappings=mappings,
        total_rows=total_rows,
        sample_data=sample_data,
    )


@router.post("/process/{task_id}", response_model=TaskStatus)
async def process_rows(
    task_id: Annotated[str, PathParam(description="Task identifier")],
    body: ProcessRequest,
    background_tasks: BackgroundTasks,
):
    task = tasks.get(task_id)
    if not task:
        return TaskStatus(task_id=task_id, status="not_found", completed=0, total=0)

    if task["status"] not in ("uploaded", "completed"):
        return TaskStatus(
            task_id=task_id,
            status=task["status"],
            completed=task["completed"],
            total=task["total"],
        )

    task["mappings"] = body.mappings
    task["status"] = "processing"
    task["completed"] = 0
    background_tasks.add_task(_run_process_task, task_id, body.mappings, body.patterns)

    return TaskStatus(task_id=task_id, status="processing", completed=0, total=task["total"])


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

    return {"rows": task["rows"], "summary": task["summary"]}


@router.get("/download/{task_id}", response_model=None)
def download_vcf(
    task_id: Annotated[str, PathParam(description="Task identifier")],
) -> StreamingResponse | TaskResult:
    task = tasks.get(task_id)
    if not task or task["status"] != "completed":
        return TaskResult(error="Task not completed")

    rows_data = task.get("rows")
    if not rows_data:
        return TaskResult(error="No results")

    vcard_rows = [VCardRow(**r) for r in rows_data]
    vcf_content = generate_vcf(vcard_rows)

    return StreamingResponse(
        io.BytesIO(vcf_content.encode("utf-8")),
        media_type="text/vcard;charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="contacts_{task_id}.vcf"'
        },
    )


@router.get("/error-report/{task_id}", response_model=None)
def download_error_report(
    task_id: Annotated[str, PathParam(description="Task identifier")],
) -> StreamingResponse | TaskResult:
    task = tasks.get(task_id)
    if not task or task["status"] != "completed":
        return TaskResult(error="Task not completed")

    rows_data = task.get("rows")
    if not rows_data:
        return TaskResult(error="No results")

    vcard_rows = [VCardRow(**r) for r in rows_data]
    buf = generate_error_report(vcard_rows)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="vcard_errors_{task_id}.xlsx"'
        },
    )
