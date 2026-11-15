"""Giải thích vì sao chương trình bị crash.

Chạy lại code với các cờ kiểm tra nhẹ (assert của STL, kiểm tra chỉ số mảng, con trỏ null, chia cho 0,
thiếu return) dưới GDB. Khi chương trình dừng vì lỗi, script GDB Python:
  - tìm dòng code của bạn gây lỗi (bỏ qua các tầng trong thư viện chuẩn),
  - thu call stack và giá trị biến,
  - phân tích dòng đó: chỉ số nào vượt kích thước mảng/vector, con trỏ nào bằng null, số chia nào bằng 0, ...
rồi trả về dữ liệu có cấu trúc để giao diện vẽ hình minh họa.
"""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

from app import sandbox
from app.debugger import DEBUG_IMAGE
from app.runner import COMPILE_TIMEOUT_SECONDS, DockerUnavailable, RunnerError

MAX_SOURCE_BYTES = 100_000
MAX_INPUT_CHARS = 20_000
GDB_TIMEOUT_SECONDS = 20
FLAGS = [
    "-std=c++20", "-g", "-O0", "-fno-omit-frame-pointer", "-D_GLIBCXX_ASSERTIONS",
    # Các lỗi nghiêm trọng thì dừng ngay; tràn số nguyên chỉ báo cáo rồi chạy tiếp.
    "-fsanitize=bounds,null,integer-divide-by-zero,return,signed-integer-overflow",
    "-fno-sanitize-recover=bounds,null,integer-divide-by-zero,return",
]

