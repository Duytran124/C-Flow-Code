import os
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import sandbox
from app.runner import run_cpp, DockerUnavailable, RunnerError
from app.debugger import (
    DebuggerError,
    DockerUnavailable as DebugDockerUnavailable,
    start_debug,
    step_debug,
    stop_debug,
)

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"

app = FastAPI(title="C++ Flow", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


# Giới hạn số lần Chạy / Bắt đầu debug mỗi phút cho mỗi địa chỉ IP (0 = tắt).
RATE_LIMIT_PER_MINUTE = int(os.environ.get("CPPFLOW_RATE_LIMIT_PER_MIN", "30"))
_RATE_HITS: dict[str, deque[float]] = defaultdict(deque)
_RATE_LOCK = threading.Lock()


def _client_key(request: Request) -> str:
    # Sau proxy của nền tảng hosting, mục CUỐI của X-Forwarded-For là địa chỉ do proxy tin cậy
    # ghi lại (mục đầu có thể bị người dùng tự đặt giả).
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(request: Request) -> bool:
    if RATE_LIMIT_PER_MINUTE <= 0:
        return False
    now = time.monotonic()
    key = _client_key(request)
    with _RATE_LOCK:
        hits = _RATE_HITS[key]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= RATE_LIMIT_PER_MINUTE:
            return True
        hits.append(now)
        if len(_RATE_HITS) > 5000:  # tránh phình bộ nhớ: bỏ các IP đã im lặng
            for stale in [k for k, v in _RATE_HITS.items() if not v or now - v[-1] > 60]:
                _RATE_HITS.pop(stale, None)
        return False


RATE_LIMIT_MESSAGE = "Bạn thao tác quá nhanh. Hãy đợi một chút rồi thử lại."


class RunRequest(BaseModel):
    code: str = Field(min_length=1, max_length=100_000)
    input: str = Field(default="", max_length=20_000)
    mode: str = Field(default="normal", pattern="^(normal|graph|tree)$")


class DebugRequest(BaseModel):
    code: str = Field(min_length=1, max_length=100_000)
    input: str = Field(default="", max_length=20_000)


class StepRequest(BaseModel):
    into: bool = False


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/health")
def health():
    mode = sandbox.current_mode_label()
    return {"ok": True, "service": "cpp-flow", "runner": mode, "debugger": f"gdb-{mode}"}


@app.post("/api/run")
def run(request: RunRequest, http_request: Request):
    if _rate_limited(http_request):
        return {
            "status": "error", "kind": "rate_limit", "stdout": "",
            "stderr": RATE_LIMIT_MESSAGE, "exitCode": None, "durationMs": 0,
        }
    try:
        return run_cpp(request.code, request.input)
    except DockerUnavailable as exc:
        return {
            "status": "error", "kind": "environment", "stdout": "",
            "stderr": str(exc), "exitCode": None, "durationMs": 0,
        }
    except RunnerError as exc:
        return {
            "status": "error", "kind": "runner", "stdout": "",
            "stderr": str(exc), "exitCode": None, "durationMs": 0,
        }


@app.post("/api/debug/start")
def debug_start(request: DebugRequest, http_request: Request):
    if _rate_limited(http_request):
        raise HTTPException(status_code=429, detail=RATE_LIMIT_MESSAGE)
    try:
        return start_debug(request.code, request.input)
    except DebugDockerUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DebuggerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/debug/{session_id}/step")
def debug_step(session_id: str, request: StepRequest = StepRequest()):
    try:
        return step_debug(session_id, into=request.into)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DebuggerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/debug/{session_id}/stop")
def debug_stop(session_id: str):
    return stop_debug(session_id)
