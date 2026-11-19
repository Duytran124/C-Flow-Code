"""Diễn đàn: đăng code, like/unlike, bình luận và ghi chú theo dòng.

Lưu trữ:
  - Có biến môi trường DATABASE_URL (Postgres, ví dụ Neon): dùng Postgres, dữ liệu lưu lâu dài.
  - Không có: dùng SQLite trong file (chỉ để thử, mất dữ liệu khi Render deploy lại).

Không cần đăng nhập: trình duyệt tự tạo một mã ngẫu nhiên (header X-Forum-Key). Máy chủ chỉ lưu bản băm của mã
đó, dùng để chống like nhiều lần và cho phép chủ bài tự xóa bài/bình luận của mình.

An toàn: mọi nội dung được hiển thị dưới dạng văn bản thuần; tiêu đề, mô tả, bình luận và tên KHÔNG được chứa link
(để không bị dùng đăng web lừa đảo); có giới hạn tốc độ; bài bị >= 3 người báo cáo tự ẩn.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import contextmanager
from pathlib import Path

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
SQLITE_PATH = os.environ.get("CPPFLOW_FORUM_SQLITE", str(Path(__file__).resolve().parent.parent / "forum-dev.db"))
ADMIN_TOKEN = os.environ.get("FORUM_ADMIN_TOKEN", "").strip()

TITLE_MAX = 100
DESC_MAX = 2000
CODE_MAX = 30_000
INPUT_MAX = 5_000
COMMENT_MAX = 1000
NAME_MAX = 30
PAGE_SIZE = 15
REPORT_HIDE_AT = 3

_LOCK = threading.Lock()
_READY = False


class ForumError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# --------------------------------------------------------------------------------------
# Kết nối
# --------------------------------------------------------------------------------------
def storage_kind() -> str:
    return "postgres" if DATABASE_URL else "sqlite"


@contextmanager
def _db():
    """Trả về hàm run(sql, params) -> list[dict]. Câu lệnh dùng dấu ? cho tham số ở cả hai loại database."""
    if DATABASE_URL:
        import psycopg
        from psycopg.rows import dict_row

        conn = psycopg.connect(DATABASE_URL, connect_timeout=12, row_factory=dict_row)

        def run(sql: str, params: tuple = ()):
            with conn.cursor() as cur:
                cur.execute(sql.replace("?", "%s"), params)
                return list(cur.fetchall()) if cur.description else []
    else:
        conn = sqlite3.connect(SQLITE_PATH, timeout=10)
        conn.row_factory = sqlite3.Row

        def run(sql: str, params: tuple = ()):
            cur = conn.execute(sql, params)
            return [dict(r) for r in cur.fetchall()] if cur.description else []
    try:
        yield run
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _add_column(run, table: str, column: str, ddl: str) -> None:
    if DATABASE_URL:
        run(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl}")
    elif column not in [r["name"] for r in run(f"PRAGMA table_info({table})")]:
        run(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _ensure_schema() -> None:
    global _READY
    if _READY:
        return
    with _LOCK:
        if _READY:
            return
        pk = "BIGSERIAL PRIMARY KEY" if DATABASE_URL else "INTEGER PRIMARY KEY AUTOINCREMENT"
        with _db() as run:
            run(f"""CREATE TABLE IF NOT EXISTS posts (
                id {pk}, title TEXT NOT NULL, description TEXT NOT NULL, code TEXT NOT NULL,
                stdin TEXT NOT NULL, author TEXT NOT NULL, owner TEXT NOT NULL,
                created_at BIGINT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)""")
            run(f"""CREATE TABLE IF NOT EXISTS comments (
                id {pk}, post_id BIGINT NOT NULL, line INTEGER, body TEXT NOT NULL, author TEXT NOT NULL,
                owner TEXT NOT NULL, created_at BIGINT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)""")
            run("""CREATE TABLE IF NOT EXISTS votes (
                post_id BIGINT NOT NULL, voter TEXT NOT NULL, value INTEGER NOT NULL,
                PRIMARY KEY (post_id, voter))""")
            run("""CREATE TABLE IF NOT EXISTS reports (
                target TEXT NOT NULL, target_id BIGINT NOT NULL, reporter TEXT NOT NULL, created_at BIGINT NOT NULL,
                PRIMARY KEY (target, target_id, reporter))""")
            run("CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id)")
            # v21: trạng thái kiểm duyệt (0 = bình thường, 1 = chờ quản trị viên duyệt, 2 = đã giữ lại, 3 = quản trị viên đã xóa)
            _add_column(run, "posts", "review", "INTEGER NOT NULL DEFAULT 0")
            _add_column(run, "comments", "review", "INTEGER NOT NULL DEFAULT 0")
            _add_column(run, "reports", "reason", "TEXT NOT NULL DEFAULT ''")
        _READY = True


# --------------------------------------------------------------------------------------
# Kiểm tra dữ liệu và giới hạn tốc độ
# --------------------------------------------------------------------------------------
_URL_RE = re.compile(
    r"(https?:|ftp:|www\.|://|\b[\w-]+\.(?:com|net|org|vn|io|xyz|ru|cn|tk|top|info|link|click|site|online|ml|ga|cf)\b)",
    re.IGNORECASE,
)
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean(text, limit: int, label: str, *, required: bool = True, allow_links: bool = False, multiline: bool = False) -> str:
    text = "" if text is None else str(text)
    text = _CTRL_RE.sub("", text).replace("\r\n", "\n").replace("\r", "\n")
    text = text.strip() if not allow_links else text.rstrip()
    if not multiline:
        text = " ".join(text.split())
    if required and not text.strip():
        raise ForumError(f"Hãy nhập {label}.")
    if len(text) > limit:
        raise ForumError(f"{label.capitalize()} quá dài (tối đa {limit} ký tự).")
    if not allow_links and _URL_RE.search(text):
        raise ForumError(f"{label.capitalize()} không được chứa đường link hoặc tên miền (để tránh bị dùng đăng web lừa đảo).")
    return text


def owner_hash(key: str) -> str:
    key = (key or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,64}", key):
        raise ForumError("Thiếu mã trình duyệt. Hãy tải lại trang.", 400)
    return hashlib.sha256(("cppflow-forum:" + key).encode()).hexdigest()[:32]


def is_admin(token: str) -> bool:
    return bool(ADMIN_TOKEN) and bool(token) and hmac.compare_digest(token, ADMIN_TOKEN)


_RATE: dict[tuple[str, str], deque] = defaultdict(deque)
_RATE_LOCK = threading.Lock()
_LIMITS = {"post": (5, 3600), "comment": (20, 600), "vote": (60, 60), "report": (20, 600), "admin": (10, 600)}
REASONS = {"spam": "Spam", "scam": "Link/lừa đảo", "malware": "Code độc hại", "inappropriate": "Không phù hợp", "other": "Khác"}


def _rate_check(action: str, who: str) -> None:
    limit, window = _LIMITS[action]
    now = time.monotonic()
    with _RATE_LOCK:
        hits = _RATE[(action, who)]
        while hits and now - hits[0] > window:
            hits.popleft()
        if len(hits) >= limit:
            raise ForumError("Bạn thao tác quá nhanh, hãy thử lại sau ít phút.", 429)
        hits.append(now)
        if len(_RATE) > 20000:  # dọn bớt để không phình bộ nhớ
            for key in [k for k, v in _RATE.items() if not v][:5000]:
                _RATE.pop(key, None)


# --------------------------------------------------------------------------------------
# Truy vấn
# --------------------------------------------------------------------------------------
_COUNTS = """
  COALESCE((SELECT SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END) FROM votes v WHERE v.post_id = p.id), 0) AS likes,
  COALESCE((SELECT SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END) FROM votes v WHERE v.post_id = p.id), 0) AS dislikes,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.hidden = 0) AS comment_count,
  COALESCE((SELECT v.value FROM votes v WHERE v.post_id = p.id AND v.voter = ?), 0) AS my_vote