TRACER = r'''
import gdb, json, re

SRC = "main.cpp"
OUT_JSON = "__OUT_JSON__"
STDIN_FILE = "__STDIN__"
STDOUT_FILE = "__STDOUT__"
STDERR_FILE = "__STDERR__"
FRAME_CAP = 30000

for cmd in ("set pagination off", "set confirm off", "set print elements 24",
            "set max-value-size unlimited",
            "set environment UBSAN_OPTIONS=abort_on_error=1:print_stacktrace=0"):
    try:
        gdb.execute(cmd, to_string=True)
    except Exception:
        pass

import os
SRC_PATH = os.path.join(os.path.dirname(OUT_JSON), SRC)
HEX = re.compile(r"0x[0-9a-fA-F]{5,}")
result = {"stopped": False}
state = {"ovf": False}


def read_src_line(line):
    try:
        return open(SRC_PATH, encoding="utf-8", errors="replace").read().split("\n")[line - 1]
    except Exception:
        return ""


def norm(v, limit=120):
    text = HEX.sub("<ptr>", str(v))
    return text if len(text) <= limit else text[:limit] + "…"


def user_frame_of(frame):
    try:
        sal = frame.find_sal()
        return sal.symtab is not None and sal.symtab.filename.endswith(SRC)
    except Exception:
        return False


def frame_args(frame):
    try:
        block = frame.block()
    except Exception:
        return []
    out = []
    while block is not None and not block.is_global and not block.is_static:
        for sym in block:
            if sym.is_argument:
                try:
                    out.append([sym.name, norm(sym.value(frame), 40)])
                except Exception:
                    pass
        if block.function is not None:
            break
        block = block.superblock
    return out


def frame_locals(frame, line):
    out = []
    try:
        block = frame.block()
    except Exception:
        return out
    seen = set()
    while block is not None and not block.is_global and not block.is_static:
        for sym in block:
            if sym.is_variable and not sym.is_argument and sym.name not in seen and not sym.name.startswith("__"):
                seen.add(sym.name)
                if sym.line > line:
                    continue
                try:
                    out.append([sym.name, norm(sym.value(frame), 80)])
                except Exception:
                    pass
        if block.function is not None:
            break
        block = block.superblock
    return out[:14]


def lookup(name, frame):
    try:
        return gdb.parse_and_eval(name)
    except Exception:
        return None


def container_info(value):
    """-> (loại, kích thước, danh sách vài phần tử đầu) hoặc None."""
    try:
        t = value.type.strip_typedefs()
        if t.code == gdb.TYPE_CODE_ARRAY:
            lo, hi = t.range()
            n = hi - lo + 1
            vals = [norm(value[i], 24) for i in range(min(n, 8))]
            return ("array", n, vals)
        name = str(t)
        if name.startswith("std::vector") and "<bool" not in name:
            start = value["_M_impl"]["_M_start"]
            finish = value["_M_impl"]["_M_finish"]
            n = int(finish - start)
            vals = [norm(start[i], 24) for i in range(min(n, 8))]
            return ("vector", n, vals)
        if "basic_string" in name:
            n = int(value["_M_string_length"])
            ptr = value["_M_dataplus"]["_M_p"]
            vals = [norm(ptr[i], 24) for i in range(min(n, 8))]
            return ("string", n, vals)
        if name.startswith("std::array"):
            arr = value["_M_elems"]
            lo, hi = arr.type.strip_typedefs().range()
            n = hi - lo + 1
            return ("array", n, [norm(arr[i], 24) for i in range(min(n, 8))])
    except Exception:
        return None
    return None


def balanced_back(text, pos):
    """Lùi từ vị trí pos để lấy biểu thức nền (a, a.b, a[i], p->x...). '' nếu không đơn giản."""
    k = pos
    while k > 0:
        c = text[k - 1]
        if c == "]":
            depth = 1
            j = k - 2
            while j >= 0 and depth:
                if text[j] == "]":
                    depth += 1
                elif text[j] == "[":
                    depth -= 1
                j -= 1
            k = j + 1
        elif c.isalnum() or c in "_.":
            k -= 1
        elif c == ">" and k >= 2 and text[k - 2] == "-":
            k -= 2
        else:
            break
    return text[k:pos].strip()


def safe_expr(expr):
    if re.search(r"\w\s*\(", expr) or "++" in expr or "--" in expr:
        return False
    if re.search(r"(?<![=!<>])=(?!=)", expr):
        return False
    return True


def int_value(expr):
    if not safe_expr(expr):
        return None
    v = lookup(expr, None)
    if v is None:
        return None
    try:
        return int(v)
    except Exception:
        return None


def find_oob(text):
    pos = 0
    while True:
        i = text.find("[", pos)
        if i < 0:
            return None
        depth = 1
        j = i + 1
        while j < len(text) and depth:
            if text[j] == "[":
                depth += 1
            elif text[j] == "]":
                depth -= 1
            j += 1
        pos = i + 1
        if depth:
            continue
        idx_expr = text[i + 1:j - 1].strip()
        base = balanced_back(text, i)
        if not base or not idx_expr or base[0].isdigit() or "(" in base:
            continue
        idx = int_value(idx_expr)
        if idx is None:
            continue
        bval = lookup(base, None)
        if bval is None:
            continue
        info = container_info(bval)
        if info is None:
            continue
        kind, n, vals = info
        if idx < 0 or idx >= n:
            return {"base": base, "index": idx_expr, "indexValue": idx, "size": n,
                    "containerKind": kind, "values": vals,
                    "type": norm(bval.type, 60), "expr": text[max(0, i - len(base)):j]}


def find_at_oob(text):
    for m in re.finditer(r"([A-Za-z_][\w\.\[\]>\-]*)\s*\.\s*at\s*\(([^()]*)\)", text):
        base, idx_expr = m.group(1), m.group(2).strip()
        idx = int_value(idx_expr)
        bval = lookup(base, None)
        info = container_info(bval) if bval is not None else None
        if idx is None or info is None:
            continue
        kind, n, vals = info
        if idx < 0 or idx >= n:
            return {"base": base, "index": idx_expr, "indexValue": idx, "size": n,
                    "containerKind": kind, "values": vals, "type": norm(bval.type, 60),
                    "expr": m.group(0)}


def find_null(text):
    cands = []
    for m in re.finditer(r"([A-Za-z_]\w*)\s*->", text):
        cands.append(m.group(1))
    for m in re.finditer(r"\*\s*([A-Za-z_]\w*)", text):
        cands.append(m.group(1))
    for m in re.finditer(r"\b([A-Za-z_]\w*)\b", text):
        cands.append(m.group(1))
    seen = set()
    for name in cands:
        if name in seen:
            continue
        seen.add(name)
        v = lookup(name, None)
        if v is None:
            continue
        try:
            if v.type.strip_typedefs().code == gdb.TYPE_CODE_PTR and int(v) == 0:
                return {"name": name, "type": norm(v.type, 60)}
        except Exception:
            continue
    return None


def find_div0(text):
    for m in re.finditer(r"[/%]=?\s*([A-Za-z_][\w\.\[\]>\-]*|\d+)", text):
        expr = m.group(1)
        v = int_value(expr)
        if v == 0:
            return {"divisor": expr, "op": "%" if "%" in m.group(0) else "/",
                    "expr": text[max(0, m.start() - 24):m.end()].strip()}
    return None


def find_alloc(text):
    pats = [r"\.\s*(?:resize|assign|reserve)\s*\(\s*([^,()]+)", r"new\s+[\w:<> ]+\s*\[\s*([^\]]+)\]",
            r"vector\s*<[^;]*?>\s*\w+\s*\(\s*([^,()]+)", r"string\s+\w+\s*\(\s*([^,()]+)"]
    for p in pats:
        for m in re.finditer(p, text):
            expr = m.group(1).strip()
            v = int_value(expr)
            if v is not None:
                return {"expr": expr, "value": v}
    return None


def on_stop(event):
    if isinstance(event, gdb.SignalEvent):
        result["signal"] = event.stop_signal
    elif isinstance(event, gdb.BreakpointEvent):
        state["ovf"] = True


def on_exit(event):
    code = getattr(event, "exit_code", None)
    result["exitCode"] = code if code is not None else 0


def overflow_snapshot():
    try:
        f = gdb.newest_frame()
        for _ in range(40):
            if f is None:
                break
            if user_frame_of(f):
                line = f.find_sal().line
                return {"line": line, "func": f.name() or "?", "locals": frame_locals(f, line),
                        "args": frame_args(f), "lineText": read_src_line(line)}
            f = f.older()
    except Exception:
        pass
    return None


gdb.events.stop.connect(on_stop)
gdb.events.exited.connect(on_exit)
ovf_bps = []
try:
    gdb.execute("set breakpoint pending on", to_string=True)
    for fn in ("__ubsan_handle_add_overflow", "__ubsan_handle_sub_overflow",
               "__ubsan_handle_mul_overflow", "__ubsan_handle_negate_overflow"):
        try:
            ovf_bps.append(gdb.Breakpoint(fn))
        except Exception:
            pass
except Exception:
    pass

command = "run < %s > %s 2> %s" % (STDIN_FILE, STDOUT_FILE, STDERR_FILE)
for _round in range(3):
    try:
        gdb.execute(command, to_string=True)
    except Exception as exc:
        result["error"] = str(exc)
        break
    if state["ovf"] and gdb.selected_inferior().pid:
        state["ovf"] = False
        if "overflow" not in result:
            snap = overflow_snapshot()
            if snap:
                result["overflow"] = snap
        for b in ovf_bps:
            try:
                b.enabled = False
            except Exception:
                pass
        command = "continue"
        continue
    break

if result.get("signal") and gdb.selected_inferior().pid:
    result["stopped"] = True
    try:
        result["faultAddr"] = int(gdb.parse_and_eval("$_siginfo._sifields._sigfault.si_addr"))
    except Exception:
        pass
    frames = []
    total = 0
    user_count = 0
    first_user = None
    try:
        f = gdb.newest_frame()
        while f is not None and total < FRAME_CAP:
            total += 1
            if user_frame_of(f):
                user_count += 1
                if first_user is None:
                    first_user = f
                if len(frames) < 8:
                    frames.append({"func": f.name() or "?", "line": f.find_sal().line,
                                   "args": frame_args(f)})
            f = f.older()
        result["capped"] = total >= FRAME_CAP
    except Exception:
        pass
    result["totalFrames"] = total
    result["userFrames"] = user_count
    result["stack"] = frames
    if first_user is not None:
        try:
            first_user.select()
        except Exception:
            pass
        line = first_user.find_sal().line
        result["line"] = line
        result["func"] = first_user.name() or "?"
        result["locals"] = frame_locals(first_user, line)
        result["args"] = frame_args(first_user)

if result.get("line"):
    text = read_src_line(result["line"])
    result["lineText"] = text
    result["analysis"] = {}
    try:
        for key, fn in (("oob", lambda: find_oob(text) or find_at_oob(text)),
                        ("null", lambda: find_null(text)),
                        ("div0", lambda: find_div0(text)),
                        ("alloc", lambda: find_alloc(text))):
            try:
                found = fn()
            except Exception:
                found = None
            if found:
                result["analysis"][key] = found
    except Exception:
        pass

with open(OUT_JSON, "w") as handle:
    handle.write(json.dumps(result))
try:
    gdb.execute("kill", to_string=True)
except Exception:
    pass
gdb.execute("quit")
'''


