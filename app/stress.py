"""Tự tìm lỗi bằng random test (stress test).

Người dùng đưa 3 chương trình C++:
  - code của bạn (cần kiểm tra),
  - code đúng / brute force (chậm cũng được, miễn là chắc chắn đúng),
  - generator: đọc 1 số nguyên (seed) từ stdin (cũng có trong argv[1]) và in ra một test.
Web chạy lần lượt seed 1, 2, 3, ... và dừng ở test đầu tiên mà code của bạn lỗi hoặc cho đáp án
khác code đúng (so sánh theo từng token, bỏ qua khác biệt về khoảng trắng / xuống dòng).
"""
from __future__ import annotations

import os
import re
import signal
import subprocess
import tempfile
import time
from pathlib import Path

from app import compile_cache, sandbox
from app.runner import (
    COMPILE_TIMEOUT_SECONDS,
    DIRECT_COMPILE_MEM_MB,
    DIRECT_RUN_MEM_MB,
    DockerUnavailable,
    RunnerError,
    _container_base,
)

MAX_SOURCE_BYTES = 100_000
MAX_TESTS = 1000
DEFAULT_TESTS = 200
PER_RUN_SECONDS = 2
# Tổng thời gian tối đa cho cả đợt (không tính biên dịch).
BUDGET_SECONDS = float(os.environ.get("CPPFLOW_STRESS_BUDGET", "15"))
SHOW_LIMIT = 6000  # số ký tự tối đa hiển thị cho input / output của test lỗi
GEN_MAX_OUTPUT_MB = 1

NAMES = ("mine", "brute", "gen")
LABELS = {"mine": "Code của bạn", "brute": "Code đúng", "gen": "Generator"}
MARK = "__CPPFLOW_STRESS__"


