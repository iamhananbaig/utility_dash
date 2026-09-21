import logging
import re
import time
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from datetime import datetime
from threading import local
from typing import Any

import httpx
import pandas as pd
from bs4 import BeautifulSoup
from bs4.element import Tag

from .config import (
    CONNECT_TIMEOUT,
    HEADERS,
    MAX_WORKERS,
    PROXY_URL,
    READ_TIMEOUT,
    REFERENCE_KEY_CANDIDATES,
    REQUEST_DELAY,
    SEARCH_URL,
    WEBSITE_PAYABLE_KEY_CANDIDATES,
)

logger = logging.getLogger(__name__)

_thread_local = local()

# ============================================================
# General helpers
# ============================================================


def attribute_to_string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(str(item) for item in value)
    return str(value)


def normalize_reference(value: Any) -> str:
    if value is None:
        return ""
    reference = str(value).strip().removesuffix(".0")
    return re.sub(r"[^A-Za-z0-9]", "", reference).upper()


def is_valid_reference_candidate(value: Any) -> bool:
    normalized = normalize_reference(value)
    return (
        10 <= len(normalized) <= 20
        and normalized.isalnum()
        and any(c.isdigit() for c in normalized)
    )


def to_number(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        if isinstance(pd.isna(value), bool) and pd.isna(value):
            return 0.0
    except (TypeError, ValueError):
        pass

    text = str(value).strip()
    if not text or text.upper() in {"-", "--", "N/A", "NA", "NONE"}:
        return 0.0

    text = text.split("/", 1)[0].strip()
    negative_parentheses = text.startswith("(") and text.endswith(")")
    cleaned = re.sub(r"[^0-9.\-]", "", text)

    if cleaned in {"", "-", ".", "-."}:
        return 0.0

    try:
        number = float(cleaned)
    except ValueError:
        return 0.0

    if negative_parentheses:
        number = -abs(number)
    return number


def normalize_key(value: str) -> str:
    normalized = (
        value.upper()
        .replace("&", "AND")
        .replace("/", "_")
        .replace("-", "_")
        .replace("(", "_")
        .replace(")", "_")
        .replace(".", "_")
        .replace(" ", "_")
    )
    return re.sub(r"_+", "_", normalized).strip("_")


# ============================================================
# Retry-enabled client
# ============================================================

_TIMEOUT = httpx.Timeout(connect=CONNECT_TIMEOUT, read=READ_TIMEOUT, write=READ_TIMEOUT, pool=CONNECT_TIMEOUT)
_TRANSPORT = httpx.HTTPTransport(retries=2)


def get_client() -> httpx.Client:
    existing = getattr(_thread_local, "client", None)
    if isinstance(existing, httpx.Client):
        return existing

    client = httpx.Client(
        headers=HEADERS,
        timeout=_TIMEOUT,
        transport=_TRANSPORT,
        follow_redirects=True,
        proxy=PROXY_URL,
    )

    _thread_local.client = client
    return client


# ============================================================
# Bill request
# ============================================================


def _get_hidden_fields(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "lxml")
    fields: dict[str, str] = {}
    for element in soup.select('input[type="hidden"][name]'):
        if not isinstance(element, Tag):
            continue
        name = attribute_to_string(element.get("name")).strip()
        if not name:
            continue
        fields[name] = attribute_to_string(element.get("value"))
    return fields


def _extract_qr_text(soup: BeautifulSoup) -> str:
    element = soup.select_one(
        '[id^="charges_qr_text_"], textarea[id*="charges_qr"], input[id*="charges_qr"]'
    )
    if not isinstance(element, Tag):
        raise TypeError("Bill details were not found.")

    if element.name == "textarea":
        value = element.get_text(strip=True)
    else:
        attr_val = element.get("value")
        if attr_val is not None:
            value = attribute_to_string(attr_val).strip()
        else:
            value = element.get_text(strip=True)

    if not value:
        raise RuntimeError("Bill details were empty.")
    return value


def fetch_bill(
    reference_no: str, client: httpx.Client
) -> tuple[str, BeautifulSoup]:
    form_response = client.get(SEARCH_URL)
    form_response.raise_for_status()

    payload = _get_hidden_fields(form_response.text)
    payload.update(
        {
            "__EVENTTARGET": "",
            "__EVENTARGUMENT": "",
            "__LASTFOCUS": "",
            "rbSearchByList": "refno",
            "searchTextBox": reference_no,
            "ruCodeTextBox": "",
            "btnSearch": "Search",
        }
    )

    bill_response = client.post(SEARCH_URL, data=payload)
    bill_response.raise_for_status()

    soup = BeautifulSoup(bill_response.text, "lxml")
    qr_text = _extract_qr_text(soup)
    return qr_text, soup


# ============================================================
# QR text parser
# ============================================================


def parse_bill(qr_text: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    current_section = ""

    for raw_line in qr_text.splitlines():
        line = raw_line.strip()
        if not line or line.lower() == "text area":
            continue

        if line.startswith("-") and line.endswith("-"):
            section_part = line.strip("- ").split("=", 1)[0].strip()
            current_section = normalize_key(section_part)
            if "=" in line:
                total_value = line.rsplit("=", 1)[1].strip("- ").strip()
                result[f"{current_section}_TOTAL"] = total_value
            continue

        if ":" not in line:
            continue

        key, value = line.split(":", 1)
        clean_key = normalize_key(key.strip())
        column_name = f"{current_section}_{clean_key}" if current_section else clean_key
        result[column_name] = value.strip()

    return result


# ============================================================
# Bill dates
# ============================================================


def extract_bill_dates(soup: BeautifulSoup) -> dict[str, str]:
    result: dict[str, str] = {}

    label_map = {
        "BILL MONTH": "BILL_MONTH",
        "READING DATE": "READING_DATE",
        "ISSUE DATE": "ISSUE_DATE",
        "DUE DATE": "DUE_DATE",
    }

    for label_el in soup.select(".right-panel-en"):
        if not isinstance(label_el, Tag):
            continue
        label = label_el.get_text(" ", strip=True).replace("\u26a0", "").strip().upper()
        column_name = label_map.get(label)
        if not column_name:
            continue

        container = label_el.find_parent(
            class_=["right-section-cell", "right-grid-cell"]
        )
        if not isinstance(container, Tag):
            continue

        value_el = container.select_one(".right-main-val, .right-panel-date-val")
        if isinstance(value_el, Tag):
            result[column_name] = value_el.get_text(" ", strip=True)

    return result


# ============================================================
# Arrears
# ============================================================


def extract_arrears(soup: BeautifulSoup) -> dict[str, Any]:
    for row in soup.select(".charges-bd-row"):
        if not isinstance(row, Tag):
            continue
        label_el = row.select_one(".charges-bd-en")
        value_el = row.select_one(".charges-bd-val")
        if not isinstance(label_el, Tag) or not isinstance(value_el, Tag):
            continue

        label = label_el.get_text(" ", strip=True).upper().strip()
        if label != "ARREARS":
            continue

        raw_value = value_el.get_text(" ", strip=True)
        amount_text = raw_value.split("/", 1)[0].replace(",", "").strip()
        suffix = raw_value.split("/", 1)[1].strip() if "/" in raw_value else ""

        return {
            "ARREARS_RAW": raw_value,
            "ARREARS_AMOUNT": to_number(amount_text),
            "ARREARS_SUFFIX": suffix,
        }

    return {"ARREARS_RAW": "", "ARREARS_AMOUNT": 0, "ARREARS_SUFFIX": ""}


# ============================================================
# Bill history
# ============================================================


def _normalize_header(value: str) -> str:
    return (
        value.upper()
        .replace(".", "")
        .replace("(", " ")
        .replace(")", " ")
        .replace("_", " ")
        .strip()
    )


def _empty_history_result(error: str = "") -> dict[str, Any]:
    return {
        "HISTORY_FIRST_MONTH": "",
        "HISTORY_FIRST_KWH_UNITS": pd.NA,
        "HISTORY_FIRST_BILL_RS": pd.NA,
        "HISTORY_LAST_MONTH": "",
        "HISTORY_LAST_KWH_UNITS": pd.NA,
        "HISTORY_LAST_BILL_RS": pd.NA,
        "HISTORY_STATUS": "NOT_AVAILABLE" if not error else "PARSE_FAILED",
        "HISTORY_ERROR": error,
    }


def extract_bill_history_summary(soup: BeautifulSoup) -> dict[str, Any]:
    try:
        history_card: Tag | None = None
        for card in soup.select(".component-card"):
            if not isinstance(card, Tag):
                continue
            card_strings = {
                text.strip().upper() for text in card.stripped_strings if text.strip()
            }
            if "BILL HISTORY" in card_strings:
                history_card = card
                break

        history_container: Tag | BeautifulSoup = history_card if history_card else soup
        grids = history_container.select(".history-block-grid")

        if not grids:
            return _empty_history_result("Bill-history grids were not found.")

        history_rows: list[dict[str, Any]] = []

        for grid in grids:
            if not isinstance(grid, Tag):
                continue

            header_cells = [
                _normalize_header(cell.get_text(" ", strip=True))
                for cell in grid.select(".history-header-row .history-header-cell")
                if isinstance(cell, Tag)
            ]
            if not header_cells:
                continue

            month_index = next(
                (i for i, h in enumerate(header_cells) if h == "MONTH"), None
            )
            units_index = next(
                (i for i, h in enumerate(header_cells) if "UNIT" in h), None
            )
            bill_index = next(
                (i for i, h in enumerate(header_cells) if h.startswith("BILL")), None
            )

            if month_index is None or units_index is None or bill_index is None:
                continue

            required_index = max(month_index, units_index, bill_index)

            for history_row in grid.select(".history-row"):
                if not isinstance(history_row, Tag):
                    continue

                cells = [
                    cell.get_text(" ", strip=True)
                    for cell in history_row.select(".history-cell")
                    if isinstance(cell, Tag)
                ]

                if len(cells) <= required_index:
                    continue

                month = cells[month_index].strip()
                if not month:
                    continue

                history_rows.append(
                    {
                        "MONTH": month,
                        "KWH_UNITS": to_number(cells[units_index]),
                        "BILL_RS": to_number(cells[bill_index]),
                    }
                )

        if not history_rows:
            return _empty_history_result("No valid bill-history rows were found.")

        first = history_rows[0]
        last = history_rows[-1]
        return {
            "HISTORY_FIRST_MONTH": first["MONTH"],
            "HISTORY_FIRST_KWH_UNITS": first["KWH_UNITS"],
            "HISTORY_FIRST_BILL_RS": first["BILL_RS"],
            "HISTORY_LAST_MONTH": last["MONTH"],
            "HISTORY_LAST_KWH_UNITS": last["KWH_UNITS"],
            "HISTORY_LAST_BILL_RS": last["BILL_RS"],
            "HISTORY_STATUS": "SUCCESS",
            "HISTORY_ERROR": "",
        }

    except (AttributeError, ValueError, IndexError, KeyError) as error:
        return _empty_history_result(str(error))


# ============================================================
# Reference-number verification
# ============================================================


def _find_reference_in_parsed_data(parsed_data: dict[str, Any]) -> str:
    for candidate in REFERENCE_KEY_CANDIDATES:
        value = parsed_data.get(candidate)
        if is_valid_reference_candidate(value):
            return normalize_reference(value)

    for key, value in parsed_data.items():
        normalized_key = normalize_key(key)
        if (
            "REFERENCE" in normalized_key
            and ("NO" in normalized_key or "NUMBER" in normalized_key)
            and is_valid_reference_candidate(value)
        ):
            return normalize_reference(value)

    return ""


def _find_reference_in_html(soup: BeautifulSoup) -> str:
    label_patterns = {
        "REFERENCE NO",
        "REFERENCE NUMBER",
        "REF NO",
        "REF NUMBER",
    }

    for label_el in soup.select(".label-row .en-lbl"):
        if not isinstance(label_el, Tag):
            continue
        label = (
            label_el.get_text(" ", strip=True)
            .replace(".", "")
            .replace(":", "")
            .upper()
            .strip()
        )
        if label not in label_patterns:
            continue

        grid_cell = label_el.find_parent(class_="grid-col-cell")
        if not isinstance(grid_cell, Tag):
            continue

        value_el = grid_cell.select_one(".val-space")
        if not isinstance(value_el, Tag):
            continue

        returned_ref = normalize_reference(value_el.get_text(" ", strip=True))
        if is_valid_reference_candidate(returned_ref):
            return returned_ref

    return ""


def _references_match(
    requested_reference: str, returned_reference: str
) -> tuple[bool, str]:
    requested = normalize_reference(requested_reference)
    returned = normalize_reference(returned_reference)

    if requested == returned:
        return True, "MATCHED"

    req_without = re.sub(r"[A-Z]$", "", requested)
    ret_without = re.sub(r"[A-Z]$", "", returned)

    if (
        req_without
        and req_without == ret_without
        and (requested != req_without or returned != ret_without)
    ):
        return True, "MATCHED_IGNORING_SUFFIX"

    return False, "MISMATCH"


def verify_returned_reference(
    requested_reference: str, parsed_data: dict[str, Any], soup: BeautifulSoup
) -> dict[str, str]:
    returned_reference = _find_reference_in_parsed_data(
        parsed_data
    ) or _find_reference_in_html(soup)
    requested_normalized = normalize_reference(requested_reference)

    if not returned_reference:
        return {
            "RETURNED_REFERENCE_NO": "",
            "REFERENCE_VERIFICATION": "NOT_AVAILABLE",
            "REFERENCE_ERROR": "",
        }

    is_match, status = _references_match(requested_normalized, returned_reference)
    reference_error = ""
    if not is_match:
        reference_error = (
            "Returned bill reference does not match the requested reference. "
            f"Requested: {requested_normalized}; returned: {returned_reference}."
        )

    return {
        "RETURNED_REFERENCE_NO": returned_reference,
        "REFERENCE_VERIFICATION": status,
        "REFERENCE_ERROR": reference_error,
    }


# ============================================================
# Website payable extraction
# ============================================================


def _find_website_payable_in_parsed_data(
    parsed_data: dict[str, Any],
) -> tuple[str, Any]:
    for candidate in WEBSITE_PAYABLE_KEY_CANDIDATES:
        if candidate in parsed_data:
            return candidate, parsed_data[candidate]

    for key, value in parsed_data.items():
        normalized_key = normalize_key(key)
        if (
            "DUE_DATE" in normalized_key
            and ("PAYABLE" in normalized_key or "AMOUNT" in normalized_key)
            and "AFTER" not in normalized_key
        ):
            return key, value

    return "", None


def _extract_website_payable_from_html(soup: BeautifulSoup) -> tuple[str, Any]:
    amount_el = soup.select_one(".payable-card .payable-card-amount")
    if not isinstance(amount_el, Tag):
        amount_el = soup.select_one(".payable-card-amount")
    if not isinstance(amount_el, Tag):
        return "", None

    raw_value = amount_el.get_text(" ", strip=True)
    if not raw_value:
        return "", None

    return "HTML_PAYABLE_CARD", raw_value


def extract_website_payable(
    parsed_data: dict[str, Any], soup: BeautifulSoup
) -> dict[str, Any]:
    source_key, raw_value = _find_website_payable_in_parsed_data(parsed_data)
    if raw_value is None:
        source_key, raw_value = _extract_website_payable_from_html(soup)

    if raw_value is None:
        return {
            "WEBSITE_PAYABLE_WITHIN_DUE_DATE": pd.NA,
            "WEBSITE_PAYABLE_SOURCE": "",
        }

    return {
        "WEBSITE_PAYABLE_WITHIN_DUE_DATE": round(to_number(raw_value)),
        "WEBSITE_PAYABLE_SOURCE": source_key,
    }


# ============================================================
# Payable calculation and comparison
# ============================================================


def _calculate_payable_within_due_date(row: dict[str, Any]) -> int:
    columns = [
        "ARREARS_AMOUNT",
        "ENERGY_DETAILS_TOTAL",
        "FPA_DETAILS_TOTAL",
        "TAXES_TOTAL",
        "TAXES_ON_FPA_TOTAL",
    ]
    total = sum(to_number(row.get(col)) for col in columns)
    return round(total)


def _compare_payable_amounts(row: dict[str, Any]) -> None:
    calculated = to_number(row.get("CALCULATED_PAYABLE_WITHIN_DUE_DATE"))
    website_value = row.get("WEBSITE_PAYABLE_WITHIN_DUE_DATE")

    if website_value is None:
        row["PAYABLE_DIFFERENCE"] = pd.NA
        row["PAYABLE_COMPARISON"] = "WEBSITE_VALUE_NOT_FOUND"
        return

    try:
        if bool(pd.isna(website_value)):
            row["PAYABLE_DIFFERENCE"] = pd.NA
            row["PAYABLE_COMPARISON"] = "WEBSITE_VALUE_NOT_FOUND"
            return
    except (TypeError, ValueError):
        pass

    website = to_number(website_value)
    difference = round(calculated - website)
    row["PAYABLE_DIFFERENCE"] = difference
    row["PAYABLE_COMPARISON"] = "MATCHED" if difference == 0 else "DIFFERENCE"


# ============================================================
# Surcharge and payable after due date
# ============================================================


def extract_surcharge(soup: BeautifulSoup) -> dict[str, Any]:
    """Extract surcharge amount and payable after due date from the HTML."""
    result = {
        "SURCHARGE_AMOUNT": 0,
        "PAYABLE_AFTER_DUE_DATE": 0,
    }

    try:
        # Find surcharge card
        surcharge_card = soup.select_one(".lp-surcharge-card")
        if not surcharge_card:
            return result

        # Extract top values (surcharge amount, and the after-due payable)
        top_vals = surcharge_card.select(".lp-surcharge-top-val")
        if len(top_vals) >= 1:
            result["SURCHARGE_AMOUNT"] = round(to_number(top_vals[0].get_text(strip=True)))

        # Extract bottom values - look for "After" period row
        bottom_vals = surcharge_card.select(".lp-surcharge-bottom-val")
        for val in bottom_vals:
            text = val.get_text(strip=True)
            if to_number(text) > 0:
                result["PAYABLE_AFTER_DUE_DATE"] = round(to_number(text))

        # Fallback: look in slip matrix for "PAYABLE AFTER DUE DATE"
        if result["PAYABLE_AFTER_DUE_DATE"] == 0:
            for cell in soup.select(".slip-matrix-cell"):
                cell_text = cell.get_text(strip=True)
                if "PAYABLE AFTER DUE DATE" in cell_text.upper():
                    # The amount is usually in the next sibling or parent
                    parent = cell.parent
                    if parent:
                        val_cell = parent.select_one(".slip-matrix-val")
                        if val_cell:
                            result["PAYABLE_AFTER_DUE_DATE"] = round(
                                to_number(val_cell.get_text(strip=True))
                            )
                    break

    except Exception:
        pass

    return result


# ============================================================
# Process one bill
# ============================================================


def process_reference(reference_no: str) -> dict[str, Any]:
    row: dict[str, Any] = {
        "INPUT_REFERENCE_NO": reference_no,
        "FETCHED_AT": datetime.now().astimezone().isoformat(timespec="seconds"),
    }

    try:
        client = get_client()
        qr_text, soup = fetch_bill(reference_no, client)
        parsed_bill = parse_bill(qr_text)

        row.update(parsed_bill)
        row.update(verify_returned_reference(reference_no, parsed_bill, soup))

        if row.get("REFERENCE_VERIFICATION") == "MISMATCH":
            raise RuntimeError(str(row.get("REFERENCE_ERROR", "")))

        row.update(extract_bill_dates(soup))
        row.update(extract_arrears(soup))
        row.update(extract_bill_history_summary(soup))
        row.update(extract_website_payable(parsed_data=parsed_bill, soup=soup))

        row["CALCULATED_PAYABLE_WITHIN_DUE_DATE"] = _calculate_payable_within_due_date(
            row
        )
        _compare_payable_amounts(row)
        row.update(extract_surcharge(soup))

        row["FETCH_STATUS"] = "SUCCESS"
        row["ERROR_TYPE"] = ""
        row["ERROR"] = ""
        row["_RAW_HTML"] = str(soup)

    except Exception as error:
        logger.exception("Failed to fetch bill %s", reference_no)
        row["FETCH_STATUS"] = "FAILED"
        row["ERROR_TYPE"] = type(error).__name__
        row["ERROR"] = str(error)

    if REQUEST_DELAY > 0:
        time.sleep(REQUEST_DELAY)

    return row


# ============================================================
# Concurrent fetching
# ============================================================


def fetch_unique_references(
    references: list[str],
    on_progress: Any = None,
) -> dict[str, dict[str, Any]]:
    unique_refs = list(dict.fromkeys(r for r in references if r))
    total = len(unique_refs)
    results: dict[str, dict[str, Any]] = {}

    if not unique_refs:
        return results

    logger.info("Fetching %d unique bills with %d workers...", total, MAX_WORKERS)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_map: dict[Future[dict[str, Any]], str] = {}

        for ref in unique_refs:
            future = executor.submit(process_reference, ref)
            future_map[future] = ref

        for completed, future in enumerate(as_completed(future_map), start=1):
            ref = future_map[future]
            try:
                result = future.result()
            except Exception as error:  # noqa: BLE001
                result = {
                    "INPUT_REFERENCE_NO": ref,
                    "FETCH_STATUS": "FAILED",
                    "ERROR_TYPE": type(error).__name__,
                    "ERROR": str(error),
                }

            results[ref] = result
            status = result.get("FETCH_STATUS", "FAILED")
            logger.info("[%d/%d] %s: %s", completed, total, ref, status)

            if status == "FAILED":
                logger.error("    Error: %s", result.get("ERROR", ""))

            if on_progress:
                on_progress(completed, total, ref, status)

    return results