def _clip(text: str, limit: int = 3000) -> str:
    return text if len(text) <= limit else text[:limit] + "\n…[đã cắt bớt]"


def run_crash(code: str, stdin: str) -> dict:
    if len(code.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise RunnerError("Code vượt quá giới hạn 100 KB.")
    if not code.strip():
        return {"status": "error", "kind": "missing", "message": "Chưa có code."}
    if len(stdin) > MAX_INPUT_CHARS:
        raise RunnerError("Input quá dài (tối đa 20.000 ký tự).")
    mode = sandbox.resolve_mode(need_gdb=True)
    if mode is None:
        raise DockerUnavailable("Chế độ chạy trực tiếp cần Linux có g++, gdb và prlimit.")
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="cpp-flow-crash-") as temp:
        work = Path(temp)
        root = "/work" if mode == "docker" else str(work)
        (work / "main.cpp").write_text(code, encoding="utf-8")
        (work / "input.txt").write_text(stdin, encoding="utf-8")
        script = (TRACER.replace("__OUT_JSON__", f"{root}/trace.json")
                  .replace("__STDIN__", f"{root}/input.txt")
                  .replace("__STDOUT__", f"{root}/stdout.txt")
                  .replace("__STDERR__", f"{root}/stderr.txt"))
        (work / "trace.py").write_text(script, encoding="utf-8")
        try:
            failure = _trace_docker(work) if mode == "docker" else _trace_direct(work)
        except sandbox.Busy as exc:
            raise RunnerError(str(exc)) from exc
        if failure:
            return failure
        result = _build(work)
    result["durationMs"] = round((time.perf_counter() - started) * 1000)
    return result


