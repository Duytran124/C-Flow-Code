import hmac
import os
import re
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import remote, sandbox
from app.runner import run_cpp, DockerUnavailable, RunnerError
from app.stress import run_stress
from app.diverge import run_diverge
from app.crash import run_crash
from app import forum
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

# Vai trò "runner": nếu đặt CPPFLOW_RUNNER_TOKEN thì mọi lời gọi /api/* (trừ /api/health)
# phải kèm header X-Runner-Token đúng. Dùng cho máy chạy Docker mà web công khai gọi tới.
RUNNER_TOKEN = os.environ.get("CPPFLOW_RUNNER_TOKEN", "").strip()

# Vai trò "web công khai": nếu có mật khẩu runner trong biến môi trường, không cho code người dùng
# (cùng user, chế độ trực tiếp) đọc được nó qua /proc.
if remote.TOKEN:
    sandbox.protect_process()


@app.middleware("http")
async def require_runner_token(request: Request, call_next):
    path = request.url.path
    if RUNNER_TOKEN and path.startswith("/api/") and path != "/api/health":
        supplied = request.headers.get("x-runner-token", "")
        if not hmac.compare_digest(supplied.encode("utf-8"), RUNNER_TOKEN.encode("utf-8")):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        request.state.trusted = True  # đã xác thực: là web công khai của chính bạn
    return await call_next(request)


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
    # Lời gọi đã xác thực từ web công khai: web đó đã tự giới hạn theo từng người dùng.
    if getattr(request.state, "trusted", False):
        return False
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


class StressRequest(BaseModel):
    mine: str = Field(max_length=100_000)
    brute: str = Field(max_length=100_000)
    gen: str = Field(max_length=100_000)
    tests: int = Field(default=200, ge=1, le=1000)
    start: int = Field(default=1, ge=1, le=1_000_000)


class DivergeRequest(BaseModel):
    mine: str = Field(max_length=100_000)
    brute: str = Field(max_length=100_000)
    input: str = Field(default="", max_length=20_000)


class ForumPostRequest(BaseModel):
    title: str = Field(max_length=500)
    description: str = Field(default="", max_length=5000)
    code: str = Field(max_length=60_000)
    input: str = Field(default="", max_length=20_000)
    author: str = Field(default="", max_length=200)


class ForumReportRequest(BaseModel):
    reason: str = Field(default="other", max_length=30)


class ForumResolveRequest(BaseModel):
    action: str = Field(max_length=20)


class ForumVoteRequest(BaseModel):
    value: int


class ForumCommentRequest(BaseModel):
    body: str = Field(max_length=5000)
    line: int | None = None
    author: str = Field(default="", max_length=200)


class CrashRequest(BaseModel):
    code: str = Field(max_length=100_000)
    input: str = Field(default="", max_length=20_000)


class StepRequest(BaseModel):
    into: bool = False


def _remote_session_call(session_id: str, action: str, payload: dict):
    """Chuyển bước debug / dừng debug tới runner nơi phiên này đang chạy."""
    real_id = remote.real_session_id(session_id)
    if real_id is None:
        raise HTTPException(status_code=404, detail="Phiên debug không tồn tại.")
    try:
        status, data = remote.post(
            f"/api/debug/{real_id}/{action}", payload, remote.STEP_TIMEOUT
        )
    except remote.RemoteUnavailable as exc:
        raise HTTPException(
            status_code=502,
            detail="Máy chạy Docker đã ngắt kết nối. Hãy bấm Bắt đầu debug để chạy lại.",
        ) from exc
    if status == 200:
        return remote.tag_session(data)
    detail = data.get("detail") if isinstance(data, dict) else None
    raise HTTPException(status_code=status, detail=str(detail or "Lỗi từ máy chạy Docker."))


def _public_base(request: Request) -> str:
    configured = os.environ.get("CPPFLOW_PUBLIC_URL", "").strip().rstrip("/")
    if configured:
        return configured
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", request.url.netloc))
    base = f"{proto}://{host}"
    return base if re.fullmatch(r"https?://[A-Za-z0-9.\-:]+", base) else ""


@app.get("/robots.txt", include_in_schema=False)
def robots(request: Request):
    body = f"User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: {_public_base(request)}/sitemap.xml\n"
    return Response(body, media_type="text/plain")


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap(request: Request):
    body = ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f'  <url><loc>{_public_base(request)}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n')
    return Response(body, media_type="application/xml")


@app.get("/")
def index(request: Request):
    html = (STATIC / "index.html").read_text(encoding="utf-8").replace("__BASE_URL__", _public_base(request))
    token = os.environ.get("GOOGLE_SITE_VERIFICATION", "").strip()
    meta = f'<meta name="google-site-verification" content="{token}" />' if re.fullmatch(r"[\w-]{10,100}", token) else ""
    return HTMLResponse(html.replace("__VERIFICATION__", meta))


