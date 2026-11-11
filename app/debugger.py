"""Source-level C++ debugger sessions backed by GDB/MI inside an isolated Docker container."""
from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from app import sandbox

DEBUG_IMAGE = "cpp-flow-debug:local"
MAX_SOURCE_BYTES = 100_000
MAX_INPUT_BYTES = 20_000
COMPILE_TIMEOUT_SECONDS = 30
COMMAND_TIMEOUT_SECONDS = 30
SESSION_TTL_SECONDS = 600
MAX_ARRAY_ITEMS = 100
MAX_OUTPUT_BYTES = 20_000
USER_SOURCE_NAME = "main.cpp"

# Giới hạn tài nguyên cho tiến trình GDB (và chương trình được debug) ở chế độ chạy trực tiếp.
GDB_CPU_SECONDS = 300
GDB_MEM_MB = 1536
COMPILE_MEM_MB = 2048

# Thư viện nhỏ nạp vào chương trình khi debug để stdout không bị đệm (buffer),
# nhờ đó output hiện ra ngay sau từng bước thay vì chỉ hiện lúc chương trình kết thúc.
UNBUFFER_SOURCE = (
    "#include <stdio.h>\n"
    "__attribute__((constructor)) static void cpp_flow_unbuffer(void) {\n"
    "    setvbuf(stdout, NULL, _IONBF, 0);\n"
    "}\n"
)

class DebuggerError(RuntimeError):
    pass


class DockerUnavailable(DebuggerError):
    pass


def _decode_mi_string(value: str) -> str:
    try:
        return json.loads('"' + value + '"')
    except Exception:
        return value.replace(r"\n", "\n").replace(r'\"', '"').replace(r"\\", "\\")


