from __future__ import annotations

import io
import re
import unicodedata
from collections import defaultdict
from typing import Any

import chardet
import pandas as pd
import phonenumbers
from phonenumbers import PhoneNumberFormat

from .config import (
    CITY_KEYWORDS,
    EMAIL_KEYWORDS,
    NAME_KEYWORDS,
    NOTES_KEYWORDS,
    ORG_KEYWORDS,
    PK_MOBILE_PREFIXES,
    PHONE_KEYWORDS,
    TITLE_KEYWORDS,
)
from .schemas import ProcessingSummary, VCardRow


def parse_file(content: bytes, filename: str) -> pd.DataFrame:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in ("xlsx", "xls"):
        return pd.read_excel(io.BytesIO(content), dtype=str)
    if ext == "csv":
        detected = chardet.detect(content)
        encoding = detected.get("encoding", "utf-8")
        return pd.read_csv(io.BytesIO(content), dtype=str, encoding=encoding, on_bad_lines="skip")
    raise ValueError(f"Unsupported file type: .{ext}")


def detect_headers(df: pd.DataFrame) -> list[str]:
    return [str(h).strip() for h in df.columns if str(h).strip()]


def _normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def suggest_mappings(headers: list[str]) -> dict[str, str | None]:
    field_keywords: dict[str, list[str]] = {
        "name": NAME_KEYWORDS,
        "phone": PHONE_KEYWORDS,
        "organization": ORG_KEYWORDS,
        "job_title": TITLE_KEYWORDS,
        "email": EMAIL_KEYWORDS,
        "city": CITY_KEYWORDS,
        "notes": NOTES_KEYWORDS,
    }
    mappings: dict[str, str | None] = {}
    used: set[str] = set()

    for field, keywords in field_keywords.items():
        for header in headers:
            normalized = _normalize_header(header)
            if header in used:
                continue
            if any(kw in normalized for kw in keywords):
                mappings[field] = header
                used.add(header)
                break
        else:
            mappings[field] = None

    return mappings


def clean_name(value: str) -> tuple[str, list[str], list[str]]:
    corrections: list[str] = []
    warnings: list[str] = []
    cleaned = str(value) if pd.notna(value) else ""

    original = cleaned
    cleaned = cleaned.strip()
    if cleaned != original:
        corrections.append("Removed leading/trailing spaces from name")

    cleaned = unicodedata.normalize("NFC", cleaned)

    if re.search(r"[\t\n\r\x0b\x0c\xa0]", cleaned):
        cleaned = re.sub(r"[\t\n\r\x0b\x0c\xa0]+", " ", cleaned)
        corrections.append("Replaced tabs, line breaks, and non-breaking spaces with spaces in name")

    if re.search(r"  +", cleaned):
        cleaned = re.sub(r"  +", " ", cleaned)
        corrections.append("Removed repeated spaces from name")

    cleaned = re.sub(r"\s+/\s+", "/", cleaned)
    cleaned = re.sub(r"\s+-\s+", " - ", cleaned)
    cleaned = re.sub(r"\s+/ ", "/ ", cleaned)
    cleaned = re.sub(r" /\s+", " /", cleaned)

    if not cleaned:
        warnings.append("Name is empty")

    return cleaned, corrections, warnings


_LABEL_RE = re.compile(r"^(mobile|phone|tel|cell|telephone)\s*:\s*", re.IGNORECASE)
_EXCEL_DOT_ZERO_RE = re.compile(r"^\d+\.0$")
_TRAILING_DOT_ZERO_RE = re.compile(r"\.0$")


