"""Bộ nhớ đệm kết quả biên dịch cho chế độ chạy trực tiếp.

Cùng một code (và cùng cờ biên dịch) thì lần chạy sau dùng lại file đã biên dịch,
nên chỉ đổi dữ liệu nhập rồi bấm Chạy lại sẽ gần như tức thì.

An toàn: code người dùng chạy cùng user với web nên có thể sửa file trong thư mục đệm.
Vì vậy mỗi file đệm có mã băm (SHA-256) lưu trong bộ nhớ của server; lúc dùng lại, server đọc
file, kiểm tra mã băm, rồi mới ghi sang thư mục riêng của lượt chạy. File bị sửa sẽ bị bỏ và
biên dịch lại. Bộ đệm chỉ nằm trong bộ nhớ/thư mục tạm của tiến trình, mất khi web khởi động lại.
"""
from __future__ import annotations

import atexit
import hashlib
import os
import shutil
import tempfile
import threading
from collections import OrderedDict

MAX_ENTRIES = int(os.environ.get("CPPFLOW_COMPILE_CACHE_ENTRIES", "40"))
MAX_BINARY_BYTES = 8 * 1024 * 1024

_LOCK = threading.Lock()
_INDEX: "OrderedDict[str, tuple[str, str]]" = OrderedDict()  # khóa -> (sha256 file, thông báo biên dịch)
_DIR: str | None = None


def enabled() -> bool:
    return MAX_ENTRIES > 0


def _directory() -> str:
    global _DIR
    if _DIR is None:
        _DIR = tempfile.mkdtemp(prefix="cpp-flow-cache-")
        os.chmod(_DIR, 0o700)
        atexit.register(shutil.rmtree, _DIR, True)
    return _DIR


def make_key(source: bytes, flags: list[str]) -> str:
    digest = hashlib.sha256()
    digest.update("\0".join(flags).encode("utf-8"))
    digest.update(b"\0\0")
    digest.update(source)
    return digest.hexdigest()


def get(key: str) -> tuple[bytes, str] | None:
    """Trả về (nội dung file đã biên dịch, thông báo biên dịch) nếu có và còn nguyên vẹn."""
    if not enabled():
        return None
    with _LOCK:
        entry = _INDEX.get(key)
        if entry is None:
            return None
        _INDEX.move_to_end(key)
    expected_hash, compile_output = entry
    try:
        with open(os.path.join(_directory(), key), "rb") as handle:
            data = handle.read(MAX_BINARY_BYTES + 1)
    except OSError:
        data = b""
    if not data or hashlib.sha256(data).hexdigest() != expected_hash:
        _drop(key)
        return None
    return data, compile_output


def put(key: str, binary: bytes, compile_output: str) -> None:
    if not enabled() or not binary or len(binary) > MAX_BINARY_BYTES:
        return
    path = os.path.join(_directory(), key)
    temp_path = f"{path}.{threading.get_ident()}.tmp"
    try:
        with open(temp_path, "wb") as handle:
            handle.write(binary)
        os.replace(temp_path, path)  # ghi nguyên tử: không bao giờ đọc phải file dở dang
    except OSError:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        return
    evicted: list[str] = []
    with _LOCK:
        _INDEX[key] = (hashlib.sha256(binary).hexdigest(), compile_output)
        _INDEX.move_to_end(key)
        while len(_INDEX) > MAX_ENTRIES:
            old_key, _ = _INDEX.popitem(last=False)
            evicted.append(old_key)
    for old_key in evicted:
        _remove_file(old_key)


def _drop(key: str) -> None:
    with _LOCK:
        _INDEX.pop(key, None)
    _remove_file(key)


def _remove_file(key: str) -> None:
    try:
        os.unlink(os.path.join(_directory(), key))
    except OSError:
        pass