def _clip(text: str, limit: int = SHOW_LIMIT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…[đã cắt bớt]"


def _same(a: str, b: str) -> bool:
    return a.split() == b.split()


def run_stress(mine: str, brute: str, gen: str, tests: int = DEFAULT_TESTS, start: int = 1) -> dict:
    sources = {"mine": mine, "brute": brute, "gen": gen}
    for name, text in sources.items():
        if len(text.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise RunnerError(f"{LABELS[name]} vượt quá giới hạn 100 KB.")
        if not text.strip():
            return {"status": "error", "kind": "missing", "which": name,
                    "message": f"Chưa có {LABELS[name].lower()}."}
    tests = max(1, min(int(tests), MAX_TESTS))
    start = max(1, int(start))

    mode = sandbox.resolve_mode()
    if mode is None:
        raise DockerUnavailable("Chế độ chạy trực tiếp cần Linux có g++ và prlimit.")
    started = time.perf_counter()
    result = _stress_direct(sources, tests, start) if mode == "direct" else _stress_docker(sources, tests, start)
    result["durationMs"] = round((time.perf_counter() - started) * 1000)
    result["requested"] = tests
    return result


# --------------------------------------------------------------------------------------
# Chạy trực tiếp (không Docker)
# --------------------------------------------------------------------------------------
def _compile_direct(name: str, source: str, work: Path) -> dict | None:
    """Biên dịch một chương trình ra work/name. Trả về dict lỗi, hoặc None nếu thành công."""
    source_bytes = source.encode("utf-8")
    flags = ["-std=c++20", "-O0", "-Wall", "-Wextra"]
    key = compile_cache.make_key(source_bytes, flags)
    cached = compile_cache.get(key)
    if cached is not None:
        binary, _ = cached
        (work / name).write_bytes(binary)
        os.chmod(work / name, 0o755)
        return None
    (work / f"{name}.cpp").write_bytes(source_bytes)
    status, timed_out = sandbox.run_limited(
        ["g++", *flags, *sandbox.pch_include_args("run"), f"{name}.cpp", "-o", name],
        cwd=work, timeout=COMPILE_TIMEOUT_SECONDS, cpu=COMPILE_TIMEOUT_SECONDS,
        mem_mb=DIRECT_COMPILE_MEM_MB, stdout_path=work / f"{name}.compile.txt",
    )
    output = sandbox.read_text(work / f"{name}.compile.txt", 40_000)
    if timed_out:
        return {"status": "error", "kind": "compile", "which": name,
                "message": f"Biên dịch {LABELS[name].lower()} vượt quá {COMPILE_TIMEOUT_SECONDS} giây."}
    if status != 0:
        return {"status": "error", "kind": "compile", "which": name, "message": _clip(output.strip(), 4000)}
    try:
        compile_cache.put(key, (work / name).read_bytes(), output)
    except OSError:
        pass
    return None


def _run_one(work: Path, binary: str, args: list[str], stdin_file: Path, tag: str) -> tuple[int, bool, str, str]:
    """Chạy một chương trình đã biên dịch. Trả về (mã thoát, quá giờ, stdout, stderr)."""
    out, err = work / f"{tag}.out", work / f"{tag}.err"
    status, timed_out = sandbox.run_limited(
        [f"./{binary}", *args], cwd=work, timeout=PER_RUN_SECONDS, cpu=PER_RUN_SECONDS + 1,
        mem_mb=DIRECT_RUN_MEM_MB, stdin_path=stdin_file, stdout_path=out, stderr_path=err,
        fsize_mb=GEN_MAX_OUTPUT_MB, nproc=64,
    )
    return (status, timed_out,
            sandbox.read_text(out, SHOW_LIMIT * 20), sandbox.read_text(err, 4000))


def _describe_exit(status: int) -> str:
    if status < 0:
        try:
            name = signal.Signals(-status).name
        except ValueError:
            name = f"tín hiệu {-status}"
        return {
            "SIGSEGV": "Segmentation fault (truy cập bộ nhớ không hợp lệ)",
            "SIGFPE": "Lỗi số học (chia cho 0)",
            "SIGABRT": "Chương trình bị hủy (abort)",
            "SIGKILL": "Bị dừng (có thể dùng quá nhiều bộ nhớ)",
            "SIGXCPU": "Dùng quá thời gian CPU",
            "SIGXFSZ": "In quá nhiều output",
        }.get(name, f"Bị dừng bởi {name}")
    return f"Kết thúc với exit code {status}"


def _stress_direct(sources: dict[str, str], tests: int, start: int = 1) -> dict:
    try:
        with sandbox.run_slot(), tempfile.TemporaryDirectory(prefix="cpp-flow-stress-") as temp:
            work = Path(temp)
            for name in NAMES:
                failure = _compile_direct(name, sources[name], work)
                if failure:
                    return failure

            deadline = time.monotonic() + BUDGET_SECONDS
            for seed in range(start, start + tests):
                if time.monotonic() > deadline:
                    return {"status": "ok", "kind": "no_diff", "tests": seed - start, "timeLimited": True}

                (work / "seed.txt").write_text(f"{seed}\n")
                g_status, g_timeout, test_input, g_err = _run_one(work, "gen", [str(seed)], work / "seed.txt", "gen")
                if g_timeout or g_status != 0:
                    return {"status": "error", "kind": "generator", "seed": seed,
                            "message": ("Generator chạy quá giờ." if g_timeout else _describe_exit(g_status)),
                            "stderr": _clip(g_err, 2000)}
                (work / "test.txt").write_text(test_input, encoding="utf-8")

                b_status, b_timeout, b_out, b_err = _run_one(work, "brute", [], work / "test.txt", "brute")
                if b_timeout or b_status != 0:
                    return {"status": "error", "kind": "brute", "seed": seed,
                            "message": ("Code đúng chạy quá giờ trên test này." if b_timeout
                                        else "Code đúng bị lỗi: " + _describe_exit(b_status)),
                            "input": _clip(test_input), "stderr": _clip(b_err, 2000)}

                a_status, a_timeout, a_out, a_err = _run_one(work, "mine", [], work / "test.txt", "mine")
                kind = None
                if a_timeout:
                    kind = "timeout"
                elif a_status != 0:
                    kind = "runtime"
                elif not _same(a_out, b_out):
                    kind = "wrong_answer"
                if kind:
                    return {
                        "status": "found", "kind": kind, "seed": seed, "tests": seed - start + 1,
                        "input": _clip(test_input), "mine": _clip(a_out), "brute": _clip(b_out),
                        "stderr": _clip(a_err, 2000),
                        "message": ("Code của bạn chạy quá " + f"{PER_RUN_SECONDS} giây" if a_timeout
                                    else _describe_exit(a_status) if a_status != 0 else ""),
                    }
            return {"status": "ok", "kind": "no_diff", "tests": tests, "timeLimited": False}
    except sandbox.Busy as exc:
        raise RunnerError(str(exc)) from exc
    except OSError as exc:
        raise RunnerError(f"Không thể chạy chương trình: {exc}") from exc


# --------------------------------------------------------------------------------------
# Chạy trong Docker: cả đợt trong MỘT container để khỏi tốn thời gian khởi động mỗi lượt.
# --------------------------------------------------------------------------------------
def _docker_script(tests: int, start: int = 1) -> str:
    m = MARK
    return f"""
set +e
for n in mine brute gen; do
  timeout {COMPILE_TIMEOUT_SECONDS}s g++ -std=c++20 -O0 -I/opt/pch-run /input/$n.cpp -o /tmp/$n 2>/tmp/$n.err
  s=$?
  if [ $s -ne 0 ]; then
    echo "{m} COMPILE $n $s"; head -c 4000 /tmp/$n.err; echo; echo "{m} END"; exit 0
  fi
done
start=$(date +%s)
i={start}
while [ $i -lt {start + tests} ]; do
  now=$(date +%s)
  if [ $((now-start)) -ge {int(BUDGET_SECONDS)} ]; then echo "{m} DONE $((i-{start})) limited"; exit 0; fi
  echo $i > /tmp/seed.txt
  timeout {PER_RUN_SECONDS}s /tmp/gen $i < /tmp/seed.txt 2>/tmp/gen.err | head -c 1000000 > /tmp/in.txt
  s=${{PIPESTATUS[0]}}
  if [ $s -ne 0 ]; then echo "{m} GENFAIL $i $s"; head -c 2000 /tmp/gen.err; echo; echo "{m} END"; exit 0; fi
  timeout {PER_RUN_SECONDS}s /tmp/brute < /tmp/in.txt 2>/tmp/b.err | head -c 1000000 > /tmp/b.out
  s=${{PIPESTATUS[0]}}
  if [ $s -ne 0 ]; then
    echo "{m} BRUTEFAIL $i $s"; head -c {SHOW_LIMIT} /tmp/in.txt; echo; echo "{m} ERR"; head -c 2000 /tmp/b.err; echo; echo "{m} END"; exit 0
  fi
  timeout {PER_RUN_SECONDS}s /tmp/mine < /tmp/in.txt 2>/tmp/a.err | head -c 1000000 > /tmp/a.out
  s=${{PIPESTATUS[0]}}
  kind=""
  if [ $s -eq 124 ]; then kind=timeout
  elif [ $s -ne 0 ]; then kind=runtime
  else
    tr -s ' \\t\\r\\n' '\\n' < /tmp/a.out | sed '/^$/d' > /tmp/a.n
    tr -s ' \\t\\r\\n' '\\n' < /tmp/b.out | sed '/^$/d' > /tmp/b.n
    cmp -s /tmp/a.n /tmp/b.n || kind=wrong_answer
  fi
  if [ -n "$kind" ]; then
    echo "{m} FOUND $kind $i $s"
    echo "{m} IN"; head -c {SHOW_LIMIT} /tmp/in.txt
    echo; echo "{m} MINE"; head -c {SHOW_LIMIT} /tmp/a.out
    echo; echo "{m} BRUTE"; head -c {SHOW_LIMIT} /tmp/b.out
    echo; echo "{m} ERR"; head -c 2000 /tmp/a.err
    echo; echo "{m} END"; exit 0
  fi
  i=$((i+1))
done
echo "{m} DONE {tests} full"
"""


def _stress_docker(sources: dict[str, str], tests: int, start: int = 1) -> dict:
    if not sandbox.docker_available():
        raise DockerUnavailable(
            "Không kết nối được Docker. Hãy mở Docker Desktop và chạy: docker pull gcc:14"
        )
    with tempfile.TemporaryDirectory(prefix="cpp-flow-stress-") as temp:
        work = Path(temp)
        for name in NAMES:
            (work / f"{name}.cpp").write_text(sources[name], encoding="utf-8")
        total_timeout = 3 * COMPILE_TIMEOUT_SECONDS + BUDGET_SECONDS + 15
        try:
            proc = subprocess.run(
                _container_base(work) + ["bash", "-c", _docker_script(tests, start)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=total_timeout, check=False,
            )
        except subprocess.TimeoutExpired:
            return {"status": "error", "kind": "timeout_total",
                    "message": "Quá trình tìm lỗi vượt thời gian chờ tổng thể."}
        except OSError as exc:
            raise RunnerError(f"Không thể gọi Docker: {exc}") from exc
    return _parse_docker_output(proc.stdout, start)


def _parse_docker_output(stdout: str, start: int = 1) -> dict:
    parts = re.split(rf"^{MARK} ", stdout, flags=re.M)
    sections = [p for p in parts[1:] if p.strip()]
    if not sections:
        return {"status": "error", "kind": "internal", "message": "Không đọc được kết quả từ Docker."}

    def body(text: str) -> str:
        lines = text.split("\n", 1)
        return (lines[1] if len(lines) > 1 else "").rstrip("\n")

    first = sections[0].split("\n", 1)[0].split()
    tag = first[0]
    if tag == "COMPILE":
        return {"status": "error", "kind": "compile", "which": first[1],
                "message": _clip(body(sections[0]), 4000)}
    if tag == "DONE":
        return {"status": "ok", "kind": "no_diff", "tests": int(first[1]),
                "timeLimited": len(first) > 2 and first[2] == "limited"}
    if tag == "GENFAIL":
        return {"status": "error", "kind": "generator", "seed": int(first[1]),
                "message": "Generator bị lỗi hoặc chạy quá giờ.", "stderr": _clip(body(sections[0]), 2000)}

    named: dict[str, str] = {}
    for sec in sections[1:]:
        label = sec.split("\n", 1)[0].strip()
        named[label] = body(sec)
    if tag == "BRUTEFAIL":
        return {"status": "error", "kind": "brute", "seed": int(first[1]),
                "message": "Code đúng bị lỗi hoặc chạy quá giờ trên test này.",
                "input": _clip(body(sections[0])), "stderr": named.get("ERR", "")}
    if tag == "FOUND":
        kind, seed, code = first[1], int(first[2]), int(first[3])
        message = ""
        if kind == "timeout":
            message = f"Code của bạn chạy quá {PER_RUN_SECONDS} giây"
        elif kind == "runtime":
            message = {139: "Segmentation fault (truy cập bộ nhớ không hợp lệ)",
                       136: "Lỗi số học (chia cho 0)", 134: "Chương trình bị hủy (abort)"
                       }.get(code, f"Kết thúc với exit code {code}")
        return {"status": "found", "kind": kind, "seed": seed, "tests": seed - start + 1,
                "input": named.get("IN", ""), "mine": named.get("MINE", ""),
                "brute": named.get("BRUTE", ""), "stderr": named.get("ERR", ""), "message": message}
    return {"status": "error", "kind": "internal", "message": "Kết quả từ Docker không hợp lệ."}
