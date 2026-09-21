import io

import pandas as pd
import pytest

from providers.vcard.processor import (
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
from providers.vcard.schemas import VCardRow


# --- clean_name tests ---


def test_clean_name_trims_whitespace():
    result, corrections, warnings = clean_name("  Muhammad Arif  ")
    assert result == "Muhammad Arif"
    assert any("spaces" in c.lower() for c in corrections)
    assert warnings == []


def test_clean_name_collapses_multiple_spaces():
    result, corrections, warnings = clean_name("Muhammad    Arif    Lodhi")
    assert result == "Muhammad Arif Lodhi"
    assert any("repeated" in c.lower() for c in corrections)


def test_clean_name_handles_tabs_and_newlines():
    result, corrections, warnings = clean_name("Muhammad\tArif\nLodhi")
    assert result == "Muhammad Arif Lodhi"
    assert any("tabs" in c.lower() or "line breaks" in c.lower() for c in corrections)


def test_clean_name_empty():
    result, corrections, warnings = clean_name("")
    assert result == ""
    assert any("empty" in w.lower() for w in warnings)


def test_clean_name_preserves_title_case():
    result, _, _ = clean_name("McDonald")
    assert result == "McDonald"


def test_clean_name_preserves_hyphenated_names():
    result, _, _ = clean_name("Aal-e-Rasool")
    assert result == "Aal-e-Rasool"


def test_clean_name_normalizes_unicode():
    result, corrections, _ = clean_name("Muhammad\u00A0Arif")
    assert "\u00A0" not in result
    assert result == "Muhammad Arif"
    assert any("non-breaking" in c.lower() or "tabs" in c.lower() for c in corrections)


# --- clean_phone tests ---


def test_phone_pakistani_national():
    _, normalized, country, corrections, warnings = clean_phone("03001234567", "PK", "mobile-only")
    assert normalized == "+923001234567"
    assert country == "PK"
    assert any("country code" in c.lower() for c in corrections)


def test_phone_pakistani_without_zero():
    _, normalized, country, _, _ = clean_phone("3001234567", "PK", "mobile-only")
    assert normalized == "+923001234567"
    assert country == "PK"


def test_phone_pakistani_with_92_prefix():
    _, normalized, _, _, _ = clean_phone("923001234567", "PK", "mobile-only")
    assert normalized == "+923001234567"


def test_phone_pakistani_with_0092_prefix():
    _, normalized, _, corrections, _ = clean_phone("00923001234567", "PK", "mobile-only")
    assert normalized == "+923001234567"
    assert any("international prefix" in c.lower() for c in corrections)


def test_phone_pakistani_with_plus92_and_spaces():
    _, normalized, _, corrections, _ = clean_phone("+92 300 1234567", "PK", "mobile-only")
    assert normalized == "+923001234567"
    assert any("spaces" in c.lower() for c in corrections)


def test_phone_uk_number():
    _, normalized, country, _, _ = clean_phone("+44 7911 123456", "PK", "mobile-only")
    assert normalized == "+447911123456"
    assert country in ("GB", "GG")


def test_phone_us_number():
    _, normalized, country, _, _ = clean_phone("+1 (202) 555-0123", "US", "mobile-landline")
    assert normalized == "+12025550123"
    assert country == "US"


def test_phone_too_short():
    _, _, _, _, warnings = clean_phone("12345", "PK", "mobile-only")
    assert any("short" in w.lower() for w in warnings)


def test_phone_with_label():
    _, normalized, _, corrections, _ = clean_phone("Mobile: 0300-1234567", "PK", "mobile-only")
    assert normalized == "+923001234567"
    assert any("label" in c.lower() for c in corrections)


def test_phone_excel_dot_zero():
    _, normalized, _, corrections, _ = clean_phone("03001234567.0", "PK", "mobile-only")
    assert normalized == "+923001234567"
    assert any("excel" in c.lower() for c in corrections)


def test_phone_empty():
    _, normalized, _, _, warnings = clean_phone("", "PK", "mobile-only")
    assert normalized == ""
    assert any("empty" in w.lower() for w in warnings)


def test_phone_pakistan_landline_in_mobile_only():
    _, _, _, _, warnings = clean_phone("02134567890", "PK", "mobile-only")
    assert any("landline" in w.lower() for w in warnings)


def test_phone_country_mismatch():
    _, _, country, _, warnings = clean_phone("+447911123456", "PK", "mobile-only")
    assert country in ("GB", "GG")
    assert any("not pk" in w.lower() or "not PK" in w for w in warnings)


# --- suggest_mappings tests ---


def test_suggest_mappings_name():
    headers = ["Doctor Name", "Phone Number", "City"]
    mappings = suggest_mappings(headers)
    assert mappings["name"] == "Doctor Name"
    assert mappings["phone"] == "Phone Number"
    assert mappings["city"] == "City"


def test_suggest_mappings_variations():
    headers = ["Contact Name", "Mobile", "Organization", "Email"]
    mappings = suggest_mappings(headers)
    assert mappings["name"] == "Contact Name"
    assert mappings["phone"] == "Mobile"
    assert mappings["organization"] == "Organization"
    assert mappings["email"] == "Email"


def test_suggest_mappings_no_match():
    headers = ["Column A", "Column B"]
    mappings = suggest_mappings(headers)
    assert mappings["name"] is None
    assert mappings["phone"] is None


# --- classify_status tests ---


def test_classify_status_valid():
    assert classify_status([], [], "John", "+1234567890") == "valid"


def test_classify_status_corrected():
    assert classify_status(["trimmed"], [], "John", "+1234567890") == "corrected"


def test_classify_status_warning():
    assert classify_status([], ["too short"], "John", "+123") == "warning"


def test_classify_status_invalid_empty_name():
    assert classify_status([], [], "", "+1234567890") == "invalid"


def test_classify_status_invalid_empty_phone():
    assert classify_status([], [], "John", "") == "invalid"


# --- detect_duplicates tests ---


def _make_row(name: str, phone: str, status: str = "valid") -> VCardRow:
    return VCardRow(
        source_row=1,
        original_name=name,
        corrected_name=name,
        original_phone=phone,
        corrected_phone=phone,
        normalized_phone=phone,
        detected_country="PK",
        status=status,
        corrections=[],
        warnings=[],
    )


def test_exact_duplicates():
    rows = [
        _make_row("John", "+923001234567"),
        _make_row("John", "+923001234567"),
    ]
    rows = detect_duplicates(rows)
    assert rows[0].status == "valid"
    assert rows[1].status == "duplicate"
    assert rows[1].included_in_export is False


def test_same_person_multiple_numbers():
    rows = [
        _make_row("John", "+923001234567"),
        _make_row("John", "+923001234568"),
    ]
    rows = detect_duplicates(rows)
    assert rows[0].duplicate_group is not None
    assert rows[0].duplicate_group.startswith("multi:")
    assert rows[1].duplicate_group is not None


def test_same_number_different_names():
    rows = [
        _make_row("John", "+923001234567"),
        _make_row("Jane", "+923001234567"),
    ]
    rows = detect_duplicates(rows)
    assert any("shared" in w.lower() for w in rows[0].warnings)
    assert any("shared" in w.lower() for w in rows[1].warnings)


# --- generate_vcf tests ---


def test_vcf_single_contact():
    rows = [
        VCardRow(
            source_row=2,
            original_name="John Doe",
            corrected_name="John Doe",
            original_phone="+923001234567",
            corrected_phone="+923001234567",
            normalized_phone="+923001234567",
            detected_country="PK",
            status="valid",
            corrections=[],
            warnings=[],
        )
    ]
    vcf = generate_vcf(rows)
    assert "BEGIN:VCARD" in vcf
    assert "END:VCARD" in vcf
    assert "FN:John Doe" in vcf
    assert "TEL;TYPE=CELL:+923001234567" in vcf
    assert "VERSION:3.0" in vcf


def test_vcf_multiple_numbers():
    rows = [
        VCardRow(
            source_row=2,
            original_name="John",
            corrected_name="John",
            original_phone="+923001234567",
            corrected_phone="+923001234567",
            normalized_phone="+923001234567",
            detected_country="PK",
            status="valid",
            corrections=[],
            warnings=[],
        ),
        VCardRow(
            source_row=3,
            original_name="John",
            corrected_name="John",
            original_phone="+923001234568",
            corrected_phone="+923001234568",
            normalized_phone="+923001234568",
            detected_country="PK",
            status="valid",
            corrections=[],
            warnings=[],
        ),
    ]
    vcf = generate_vcf(rows)
    assert vcf.count("BEGIN:VCARD") == 1
    assert "+923001234567" in vcf
    assert "+923001234568" in vcf


def test_vcf_excludes_duplicates():
    rows = [
        _make_row("John", "+923001234567"),
        VCardRow(
            source_row=3,
            original_name="John",
            corrected_name="John",
            original_phone="+923001234567",
            corrected_phone="+923001234567",
            normalized_phone="+923001234567",
            detected_country="PK",
            status="duplicate",
            corrections=[],
            warnings=[],
            included_in_export=False,
        ),
    ]
    vcf = generate_vcf(rows)
    assert vcf.count("BEGIN:VCARD") == 1


def test_vcf_escapes_special_characters():
    rows = [
        VCardRow(
            source_row=2,
            original_name="John, Doe",
            corrected_name="John, Doe",
            original_phone="+923001234567",
            corrected_phone="+923001234567",
            normalized_phone="+923001234567",
            detected_country="PK",
            status="valid",
            corrections=[],
            warnings=[],
        )
    ]
    vcf = generate_vcf(rows)
    assert "John\\, Doe" in vcf


def test_vcf_crlf_line_endings():
    rows = [_make_row("John", "+923001234567")]
    vcf = generate_vcf(rows)
    assert "\r\n" in vcf


# --- generate_summary tests ---


def test_generate_summary():
    rows = [
        _make_row("John", "+923001234567", "valid"),
        _make_row("Jane", "+923001234568", "corrected"),
        VCardRow(
            source_row=4,
            original_name="X",
            corrected_name="X",
            original_phone="",
            corrected_phone="",
            normalized_phone="",
            detected_country="",
            status="invalid",
            corrections=[],
            warnings=["empty"],
        ),
    ]
    summary = generate_summary(rows, 3)
    assert summary.uploaded_rows == 3
    assert summary.valid_rows == 1
    assert summary.corrected_rows == 1
    assert summary.invalid_rows == 1
    assert summary.final_vcards == 2


# --- parse_file tests ---


def test_parse_csv():
    csv_content = b"Name,Phone\nJohn,03001234567\nJane,03011234567"
    df = parse_file(csv_content, "test.csv")
    assert list(df.columns) == ["Name", "Phone"]
    assert len(df) == 2


def test_parse_xlsx():
    df = pd.DataFrame({"Name": ["John", "Jane"], "Phone": ["03001234567", "03011234567"]})
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        df.to_excel(w, index=False)
    xlsx_bytes = buf.getvalue()
    result = parse_file(xlsx_bytes, "test.xlsx")
    assert list(result.columns) == ["Name", "Phone"]
    assert len(result) == 2


# --- resolve_pattern tests ---


def test_resolve_pattern_simple():
    row = pd.Series({"City": "Islamabad", "Name": "Dr. Ahmed", "Speciality": "Cardiology"})
    result = resolve_pattern("{City} / {Speciality} / {Name}", row)
    assert result == "Islamabad / Cardiology / Dr. Ahmed"


def test_resolve_pattern_with_different_separator():
    row = pd.Series({"City": "Lahore", "Name": "Dr. Fatima"})
    result = resolve_pattern("{City} - {Name}", row)
    assert result == "Lahore - Dr. Fatima"


def test_resolve_pattern_single_column():
    row = pd.Series({"Name": "John Doe"})
    result = resolve_pattern("{Name}", row)
    assert result == "John Doe"


def test_resolve_pattern_missing_column():
    row = pd.Series({"City": "Karachi"})
    result = resolve_pattern("{City} / {Missing}", row)
    assert result == "Karachi / {Missing}"


def test_resolve_pattern_empty_values():
    row = pd.Series({"City": "", "Name": "Test"})
    result = resolve_pattern("{City} / {Name}", row)
    assert result == "Test"


def test_resolve_pattern_leading_trailing_separator():
    row = pd.Series({"City": "Peshawar", "Name": "Ali"})
    result = resolve_pattern("{City} / {Name} /", row)
    assert result == "Peshawar / Ali"


def test_resolve_pattern_consecutive_separators():
    row = pd.Series({"City": "Quetta", "Speciality": "", "Name": "Sara"})
    result = resolve_pattern("{City} / {Speciality} / {Name}", row)
    assert result == "Quetta / Sara"