"""


def _post_row(row: dict, owner: str, admin: bool, with_code: bool) -> dict:
    out = {
        "id": int(row["id"]), "title": row["title"], "author": row["author"],
        "createdAt": int(row["created_at"]), "likes": int(row["likes"]), "dislikes": int(row["dislikes"]),
        "comments": int(row["comment_count"]), "myVote": int(row["my_vote"]),
        "mine": row["owner"] == owner, "lines": row["code"].count("\n") + 1,
    }
    if with_code:
        out.update(description=row["description"], code=row["code"], input=row["stdin"])
    else:
        out["preview"] = "\n".join(row["code"].split("\n")[:6])[:500]
        out["description"] = row["description"][:160]
    out["canDelete"] = out["mine"] or admin
    return out


def list_posts(owner: str, admin: bool, sort: str, query: str, page: int) -> dict:
    _ensure_schema()
    page = max(1, min(page, 500))
    where, params = "p.hidden = 0", []
    query = (query or "").strip().lower()[:60]
    if query:
        where += " AND (LOWER(p.title) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.author) LIKE ?)"
        like = "%" + query.replace("%", "").replace("_", "") + "%"
        params += [like, like, like]
    order = "t.likes - t.dislikes DESC, t.created_at DESC" if sort == "top" else "t.created_at DESC"
    sql = f"""SELECT * FROM (SELECT p.id, p.title, p.description, p.code, p.author, p.owner, p.created_at, {_COUNTS}
              FROM posts p WHERE {where}) t ORDER BY {order} LIMIT ? OFFSET ?"""
    with _db() as run:
        rows = run(sql, tuple([owner] + params + [PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]))
    return {"posts": [_post_row(r, owner, admin, False) for r in rows[:PAGE_SIZE]], "page": page, "hasMore": len(rows) > PAGE_SIZE}


def get_post(post_id: int, owner: str, admin: bool) -> dict:
    _ensure_schema()
    with _db() as run:
        rows = run(f"""SELECT p.id, p.title, p.description, p.code, p.stdin, p.author, p.owner, p.created_at, {_COUNTS}
                       FROM posts p WHERE p.id = ? AND p.hidden = 0""", (owner, post_id))
        if not rows:
            raise ForumError("Không tìm thấy bài viết (có thể đã bị xóa).", 404)
        comments = run("SELECT id, line, body, author, owner, created_at FROM comments WHERE post_id = ? AND hidden = 0 "
                       "ORDER BY created_at ASC, id ASC LIMIT 500", (post_id,))
    post = _post_row(rows[0], owner, admin, True)
    post["commentList"] = [{
        "id": int(c["id"]), "line": c["line"], "body": c["body"], "author": c["author"],
        "createdAt": int(c["created_at"]), "canDelete": c["owner"] == owner or admin,
    } for c in comments]
    return post


def create_post(owner: str, who: str, title, description, code, stdin, author) -> int:
    _rate_check("post", who)
    title = _clean(title, TITLE_MAX, "tiêu đề")
    description = _clean(description, DESC_MAX, "mô tả", required=False, multiline=True)
    author = _clean(author or "Ẩn danh", NAME_MAX, "tên hiển thị")
    code = _clean(code, CODE_MAX, "code", allow_links=True, multiline=True)
    stdin = _clean(stdin, INPUT_MAX, "input", required=False, allow_links=True, multiline=True)
    _ensure_schema()
    with _db() as run:
        rows = run("INSERT INTO posts (title, description, code, stdin, author, owner, created_at) "
                   "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
                   (title, description, code, stdin, author, owner, int(time.time())))
    return int(rows[0]["id"])


def vote(owner: str, who: str, post_id: int, value: int) -> dict:
    if value not in (-1, 0, 1):
        raise ForumError("Giá trị không hợp lệ.")
    _rate_check("vote", who)
    _ensure_schema()
    with _db() as run:
        if not run("SELECT 1 AS x FROM posts WHERE id = ? AND hidden = 0", (post_id,)):
            raise ForumError("Không tìm thấy bài viết.", 404)
        if value == 0:
            run("DELETE FROM votes WHERE post_id = ? AND voter = ?", (post_id, owner))
        else:
            run("INSERT INTO votes (post_id, voter, value) VALUES (?, ?, ?) "
                "ON CONFLICT (post_id, voter) DO UPDATE SET value = excluded.value", (post_id, owner, value))
        row = run("""SELECT
            COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS likes,
            COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS dislikes
            FROM votes WHERE post_id = ?""", (post_id,))[0]
    return {"likes": int(row["likes"]), "dislikes": int(row["dislikes"]), "myVote": value}


def add_comment(owner: str, who: str, post_id: int, body, line, author) -> dict:
    _rate_check("comment", who)
    body = _clean(body, COMMENT_MAX, "nội dung bình luận", multiline=True)
    author = _clean(author or "Ẩn danh", NAME_MAX, "tên hiển thị")
    _ensure_schema()
    with _db() as run:
        rows = run("SELECT code FROM posts WHERE id = ? AND hidden = 0", (post_id,))
        if not rows:
            raise ForumError("Không tìm thấy bài viết.", 404)
        if line is not None:
            try:
                line = int(line)
            except (TypeError, ValueError):
                raise ForumError("Số dòng không hợp lệ.")
            if not 1 <= line <= rows[0]["code"].count("\n") + 1:
                raise ForumError("Dòng này không tồn tại trong code.")
        now = int(time.time())
        out = run("INSERT INTO comments (post_id, line, body, author, owner, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
                  (post_id, line, body, author, owner, now))
    return {"id": int(out[0]["id"]), "line": line, "body": body, "author": author, "createdAt": now, "canDelete": True}


def delete_item(kind: str, item_id: int, owner: str, admin: bool) -> None:
    table = {"post": "posts", "comment": "comments"}[kind]
    _ensure_schema()
    with _db() as run:
        rows = run(f"SELECT owner FROM {table} WHERE id = ?", (item_id,))
        if not rows:
            raise ForumError("Không tìm thấy.", 404)
        if rows[0]["owner"] != owner and not admin:
            raise ForumError("Bạn chỉ xóa được nội dung của chính mình.", 403)
        run(f"UPDATE {table} SET hidden = 1 WHERE id = ?", (item_id,))


def report(kind: str, item_id: int, owner: str, who: str, reason: str = "other") -> dict:
    _rate_check("report", who)
    if reason not in REASONS:
        reason = "other"
    table = {"post": "posts", "comment": "comments"}[kind]
    _ensure_schema()
    with _db() as run:
        rows = run(f"SELECT review FROM {table} WHERE id = ? AND hidden = 0", (item_id,))
        if not rows:
            raise ForumError("Không tìm thấy.", 404)
        if int(rows[0]["review"]) == 2:       # quản trị viên đã xem và giữ lại: không tự ẩn nữa
            return {"reports": 0, "hidden": False}
        run("INSERT INTO reports (target, target_id, reporter, created_at, reason) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT (target, target_id, reporter) DO NOTHING", (kind, item_id, owner, int(time.time()), reason))
        count = int(run("SELECT COUNT(*) AS n FROM reports WHERE target = ? AND target_id = ?", (kind, item_id))[0]["n"])
        hidden = count >= REPORT_HIDE_AT
        if hidden:   # ẩn tạm thời, chờ quản trị viên duyệt
            run(f"UPDATE {table} SET hidden = 1, review = 1 WHERE id = ?", (item_id,))
    return {"reports": count, "hidden": hidden}


# --------------------------------------------------------------------------------------
# Quản trị viên
# --------------------------------------------------------------------------------------
def admin_queue() -> dict:
    """Các bài/bình luận đang chờ duyệt (đã bị ẩn tạm) và đang bị báo cáo nhưng chưa bị ẩn."""
    _ensure_schema()
    items = []
    with _db() as run:
        posts = run("""SELECT * FROM (
              SELECT p.id, p.title, p.description, p.code, p.author, p.created_at, p.hidden, p.review,
                (SELECT COUNT(*) FROM reports r WHERE r.target = 'post' AND r.target_id = p.id) AS n FROM posts p) t
            WHERE t.review = 1 OR (t.review = 0 AND t.hidden = 0 AND t.n > 0)""")
        comments = run("""SELECT * FROM (
              SELECT c.id, c.post_id, c.line, c.body, c.author, c.created_at, c.hidden, c.review,
                (SELECT COUNT(*) FROM reports r WHERE r.target = 'comment' AND r.target_id = c.id) AS n FROM comments c) t
            WHERE t.review = 1 OR (t.review = 0 AND t.hidden = 0 AND t.n > 0)""")
        reasons: dict[tuple[str, int], dict[str, int]] = {}
        for r in run("SELECT target, target_id, reason, COUNT(*) AS n FROM reports GROUP BY target, target_id, reason"):
            reasons.setdefault((r["target"], int(r["target_id"])), {})[r["reason"] or "other"] = int(r["n"])
    for r in posts:
        items.append({"kind": "post", "id": int(r["id"]), "title": r["title"], "text": r["description"],
                      "code": "\n".join(r["code"].split("\n")[:40]), "author": r["author"],
                      "createdAt": int(r["created_at"]), "pending": int(r["review"]) == 1,
                      "reports": int(r["n"]), "reasons": reasons.get(("post", int(r["id"])), {})})
    for r in comments:
        items.append({"kind": "comment", "id": int(r["id"]), "postId": int(r["post_id"]), "line": r["line"],
                      "title": "", "text": r["body"], "code": "", "author": r["author"],
                      "createdAt": int(r["created_at"]), "pending": int(r["review"]) == 1,
                      "reports": int(r["n"]), "reasons": reasons.get(("comment", int(r["id"])), {})})
    items.sort(key=lambda x: (not x["pending"], -x["reports"], -x["createdAt"]))
    return {"items": items, "pending": sum(1 for x in items if x["pending"])}


def admin_resolve(kind: str, item_id: int, action: str) -> None:
    table = {"post": "posts", "comment": "comments"}[kind]
    if action not in ("keep", "delete"):
        raise ForumError("Thao tác không hợp lệ.")
    _ensure_schema()
    with _db() as run:
        if not run(f"SELECT 1 AS x FROM {table} WHERE id = ?", (item_id,)):
            raise ForumError("Không tìm thấy.", 404)
        if action == "keep":
            run(f"UPDATE {table} SET hidden = 0, review = 2 WHERE id = ?", (item_id,))
        else:
            run(f"UPDATE {table} SET hidden = 1, review = 3 WHERE id = ?", (item_id,))


def admin_rate(who: str) -> None:
    _rate_check("admin", who)