def _trace_direct(work: Path) -> dict | None:
    with sandbox.run_slot():
        status, timed_out = sandbox.run_limited(
            ["g++", *FLAGS, *sandbox.pch_include_args("crash"), "main.cpp", "-o", "prog"],
            cwd=work, timeout=COMPILE_TIMEOUT_SECONDS, cpu=COMPILE_TIMEOUT_SECONDS,
            mem_mb=1024, stdout_path=work / "compile.txt",
        )
        if timed_out:
            return {"status": "error", "kind": "compile", "message": "Biên dịch quá thời gian cho phép."}
        if status != 0:
            return {"status": "error", "kind": "compile",
                    "message": _clip(sandbox.read_text(work / "compile.txt", 40_000).strip(), 4000)}
        _, timed_out = sandbox.run_limited(
            ["gdb", "--batch", "--nx", "-x", str(work / "trace.py"), str(work / "prog")],
            cwd=work, timeout=GDB_TIMEOUT_SECONDS, cpu=GDB_TIMEOUT_SECONDS, mem_mb=1536,
            stdout_path=work / "gdb.log", fsize_mb=20, nproc=128,
        )
        (work / "timedout").write_text("1" if timed_out else "0")
    return None


def _trace_docker(work: Path) -> dict | None:
    if not sandbox.docker_available():
        raise DockerUnavailable(
            "Không kết nối được Docker. Hãy mở Docker Desktop và chạy: docker build -f Dockerfile.debug -t cpp-flow-debug:local ."
        )
    script = f"""
set +e
cd /work
timeout {COMPILE_TIMEOUT_SECONDS}s g++ {' '.join(FLAGS)} -I/opt/pch-crash main.cpp -o prog 2> compile.txt
echo $? > cstatus
if [ "$(cat cstatus)" = 0 ]; then
  timeout {GDB_TIMEOUT_SECONDS}s gdb --batch --nx -x /work/trace.py /work/prog > gdb.log 2>&1
  if [ $? = 124 ]; then echo 1 > timedout; else echo 0 > timedout; fi
fi
"""
    cmd = [
        "docker", "run", "--rm", "--network", "none",
        "--memory", "1g", "--memory-swap", "1g", "--cpus", "1", "--pids-limit", "64",
        "--read-only", "--security-opt", "no-new-privileges",
        "--security-opt", "seccomp=unconfined", "--cap-drop", "ALL", "--cap-add", "SYS_PTRACE",
        "--tmpfs", "/tmp:rw,exec,nosuid,size=96m",
        "-v", f"{work.resolve()}:/work:rw", "-w", "/work",
        DEBUG_IMAGE, "bash", "-c", script,
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=COMPILE_TIMEOUT_SECONDS + GDB_TIMEOUT_SECONDS + 20,
        )
    except subprocess.TimeoutExpired:
        return {"status": "error", "kind": "timeout_total", "message": "Quá thời gian chờ tổng thể."}
    except OSError as exc:
        raise RunnerError(f"Không thể gọi Docker: {exc}") from exc
    lowered = (proc.stderr or "").lower()
    if proc.returncode != 0 and ("unable to find image" in lowered or "pull access denied" in lowered):
        raise RunnerError("Chưa có image debugger. Chạy: docker build -f Dockerfile.debug -t cpp-flow-debug:local .")
    if proc.returncode != 0 and ("cannot connect to the docker daemon" in lowered
                                 or "dockerdesktoplinuxengine" in lowered):
        raise DockerUnavailable("Không kết nối được Docker Engine. Hãy mở Docker Desktop.")
    status_file = work / "cstatus"
    if status_file.exists() and status_file.read_text().strip() != "0":
        return {"status": "error", "kind": "compile",
                "message": _clip(sandbox.read_text(work / "compile.txt", 40_000).strip(), 4000)}
    return None


