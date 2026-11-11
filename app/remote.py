"""Chuyển việc chạy code sang một "runner" Docker đặt ở nơi khác (ví dụ máy cá nhân qua ngrok).

Dùng cho web công khai (Render): nếu runner đang bật thì chạy code bằng Docker trên máy đó,
nếu runner tắt hoặc không trả lời thì web tự chạy trực tiếp như bình thường.

Cấu hình trên web công khai (biến môi trường):
  CPPFLOW_REMOTE_RUNNER_URL    địa chỉ https của runner, ví dụ https://ten-ban.ngrok-free.app
  CPPFLOW_REMOTE_RUNNER_TOKEN  mật khẩu dùng chung với runner (đặt giá trị dài, ngẫu nhiên)
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any

URL = os.environ.get("CPPFLOW_REMOTE_RUNNER_URL", "").strip().rstrip("/")
TOKEN = os.environ.get("CPPFLOW_REMOTE_RUNNER_TOKEN", "").strip()

# Đặt CPPFLOW_REMOTE_DEBUG=0 để chỉ chuyển nút "Chạy C++" sang runner, còn debug vẫn chạy trên web công khai.
# (Container debug trên runner dùng quyền ptrace và seccomp lỏng hơn container chạy thường.)
DEBUG_ENABLED = os.environ.get("CPPFLOW_REMOTE_DEBUG", "1").strip() != "0"

SESSION_PREFIX = "r_"  # Gắn vào sessionId của phiên debug chạy trên runner từ xa.
HEALTH_TIMEOUT = 3
RUN_TIMEOUT = 75
START_TIMEOUT = 75
STEP_TIMEOUT = 45
HEALTH_CACHE_SECONDS = 8
MAX_RESPONSE_BYTES = 2_000_000

_UUID = re.compile(r"^[0-9a-fA-F-]{36}$")
_CACHE: tuple[float, bool] = (0.0, False)
_LOCK = threading.Lock()


class RemoteUnavailable(RuntimeError):
    """Runner từ xa không dùng được (tắt, sai mật khẩu, lỗi mạng...)."""


def enabled() -> bool:
    return bool(URL and TOKEN)


def _log(message: str) -> None:
    # Không bao giờ ghi mật khẩu ra log.
    print(f"[remote-runner] {message}", file=sys.stderr, flush=True)


def _request(method: str, path: str, payload: Any, timeout: float) -> tuple[int, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        URL + path,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-Runner-Token": TOKEN,
            # Bỏ qua trang cảnh báo của ngrok (gói miễn phí) cho các lời gọi API.
            "ngrok-skip-browser-warning": "1",
            "User-Agent": "cpp-flow-proxy/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status, raw = response.status, response.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read(MAX_RESPONSE_BYTES)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RemoteUnavailable(f"không kết nối được runner: {exc}") from exc
    try:
        return status, json.loads(raw)
    except ValueError as exc:
        # Ví dụ trang HTML "tunnel offline" của ngrok.
        raise RemoteUnavailable(f"runner trả về dữ liệu không phải JSON (HTTP {status})") from exc


def _set_available(value: bool) -> None:
    global _CACHE
    with _LOCK:
        _CACHE = (time.monotonic(), value)


def available() -> bool:
    """Runner có đang bật, nhận đúng mật khẩu và dùng được Docker không (cache vài giây)."""
    if not enabled():
        return False
    with _LOCK:
        checked_at, value = _CACHE
    if time.monotonic() - checked_at < HEALTH_CACHE_SECONDS:
        return value
    try:
        status, data = _request("GET", "/api/health", None, HEALTH_TIMEOUT)
        ok = (
            status == 200
            and isinstance(data, dict)
            and bool(data.get("ok"))
            and bool(data.get("ready"))
            and data.get("runner") == "docker"
        )
    except RemoteUnavailable:
        ok = False
    _set_available(ok)
    return ok


def post(path: str, payload: Any, timeout: float) -> tuple[int, Any]:
    """POST tới runner. Ném RemoteUnavailable nếu runner không dùng được."""
    try:
        status, data = _request("POST", path, payload, timeout)
    except RemoteUnavailable:
        _set_available(False)
        raise
    if status in (401, 403, 502, 503, 504):
        if status in (401, 403):
            _log("runner từ chối mật khẩu (HTTP %d): kiểm tra CPPFLOW_REMOTE_RUNNER_TOKEN" % status)
        _set_available(False)
        raise RemoteUnavailable(f"runner không sẵn sàng (HTTP {status})")
    return status, data


def tag_session(data: Any) -> Any:
    """Gắn tiền tố vào sessionId để lần sau biết phiên debug này nằm trên runner từ xa."""
    if isinstance(data, dict) and isinstance(data.get("sessionId"), str):
        data["sessionId"] = SESSION_PREFIX + data["sessionId"]
    return data


def is_remote_session(session_id: str) -> bool:
    return session_id.startswith(SESSION_PREFIX)


def real_session_id(session_id: str) -> str | None:
    """sessionId thật trên runner; None nếu sai định dạng (chặn ký tự lạ đưa vào đường dẫn URL)."""
    real = session_id[len(SESSION_PREFIX):]
    return real if _UUID.match(real) else None
