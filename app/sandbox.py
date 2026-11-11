"""Chọn cách chạy code C++ (Docker hoặc trực tiếp) và các giới hạn an toàn.

Chế độ chạy (biến môi trường CPPFLOW_EXEC_MODE):
  - "auto"   (mặc định): có Docker thì dùng Docker, không thì chạy trực tiếp.
  - "docker": luôn dùng Docker (như bản chạy trên máy cá nhân).
  - "direct": luôn chạy trực tiếp g++/gdb trong chính máy/container đang chạy web.

Chạy trực tiếp KHÔNG cô lập mạnh như Docker. Các giới hạn dùng ở đây:
CPU, RAM ảo, dung lượng file ghi ra, số tiến trình (qua `prlimit`), thời gian chờ,
diệt cả nhóm tiến trình khi quá hạn, môi trường sạch, và giới hạn số lượt chạy cùng lúc.
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path

MODE_ENV = "CPPFLOW_EXEC_MODE"

MAX_CONCURRENT_RUNS = int(os.environ.get("CPPFLOW_MAX_CONCURRENT_RUNS", "2"))
MAX_DEBUG_SESSIONS = int(os.environ.get("CPPFLOW_MAX_DEBUG_SESSIONS", "3"))
SLOT_WAIT_SECONDS = 20

_DOCKER_CACHE: tuple[float, bool] = (0.0, False)
_DOCKER_LOCK = threading.Lock()
_RUN_SLOTS = threading.BoundedSemaphore(max(1, MAX_CONCURRENT_RUNS))


class Busy(RuntimeError):
    """Máy chủ đang bận (hết lượt chạy đồng thời)."""


def docker_available() -> bool:
    """Docker CLI có kết nối được tới Docker Engine không (kết quả cache 10 giây)."""
    global _DOCKER_CACHE
    with _DOCKER_LOCK:
        checked_at, value = _DOCKER_CACHE
        if time.monotonic() - checked_at < 10:
            return value
        ok = False
        if shutil.which("docker") is not None:
            try:
                result = subprocess.run(
                    ["docker", "version", "--format", "{{.Server.Version}}"],
                    capture_output=True, text=True, timeout=4, check=False,
                )
                ok = result.returncode == 0
            except (subprocess.TimeoutExpired, OSError):
                ok = False
        _DOCKER_CACHE = (time.monotonic(), ok)
        return ok


def direct_supported(need_gdb: bool = False) -> bool:
    """Máy này có chạy trực tiếp được không (Linux/macOS có g++ và prlimit)."""
    if os.name != "posix":
        return False
    tools = ["g++", "gcc", "prlimit"] + (["gdb"] if need_gdb else [])
    return all(shutil.which(tool) for tool in tools)


def resolve_mode(need_gdb: bool = False) -> str | None:
    """Trả về "docker", "direct", hoặc None nếu bị ép "direct" mà máy không hỗ trợ."""
    preference = os.environ.get(MODE_ENV, "auto").strip().lower()
    if preference == "direct":
        return "direct" if direct_supported(need_gdb) else None
    if preference == "docker":
        return "docker"
    if docker_available():
        return "docker"
    if direct_supported(need_gdb):
        return "direct"
    return "docker"  # Để code gọi Docker báo lỗi quen thuộc ("hãy mở Docker Desktop").


def current_mode_label() -> str:
    mode = resolve_mode(need_gdb=False)
    return mode or "unavailable"


@contextmanager
def run_slot():
    """Giới hạn số lượt biên dịch/chạy cùng lúc ở chế độ trực tiếp (máy free rất yếu)."""
    if not _RUN_SLOTS.acquire(timeout=SLOT_WAIT_SECONDS):
        raise Busy("Máy chủ đang bận. Hãy thử lại sau ít giây.")
    try:
        yield
    finally:
        _RUN_SLOTS.release()


def clean_env(home: str) -> dict[str, str]:
    """Môi trường tối thiểu: không để lộ biến môi trường của máy chủ cho code người dùng."""
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": home,
        "TMPDIR": home,
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
    }


def limited(argv: list[str], *, cpu: int, mem_mb: int, fsize_mb: int = 50, nproc: int = 128) -> list[str]:
    """Bọc lệnh bằng prlimit để đặt giới hạn tài nguyên cho tiến trình và con của nó.

    Dùng prlimit thay cho preexec_fn vì preexec_fn không an toàn khi chương trình đa luồng.
    """
    mem = mem_mb * 1024 * 1024
    return [
        "prlimit",
        f"--cpu={cpu}:{cpu + 1}",
        f"--as={mem}",
        f"--fsize={fsize_mb * 1024 * 1024}",
        f"--nproc={nproc}",
        "--core=0",
        "--",
        *argv,
    ]


def kill_group(proc: subprocess.Popen) -> None:
    """Diệt cả nhóm tiến trình (cả tiến trình con do chương trình tự sinh ra)."""
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except OSError:
            pass


def run_limited(
    argv: list[str],
    *,
    cwd: str | Path,
    timeout: float,
    cpu: int,
    mem_mb: int,
    stdin_path: str | Path | None = None,
    stdout_path: str | Path,
    stderr_path: str | Path | None = None,
    fsize_mb: int = 50,
    nproc: int = 128,
) -> tuple[int, bool]:
    """Chạy một lệnh với giới hạn tài nguyên; trả về (returncode, bị_quá_giờ).

    stdout/stderr ghi thẳng ra file (không qua bộ nhớ của server) nên chương trình
    in vô hạn cũng không làm đầy RAM: dung lượng file bị chặn bởi `--fsize`.
    returncode âm nghĩa là bị tín hiệu giết (ví dụ -11 = segfault).
    """
    stdin_handle = open(stdin_path, "rb") if stdin_path else subprocess.DEVNULL
    stdout_handle = open(stdout_path, "wb")
    stderr_handle = open(stderr_path, "wb") if stderr_path else subprocess.STDOUT
    try:
        proc = subprocess.Popen(
            limited(argv, cpu=cpu, mem_mb=mem_mb, fsize_mb=fsize_mb, nproc=nproc),
            cwd=str(cwd),
            stdin=stdin_handle,
            stdout=stdout_handle,
            stderr=stderr_handle,
            env=clean_env(str(cwd)),
            start_new_session=True,
        )
        timed_out = False
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        # Dù thoát bình thường hay quá giờ, luôn dọn cả nhóm tiến trình còn sót.
        kill_group(proc)
        proc.wait()
        return proc.returncode, timed_out
    finally:
        for handle in (stdin_handle, stdout_handle, stderr_handle):
            if hasattr(handle, "close"):
                handle.close()


def read_text(path: str | Path, limit: int) -> str:
    """Đọc tối đa `limit` byte đầu của file và giải mã UTF-8 (lỗi thì thay ký tự)."""
    try:
        with open(path, "rb") as handle:
            data = handle.read(limit)
    except OSError:
        return ""
    return data.decode("utf-8", errors="replace")