def clean_phone(
    value: str, default_country: str, contact_type: str
) -> tuple[str, str, str, list[str], list[str]]:
    corrections: list[str] = []
    warnings: list[str] = []
    raw = str(value) if pd.notna(value) else ""
    original = raw

    cleaned = raw.strip()
    cleaned = unicodedata.normalize("NFC", cleaned)

    after_label = _LABEL_RE.sub("", cleaned)
    if after_label != cleaned:
        corrections.append("Removed phone label prefix")
        cleaned = after_label

    if _EXCEL_DOT_ZERO_RE.match(cleaned):
        cleaned = cleaned[:-2]
        corrections.append("Removed Excel .0 suffix")

    no_spaces = re.sub(r"[\s\-().|]+", "", cleaned)
    if no_spaces != cleaned:
        corrections.append("Removed spaces and punctuation from phone number")
        cleaned = no_spaces

    if cleaned.count("+") > 1:
        first_plus = cleaned.find("+")
        cleaned = cleaned[: first_plus + 1] + cleaned[first_plus + 1:].replace("+", "")
        corrections.append("Removed misplaced + signs")
    elif cleaned.count("+") == 1 and not cleaned.startswith("+"):
        cleaned = "+" + cleaned.replace("+", "")
        corrections.append("Moved + to beginning of phone number")

    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
        corrections.append("Converted international prefix 00 to +")

    if not cleaned:
        warnings.append("Phone number is empty")
        return "", "", default_country, corrections, warnings

    if not cleaned.startswith("+") and cleaned.isdigit():
        if default_country == "PK":
            national = cleaned.lstrip("0") if cleaned.startswith("0") else cleaned
            if national.startswith("92") and len(national) >= 12:
                cleaned = "+" + national
            else:
                cleaned = "+92" + national
                if raw.startswith("0"):
                    corrections.append("Removed national trunk prefix")
                corrections.append("Added Pakistan country code")
        else:
            try:
                parsed = phonenumbers.parse(cleaned, default_country)
                if phonenumbers.is_possible_number(parsed):
                    cleaned = phonenumbers.format_number(parsed, PhoneNumberFormat.E164)
                    corrections.append(f"Added {default_country} country code")
            except phonenumbers.NumberParseException:
                pass

    try:
        parsed = phonenumbers.parse(cleaned, default_country)
    except phonenumbers.NumberParseException:
        warnings.append("Could not parse phone number")
        return original, cleaned, "", corrections, warnings

    is_possible = phonenumbers.is_possible_number(parsed)
    is_valid = phonenumbers.is_valid_number(parsed)

    region = phonenumbers.region_code_for_number(parsed) or ""

    e164 = phonenumbers.format_number(parsed, PhoneNumberFormat.E164)

    if not is_possible:
        warnings.append("Phone number is not possible")

    if not is_valid:
        warnings.append("Phone number is possible but not valid")

    if region and region != default_country:
        warnings.append(
            f"Number belongs to {region}, not {default_country}"
        )

    if default_country == "PK" and contact_type == "mobile-only":
        national_num = phonenumbers.format_number(parsed, PhoneNumberFormat.NATIONAL)
        national_digits = re.sub(r"\D", "", national_num)
        if national_digits.startswith("0"):
            national_digits = national_digits[1:]
        if len(national_digits) < 10:
            warnings.append("Phone number is too short")
        elif len(national_digits) > 10:
            warnings.append("Phone number is too long")
        elif national_digits[0] != "3":
            warnings.append("Pakistan landline number in mobile-only mode")

    return original, e164, region, corrections, warnings


def resolve_pattern(template: str, row: pd.Series) -> str:
    """Replace {ColumnName} placeholders with row values."""
    result = template
    for col in row.index:
        val = str(row[col]) if pd.notna(row[col]) else ""
        result = result.replace(f"{{{col}}}", val.strip())
    result = re.sub(r"\s*/\s*/\s*", " / ", result)
    result = re.sub(r"^\s*/\s*|\s*/\s*$", "", result)
    return result.strip()


def _normalize_name_for_dedup(name: str) -> str:
    n = name.lower().strip()
    n = re.sub(r"[^a-z0-9\s]", "", n)
    n = re.sub(r"\s+", " ", n)
    return n


def _normalize_phone_for_dedup(phone: str) -> str:
    return re.sub(r"[^0-9+]", "", phone).strip()


def classify_status(
    corrections: list[str], warnings: list[str], original_name: str, original_phone: str
) -> str:
    if not original_name.strip():
        return "invalid"
    if not original_phone.strip():
        return "invalid"
    if warnings:
        return "warning"
    if corrections:
        return "corrected"
    return "valid"


def detect_duplicates(rows: list[VCardRow]) -> list[VCardRow]:
    name_groups: dict[str, list[int]] = defaultdict(list)
    phone_groups: dict[str, list[int]] = defaultdict(list)

    for i, row in enumerate(rows):
        if row.status == "invalid":
            continue
        nn = _normalize_name_for_dedup(row.corrected_name)
        if nn:
            name_groups[nn].append(i)
        pn = _normalize_phone_for_dedup(row.normalized_phone)
        if pn:
            phone_groups[pn].append(i)

    exact_dupes: set[int] = set()
    for nn, indices in name_groups.items():
        phone_by_name: dict[str, list[int]] = defaultdict(list)
        for idx in indices:
            pn = _normalize_phone_for_dedup(rows[idx].normalized_phone)
            if pn:
                phone_by_name[pn].append(idx)

        for pn, dup_indices in phone_by_name.items():
            if len(dup_indices) > 1:
                for idx in dup_indices[1:]:
                    exact_dupes.add(idx)

    multi_number_names: dict[str, list[int]] = {}
    for nn, indices in name_groups.items():
        phones = {_normalize_phone_for_dedup(rows[idx].normalized_phone) for idx in indices}
        phones.discard("")
        if len(phones) > 1:
            multi_number_names[nn] = indices

    shared_numbers: dict[str, list[int]] = {}
    for pn, indices in phone_groups.items():
        names = {_normalize_name_for_dedup(rows[idx].corrected_name) for idx in indices}
        names.discard("")
        if len(names) > 1:
            shared_numbers[pn] = indices

    for idx in exact_dupes:
        rows[idx].status = "duplicate"
        rows[idx].included_in_export = False
        rows[idx].duplicate_group = "exact"

    for nn, indices in multi_number_names.items():
        for idx in indices:
            rows[idx].duplicate_group = f"multi:{nn}"
            if rows[idx].status == "valid":
                rows[idx].status = "corrected"
            if "Same contact has multiple phone numbers" not in rows[idx].warnings:
                rows[idx].warnings.append("Same contact has multiple phone numbers")

    for pn, indices in shared_numbers.items():
        for idx in indices:
            if "Phone number is shared by different contacts" not in rows[idx].warnings:
                rows[idx].warnings.append("Phone number is shared by different contacts")
            if rows[idx].status == "valid":
                rows[idx].status = "warning"

    return rows