# --------------------------------------------------------------------------------------
# Phân loại
# --------------------------------------------------------------------------------------
UB_LOC = re.compile(r"main\.cpp:(\d+):\d+: runtime error: (.*)")
RANGE_CHECK = re.compile(r"__n \(which is (-?\d+)\) >= this->size\(\) \(which is (\d+)\)")
OVF_BIN = re.compile(r"main\.cpp:(\d+):\d+: runtime error: signed integer overflow: (-?\d+) ([+\-*]) (-?\d+) cannot be represented in type '([^']+)'")
OVF_NEG = re.compile(r"main\.cpp:(\d+):\d+: runtime error: negation of (-?\d+) cannot be represented in type '([^']+)'")
TYPE_BITS = {"int": 32, "long": 64, "long int": 64, "long long": 64, "long long int": 64, "short": 16,
             "signed char": 8, "short int": 16}
UB_INDEX = re.compile(r"index (-?\d+) out of bounds for type '([^']+)'")


def _overflow_info(stderr: str, snap: dict | None) -> dict | None:
    found = OVF_BIN.search(stderr)
    neg = None if found else OVF_NEG.search(stderr)
    if not found and not neg:
        return None
    count = len(OVF_BIN.findall(stderr)) + len(OVF_NEG.findall(stderr))
    if found:
        line, a, op, b, typ = int(found.group(1)), found.group(2), found.group(3), found.group(4), found.group(5)
    else:
        line, a, op, b, typ = int(neg.group(1)), neg.group(2), "neg", None, neg.group(3)
    info = {"line": line, "a": a, "op": op, "b": b, "type": typ, "bits": TYPE_BITS.get(typ, 32), "places": count}
    if snap:
        info.update({k: snap.get(k) for k in ("func", "locals", "lineText")})
    return info


