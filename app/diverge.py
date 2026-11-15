"""Tìm chỗ hai chương trình bắt đầu "lệch" nhau.

Cho code của bạn, code đúng và MỘT input, web chạy từng dòng cả hai chương trình dưới GDB,
ghi lại lịch sử giá trị của mọi biến (theo tên hàm + tên biến), rồi so sánh các biến có
tên giống nhau ở hai bên. Biến nào có lịch sử giá trị tách ra sớm nhất chính là chỗ nghi vấn:
dòng làm giá trị đó khác đi ở mỗi bên.

Giới hạn: chỉ so sánh được các biến TRÙNG TÊN ở hai code, và chỉ theo dõi tối đa vài nghìn
bước, nên dùng với test nhỏ.
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
MAX_STEPS = 6000
MAX_TRACE_SECONDS = 12
GDB_TIMEOUT_SECONDS = 40
NAMES = ("mine", "brute")
LABELS = {"mine": "Code của bạn", "brute": "Code đúng"}
DEBUG_FLAGS = ["-std=c++20", "-g3", "-O0", "-fno-omit-frame-pointer", "-Wall", "-Wextra"]

TRACER = r'''
import gdb, json, re, time

SRC = "main.cpp"
OUT_JSON = "__OUT_JSON__"
STDIN_FILE = "__STDIN__"
STDOUT_FILE = "__STDOUT__"
MAX_STEPS = __MAX_STEPS__
MAX_SECONDS = __MAX_SECONDS__

for cmd in ("set pagination off", "set confirm off", "set print elements 40",
            "set print repeats 12", "set max-value-size unlimited",
            "set disable-randomization off", "skip -rfu ^std::",
            "skip -rfu ^__gnu_cxx::", "skip -rfu ^__cxx11::"):
    try:
        gdb.execute(cmd, to_string=True)
    except Exception:
        pass

HEX = re.compile(r"0x[0-9a-fA-F]{5,}")
CAP = re.compile(r", capacity \d+")


def norm(text):
    text = HEX.sub("<ptr>", text)
    text = CAP.sub("", text)
    return text if len(text) <= 160 else text[:160] + "…"


events = []          # [bước, hàm, tên biến, giá trị, dòng gây ra thay đổi]
last = {}
confirmed = set()
info = {"steps": 0, "truncated": False, "signal": None, "exited": False}

try:
    gdb.execute("break main", to_string=True)
    gdb.execute("run < %s > %s 2>/dev/null" % (STDIN_FILE, STDOUT_FILE), to_string=True)
except Exception as exc:
    info["error"] = str(exc)

started = time.time()
prev_line = None
step = 0
while "error" not in info and step < MAX_STEPS:
    if time.time() - started > MAX_SECONDS:
        info["truncated"] = True
        break
    try:
        frame = gdb.selected_frame()
        sal = frame.find_sal()
    except Exception:
        info["exited"] = True
        break
    line = sal.line
    in_user = sal.symtab is not None and sal.symtab.filename.endswith(SRC)
    if in_user:
        func = frame.name() or "?"
        try:
            block = frame.block()
        except Exception:
            block = None
        seen_names = set()
        entries = []
        b = block
        while b is not None and not b.is_global and not b.is_static:
            for sym in b:
                if (sym.is_variable or sym.is_argument) and sym.name not in seen_names:
                    seen_names.add(sym.name)
                    entries.append((func, sym, True))
            if b.function is not None:
                break
            b = b.superblock
        try:
            static_block = block.static_block if block is not None else None
            if static_block is not None:
                for sym in static_block:
                    if sym.is_variable and sym.symtab is not None and sym.symtab.filename.endswith(SRC):
                        entries.append(("(toàn cục)", sym, False))
        except Exception:
            pass
        for owner, sym, is_local in entries:
            name = sym.name
            if name.startswith("__"):
                continue
            key = (owner, name)
            if is_local and not sym.is_argument:
                if sym.line > line:
                    continue
                if sym.line == line:
                    continue          # dòng khai báo chưa chạy xong: giá trị còn là rác
                confirmed.add(key)
            try:
                value = norm(str(sym.value(frame) if is_local else sym.value()))
            except Exception:
                continue
            if last.get(key) != value:
                last[key] = value
                if len(events) < 40000:
                    events.append([step, owner, name, value, prev_line if prev_line else line])
    prev_line = line if in_user else prev_line
    try:
        out = gdb.execute("step", to_string=True)
    except Exception:
        info["exited"] = True
        break
    step += 1
    if "Program received signal" in out or "Program terminated" in out:
        m = re.search(r"Program (?:received|terminated with) signal (\w+)", out)
        info["signal"] = m.group(1) if m else "?"
        try:
            sal2 = gdb.selected_frame().find_sal()
            info["signalLine"] = sal2.line
        except Exception:
            pass
        break
    if "exited" in out:
        info["exited"] = True
        break

if step >= MAX_STEPS:
    info["truncated"] = True
info["steps"] = step
with open(OUT_JSON, "w") as handle:
    handle.write(json.dumps({"info": info, "events": events}))
try:
    gdb.execute("kill", to_string=True)
except Exception:
    pass
gdb.execute("quit")
'''


def _clip(text: str, limit: int = 3000) -> str:
    return text if len(text) <= limit else text[:limit] + "\n…[đã cắt bớt]"


def run_diverge(mine: str, brute: str, stdin: str) -> dict:
    sources = {"mine": mine, "brute": brute}
    for name, text in sources.items():
        if len(text.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise RunnerError(f"{LABELS[name]} vượt quá giới hạn 100 KB.")
        if not text.strip():
            return {"status": "error", "kind": "missing", "which": name,
                    "message": f"Chưa có {LABELS[name].lower()}."}
    if len(stdin) > MAX_INPUT_CHARS:
        raise RunnerError("Input quá dài (tối đa 20.000 ký tự). Hãy dùng test nhỏ hơn.")

    mode = sandbox.resolve_mode(need_gdb=True)
    if mode is None:
        raise DockerUnavailable("Chế độ chạy trực tiếp cần Linux có g++, gdb và prlimit.")
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="cpp-flow-diverge-") as temp:
        work = Path(temp)
        root = "/work" if mode == "docker" else str(work)
        for name in NAMES:
            folder = work / name
            folder.mkdir()
            (folder / "main.cpp").write_text(sources[name], encoding="utf-8")
            (folder / "input.txt").write_text(stdin, encoding="utf-8")
            script = (TRACER.replace("__OUT_JSON__", f"{root}/{name}/trace.json")
                      .replace("__STDIN__", f"{root}/{name}/input.txt")
                      .replace("__STDOUT__", f"{root}/{name}/stdout.txt")
                      .replace("__MAX_STEPS__", str(MAX_STEPS))
                      .replace("__MAX_SECONDS__", str(MAX_TRACE_SECONDS)))
            (folder / "trace.py").write_text(script, encoding="utf-8")
        try:
            if mode == "docker":
                failure = _trace_docker(work)
            else:
                failure = _trace_direct(work)
        except sandbox.Busy as exc:
            raise RunnerError(str(exc)) from exc
        if failure:
            return failure
        result = _compare(work)
    result["durationMs"] = round((time.perf_counter() - started) * 1000)
    return result


def _compile_failure(name: str, text: str) -> dict:
    return {"status": "error", "kind": "compile", "which": name, "message": _clip(text.strip(), 4000)}


def _trace_direct(work: Path) -> dict | None:
    with sandbox.run_slot():
        for name in NAMES:
            folder = work / name
            status, timed_out = sandbox.run_limited(
                ["g++", *DEBUG_FLAGS, *sandbox.pch_include_args(), "main.cpp", "-o", "prog"],
                cwd=folder, timeout=COMPILE_TIMEOUT_SECONDS, cpu=COMPILE_TIMEOUT_SECONDS,
                mem_mb=1024, stdout_path=folder / "compile.txt",
            )
            output = sandbox.read_text(folder / "compile.txt", 40_000)
            if timed_out:
                return {"status": "error", "kind": "compile", "which": name,
                        "message": f"Biên dịch {LABELS[name].lower()} quá thời gian cho phép."}
            if status != 0:
                return _compile_failure(name, output)
        for name in NAMES:
            folder = work / name
            sandbox.run_limited(
                ["gdb", "--batch", "--nx", "-x", str(folder / "trace.py"), str(folder / "prog")],
                cwd=folder, timeout=GDB_TIMEOUT_SECONDS, cpu=GDB_TIMEOUT_SECONDS, mem_mb=1536,
                stdout_path=folder / "gdb.log", fsize_mb=20, nproc=128,
            )
    return None


def _trace_docker(work: Path) -> dict | None:
    if not sandbox.docker_available():
        raise DockerUnavailable(
            "Không kết nối được Docker. Hãy mở Docker Desktop và chạy: docker build -f Dockerfile.debug -t cpp-flow-debug:local ."
        )
    script = f"""