def _mi_fields(fragment: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for match in re.finditer(r'([A-Za-z_][A-Za-z0-9_-]*)="((?:\\.|[^"\\])*)"', fragment):
        fields[match.group(1)] = _decode_mi_string(match.group(2))
    return fields


def _mi_attr(fragment: str, key: str) -> str | None:
    """Read a quoted MI attribute without confusing escaped quotes/commas."""
    match = re.search(
        rf'(?:^|,){re.escape(key)}="((?:\\.|[^"\\])*)"', fragment
    )
    return _decode_mi_string(match.group(1)) if match else None


def _mi_top_level_records(text: str) -> list[str]:
    """Split comma-separated GDB/MI records, respecting nested braces and strings."""
    records: list[str] = []
    depth = 0
    start: int | None = None
    in_string = False
    escaped = False
    for pos, char in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            if depth == 0:
                start = pos + 1
            depth += 1
        elif char == "}" and depth:
            depth -= 1
            if depth == 0 and start is not None:
                records.append(text[start:pos])
                start = None
    return records


def _mi_bracket_content(text: str, key: str) -> str | None:
    """Extract key=[...] while respecting nested arrays and quoted strings."""
    match = re.search(rf'(?:^|,){re.escape(key)}=\[', text)
    if not match:
        return None
    start = match.end()
    depth = 1
    in_string = False
    escaped = False
    for pos in range(start, len(text)):
        char = text[pos]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return text[start:pos]
    return None


class DebugSession:
    def __init__(self, code: str, stdin: str):
        if len(code.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise DebuggerError("Mã nguồn vượt quá giới hạn 100 KB.")
        if len(stdin.encode("utf-8")) > MAX_INPUT_BYTES:
            raise DebuggerError("Input vượt quá giới hạn 20 KB.")
        self._mode = sandbox.resolve_mode(need_gdb=True)
        if self._mode is None:
            raise DockerUnavailable("Chế độ chạy trực tiếp cần Linux có g++, gdb và prlimit.")
        if self._mode == "docker" and shutil.which("docker") is None:
            raise DockerUnavailable("Không tìm thấy Docker CLI. Hãy mở Docker Desktop rồi thử lại.")

        self.id = str(uuid.uuid4())
        self.created_at = time.time()
        self.last_activity = self.created_at
        self._lock = threading.RLock()
        self._lines: queue.Queue[str] = queue.Queue()
        self._token = 0
        self._stop_event: str | None = None
        self._finished = False
        self._stopped = False
        self._stdout = ""
        self._stderr = ""
        self._last_error = ""
        self._last_good_snapshot: dict[str, Any] | None = None
        # Danh sách biến toàn cục không đổi giữa các bước; truy vấn GDB tốn ~0,8 giây
        # nên chỉ làm một lần cho mỗi phiên.
        self._global_symbol_cache: set[str] | None = None
        self._source_code = code
        self._temp_dir = tempfile.mkdtemp(prefix="cpp-flow-debug-")
        work = Path(self._temp_dir)
        # Trong Docker thư mục này được gắn vào /work; chạy trực tiếp thì dùng chính đường dẫn thật.
        self._wd = "/work" if self._mode == "docker" else self._temp_dir
        wd = self._wd
        (work / "main.cpp").write_text(code, encoding="utf-8")
        (work / "input.txt").write_text(stdin, encoding="utf-8")
        (work / "unbuf.c").write_text(UNBUFFER_SOURCE, encoding="utf-8")

        try:
            if self._mode == "direct":
                self._compile_direct(work)
                gdb_cmd = sandbox.limited(
                    ["gdb", "--quiet", "--nx", "--interpreter=mi2", f"{wd}/main"],
                    cpu=GDB_CPU_SECONDS, mem_mb=GDB_MEM_MB, fsize_mb=2, nproc=128,
                )
                self._proc = subprocess.Popen(
                    gdb_cmd, cwd=self._temp_dir, env=sandbox.clean_env(self._temp_dir),
                    start_new_session=True,
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                    errors="replace", bufsize=1,
                )
            else:
                # Biên dịch code người dùng; sau đó biên dịch thư viện unbuf.so
                # (nếu thư viện lỗi thì bỏ qua, không làm hỏng phiên debug).
                compile_script = (
                    "g++ -std=c++20 -g3 -O0 -fno-omit-frame-pointer -Wall -Wextra "
                    "/work/main.cpp -o /work/main "
                    "&& { gcc -shared -fPIC -O0 /work/unbuf.c -o /work/unbuf.so "
                    "2>/dev/null || true; }"
                )
                compile_cmd = [
                    "docker", "run", "--rm", "--network", "none",
                    "--memory", "1g", "--memory-swap", "1g", "--cpus", "1",
                    "--pids-limit", "64", "--read-only",
                    "--security-opt", "no-new-privileges",
                    "--tmpfs", "/tmp:rw,exec,nosuid,size=96m",
                    "-v", f"{self._temp_dir}:/work:rw", "-w", "/work",
                    DEBUG_IMAGE, "bash", "-c", compile_script,
                ]
                compiled = subprocess.run(
                    compile_cmd, capture_output=True, text=True,
                    timeout=COMPILE_TIMEOUT_SECONDS, encoding="utf-8", errors="replace",
                )
                self._stderr = compiled.stderr[-20_000:]
                if compiled.returncode != 0:
                    detail = self._stderr or compiled.stdout[-20_000:] or "Biên dịch thất bại, hãy kiểm tra code C++."
                    lowered = detail.lower()
                    if "cannot connect to the docker daemon" in lowered or "is the docker daemon running" in lowered or "dockerdesktoplinuxengine" in lowered:
                        raise DockerUnavailable("Không kết nối được Docker Engine. Hãy mở Docker Desktop và đợi engine chạy xong.")
                    if "pull access denied" in lowered or "unable to find image" in lowered or "manifest unknown" in lowered:
                        raise DebuggerError("Chưa có image debugger. Mở PowerShell trong thư mục cpp-flow và chạy: docker build -f Dockerfile.debug -t cpp-flow-debug:local .")
                    raise DebuggerError(detail)

                run_cmd = [
                    "docker", "run", "--rm", "-i", "--network", "none",
                    "--memory", "1g", "--memory-swap", "1g", "--cpus", "1",
                    "--pids-limit", "64", "--read-only",
                    "--security-opt", "no-new-privileges",
                    "--security-opt", "seccomp=unconfined", "--cap-drop", "ALL",
                    "--cap-add", "SYS_PTRACE",
                    "--tmpfs", "/tmp:rw,exec,nosuid,size=96m",
                    "-v", f"{self._temp_dir}:/work:rw", "-w", "/work",
                    DEBUG_IMAGE, "gdb", "--quiet", "--nx", "--interpreter=mi2", "/work/main",
                ]
                self._proc = subprocess.Popen(
                    run_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1,
                )
            self._reader = threading.Thread(target=self._read_output, daemon=True)
            self._reader.start()
            self._mi_command("-gdb-set pagination off")
            self._mi_command("-gdb-set confirm off")
            self._mi_command("-enable-pretty-printing")
            if self._mode == "direct":
                # Trong container hạn chế, GDB không được phép tắt ASLR; tránh lời cảnh báo thừa.
                self._mi_command("-gdb-set disable-randomization off")
            if (work / "unbuf.so").exists():
                self._mi_command(f"-gdb-set environment LD_PRELOAD {wd}/unbuf.so")
            breakpoint_result, _ = self._mi_command("-break-insert main")

            if "^error" in breakpoint_result or "^done" not in breakpoint_result:
                raise DebuggerError(
                    "GDB không đặt được breakpoint tại main: " + breakpoint_result[-1000:]
                )
            # Output của chương trình được ghi vào file để đọc lại sau mỗi bước.
            # (Nếu để chung stdout với GDB thì output lẫn vào luồng MI và bị mất.)
            result, stop = self._mi_command(
                '-interpreter-exec console '
                f'"run < {wd}/input.txt > {wd}/output.txt 2>&1"',
                wait_stop=True
            )

            if "^error" in result:
                hint = ""
                if "ptrace" in result.lower() or "operation not permitted" in result.lower():
                    hint = (" (Máy chủ này không cho phép debug bằng GDB. "
                            "Bạn vẫn có thể dùng nút Chạy C++.)")
                raise DebuggerError(
                    "GDB không thể bắt đầu chương trình: " + result[-1000:] + hint
                )

            # Lưu sự kiện dừng để initial_snapshot() đọc được dòng và frame.
            self._stop_event = stop
            self._stopped = stop is not None

            self._update_status()
        except subprocess.TimeoutExpired as exc:
            self.close()
            raise DebuggerError("Biên dịch quá thời gian cho phép (30 giây).") from exc
        except FileNotFoundError as exc:
            self.close()
            raise DockerUnavailable("Không chạy được Docker. Hãy kiểm tra Docker Desktop.") from exc
        except Exception:
            self.close()
            raise

    def _compile_direct(self, work: Path) -> None:
        """Biên dịch trực tiếp (không Docker) với giới hạn tài nguyên."""
        try:
            with sandbox.run_slot():
                status, timed_out = sandbox.run_limited(
                    ["g++", "-std=c++20", "-g3", "-O0", "-fno-omit-frame-pointer",
                     "-Wall", "-Wextra", "main.cpp", "-o", "main"],
                    cwd=work, timeout=COMPILE_TIMEOUT_SECONDS,
                    cpu=COMPILE_TIMEOUT_SECONDS, mem_mb=COMPILE_MEM_MB,
                    stdout_path=work / "compile.txt",
                )
                output = sandbox.read_text(work / "compile.txt", 20_000)
                if timed_out:
                    raise DebuggerError("Biên dịch quá thời gian cho phép (30 giây).")
                self._stderr = output
                if status != 0:
                    raise DebuggerError(output.strip() or "Biên dịch thất bại, hãy kiểm tra code C++.")
                # Thư viện unbuf.so là tùy chọn: lỗi thì bỏ qua, không làm hỏng phiên debug.
                sandbox.run_limited(
                    ["gcc", "-shared", "-fPIC", "-O0", "unbuf.c", "-o", "unbuf.so"],
                    cwd=work, timeout=10, cpu=10, mem_mb=512,
                    stdout_path=work / "unbuf.txt",
                )
        except sandbox.Busy as exc:
            raise DebuggerError(str(exc)) from exc

    def _read_output(self) -> None:
        assert self._proc.stdout is not None
        for raw in self._proc.stdout:
            line = raw.rstrip("\r\n")
            if line.startswith("@\""):
                try:
                    self._stdout += json.loads(line[1:])
                except Exception:
                    self._stdout += line[2:]
            self._lines.put(line)
        self._lines.put("__GDB_EOF__")

    def _mi_command(self, command: str, wait_stop: bool = False) -> tuple[str, str | None]:
        if self._proc.poll() is not None:
            raise DebuggerError("Tiến trình GDB đã dừng bất ngờ.")
        self._token += 1
        token = self._token
        assert self._proc.stdin is not None
        self._proc.stdin.write(f"{token}{command}\n")
        self._proc.stdin.flush()
        result = ""
        deadline = time.monotonic() + COMMAND_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            try:
                line = self._lines.get(timeout=max(0.05, deadline - time.monotonic()))
            except queue.Empty:
                break
            if line == "__GDB_EOF__":
                raise DebuggerError("GDB đã kết thúc trước khi trả kết quả.")
            if line.startswith("*stopped,"):
                self._stop_event = line
                self._stopped = True
            if re.match(rf"^{token}\^", line):
                result = line
                break
        if not result:
            raise DebuggerError("GDB phản hồi quá chậm. Hãy dừng phiên debug và thử lại.")
        if wait_stop and "^running" in result:
            stop = self._wait_for_stop()
            return result, stop
        if wait_stop and self._stop_event:
            stop, self._stop_event = self._stop_event, None
            return result, stop
        return result, None

    def _wait_for_stop(self) -> str:
        deadline = time.monotonic() + COMMAND_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if self._stop_event:
                stop, self._stop_event = self._stop_event, None
                self._stopped = True
                return stop
            try:
                line = self._lines.get(timeout=max(0.05, deadline - time.monotonic()))
            except queue.Empty:
                break
            if line == "__GDB_EOF__":
                raise DebuggerError("GDB đã kết thúc trước khi chương trình dừng.")
            if line.startswith("*stopped,"):
                self._stopped = True
                return line
        # Interrupt a source step that appears to be stuck inside a long-running call.
        try:
            self._token += 1
            token = self._token
            assert self._proc.stdin is not None
            self._proc.stdin.write(f"{token}-exec-interrupt --all\n")
            self._proc.stdin.flush()
            interrupt_deadline = time.monotonic() + 2
            while time.monotonic() < interrupt_deadline:
                line = self._lines.get(timeout=0.2)
                if line.startswith("*stopped,"):
                    self._stopped = True
                    self._stop_event = line
                    return line
        except Exception:
            pass
        raise DebuggerError("Bước thực thi mất quá nhiều thời gian. Hãy thử Tiến bước hoặc Dừng.")

    def _update_status(self) -> None:
        if self._stop_event and ('reason="exited-normally"' in self._stop_event or 'reason="exited"' in self._stop_event):
            self._finished = True
        if self._stop_event and 'reason="exited-signalled"' in self._stop_event:
            self._finished = True
            self._last_error = "Chương trình kết thúc do tín hiệu: " + self._stop_event

    def _read_program_output(self) -> str:
        """Đọc output (stdout + stderr) mà chương trình đã ghi ra cho tới hiện tại."""
        try:
            with open(Path(self._temp_dir) / "output.txt", "rb") as handle:
                data = handle.read(MAX_OUTPUT_BYTES + 1)
        except OSError:
            return self._stdout
        text = data[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")
        if len(data) > MAX_OUTPUT_BYTES:
            text += "\n...[output bị cắt bớt]"
        return text

    @staticmethod
    def _frame_fields(event: str) -> dict[str, str]:
        """Đọc func/file/fullname/line của frame trong dòng *stopped.

        Không dùng regex `frame=\\{[^}]*\\}` vì `args=[{name=...}]` chứa dấu `}`
        làm frame bị cắt cụt (mất file/line) với hàm có tham số.
        """
        start = event.find("frame={")
        if start == -1:
            return {}
        text = event[start + len("frame={"):]
        fields: dict[str, str] = {}
        for key in ("func", "file", "fullname", "line"):
            value = _mi_attr(text, key)
            if value is not None:
                fields[key] = value
        return fields

    @staticmethod
    def _is_exit_event(event: str | None) -> bool:
        return bool(event) and 'reason="exited' in event

    def _is_user_frame(self, event: str) -> bool:
        fields = self._frame_fields(event)
        name = (fields.get("fullname") or fields.get("file") or "").replace("\\", "/")
        return name.rsplit("/", 1)[-1] == USER_SOURCE_NAME

    def _stack_has_user_frame(self) -> bool:
        result, _ = self._mi_command("-stack-list-frames")
        return any(
            (_mi_fields(item.group(1)).get("file") or "").rsplit("/", 1)[-1] == USER_SOURCE_NAME
            for item in re.finditer(r"frame=\{([^}]*)\}", result)
        )

    def _leave_non_user_code(self, stop: str | None) -> str | None:
        """Nếu bước vừa rồi rơi vào code không phải của người dùng (STL, libc...),
        tự động thoát ra để debugger luôn dừng ở một dòng trong main.cpp."""
        for _ in range(8):
            if not stop or self._is_exit_event(stop) or self._is_user_frame(stop):
                return stop
            if 'reason="signal-received"' in stop:
                return stop  # giữ nguyên vị trí lỗi để người dùng thấy
            command = "-exec-finish" if self._stack_has_user_frame() else "-exec-continue"
            self._stop_event = None
            result, new_stop = self._mi_command(command, wait_stop=True)
            if "^error" in result or new_stop is None:
                return stop
            stop = new_stop
            self._stopped = True
        return stop

    def _snapshot(self, stop_line: str | None = None) -> dict[str, Any]:
        event = stop_line or self._stop_event or ""

        if 'reason="exited-normally"' in event or 'reason="exited"' in event:
            self._finished = True

        if 'reason="exited-signalled"' in event:
            self._finished = True
            self._last_error = "Chương trình kết thúc do tín hiệu hoặc lỗi runtime."

        if self._finished and self._last_good_snapshot is not None:
            finished_view = dict(self._last_good_snapshot)
            finished_view.update({
                "stdout": self._read_program_output(),
                "finished": True,
                "reason": (
                    "exited-normally"
                    if not self._last_error
                    else "exited-signalled"
                ),
                "error": self._last_error,
            })
            return finished_view

        frame = self._frame_fields(event)

        line_number = (
            int(frame["line"])
            if frame.get("line", "").isdigit()
            else None
        )

        variables: list[dict[str, Any]] = []
        stack: list[dict[str, Any]] = []
        seen_names: set[str] = set()

        if not self._finished:

            # ---------------------------------------------------------
            # Helpers nội bộ: đọc dữ liệu GDB/MI và quản lý biến.
            # ---------------------------------------------------------

            def add_variable(name: str, value: str = "") -> None:
                name = name.strip()
                if not name or name in seen_names:
                    return

                variables.append({
                    "name": name,
                    "value": value,
                    "type": "",
                    "children": [],
                    "expandable": False,
                })
                seen_names.add(name)

            def evaluate(expression: str) -> str | None:
                result, _ = self._mi_command(
                    f"-data-evaluate-expression {expression}"
                )

                if "^error" in result or "^done" not in result:
                    return None

                match = re.search(
                    r'\bvalue="((?:\\.|[^"\\])*)"',
                    result,
                )

                if not match:
                    return None

                return _decode_mi_string(match.group(1))
 
            def read_children(
                var_name: str,
                count: int,
                depth: int = 0,
            ) -> list[dict[str, Any]]:
                """Đọc tối đa 100 phần tử đầu để snapshot không quá nặng."""
                if depth >= 2 or count <= 0:
                    return []

                limit = min(count, MAX_ARRAY_ITEMS)

                # Khoảng [from, to) của GDB/MI không gồm chỉ số `to`,
                # nên phải truyền `limit` (không phải `limit - 1`).
                result, _ = self._mi_command(
                    f"-var-list-children --all-values "
                    f"{var_name} 0 {limit}"
                )

                if "^error" in result or "^done" not in result:
                    print(f"[DEBUG ARRAY READ] {result[-1000:]}", flush=True)
                    return []

                content = _mi_bracket_content(result, "children")
                if content is None:
                    return []

                children: list[dict[str, Any]] = []

                for record in _mi_top_level_records(content)[:limit]:
                    child_name = _mi_attr(record, "name")
                    child_exp = _mi_attr(record, "exp")
                    child_value = _mi_attr(record, "value") or ""
                    child_type = _mi_attr(record, "type") or ""
                    count_text = _mi_attr(record, "numchild") or "0"

                    try:
                        child_count = int(count_text)
                    except (ValueError, TypeError):
                        child_count = 0

                    if not child_name:
                        continue

                    children.append({
                        "name": child_exp or child_name,
                        "value": child_value,
                        "type": child_type,
                        "children": [],
                        "expandable": child_count > 0,
                        "numChildren": child_count,
                        "varObject": child_name,
                    })

                return children

            # ---------------------------------------------------------
            # 1. Biến cục bộ và tham số của frame hiện tại.
            # ---------------------------------------------------------
            try:
                # Luôn chọn frame 0 trước khi đọc locals. Nếu GDB đang giữ
                # frame khác, danh sách biến có thể rỗng hoặc không đúng scope.
                frame_result, _ = self._mi_command("-stack-select-frame 0")
                if "^error" in frame_result:
                    print(f"[DEBUG FRAME SELECT] {frame_result[-500:]}", flush=True)

                result, _ = self._mi_command(
                    "-stack-list-variables --all-values"
                )
                content = _mi_bracket_content(result, "variables")
                parsed_locals: list[tuple[str, str]] = []

                if content is not None:
                    for record in _mi_top_level_records(content):
                        name = _mi_attr(record, "name")
                        value = _mi_attr(record, "value")
                        if name:
                            parsed_locals.append((name, value or ""))

                # Một số phiên bản GDB trả variables=[] khi yêu cầu values,
                # dù frame vẫn có biến. Thử lại chế độ chỉ lấy tên biến.
                if not parsed_locals:
                    names_result, _ = self._mi_command(
                        "-stack-list-variables --no-values"
                    )
                    names_content = _mi_bracket_content(names_result, "variables")
                    if names_content is not None:
                        for record in _mi_top_level_records(names_content):
                            name = _mi_attr(record, "name")
                            if name:
                                parsed_locals.append((name, ""))

                for name, value in parsed_locals:
                    add_variable(name, value)

            except Exception as exc:
                print(f"[DEBUG LOCALS] {exc}", flush=True)

            # ---------------------------------------------------------
            # 2. Thu thập biến toàn cục từ symbol của GDB.
            # ---------------------------------------------------------
            symbol_names: set[str] = set()

            try:
                if self._global_symbol_cache is not None:
                    symbol_names |= self._global_symbol_cache
                    result = ""
                else:
                    result, _ = self._mi_command(
                        "-symbol-info-variables"
                    )

                if result and "^error" not in result:
                    # Phân tích từng nhóm symbols=[...].
                    # GDB trả filename="...",fullname="...",symbols=[...]
                    # nên cho phép các trường khác (fullname) nằm giữa.
                    for match in re.finditer(
                        r'filename="((?:\\.|[^"\\])*)"'
                        r'(?:\s*,\s*[A-Za-z_-]+="(?:\\.|[^"\\])*")*'
                        r'\s*,\s*symbols=\[',
                        result,
                    ):
                        filename = _decode_mi_string(
                            match.group(1)
                        ).replace("\\", "/")

                        # Chỉ lấy symbol từ file mã nguồn đang debug.
                        if filename.rsplit("/", 1)[-1] != "main.cpp":
                            continue

                        start = match.end() - 1
                        depth = 0
                        in_string = False
                        escaped = False
                        end = None

                        for pos in range(start, len(result)):
                            char = result[pos]

                            if in_string:
                                if escaped:
                                    escaped = False
                                elif char == "\\":
                                    escaped = True
                                elif char == '"':
                                    in_string = False
                                continue

                            if char == '"':
                                in_string = True
                            elif char == "[":
                                depth += 1
                            elif char == "]":
                                depth -= 1
                                if depth == 0:
                                    end = pos
                                    break

                        if end is None:
                            continue

                        symbols_content = result[start + 1:end]

                        # Các phiên bản GDB có thể bọc symbol trong một
                        # record có field name hoặc thêm lớp {symbols=[...]}.
                        # Đọc tất cả record name="..." trong riêng nhóm file này,
                        # thay vì phụ thuộc vào đúng một cấp lồng nhau.
                        for name_match in re.finditer(
                            r'\bname="((?:\\.|[^"\\])*)"',
                            symbols_content,
                        ):
                            name = _decode_mi_string(name_match.group(1))
                            if name and re.fullmatch(
                                r"[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*",
                                name,
                            ):
                                symbol_names.add(name)

            except Exception as exc:
                print(f"[DEBUG GLOBAL SYMBOLS] {exc}", flush=True)

            if self._global_symbol_cache is None:
                self._global_symbol_cache = set(symbol_names)

            # Bổ sung từ source nếu symbol GDB không lấy đủ.
            # Đây chỉ là fallback cho khai báo toàn cục đơn giản.
            try:
                depth = 0
                top_level_lines: list[str] = []

                for source_line in self._source_code.splitlines():
                    cleaned = source_line.strip()

                    if (
                        depth == 0
                        and cleaned
                        and not cleaned.startswith(
                            ("#", "//", "/*", "*")
                        )
                    ):
                        top_level_lines.append(cleaned)

                    # Theo dõi dấu ngoặc để bỏ qua nội dung hàm/class.
                    in_string = False
                    in_char = False
                    escaped = False

                    for char in source_line:
                        if escaped:
                            escaped = False
                            continue

                        if char == "\\" and (in_string or in_char):
                            escaped = True
                        elif char == '"' and not in_char:
                            in_string = not in_string
                        elif char == "'" and not in_string:
                            in_char = not in_char
                        elif not in_string and not in_char:
                            if char == "{":
                                depth += 1
                            elif char == "}":
                                depth = max(0, depth - 1)

                for declaration in top_level_lines:
                    if not declaration.endswith(";"):
                        continue

                    if any(token in declaration for token in (
                        "using ",
                        "namespace ",
                        "typedef ",
                        "return ",
                    )):
                        continue

                    before = declaration[:-1].strip()

                    if "(" in before or ")" in before:
                        continue

                    # Nhận dạng khai báo biến đơn giản, kể cả mảng.
                    match = re.match(
                        r"(?:const\s+|static\s+|constexpr\s+|"
                        r"volatile\s+|unsigned\s+|signed\s+|"
                        r"long\s+|short\s+|int\s+|char\s+|"
                        r"bool\s+|float\s+|double\s+|auto\s+|"
                        r"std::[\w:]+(?:\s*<[^;]+>)?\s+|"
                        r"[A-Za-z_]\w*(?:\s*<[^;]+>)?\s+)+"
                        r"(.+)$",
                        before,
                    )

                    if not match:
                        continue

                    for part in match.group(1).split(","):
                        item = re.match(
                            r"\s*([A-Za-z_]\w*)\s*"
                            r"(?:\[[^\]]*\])?\s*(?:=.*)?$",
                            part,
                        )

                        if item:
                            symbol_names.add(item.group(1))

            except Exception as exc:
                print(f"[DEBUG SOURCE GLOBALS] {exc}", flush=True)

            # Đưa biến toàn cục vào danh sách; tránh trùng biến cục bộ.
            for name in sorted(symbol_names):
                if name in seen_names:
                    continue

                value = evaluate(name)
                if value is not None:
                    add_variable(name, value)

            # ---------------------------------------------------------
            # 3. Lấy kiểu và phần tử con cho mảng/vector.
            # ---------------------------------------------------------
            for variable in variables:
                expression = variable["name"]
                created_var: str | None = None

                try:
                    # Không JSON-quote tên biến C++.
                    created, _ = self._mi_command(
                        f"-var-create - * {expression}"
                    )

                    if "^error" in created or "^done" not in created:
                        continue

                    var_name = _mi_attr(created, "name")
                    created_var = var_name
                    var_type = _mi_attr(created, "type") or ""
                    count_text = _mi_attr(created, "numchild") or "0"

                    try:
                        count = int(count_text)
                    except (ValueError, TypeError):
                        count = 0

                    variable["type"] = var_type
                    variable["numChildren"] = count
                    variable["expandable"] = count > 0
                    variable["arrayLike"] = (
                        "[" in var_type
                        or "std::vector<" in var_type
                        or var_type.startswith("vector<")
                        or "std::array<" in var_type
                    )

                    is_vector = (
                        "vector<" in var_type
                        or "std::array<" in var_type
                    )

                    if not var_name or (count <= 0 and not is_vector):
                        continue

                    # Với vector, pretty-printer của GDB thường báo numchild=0
                    # cho tới khi liệt kê phần tử, nên vẫn thử đọc các phần tử đầu.
                    children = read_children(
                        var_name,
                        count if count > 0 else MAX_ARRAY_ITEMS,
                    )
                    variable["children"] = children

                    if is_vector:
                        size_value = evaluate(f"{expression}.size()")
                        try:
                            vector_size = (
                                int(size_value)
                                if size_value is not None
                                else len(children)
                            )
                        except (ValueError, TypeError):
                            vector_size = len(children)

                        if vector_size < 0 or vector_size > 10_000_000:
                            # Vector chưa được khởi tạo (kích thước rác): không hiển thị phần tử.
                            children = []
                            variable["children"] = children
                            vector_size = 0
                        elif not any(
                            str(child.get("name", "")).startswith("[")
                            for child in children
                        ):
                            # Pretty-printer không trả về [0], [1], ...:
                            # đọc từng phần tử qua operator[].
                            vector_children = []
                            for index in range(min(vector_size, MAX_ARRAY_ITEMS)):
                                element_value = evaluate(f"{expression}[{index}]")
                                if element_value is not None:
                                    vector_children.append({
                                        "name": f"[{index}]",
                                        "value": element_value,
                                        "type": "",
                                        "children": [],
                                        "expandable": False,
                                    })
                            children = vector_children
                            variable["children"] = children

                        count = vector_size
                        variable["numChildren"] = vector_size
                        variable["expandable"] = vector_size > 0
                        variable["arrayLike"] = True

                    if children:
                        values = [child["value"] for child in children]
                        variable["value"] = (
                            "[" + ", ".join(values)
                            + (", …" if count > len(children) else "")
                            + "]"
                        )

                    if count > len(children):
                        variable["childrenTruncated"] = True

                except Exception as exc:
                    print(
                        f"[DEBUG VAR TREE] "
                        f"{expression}: {exc}",
                        flush=True,
                    )
                finally:
                    # Xóa biến tạm của GDB để không tích lũy qua mỗi bước.
                    if created_var:
                        try:
                            self._mi_command(f"-var-delete {created_var}")
                        except Exception:
                            pass

            # ---------------------------------------------------------
            # 4. Call stack.
            # ---------------------------------------------------------
            try:
                result, _ = self._mi_command(
                    "-stack-list-frames"
                )

                for item in re.finditer(
                    r"frame=\{([^}]*)\}",
                    result,
                ):
                    fields = _mi_fields(item.group(1))

                    stack.append({
                        "function": fields.get("func", "?"),
                        "file": fields.get("file", ""),
                        "line": (
                            int(fields["line"])
                            if fields.get("line", "").isdigit()
                            else None
                        ),
                    })

            except Exception as exc:
                print(f"[DEBUG STACK] {exc}", flush=True)

        reason_match = re.search(
            r'reason="([^"]+)"',
            event,
        )
        reason = (
            reason_match.group(1)
            if reason_match
            else ("đang dừng" if self._stopped else "sẵn sàng")
        )

        snapshot = {
            "sessionId": self.id,
            "line": line_number,
            "function": frame.get("func", ""),
            "file": frame.get("file", "main.cpp"),
            "variables": variables,
            "stack": stack,
            "stdout": self._read_program_output(),
            "finished": self._finished,
            "reason": reason,
            "error": self._last_error,
        }

        if not self._finished and line_number is not None:
            self._last_good_snapshot = dict(snapshot)

        return snapshot

    def step(self, into: bool = False) -> dict[str, Any]:
        with self._lock:
            self.last_activity = time.time()
            if self._finished:
                return self._snapshot()
            if not self._stopped:
                raise DebuggerError("Chương trình chưa ở trạng thái dừng an toàn.")
            command = "-exec-step" if into else "-exec-next"
            self._stop_event = None
            result, stop = self._mi_command(command, wait_stop=True)
            if "^error" in result:
                # GDB can return this when a source-level step is requested at
                # the end of main (there is no further source range to step to).
                # Treat it as a completed program rather than exposing an MI error.
                if "Cannot find bounds of current function" in result:
                    self._finished = True
                    self._stopped = True
                    self._stop_event = None
                    self._last_error = ""
                    self._finished = True
                    if self._last_good_snapshot is not None:
                        finished_view = dict(self._last_good_snapshot)
                        finished_view.update({"stdout": self._read_program_output(), "finished": True, "reason": "exited-normally", "error": ""})
                        return finished_view
                    return self._snapshot(None)
                raise DebuggerError(result[-1000:])
            # Tránh dừng lại trong ruột STL/libc: thoát ra tới dòng kế tiếp của main.cpp.
            stop = self._leave_non_user_code(stop)
            self._stop_event = stop
            self._stopped = True
            return self._snapshot(stop)

    def close(self) -> None:
        proc = getattr(self, "_proc", None)
        if proc is not None:
            try:
                if proc.poll() is None and proc.stdin:
                    proc.stdin.write("-gdb-exit\n")
                    proc.stdin.flush()
                    proc.wait(timeout=1.5)
            except Exception:
                try:
                    proc.terminate()
                    proc.wait(timeout=1)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
        if proc is not None and getattr(self, "_mode", "docker") == "direct":
            # Đảm bảo không còn tiến trình mồ côi (chương trình đang debug và con của nó).
            sandbox.kill_group(proc)
        path = getattr(self, "_temp_dir", None)
        if path:
            shutil.rmtree(path, ignore_errors=True)

    def initial_snapshot(self) -> dict[str, Any]:
        with self._lock:
            self.last_activity = time.time()
            event, self._stop_event = self._stop_event, None
            result = self._snapshot(event)
            self._stop_event = event
            return result


_SESSIONS: dict[str, DebugSession] = {}
_SESSIONS_LOCK = threading.RLock()


def _cleanup_expired() -> None:
    cutoff = time.time() - SESSION_TTL_SECONDS
    expired: list[DebugSession] = []
    with _SESSIONS_LOCK:
        for session_id, session in list(_SESSIONS.items()):
            if session.last_activity < cutoff:
                expired.append(_SESSIONS.pop(session_id))
    for session in expired:
        session.close()


def start_debug(code: str, stdin: str) -> dict[str, Any]:
    _cleanup_expired()
    if sandbox.resolve_mode(need_gdb=True) == "direct":
        with _SESSIONS_LOCK:
            active = len(_SESSIONS)
        if active >= sandbox.MAX_DEBUG_SESSIONS:
            raise DebuggerError(
                "Máy chủ đang có quá nhiều phiên debug. Hãy thử lại sau ít phút."
            )
    session = DebugSession(code, stdin)
    with _SESSIONS_LOCK:
        _SESSIONS[session.id] = session
    snapshot = session.initial_snapshot()
    if snapshot.get("finished"):
        # Keep the finished snapshot readable until the user stops or TTL expires.
        pass
    return snapshot


def step_debug(session_id: str, into: bool = False) -> dict[str, Any]:
    _cleanup_expired()
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)
    if not session:
        raise KeyError("Phiên debug không tồn tại hoặc đã hết hạn. Hãy bấm Bắt đầu debug lại.")
    return session.step(into=into)


def stop_debug(session_id: str) -> dict[str, Any]:
    with _SESSIONS_LOCK:
        session = _SESSIONS.pop(session_id, None)
    if session:
        session.close()
    return {"ok": True, "stopped": bool(session)}
