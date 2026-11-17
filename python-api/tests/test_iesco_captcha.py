from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

import main
from providers.iesco import captcha, config, fetcher

FORM_HTML = (Path(__file__).parent / "fixtures" / "iesco_search_form.html").read_text()
INVALID_CAPTCHA_HTML = FORM_HTML.replace(
    "</form>", "<span>Invalid CAPTCHA code. Please try again.</span></form>", 1
)
PNG = b"\x89PNG\r\n\x1a\nfake"
REF = "31143174995808"


def mock_iesco(post_html: str, posted: list[dict[str, str]] | None = None) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/iescobill" and request.method == "GET":
            return httpx.Response(200, text=FORM_HTML, headers={"set-cookie": "ASP.NET_SessionId=abc"})
        if request.url.path == "/CaptchaImageHandler.ashx":
            return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
        if request.url.path == "/iescobill" and request.method == "POST":
            if posted is not None:
                posted.append(dict(httpx.QueryParams(request.content.decode())))
            return httpx.Response(200, text=post_html)
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler), base_url=config.BASE_URL)


@pytest.fixture(autouse=True)
def clear_challenges():
    captcha._challenges.clear()
    yield
    captcha._challenges.clear()


def test_batch_fetch_reports_captcha_instead_of_missing_bill(monkeypatch):
    monkeypatch.setattr(fetcher, "get_client", lambda: mock_iesco(FORM_HTML))
    monkeypatch.setattr(fetcher, "REQUEST_DELAY", 0)

    row = fetcher.process_reference(REF)

    assert row["FETCH_STATUS"] == "FAILED"
    assert row["ERROR_TYPE"] == "CaptchaRequiredError"
    assert "CAPTCHA" in row["ERROR"]


def test_start_returns_captcha_image_and_keeps_session(monkeypatch):
    monkeypatch.setattr(captcha, "_new_client", lambda: mock_iesco(FORM_HTML))

    challenge = captcha.start_challenge(REF)

    assert challenge["reference_no"] == REF
    assert challenge["image"].startswith("data:image/png;base64,")
    assert challenge["challenge_id"] in captcha._challenges


def test_submit_sends_answer_with_session_form_fields(monkeypatch):
    posted: list[dict[str, str]] = []
    monkeypatch.setattr(captcha, "_new_client", lambda: mock_iesco(INVALID_CAPTCHA_HTML, posted))
    challenge = captcha.start_challenge(REF)

    captcha.submit_challenge(challenge["challenge_id"], "  ab12  ")

    assert posted[0]["captchaInput"] == "ab12"
    assert posted[0]["searchTextBox"] == REF
    assert "__VIEWSTATE" in posted[0]


def test_submit_reports_rejected_captcha(monkeypatch):
    monkeypatch.setattr(captcha, "_new_client", lambda: mock_iesco(INVALID_CAPTCHA_HTML))
    challenge = captcha.start_challenge(REF)

    result = captcha.submit_challenge(challenge["challenge_id"], "wrong")

    assert result == {"status": "captcha_invalid", "reference_no": REF}


def test_challenge_cannot_be_submitted_twice(monkeypatch):
    monkeypatch.setattr(captcha, "_new_client", lambda: mock_iesco(INVALID_CAPTCHA_HTML))
    challenge = captcha.start_challenge(REF)
    captcha.submit_challenge(challenge["challenge_id"], "wrong")

    with pytest.raises(captcha.ChallengeNotFoundError):
        captcha.submit_challenge(challenge["challenge_id"], "wrong")


def test_expired_challenge_is_rejected(monkeypatch):
    monkeypatch.setattr(captcha, "_new_client", lambda: mock_iesco(FORM_HTML))
    challenge = captcha.start_challenge(REF)
    captcha._challenges[challenge["challenge_id"]].created_at -= captcha.CHALLENGE_TTL_SECONDS + 1

    with pytest.raises(captcha.ChallengeNotFoundError):
        captcha.submit_challenge(challenge["challenge_id"], "ab12")


def test_start_endpoint_rejects_malformed_reference():
    response = TestClient(main.app).post("/iesco/captcha/start", json={"reference_no": "123"})

    assert response.status_code == 422


def test_submit_endpoint_returns_410_for_unknown_challenge():
    response = TestClient(main.app).post(
        "/iesco/captcha/submit", json={"challenge_id": "missing", "answer": "ab12"}
    )

    assert response.status_code == 410