@app.get("/api/health")
def health():
    if remote.enabled() and remote.available():
        return {
            "ok": True, "service": "cpp-flow", "runner": "docker", "remote": True,
            "ready": True, "debugger": "gdb-docker",
        }
    info = sandbox.describe()
    return {
        "ok": True,
        "service": "cpp-flow",
        "runner": info["mode"],
        "remote": False,
        "remoteConfigured": remote.enabled(),
        "ready": info["ready"],
        "debugger": f"gdb-{info['mode']}",
    }


@app.post("/api/run")
def run(request: RunRequest, http_request: Request):
    if _rate_limited(http_request):
        return {
            "status": "error", "kind": "rate_limit", "stdout": "",
            "stderr": RATE_LIMIT_MESSAGE, "exitCode": None, "durationMs": 0,
        }
    if remote.enabled() and remote.available():
        try:
            status, data = remote.post("/api/run", request.model_dump(), remote.RUN_TIMEOUT)
            # kind "environment" = Docker trên runner đang tắt: chuyển sang chạy trực tiếp.
            if status == 200 and isinstance(data, dict) and data.get("kind") != "environment":
                data["via"] = "remote"
                return data
        except remote.RemoteUnavailable:
            pass  # runner tắt hoặc lỗi: dự phòng bằng chạy trực tiếp ngay trên máy chủ này
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


@app.post("/api/stress")
def stress(request: StressRequest, http_request: Request):
    if _rate_limited(http_request):
        return {"status": "error", "kind": "rate_limit", "message": RATE_LIMIT_MESSAGE}
    if remote.enabled() and remote.available():
        try:
            status, data = remote.post("/api/stress", request.model_dump(), remote.RUN_TIMEOUT)
            if status == 200 and isinstance(data, dict) and data.get("kind") != "environment":
                data["via"] = "remote"
                return data
        except remote.RemoteUnavailable:
            pass  # runner tắt: dự phòng chạy trực tiếp trên máy chủ này
    try:
        return run_stress(request.mine, request.brute, request.gen, request.tests, request.start)
    except DockerUnavailable as exc:
        return {"status": "error", "kind": "environment", "message": str(exc)}
    except RunnerError as exc:
        return {"status": "error", "kind": "runner", "message": str(exc)}


@app.post("/api/diverge")
def diverge(request: DivergeRequest, http_request: Request):
    if _rate_limited(http_request):
        return {"status": "error", "kind": "rate_limit", "message": RATE_LIMIT_MESSAGE}
    if remote.enabled() and remote.available():
        try:
            status, data = remote.post("/api/diverge", request.model_dump(), remote.RUN_TIMEOUT)
            if status == 200 and isinstance(data, dict) and data.get("kind") != "environment":
                data["via"] = "remote"
                return data
        except remote.RemoteUnavailable:
            pass
    try:
        return run_diverge(request.mine, request.brute, request.input)
    except DockerUnavailable as exc:
        return {"status": "error", "kind": "environment", "message": str(exc)}
    except RunnerError as exc:
        return {"status": "error", "kind": "runner", "message": str(exc)}


def _forum_call(request: Request, fn):
    """Gọi một hàm diễn đàn, đổi lỗi thành JSON dễ hiểu."""
    try:
        owner = forum.owner_hash(request.headers.get("x-forum-key", ""))
        admin = forum.is_admin(request.headers.get("x-admin-token", ""))
        return fn(owner, admin, _client_key(request))
    except forum.ForumError as exc:
        return JSONResponse({"status": "error", "message": exc.message}, status_code=exc.status)
    except ImportError:
        return JSONResponse({"status": "error", "message": "Máy chủ thiếu thư viện psycopg. Hãy thêm vào requirements.txt."}, status_code=503)
    except Exception as exc:  # lỗi database / mạng tới database
        print(f"[forum] lỗi: {type(exc).__name__}: {exc}", flush=True)
        return JSONResponse({"status": "error", "message": "Không kết nối được cơ sở dữ liệu diễn đàn. Hãy thử lại sau ít giây."}, status_code=503)


@app.get("/api/forum/status")
def forum_status():
    return {"enabled": True, "storage": forum.storage_kind(), "adminEnabled": bool(forum.ADMIN_TOKEN)}


@app.get("/api/forum/posts")
def forum_posts(request: Request, sort: str = "new", q: str = "", page: int = 1):
    return _forum_call(request, lambda owner, admin, who: forum.list_posts(owner, admin, sort, q, page))


@app.get("/api/forum/posts/{post_id}")
def forum_post(post_id: int, request: Request):
    return _forum_call(request, lambda owner, admin, who: forum.get_post(post_id, owner, admin))