def _build(work: Path) -> dict:
    stderr = sandbox.read_text(work / "stderr.txt", 20_000)
    stdout_head = sandbox.read_text(work / "stdout.txt", 400)
    timed_out = (work / "timedout").exists() and (work / "timedout").read_text().strip() == "1"
    try:
        data = json.loads((work / "trace.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        if timed_out:
            return {"status": "ok", "kind": "timeout", "stderr": _clip(stderr, 1500), "stdout": stdout_head}
        log = sandbox.read_text(work / "gdb.log", 1500)
        raise RunnerError("Không theo dõi được chương trình bằng GDB." + (f" Chi tiết: {_clip(log, 500)}" if log else ""))

    base = {
        "status": "ok", "stderr": _clip(stderr, 2500), "stdout": stdout_head,
        "signal": data.get("signal"), "line": data.get("line"), "func": data.get("func"),
        "lineText": data.get("lineText", ""), "stack": data.get("stack", []),
        "locals": data.get("locals", []), "userFrames": data.get("userFrames", 0),
        "totalFrames": data.get("totalFrames", 0), "capped": bool(data.get("capped")),
    }
    overflow = _overflow_info(stderr, data.get("overflow"))
    if not data.get("stopped"):
        base["exitCode"] = data.get("exitCode")
        if overflow:
            base.update(kind="overflow", detail=overflow, line=overflow["line"], func=overflow.get("func"),
                        lineText=overflow.get("lineText") or "", locals=overflow.get("locals") or [])
        else:
            base["kind"] = "no_crash"
        return base
    base["overflow"] = overflow

    analysis = data.get("analysis") or {}
    sig = data.get("signal")
    ub = UB_LOC.search(stderr)
    if ub:
        base["line"] = base["line"] or int(ub.group(1))
    base["ubMessage"] = ub.group(2).strip() if ub else None

    low = stderr.lower()
    # 1) Tràn stack: SEGV với rất nhiều tầng gọi hàm
    if sig == "SIGSEGV" and (data.get("userFrames", 0) >= 1500 or data.get("capped")):
        names: dict[str, int] = {}
        for frame in base["stack"]:
            names[frame["func"]] = names.get(frame["func"], 0) + 1
        base.update(kind="stack_overflow", func=max(names, key=names.get) if names else base["func"])
        return base

    # 2) Chia cho 0
    if sig == "SIGFPE" or (ub and "division by zero" in ub.group(2)) or "division by zero" in low:
        base["kind"] = "div0"
        base["detail"] = analysis.get("div0")
        return base

    # 3) Thiếu return
    if ub and "without returning a value" in ub.group(2):
        base["kind"] = "noreturn"
        return base

    # 4) Chỉ số ngoài biên (assert STL, .at(), UBSan hoặc phân tích dòng)
    oob = analysis.get("oob")
    m_range = RANGE_CHECK.search(stderr)
    m_ub = UB_INDEX.search(stderr)
    if oob is None and m_range:
        oob = {"base": "?", "index": "?", "indexValue": int(m_range.group(1)), "size": int(m_range.group(2)),
               "containerKind": "vector", "values": [], "type": "", "expr": ""}
    if oob is None and m_ub:
        size = re.search(r"\[(\d+)\]", m_ub.group(2))
        oob = {"base": "?", "index": "?", "indexValue": int(m_ub.group(1)), "size": int(size.group(1)) if size else 0,
               "containerKind": "array", "values": [], "type": m_ub.group(2), "expr": ""}
    assertion = "assertion" in low and ("__n <" in low or "size()" in low or "__pos" in low or "!this->empty()" in low)
    if oob is not None and (sig in ("SIGSEGV", "SIGABRT") or m_ub or m_range):
        base.update(kind="oob", detail=oob)
        return base
    if assertion:
        base["kind"] = "stl_assert"
        base["message"] = _clip(stderr.strip().split("\n")[0], 400)
        return base

    # 5) Con trỏ null
    fault = data.get("faultAddr")
    nulled = analysis.get("null")
    if (ub and "null pointer" in ub.group(2)) or (sig == "SIGSEGV" and fault is not None and fault < 4096 and nulled):
        base.update(kind="null", detail=nulled, faultAddr=fault)
        return base
    if sig == "SIGSEGV" and fault is not None and fault < 4096:
        base.update(kind="null", detail=None, faultAddr=fault)
        return base

    # 6) Ngoại lệ C++
    exc = re.search(r"terminate called after throwing an instance of '([^']+)'(?:\s*what\(\):\s*(.*))?", stderr)
    if exc:
        kind_name = exc.group(1)
        if "bad_alloc" in kind_name or "length_error" in kind_name:
            base.update(kind="alloc", detail=analysis.get("alloc"), exception=kind_name,
                        message=(exc.group(2) or "").strip())
            return base
        base.update(kind="exception", exception=kind_name, message=(exc.group(2) or "").strip())
        return base

    # 7) Lỗi bộ nhớ do glibc
    if any(s in low for s in ("free(): ", "double free", "munmap_chunk", "malloc(): ", "corrupted",
                              "stack smashing")):
        base["kind"] = "memory"
        base["message"] = _clip(stderr.strip().split("\n")[0], 300)
        return base

    # 8) Con trỏ/chỉ số lạ gây SEGV
    if sig == "SIGSEGV":
        base.update(kind="segv", faultAddr=fault, detail=analysis.get("null"))
        return base
    if sig == "SIGABRT":
        base["kind"] = "abort"
        base["message"] = _clip(stderr.strip().split("\n")[0] if stderr.strip() else "", 300)
        return base
    base["kind"] = "signal"
    return base
