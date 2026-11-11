
import signal
import subprocess
import tempfile
import time
from pathlib import Path

from app import sandbox

IMAGE = "gcc:14"
MAX_SOURCE_BYTES = 100_000
MAX_INPUT_BYTES = 20_000
RUN_TIMEOUT_SECONDS = 5
COMPILE_TIMEOUT_SECONDS = 25
MAX_OUTPUT_CHARS = 20_000

# Giới hạn khi chạy trực tiếp (không có Docker).
DIRECT_COMPILE_MEM_MB = 2048
DIRECT_RUN_MEM_MB = 512
DIRECT_MAX_OUTPUT_MB = 1

COMPILE_TIMEOUT_MARKER = "__CPP_FLOW_COMPILE_TIMEOUT__"
COMPILE_ERROR_MARKER = "__CPP_FLOW_COMPILE_ERROR__"
RUN_START_MARKER = "__CPP_FLOW_RUN_START__"
RUN_TIMEOUT_MARKER = "__CPP_FLOW_RUN_TIMEOUT__"


class DockerUnavailable(RuntimeError):
    pass


class RunnerError(RuntimeError):
    pass


def _container_base(work_dir: Path):
    return [
        "docker", "run", "--rm",
        "--network", "none",
        "--memory", "1g",
        "--memory-swap", "1g",
        "--cpus", "1",
        "--pids-limit", "64",
        "--read-only",
        "--security-opt", "no-new-privileges",
        "--cap-drop", "ALL",
        "--tmpfs", "/tmp:rw,exec,nosuid,size=96m",
        "-v", f"{work_dir.resolve()}:/input:ro",
        "-w", "/tmp",
        IMAGE,
    ]


def _clip(text: str) -> str:
    if len(text) > MAX_OUTPUT_CHARS:
        return text[:MAX_OUTPUT_CHARS] + (
            "\n...[output truncated by C++ Flow]"
        )
    return text


def run_cpp(code: str, stdin_text: str) -> dict:
    source = code.encode("utf-8")
    user_input = stdin_text.encode("utf-8")

    if len(source) > MAX_SOURCE_BYTES:
        raise RunnerError("Code vượt quá giới hạn 100 KB.")

    if len(user_input) > MAX_INPUT_BYTES:
        raise RunnerError("Input vượt quá giới hạn 20 KB.")

    mode = sandbox.resolve_mode()
    if mode is None:
        raise DockerUnavailable(
            "Chế độ chạy trực tiếp cần Linux có g++ và prlimit."
        )
    if mode == "direct":
        return _run_direct(source, user_input)
    return _run_docker(source, user_input)


def _run_direct(source: bytes, user_input: bytes) -> dict:
    """Biên dịch và chạy trực tiếp trên máy/container đang chạy web (không dùng Docker)."""
    started = time.perf_counter()

    def elapsed_ms() -> int:
        return round((time.perf_counter() - started) * 1000)

    with tempfile.TemporaryDirectory(prefix="cpp-flow-") as temp:
        work = Path(temp)
        (work / "main.cpp").write_bytes(source)
        (work / "input.txt").write_bytes(user_input)

        try:
            with sandbox.run_slot():
                compile_status, compile_timed_out = sandbox.run_limited(
                    ["g++", "-std=c++20", "-O0", "-Wall", "-Wextra",
                     *sandbox.pch_include_args(),
                     "main.cpp", "-o", "main"],
                    cwd=work,
                    timeout=COMPILE_TIMEOUT_SECONDS,
                    cpu=COMPILE_TIMEOUT_SECONDS,
                    mem_mb=DIRECT_COMPILE_MEM_MB,
                    stdout_path=work / "compile.txt",
                )
                compile_output = sandbox.read_text(
                    work / "compile.txt", MAX_OUTPUT_CHARS * 4
                )

                if compile_timed_out:
                    return {
                        "status": "error", "kind": "compile_timeout",
                        "stdout": "",
                        "stderr": f"Biên dịch C++ vượt quá {COMPILE_TIMEOUT_SECONDS} giây.",
                        "exitCode": None, "durationMs": elapsed_ms(),
                    }

                if compile_status != 0:
                    return {
                        "status": "error", "kind": "compile",
                        "stdout": "", "stderr": _clip(compile_output.strip()),
                        "exitCode": compile_status, "durationMs": elapsed_ms(),
                    }

                run_status, run_timed_out = sandbox.run_limited(
                    ["./main"],
                    cwd=work,
                    timeout=RUN_TIMEOUT_SECONDS,
                    cpu=RUN_TIMEOUT_SECONDS + 1,
                    mem_mb=DIRECT_RUN_MEM_MB,
                    stdin_path=work / "input.txt",
                    stdout_path=work / "stdout.txt",
                    stderr_path=work / "stderr.txt",
                    fsize_mb=DIRECT_MAX_OUTPUT_MB,
                    nproc=64,
                )
        except sandbox.Busy as exc:
            raise RunnerError(str(exc)) from exc
        except OSError as exc:
            raise RunnerError(f"Không thể chạy chương trình: {exc}") from exc

        stdout = sandbox.read_text(work / "stdout.txt", MAX_OUTPUT_CHARS * 4)
        program_stderr = sandbox.read_text(work / "stderr.txt", MAX_OUTPUT_CHARS * 4)
        # Giống chế độ Docker: cảnh báo của trình biên dịch đứng trước stderr của chương trình.
        stderr = (compile_output + program_stderr) if compile_output else program_stderr

        if run_timed_out:
            return {
                "status": "error", "kind": "timeout",
                "stdout": _clip(stdout),
                "stderr": _clip(
                    stderr.strip()
                    + f"\nĐã dừng chương trình sau {RUN_TIMEOUT_SECONDS} giây."
                ),
                "exitCode": None, "durationMs": elapsed_ms(),
            }

        exit_code = run_status
        if run_status < 0:
            # Bị tín hiệu giết: quy ước shell là 128 + số tín hiệu (ví dụ segfault = 139).
            try:
                signal_name = signal.Signals(-run_status).name
            except ValueError:
                signal_name = f"tín hiệu {-run_status}"
            exit_code = 128 - run_status
            reason = {
                "SIGXFSZ": f"Output vượt quá {DIRECT_MAX_OUTPUT_MB} MB nên chương trình bị dừng.",
                "SIGSEGV": "Segmentation fault (truy cập bộ nhớ không hợp lệ).",
                "SIGABRT": "Chương trình bị hủy (abort).",
                "SIGFPE": "Lỗi số học (chia cho 0).",
                "SIGKILL": "Chương trình bị dừng (có thể do dùng quá nhiều bộ nhớ).",
                "SIGXCPU": "Chương trình dùng quá thời gian CPU cho phép.",
            }.get(signal_name, f"Chương trình bị dừng bởi {signal_name}.")
            stderr = stderr.strip() + ("\n" if stderr.strip() else "") + reason

        success = exit_code == 0
        return {
            "status": "success" if success else "error",
            "kind": "ok" if success else "runtime",
            "stdout": _clip(stdout),
            "stderr": _clip(stderr),
            "exitCode": exit_code,
            "durationMs": elapsed_ms(),
        }