@app.post("/api/forum/posts")
def forum_create(body: ForumPostRequest, request: Request):
    def work(owner, admin, who):
        post_id = forum.create_post(owner, who, body.title, body.description, body.code, body.input, body.author)
        return {"status": "ok", "id": post_id}
    return _forum_call(request, work)


@app.post("/api/forum/posts/{post_id}/vote")
def forum_vote(post_id: int, body: ForumVoteRequest, request: Request):
    return _forum_call(request, lambda owner, admin, who: forum.vote(owner, who, post_id, body.value))


@app.post("/api/forum/posts/{post_id}/comments")
def forum_comment(post_id: int, body: ForumCommentRequest, request: Request):
    return _forum_call(request, lambda owner, admin, who: forum.add_comment(owner, who, post_id, body.body, body.line, body.author))


@app.post("/api/forum/{kind}/{item_id}/report")
def forum_report(kind: str, item_id: int, request: Request, body: ForumReportRequest | None = None):
    if kind not in ("post", "comment"):
        raise HTTPException(status_code=404)
    reason = body.reason if body else "other"
    return _forum_call(request, lambda owner, admin, who: forum.report(kind, item_id, owner, who, reason))


def _forum_admin_only(request: Request, fn):
    def work(owner, admin, who):
        forum.admin_rate(who)
        if not admin:
            raise forum.ForumError("Mã quản trị không đúng hoặc chưa được cấu hình.", 403)
        return fn()
    return _forum_call(request, work)


@app.get("/api/forum/admin/check")
def forum_admin_check(request: Request):
    return _forum_admin_only(request, lambda: {"status": "ok"})


@app.get("/api/forum/admin/queue")
def forum_admin_queue(request: Request):
    return _forum_admin_only(request, forum.admin_queue)


@app.post("/api/forum/admin/{kind}/{item_id}/resolve")
def forum_admin_resolve(kind: str, item_id: int, body: ForumResolveRequest, request: Request):
    if kind not in ("post", "comment"):
        raise HTTPException(status_code=404)
    def run():
        forum.admin_resolve(kind, item_id, body.action)
        return {"status": "ok"}
    return _forum_admin_only(request, run)


@app.delete("/api/forum/{kind}/{item_id}")
def forum_delete(kind: str, item_id: int, request: Request):
    if kind not in ("post", "comment"):
        raise HTTPException(status_code=404)
    def work(owner, admin, who):
        forum.delete_item(kind, item_id, owner, admin)
        return {"status": "ok"}
    return _forum_call(request, work)


@app.post("/api/crash")
def crash(request: CrashRequest, http_request: Request):
    if _rate_limited(http_request):
        return {"status": "error", "kind": "rate_limit", "message": RATE_LIMIT_MESSAGE}
    if remote.enabled() and remote.available():
        try:
            status, data = remote.post("/api/crash", request.model_dump(), remote.RUN_TIMEOUT)
            if status == 200 and isinstance(data, dict) and data.get("kind") != "environment":
                data["via"] = "remote"
                return data
        except remote.RemoteUnavailable:
            pass
    try:
        return run_crash(request.code, request.input)
    except DockerUnavailable as exc:
        return {"status": "error", "kind": "environment", "message": str(exc)}
    except RunnerError as exc:
        return {"status": "error", "kind": "runner", "message": str(exc)}


@app.post("/api/debug/start")
def debug_start(request: DebugRequest, http_request: Request):
    if _rate_limited(http_request):
        raise HTTPException(status_code=429, detail=RATE_LIMIT_MESSAGE)
    if remote.enabled() and remote.DEBUG_ENABLED and remote.available():
        try:
            status, data = remote.post(
                "/api/debug/start", {"code": request.code, "input": request.input},
                remote.START_TIMEOUT,
            )
            if status == 200 and isinstance(data, dict) and "sessionId" in data:
                return remote.tag_session(data)
            if status == 400 and isinstance(data, dict):  # ví dụ lỗi biên dịch: báo thẳng cho người dùng
                raise HTTPException(status_code=400, detail=str(data.get("detail", "Lỗi debug.")))
            # Các trường hợp khác (Docker tắt trên runner...): dự phòng chạy trực tiếp.
        except remote.RemoteUnavailable:
            pass
    try:
        return start_debug(request.code, request.input)
    except DebugDockerUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DebuggerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/debug/{session_id}/step")
def debug_step(session_id: str, request: StepRequest = StepRequest()):
    if remote.is_remote_session(session_id):
        return _remote_session_call(session_id, "step", {"into": request.into})
    try:
        return step_debug(session_id, into=request.into)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DebuggerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/debug/{session_id}/stop")
def debug_stop(session_id: str):
    if remote.is_remote_session(session_id):
        try:
            return _remote_session_call(session_id, "stop", {})
        except HTTPException:
            return {"ok": True, "stopped": False}  # runner đã tắt: phiên coi như đã đóng
    return stop_debug(session_id)