set +e
for n in mine brute; do
  cd /work/$n
  timeout {COMPILE_TIMEOUT_SECONDS}s g++ {' '.join(DEBUG_FLAGS)} -I/opt/pch main.cpp -o prog 2> compile.txt
  echo $? > cstatus
  if [ "$(cat cstatus)" = 0 ]; then
    timeout {GDB_TIMEOUT_SECONDS}s gdb --batch --nx -x /work/$n/trace.py /work/$n/prog > gdb.log 2>&1
  fi
done
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
            timeout=2 * (COMPILE_TIMEOUT_SECONDS + GDB_TIMEOUT_SECONDS) + 20,
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
    for name in NAMES:
        status_file = work / name / "cstatus"
        if status_file.exists() and status_file.read_text().strip() != "0":
            return _compile_failure(name, sandbox.read_text(work / name / "compile.txt", 40_000))
    return None


# --------------------------------------------------------------------------------------
# So sánh
# --------------------------------------------------------------------------------------
def _load(folder: Path) -> dict:
    try:
        data = json.loads((folder / "trace.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log = sandbox.read_text(folder / "gdb.log", 3000) if (folder / "gdb.log").exists() else ""
        raise RunnerError("Không theo dõi được chương trình bằng GDB." + (f" Chi tiết: {_clip(log, 600)}" if log else ""))
    return data


def _histories(events: list) -> dict[tuple[str, str], list[tuple[str, int, int]]]:
    """key (hàm, tên) -> [(giá trị, dòng gây ra, bước), ...] theo thứ tự thời gian."""
    out: dict[tuple[str, str], list[tuple[str, int, int]]] = {}
    for step, owner, name, value, line in events:
        out.setdefault((owner, name), []).append((value, int(line or 0), int(step)))
    return out


def _compare(work: Path) -> dict:
    data = {name: _load(work / name) for name in NAMES}
    hist = {name: _histories(data[name]["events"]) for name in NAMES}
    info = {name: data[name]["info"] for name in NAMES}
    for name in NAMES:
        if info[name].get("error"):
            return {"status": "error", "kind": "trace", "which": name,
                    "message": f"GDB không chạy được {LABELS[name].lower()}: {info[name]['error']}"}

    common = sorted(set(hist["mine"]) & set(hist["brute"]))
    divergences = []
    for key in common:
        a, b = hist["mine"][key], hist["brute"][key]
        limit = min(len(a), len(b))
        index = next((i for i in range(limit) if a[i][0] != b[i][0]), None)
        kind = "different"
        if index is None:
            # Một bên chỉ là phần đầu của bên kia: chỉ coi là lệch nếu bên ngắn đã chạy xong hẳn.
            if len(a) == len(b):
                continue
            shorter = "mine" if len(a) < len(b) else "brute"
            if info[shorter].get("truncated"):
                continue
            index, kind = limit, "extra"

        def side(h: list, i: int) -> dict:
            item = h[i] if i < len(h) else None
            return {
                "value": item[0] if item else None,
                "line": item[1] if item else None,
                "step": item[2] if item else None,
                "next": [x[0] for x in h[i + 1:i + 3]],
            }

        divergences.append({
            "func": key[0], "name": key[1], "index": index, "kind": kind,
            "before": a[index - 1][0] if index > 0 else None,
            "mine": side(a, index), "brute": side(b, index),
            "_order": (a[index][2] if index < len(a) else 10**9) + (b[index][2] if index < len(b) else 10**9),
        })
    divergences.sort(key=lambda d: d["_order"])
    for item in divergences:
        item.pop("_order")

    out_a = (work / "mine" / "stdout.txt").read_text(errors="replace") if (work / "mine" / "stdout.txt").exists() else ""
    out_b = (work / "brute" / "stdout.txt").read_text(errors="replace") if (work / "brute" / "stdout.txt").exists() else ""
    lines_a = [ln.rstrip() for ln in out_a.rstrip().split("\n")]
    lines_b = [ln.rstrip() for ln in out_b.rstrip().split("\n")]
    output = {"same": out_a.split() == out_b.split()}
    if not output["same"]:
        for i in range(max(len(lines_a), len(lines_b))):
            la = lines_a[i] if i < len(lines_a) else None
            lb = lines_b[i] if i < len(lines_b) else None
            if la != lb:
                output.update({"line": i + 1, "mine": _clip(la or "", 300) if la is not None else None,
                               "brute": _clip(lb or "", 300) if lb is not None else None})
                break

    return {
        "status": "ok",
        "commonVars": len(common),
        "divergences": divergences[:6],
        "totalDivergent": len(divergences),
        "steps": {name: info[name]["steps"] for name in NAMES},
        "truncated": {name: bool(info[name].get("truncated")) for name in NAMES},
        "signal": {name: info[name].get("signal") for name in NAMES},
        "signalLine": {name: info[name].get("signalLine") for name in NAMES},
        "output": output,
    }
