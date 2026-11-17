from pydantic import BaseModel


class FetchRequest(BaseModel):
    reference_numbers: list[str]


class FetchResponse(BaseModel):
    task_id: str
    total: int


class LogEntry(BaseModel):
    n: int
    total: int
    ref: str
    status: str


class TaskStatus(BaseModel):
    task_id: str
    status: str
    completed: int
    total: int
    success_count: int = 0
    fail_count: int = 0
    has_results: bool = False
    log: list[LogEntry] | None = None


class TaskResult(BaseModel):
    error: str
    status: str | None = None


class CaptchaStartRequest(BaseModel):
    reference_no: str


class CaptchaChallenge(BaseModel):
    challenge_id: str
    reference_no: str
    image: str  # data: URL of the CAPTCHA image


class CaptchaSubmitRequest(BaseModel):
    challenge_id: str
    answer: str
