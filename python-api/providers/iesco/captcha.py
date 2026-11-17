"""Human-in-the-loop CAPTCHA flow for IESCO bill lookups.

IESCO's bill search requires a CAPTCHA. The CAPTCHA image is bound to the
ASP.NET session cookie, so each challenge keeps its own HTTP client alive
between showing the image to a person and submitting their answer.

Nothing here solves CAPTCHAs: a person reads the image and types the code.
"""

import base64
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup, Tag

from .config import BASE_URL, HEADERS, PROXY_URL, SEARCH_URL
from .fetcher import (
    _TIMEOUT,
    CaptchaInvalidError,
    _get_hidden_fields,
    attribute_to_string,
    build_search_payload,
    extract_bill_row,
    normalize_reference,
    submit_search,
)

logger = logging.getLogger(__name__)

CHALLENGE_TTL_SECONDS = 5 * 60
MAX_OPEN_CHALLENGES = 50


class ChallengeNotFoundError(LookupError):
    """The challenge id is unknown, already used, or expired."""


@dataclass
class Challenge:
    reference_no: str
    client: httpx.Client
    hidden_fields: dict[str, str]
    created_at: float = field(default_factory=time.monotonic)

    def expired(self) -> bool:
        return time.monotonic() - self.created_at > CHALLENGE_TTL_SECONDS


_challenges: dict[str, Challenge] = {}
_lock = threading.Lock()


def _new_client() -> httpx.Client:
    return httpx.Client(
        headers=HEADERS,
        timeout=_TIMEOUT,
        follow_redirects=True,
        proxy=PROXY_URL,
    )


def _evict_expired() -> None:
    with _lock:
        expired = [cid for cid, c in _challenges.items() if c.expired()]
        stale = [_challenges.pop(cid) for cid in expired]
        # Bound memory if challenges are started but never answered.
        while len(_challenges) >= MAX_OPEN_CHALLENGES:
            oldest = min(_challenges, key=lambda cid: _challenges[cid].created_at)
            stale.append(_challenges.pop(oldest))
    for challenge in stale:
        challenge.client.close()


def _captcha_image_url(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    img = soup.select_one("#captchaImage")
    if not isinstance(img, Tag):
        raise RuntimeError("IESCO did not return a CAPTCHA image. The site may have changed.")
    return urljoin(BASE_URL + "/", attribute_to_string(img.get("src")))


def start_challenge(reference_no: str) -> dict[str, str]:
    """Open an IESCO session and return the CAPTCHA image for a person to read."""
    reference_no = normalize_reference(reference_no)
    _evict_expired()

    client = _new_client()
    try:
        form = client.get(SEARCH_URL)
        form.raise_for_status()
        image = client.get(_captcha_image_url(form.text))
        image.raise_for_status()
    except Exception:
        client.close()
        raise

    challenge_id = uuid.uuid4().hex
    with _lock:
        _challenges[challenge_id] = Challenge(
            reference_no=reference_no,
            client=client,
            hidden_fields=_get_hidden_fields(form.text),
        )

    content_type = image.headers.get("content-type", "image/png").split(";")[0]
    encoded = base64.b64encode(image.content).decode("ascii")
    return {
        "challenge_id": challenge_id,
        "reference_no": reference_no,
        "image": f"data:{content_type};base64,{encoded}",
    }


def submit_challenge(challenge_id: str, answer: str) -> dict[str, Any]:
    """Submit a person's CAPTCHA answer and fetch the bill.

    Each challenge is single-use: IESCO issues a new CAPTCHA per form load.
    Returns {"status": "success", "bill": row}, {"status": "captcha_invalid"}
    or {"status": "failed", "error": ...}.
    """
    with _lock:
        challenge = _challenges.pop(challenge_id, None)
    if challenge is None or challenge.expired():
        if challenge is not None:
            challenge.client.close()
        raise ChallengeNotFoundError("This CAPTCHA has expired. Load a new one.")

    reference_no = challenge.reference_no
    try:
        payload = build_search_payload(challenge.hidden_fields, reference_no, answer.strip())
        qr_text, soup = submit_search(challenge.client, payload, captcha_submitted=True)
        row: dict[str, Any] = {
            "INPUT_REFERENCE_NO": reference_no,
            "FETCHED_AT": datetime.now().astimezone().isoformat(timespec="seconds"),
        }
        row.update(extract_bill_row(reference_no, qr_text, soup))
        return {"status": "success", "reference_no": reference_no, "bill": row}
    except CaptchaInvalidError:
        return {"status": "captcha_invalid", "reference_no": reference_no}
    except Exception as error:
        logger.exception("CAPTCHA fetch failed for %s", reference_no)
        return {"status": "failed", "reference_no": reference_no, "error": str(error)}
    finally:
        challenge.client.close()