def generate_summary(
    rows: list[VCardRow], uploaded_rows: int
) -> ProcessingSummary:
    status_counts: dict[str, int] = defaultdict(int)
    for row in rows:
        status_counts[row.status] += 1

    multi_number = sum(
        1 for r in rows if r.duplicate_group and r.duplicate_group.startswith("multi:")
    )
    shared = sum(
        1
        for r in rows
        if "Phone number is shared by different contacts" in r.warnings
    )

    all_corrections = []
    for r in rows:
        all_corrections.extend(r.corrections)

    return ProcessingSummary(
        uploaded_rows=uploaded_rows,
        processed_rows=len(rows),
        valid_rows=status_counts.get("valid", 0),
        corrected_rows=status_counts.get("corrected", 0),
        warning_rows=status_counts.get("warning", 0),
        invalid_rows=status_counts.get("invalid", 0),
        excluded_rows=status_counts.get("excluded", 0),
        exact_duplicates_removed=status_counts.get("duplicate", 0),
        contacts_with_multiple_numbers=multi_number,
        shared_phone_numbers=shared,
        names_trimmed=sum(1 for c in all_corrections if "spaces from name" in c),
        multiple_spaces_removed=sum(
            1 for c in all_corrections if "repeated spaces" in c
        ),
        phone_spaces_removed=sum(
            1 for c in all_corrections if "spaces and punctuation from phone" in c
        ),
        country_codes_added=sum(
            1 for c in all_corrections if "country code" in c.lower()
        ),
        leading_zeroes_removed=sum(
            1 for c in all_corrections if "trunk prefix" in c
        ),
        international_prefixes_corrected=sum(
            1 for c in all_corrections if "international prefix" in c
        ),
        final_vcards=sum(
            1
            for r in rows
            if r.included_in_export
            and r.status not in ("invalid", "duplicate")
        ),
    )


def _escape_vcard(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(",", "\\,")
        .replace(";", "\\;")
        .replace("\n", "\\n")
        .replace("\r", "")
    )


def generate_vcf(rows: list[VCardRow]) -> str:
    included = [
        r
        for r in rows
        if r.included_in_export and r.status not in ("invalid", "duplicate")
    ]

    name_groups: dict[str, list[VCardRow]] = defaultdict(list)
    for row in included:
        key = _normalize_name_for_dedup(row.corrected_name) or str(row.source_row)
        name_groups[key].append(row)

    vcards: list[str] = []
    for group_rows in name_groups.values():
        first = group_rows[0]
        lines = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            f"N:;{_escape_vcard(first.corrected_name)};;;",
            f"FN:{_escape_vcard(first.corrected_name)}",
        ]

        if first.organization:
            lines.append(f"ORG:{_escape_vcard(first.organization)}")
        if first.job_title:
            lines.append(f"TITLE:{_escape_vcard(first.job_title)}")

        seen_phones: set[str] = set()
        for row in group_rows:
            if row.normalized_phone and row.normalized_phone not in seen_phones:
                lines.append(f"TEL;TYPE=CELL:{row.normalized_phone}")
                seen_phones.add(row.normalized_phone)

        if first.email:
            lines.append(f"EMAIL:{_escape_vcard(first.email)}")
        if first.city:
            lines.append(f"NOTE:{_escape_vcard('City: ' + first.city)}")
        elif first.notes:
            lines.append(f"NOTE:{_escape_vcard(first.notes)}")

        lines.append("END:VCARD")
        vcards.append("\r\n".join(lines))

    return "\r\n".join(vcards) + "\r\n"


def generate_error_report(rows: list[VCardRow]) -> io.BytesIO:
    error_rows = [
        r
        for r in rows
        if r.status in ("warning", "invalid", "duplicate")
    ]

    data = []
    for r in error_rows:
        data.append(
            {
                "Row": r.source_row,
                "Original Name": r.original_name,
                "Corrected Name": r.corrected_name,
                "Original Phone": r.original_phone,
                "Corrected Phone": r.corrected_phone,
                "Normalized Phone": r.normalized_phone,
                "Country": r.detected_country,
                "Status": r.status,
                "Warnings": "; ".join(r.warnings),
                "Corrections": "; ".join(r.corrections),
            }
        )

    df = pd.DataFrame(data)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Errors", index=False)
    buf.seek(0)
    return buf
