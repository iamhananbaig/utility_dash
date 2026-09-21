from pydantic import BaseModel


class FieldPattern(BaseModel):
    template: str
    columns: list[str]
    separator: str


class ProcessRequest(BaseModel):
    mappings: dict[str, str | None]
    patterns: dict[str, FieldPattern] | None = None


class AnalyseResponse(BaseModel):
    task_id: str
    headers: list[str]
    suggested_mappings: dict[str, str | None]
    total_rows: int
    sample_data: list[dict[str, str]] = []


class VCardRow(BaseModel):
    source_row: int
    original_name: str
    corrected_name: str
    original_phone: str
    corrected_phone: str
    normalized_phone: str
    detected_country: str
    status: str
    corrections: list[str]
    warnings: list[str]
    included_in_export: bool = True
    duplicate_group: str | None = None
    organization: str | None = None
    job_title: str | None = None
    email: str | None = None
    city: str | None = None
    notes: str | None = None


class ProcessingSummary(BaseModel):
    uploaded_rows: int
    processed_rows: int
    valid_rows: int
    corrected_rows: int
    warning_rows: int
    invalid_rows: int
    excluded_rows: int
    exact_duplicates_removed: int
    contacts_with_multiple_numbers: int
    shared_phone_numbers: int
    names_trimmed: int
    multiple_spaces_removed: int
    phone_spaces_removed: int
    country_codes_added: int
    leading_zeroes_removed: int
    international_prefixes_corrected: int
    final_vcards: int


class TaskStatus(BaseModel):
    task_id: str
    status: str
    completed: int
    total: int


class TaskResult(BaseModel):
    error: str
    status: str | None = None