def _run_docker(source: bytes, user_input: bytes) -> dict:
    if not sandbox.docker_available():
        raise DockerUnavailable(
            "Không kết nối được Docker. Hãy mở Docker Desktop "
            "và chạy: docker pull gcc:14"
        )

    with tempfile.TemporaryDirectory(prefix="cpp-flow-") as temp:
        work_dir = Path(temp)
        (work_dir / "main.cpp").write_bytes(source)
        (work_dir / "input.txt").write_bytes(user_input)

        # Biên dịch và chạy trong CÙNG một container.
        # /tmp/main vì vậy vẫn tồn tại khi chương trình bắt đầu chạy.
        script = f"""
set +e

timeout {COMPILE_TIMEOUT_SECONDS}s \
    g++ -std=c++20 -O0 -Wall -Wextra \
    /input/main.cpp -o /tmp/main

compile_status=$?

if [ "$compile_status" -eq 124 ]; then
    echo "{COMPILE_TIMEOUT_MARKER}" >&2
    exit 124
fi

if [ "$compile_status" -ne 0 ]; then
    echo "{COMPILE_ERROR_MARKER}" >&2
    exit "$compile_status"
fi

echo "{RUN_START_MARKER}"

timeout {RUN_TIMEOUT_SECONDS}s \
    /tmp/main < /input/input.txt

run_status=$?

if [ "$run_status" -eq 124 ]; then
    echo "{RUN_TIMEOUT_MARKER}" >&2
    exit 124
fi

exit "$run_status"
"""

        started = time.perf_counter()

        try:
            result = subprocess.run(
                _container_base(work_dir) + ["bash", "-lc", script],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=COMPILE_TIMEOUT_SECONDS
                + RUN_TIMEOUT_SECONDS + 10,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "kind": "compile_timeout",
                "stdout": "",
                "stderr": (
                    "Docker hoặc quá trình biên dịch vượt thời gian "
                    "chờ tổng thể. Hãy thử lại và kiểm tra Docker Desktop."
                ),
                "exitCode": None,
                "durationMs": round(
                    (time.perf_counter() - started) * 1000
                ),
            }
        except OSError as exc:
            raise RunnerError(f"Không thể gọi Docker: {exc}") from exc

        duration = round((time.perf_counter() - started) * 1000)
        stdout = result.stdout
        stderr = result.stderr

        # Phân biệt lỗi biên dịch với lỗi khi chạy.
        if COMPILE_TIMEOUT_MARKER in stderr:
            return {
                "status": "error",
                "kind": "compile_timeout",
                "stdout": "",
                "stderr": "Biên dịch C++ vượt quá 25 giây.",
                "exitCode": None,
                "durationMs": duration,
            }

        if COMPILE_ERROR_MARKER in stderr:
            stderr = stderr.replace(
                COMPILE_ERROR_MARKER, ""
            ).strip()
            return {
                "status": "error",
                "kind": "compile",
                "stdout": _clip(stdout),
                "stderr": _clip(stderr),
                "exitCode": result.returncode,
                "durationMs": duration,
            }

        if RUN_START_MARKER in stdout:
            stdout = stdout.split(RUN_START_MARKER, 1)[1]
            stdout = stdout.lstrip("\r\n")

        if RUN_TIMEOUT_MARKER in stderr:
            stderr = stderr.replace(
                RUN_TIMEOUT_MARKER, ""
            ).strip()
            return {
                "status": "error",
                "kind": "timeout",
                "stdout": _clip(stdout),
                "stderr": _clip(
                    stderr
                    + f"\nĐã dừng chương trình sau {RUN_TIMEOUT_SECONDS} giây."
                ),
                "exitCode": None,
                "durationMs": duration,
            }

        success = result.returncode == 0

        return {
            "status": "success" if success else "error",
            "kind": "ok" if success else "runtime",
            "stdout": _clip(stdout),
            "stderr": _clip(stderr),
            "exitCode": result.returncode,
            "durationMs": duration,
        }
