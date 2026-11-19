const $ = (id) => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Không tìm thấy phần tử HTML có id="${id}"`);
  }
  return element;
};

const cppHighlight = (() => {
  const keywords = new Set([
    "alignas", "alignof", "asm", "auto", "break", "case",
    "catch", "class", "const", "constexpr", "continue",
    "default", "delete", "do", "else", "enum", "explicit",
    "export", "extern", "false", "for", "friend", "goto",
    "if", "inline", "namespace", "new", "noexcept", "nullptr",
    "operator", "private", "protected", "public", "register",
    "return", "sizeof", "static", "struct", "switch", "template",
    "this", "throw", "true", "try", "typedef", "typename",
    "union", "using", "virtual", "volatile", "while"
  ]);

  const types = new Set([
    "bool", "char", "char8_t", "char16_t", "char32_t",
    "double", "float", "int", "long", "short", "signed",
    "unsigned", "void", "wchar_t", "string", "vector",
    "pair", "map", "set", "unordered_map", "unordered_set",
    "size_t", "int8_t", "int16_t", "int32_t", "int64_t"
  ]);

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  function span(type, text) {
    return `<span class="cpp-${type}">${escapeHtml(text)}</span>`;
  }

  function highlight(source) {
    let result = "";
    let i = 0;

    while (i < source.length) {
      const rest = source.slice(i);
      let match;

      // Preprocessor: #include, #define, ...
      if (
        source[i] === "#" &&
        (i === 0 || source[i - 1] === "\n") &&
        (match = /^[ \t]*#\s*[a-zA-Z_]\w*/.exec(rest))
      ) {
        result += span("preprocessor", match[0]);
        i += match[0].length;
        continue;
      }

      // Comments
      if (rest.startsWith("//")) {
        match = /^\/\/[^\n]*/.exec(rest)[0];
        result += span("comment", match);
        i += match.length;
        continue;
      }

      if (rest.startsWith("/*")) {
        const end = source.indexOf("*/", i + 2);
        const length = end === -1 ? source.length - i : end + 2 - i;
        match = source.slice(i, i + length);
        result += span("comment", match);
        i += length;
        continue;
      }

      // String and character literals
      if (source[i] === '"' || source[i] === "'") {
        const quote = source[i];
        let j = i + 1;

        while (j < source.length) {
          if (source[j] === "\\") {
            j += 2;
            continue;
          }
          if (source[j] === quote) {
            j++;
            break;
          }
          j++;
        }

        match = source.slice(i, j);
        result += span("string", match);
        i = j;
        continue;
      }

      // Numbers
      if (
        (match = /^(?:0[xX][\da-fA-F']+|0[bB][01']+|\d[\d'.]*(?:[eEpP][+-]?\d+)?)(?:ULL|LLU|LL|UL|LU|U|L|F)?\b/i.exec(rest))
      ) {
        result += span("number", match[0]);
        i += match[0].length;
        continue;
      }

      // Identifiers and keywords
      if ((match = /^[a-zA-Z_]\w*/.exec(rest))) {
        const word = match[0];
        const next = source.slice(i + word.length).trimStart();

        if (keywords.has(word)) {
          result += span("keyword", word);
        } else if (types.has(word) || /^[A-Z][A-Z0-9_]*$/.test(word)) {
          result += span(
            /^[A-Z][A-Z0-9_]*$/.test(word) ? "constant" : "type",
            word
          );
        } else if (next.startsWith("(")) {
          result += span("function", word);
        } else {
          result += escapeHtml(word);
        }

        i += word.length;
        continue;
      }

      // Operators
      if ((match = /^(?:<<=|>>=|->\*|<=>|::|->|&&|\|\||==|!=|<=|>=|\+\+|--|\+=|-=|\*=|\/=|%=|<<|>>|&=|\|=|\^=)/.exec(rest))) {
        result += span("operator", match[0]);
        i += match[0].length;
        continue;
      }

      result += escapeHtml(source[i]);
      i++;
    }

    // Keep the editor's final blank line visible.
    return result + "\n";
  }

  return {highlight};
})();

let renderedLineCount = 0;

function updateCodeHighlight() {
  const editor = $("code");
  const highlight = $("code-highlight");
  if (!editor || !highlight) return;

  highlight.innerHTML = cppHighlight.highlight(editor.value);
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;

  // Cột số dòng bên trái ô soạn code (chỉ dựng lại khi số dòng thay đổi).
  const lineCount = editor.value.split("\n").length;
  if (lineCount !== renderedLineCount) {
    renderedLineCount = lineCount;
    $("line-numbers").textContent = Array.from({length: lineCount}, (_, i) => i + 1).join("\n");
  }
  $("line-numbers").scrollTop = editor.scrollTop;
}

$("code").addEventListener("input", updateCodeHighlight);

$("code").addEventListener("scroll", () => {
  const highlight = $("code-highlight");
  highlight.scrollTop = $("code").scrollTop;
  highlight.scrollLeft = $("code").scrollLeft;
  $("line-numbers").scrollTop = $("code").scrollTop;
});

const examples = {
  normal: `#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;

    int sum = 0;
    for (int i = 1; i <= n; i++) {
        sum += i;
    }

    cout << "Sum = " << sum << '\\n';
    return 0;
}`,
  graph: `#include <iostream>
#include <vector>
using namespace std;

// Ví dụ đồ thị: danh sách kề.
// Chế độ trực quan hóa BFS/DFS sẽ được bổ sung ở giai đoạn sau.
int main() {
    int n = 4;
    vector<vector<int>> adj(n + 1);
    adj[1] = {2, 3};
    adj[2] = {1, 4};
    adj[3] = {1};
    adj[4] = {2};

    for (int u = 1; u <= n; ++u) {
        cout << u << ": ";
        for (int v : adj[u]) cout << v << ' ';
        cout << '\\n';
    }
    return 0;
}`,
  tree: `#include <iostream>
#include <vector>
using namespace std;

// Ví dụ mảng lưu Segment Tree.
// Trực quan hóa cây và thao tác query/update sẽ được bổ sung sau.
int main() {
    vector<int> tree = {0, 10, 4, 6, 1, 3, 2, 4};
    for (int i = 1; i < (int)tree.size(); ++i) {
        cout << "tree[" << i << "] = " << tree[i] << '\\n';
    }
    return 0;
}`
};

// Input mặc định cho từng ví dụ (ví dụ "normal" cần đọc n từ cin).
const exampleInputs = {
  normal: "5",
  graph: "",
  tree: ""
};

function updateLineCount() {
  $("line-count").textContent = `${$("code").value.split("\n").length} dòng`;
}

let currentMode = "normal";
$("code").value = examples.normal;
updateCodeHighlight();
updateLineCount();
$("code").addEventListener("input", updateLineCount);

// Phím Tab chèn 4 dấu cách thay vì nhảy focus sang phần tử khác.
$("code").addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  event.preventDefault();
  const editor = event.target;
  editor.setRangeText("    ", editor.selectionStart, editor.selectionEnd, "end");
  editor.dispatchEvent(new Event("input", {bubbles: true}));
});

// Ô chọn "Mẫu code": nạp ví dụ Mặc định / Đồ thị / Cây (hiện vẫn là code C++ thông thường).
$("example-select").addEventListener("change", () => {
  currentMode = $("example-select").value;
  $("code").value = examples[currentMode];
  updateCodeHighlight();
  updateLineCount();
  if (typeof markDebugSourceChanged === "function") markDebugSourceChanged();
  $("stdin").value = exampleInputs[currentMode];
  clearOutput();
});

$("reset-code").addEventListener("click", () => {
  $("code").value = examples[currentMode];
  updateCodeHighlight();
  updateLineCount();
  if (typeof markDebugSourceChanged === "function") markDebugSourceChanged();
  $("stdin").value = exampleInputs[currentMode];
});

// Chuyển giữa chế độ "Chạy" và "Debug": mỗi lúc chỉ hiện một chế độ.
function setView(view) {
  const previousView = $("workspace").dataset.view;
  if (view === "forum") { forumEnter(); }
  else if (previousView !== "stress" && view === "stress") enterStress();
  else if (previousView === "stress" && view !== "stress") leaveStress();
  const isForum = view === "forum";
  if (!isForum) $("workspace").dataset.view = view;
  $("workspace").hidden = isForum;
  $("forum").hidden = !isForum;
  $("share-code").hidden = isForum;
  document.querySelectorAll(".hide-in-stress").forEach((element) => { element.hidden = view === "stress" || isForum; });
  document.querySelectorAll(".mode-btn").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  // Rời chế độ Debug thì dừng tự chạy (phiên debug vẫn giữ nguyên, quay lại là tiếp tục được).
  if (view !== "debug" && typeof stopDebugTimer === "function") stopDebugTimer();
}
document.querySelectorAll(".mode-btn").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

function formatMs(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return "—";
  ms = Number(ms);
  if (ms < 1) return "<1 ms";
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// Hiện thời gian chạy THẬT của chương trình (thời gian CPU), tách khỏi thời gian biên dịch và độ trễ mạng.
// Máy chủ miễn phí rất yếu nên tổng thời gian có thể lớn hơn nhiều so với thời gian chương trình thật sự chạy.
function showDuration(data) {
  const el = $("duration");
  if (typeof data.runMs === "number") {
    el.textContent = `Thời gian chạy: ${formatMs(data.runMs)}`;
    const parts = [`Thời gian CPU của chương trình: ${formatMs(data.runMs)} (con số này không bị máy chủ chậm làm sai lệch).`];
    if (typeof data.wallMs === "number") parts.push(`Thời gian đồng hồ khi chạy: ${formatMs(data.wallMs)}.`);
    if (data.cached) parts.push("Bỏ qua biên dịch (dùng lại bản đã biên dịch).");
    else if (typeof data.compileMs === "number") parts.push(`Biên dịch: ${formatMs(data.compileMs)}.`);
    parts.push(`Tổng cả biên dịch và xử lý: ${formatMs(data.durationMs)}.`);
    el.title = parts.join("\n");
  } else {
    // Lỗi biên dịch hoặc máy chủ cũ chưa báo thời gian chạy riêng.
    el.textContent = data.kind === "compile" ? `Biên dịch: ${formatMs(data.durationMs)}` : `Tổng thời gian: ${formatMs(data.durationMs ?? 0)}`;
    el.title = "";
  }
}

let lastRun = {code: "", input: ""};
let crashButtonLabel = "Giải thích vì sao lỗi";

function resetCrashBox() {
  $("crash-box").hidden = true;
  $("crash-box").textContent = "";
  $("explain-crash").hidden = true;
  $("explain-crash").disabled = false;
  $("explain-crash").textContent = crashButtonLabel;
}

function clearOutput() {
  resetCrashBox();
  $("stdout").textContent = "Kết quả chương trình sẽ xuất hiện ở đây.";
  $("stdout").classList.remove("empty");
  $("stderr").textContent = "Chưa có lỗi.";
  $("stderr").classList.add("empty");
  $("result-badge").textContent = "Chưa chạy";
  $("result-badge").className = "result-badge neutral";
  $("exit-code").textContent = "Exit code: —";
  $("duration").textContent = "Thời gian chạy: —";
  $("duration").title = "";
  $("run-state").textContent = "Chưa chạy";
}
$("clear-output").addEventListener("click", clearOutput);

async function checkHealth() {
  const badge = $("backend-status");
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("Backend chưa sẵn sàng");
    const info = await response.json();
    let modeLabel = info.runner === "docker" ? "Docker" : "Chạy trực tiếp";
    if (info.remote) modeLabel = "Docker (máy chạy từ xa)";
    else if (info.remoteConfigured && info.runner !== "docker") modeLabel = "Chạy trực tiếp (máy Docker đang tắt)";
    if (info.ready === false) {
      badge.innerHTML = info.runner === "docker"
        ? '<span style="color:var(--red)">●</span> Docker chưa bật — hãy mở Docker Desktop'
        : '<span style="color:var(--red)">●</span> Máy chủ chưa chạy được C++';
    } else {
      badge.innerHTML = `<span class="status-dot"></span> ${modeLabel}`;
    }
  } catch {
    badge.innerHTML = '<span style="color:var(--red)">●</span> Không kết nối được backend';
  }
}

$("run").addEventListener("click", async () => {
  const code = $("code").value;
  if (!code.trim()) {
    $("stderr").textContent = "Hãy nhập code C++ trước khi chạy.";
    $("stderr").classList.remove("empty");
    $("result-badge").textContent = "Thiếu code";
    $("result-badge").className = "result-badge error";
    return;
  }

  $("run").disabled = true;
  $("run-label").textContent = "Đang chạy…";
  $("run-state").textContent = "Đang biên dịch / chạy";
  $("result-badge").textContent = "Đang xử lý";
  $("result-badge").className = "result-badge neutral";
  $("stdout").textContent = "";
  $("stderr").textContent = "";
  $("stdout").classList.remove("empty");
  $("stderr").classList.remove("empty");

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({code, input: $("stdin").value, mode: currentMode})
    });
    const data = await response.json();
    $("stdout").textContent = data.stdout || "(không có output)";
    $("stderr").textContent = data.stderr || (data.status === "success" ? "Không có lỗi." : "Có lỗi nhưng không có thông báo chi tiết.");
    $("stderr").classList.toggle("empty", !data.stderr);
    $("result-badge").textContent = data.status === "success" ? "Thành công" : "Có lỗi";
    $("result-badge").className = `result-badge ${data.status === "success" ? "success" : "error"}`;
    $("run-state").textContent = data.status === "success" ? "Chạy hoàn tất" : "Cần kiểm tra";
    $("exit-code").textContent = `Exit code: ${data.exitCode ?? "—"}`;
    showDuration(data);
    resetCrashBox();
    lastRun = {code, input: $("stdin").value};
    // Có nút cả khi chạy "thành công": nhiều lỗi (vượt mảng...) không crash mà chỉ làm kết quả sai.
    $("explain-crash").hidden = !["runtime", "ok"].includes(data.kind);
    crashButtonLabel = data.kind === "runtime" ? "Giải thích vì sao lỗi" : "Kiểm tra lỗi ngầm";
    $("explain-crash").textContent = crashButtonLabel;
  } catch (error) {
    $("stdout").textContent = "(không có output)";
    $("stderr").textContent = `Không gọi được API: ${error.message}`;
    $("result-badge").textContent = "Lỗi kết nối";
    $("result-badge").className = "result-badge error";
    $("run-state").textContent = "Lỗi kết nối";
  } finally {
    $("run").disabled = false;
    $("run-label").textContent = "Chạy C++";
  }
});

checkHealth();
// Cập nhật định kỳ để thấy ngay khi bật/tắt Docker.
setInterval(checkHealth, 15000);

// GDB source-level debugger. Normal /api/run remains separate and unchanged.
let debugSessionId = null;
let debugTimer = null;
let debugBusy = false;
let debugFinished = false;
let debugSpeed = 500;
let debugSourceCode = "";

// Bản ghi các bước debug để tua lại / phát lại / chia sẻ.
const REPLAY_MAX_FRAMES = 1500;
const replay = {frames: [], idx: -1, timer: null, viewOnly: false, code: "", input: "", recording: false, origin: ""};

function setDebugStatus(message, badge = null, badgeClass = null) {
  const statusElement = document.getElementById("debug-status");
  const badgeElement = document.getElementById("debug-badge");

  if (statusElement) {
    statusElement.textContent = message;
  }

  if (badgeElement && badge !== null) {
    badgeElement.textContent = badge;
  }

  if (badgeElement && badgeClass !== null) {
    badgeElement.className = `result-badge ${badgeClass}`;
  }
}

function setDebugButtons(active, finished = false) {
  $("debug-start").disabled = active && !finished;
  $("debug-pause").disabled = !active || finished;
  $("debug-pause").textContent = debugTimer === null ? "▶ Tiếp tục" : "Ⅱ Tạm dừng";
  $("debug-step").disabled = !active || finished || debugBusy;
  $("debug-into").disabled = !active || finished || debugBusy;
  $("debug-stop").disabled = !active;
  $("debug-speed").disabled = !active;
}

// Hiện khung mã nguồn đang chạy (thay cho ô soạn code) khi có phiên debug; về lại ô soạn code khi dừng.
function setDebugLive(live) {
  $("workspace").classList.toggle("debug-live", live);
}

// Kết thúc phiên debug hiện tại (nếu có) và trả giao diện về trạng thái chờ.
async function endDebugSession(message = "Đã dừng phiên debug.") {
  stopDebugTimer();
  const oldId = debugSessionId;
  debugSessionId = null;
  if (oldId) {
    try { await debugApi(`/api/debug/${oldId}/stop`); } catch {}
  }
  debugBusy = false;
  debugFinished = true;
  setDebugLive(false);
  setDebugStatus(message, "Đã dừng", "neutral");
  $("debug-line-label").textContent = "Dòng: —";
  $("debug-start").disabled = false;
  $("debug-pause").disabled = true;
  $("debug-step").disabled = true;
  $("debug-into").disabled = true;
  $("debug-stop").disabled = true;
  $("debug-speed").disabled = true;
  if (typeof replayRefresh === "function") replayRefresh();
}

function renderDebugSource(currentLine) {
  const lines = debugSourceCode.split("\n");
  const fragment = document.createDocumentFragment();
  lines.forEach((line, index) => {
    const row = document.createElement("span");
    row.className = `source-line${index + 1 === currentLine ? " active" : ""}`;
    row.dataset.line = String(index + 1);
    const number = document.createElement("span");
    number.className = "source-number";
    number.textContent = String(index + 1);
    const sourceText = document.createElement("span");
    sourceText.textContent = line || " ";
    row.append(number, sourceText);
    fragment.appendChild(row);
  });
  const source = $("debug-source");
  source.replaceChildren(fragment);
  const active = source.querySelector(".source-line.active");
  if (active) active.scrollIntoView({block: "nearest", behavior: "smooth"});
}

function renderDebugTable(containerId, rows, emptyText, columns) {
  const container = $(containerId);
  if (!rows || rows.length === 0) {
    container.className = "debug-table-empty";
    container.textContent = emptyText;
    return;
  }
  const table = document.createElement("table");
  table.className = "debug-table";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      td.textContent = row[column.key] ?? "—";
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  container.className = "";
  container.replaceChildren(table);
}

function isArrayVariable(variable) {
  if (variable.uninitialized) return false;
  const type = String(variable.type || "");
  return Boolean(variable.arrayLike)
    || type.includes("[")
    || type.includes("vector<")
    || type.includes("array<");
}

function renderDebugVariables(rows) {
  const container = $("debug-variables");
  const scalarRows = (rows || []).filter((variable) => !isArrayVariable(variable));

  if (scalarRows.length === 0) {
    container.className = "debug-table-empty";
    container.textContent = "Chưa có biến đơn nào ở frame hiện tại.";
    return;
  }

  const table = document.createElement("table");
  table.className = "debug-table";
  const thead = document.createElement("thead");
  const header = document.createElement("tr");
  ["Tên biến", "Kiểu", "Giá trị"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    header.appendChild(th);
  });
  thead.appendChild(header);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  scalarRows.forEach((variable) => {
    const tr = document.createElement("tr");
    const shown = variable.uninitialized ? "(chưa khởi tạo)" : (variable.value ?? "—");
    [variable.name ?? "—", variable.type || "—", shown].forEach((value, col) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      if (variable.uninitialized && col === 2) { td.style.opacity = ".5"; td.style.fontStyle = "italic"; }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.className = "";
  container.replaceChildren(table);
}

function renderDebugArrays(rows) {
  const container = $("debug-arrays");
  const arrays = (rows || []).filter(isArrayVariable);

  // Khung "Mảng & vector" chỉ hiện khi code thật sự có mảng hoặc vector.
  $("debug-arrays-panel").hidden = arrays.length === 0;
  $("debug-arrays-hint").hidden = arrays.length > 0;

  if (arrays.length === 0) {
    container.className = "debug-table-empty";
    container.textContent = "Chưa tìm thấy mảng hoặc vector tại trạng thái hiện tại.";
    return;
  }

  const fragment = document.createDocumentFragment();
  arrays.forEach((array) => {
    const card = document.createElement("div");
    card.style.cssText = "margin:0 0 14px;padding:10px;border:1px solid var(--border, #ddd);border-radius:8px;min-width:0;";

    const title = document.createElement("div");
    title.style.cssText = "font-weight:600;margin-bottom:4px;overflow-wrap:anywhere;";
    title.textContent = `${array.name}  ·  ${array.type || "mảng"}`;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.style.cssText = "font-size:12px;opacity:.75;margin-bottom:8px;";
    const total = Number(array.numChildren || 0);
    const loaded = Array.isArray(array.children) ? array.children.length : 0;
    meta.textContent = total > loaded
      ? `Đã tải ${loaded}/${total} phần tử (đang hiển thị đoạn đầu)`
      : `${loaded} phần tử`;
    card.appendChild(meta);

    const scroller = document.createElement("div");
    scroller.style.cssText = "max-width:100%;overflow-x:auto;overflow-y:hidden;";
    const table = document.createElement("table");
    table.className = "debug-table";
    table.style.cssText = "width:max-content;min-width:100%;border-collapse:collapse;";

    const isMatrix = (array.children || []).length > 0
      && array.children.every((c) => Array.isArray(c.children) && c.children.length > 0);
    const headRow = document.createElement("tr");
    const cols = isMatrix ? Math.max(...array.children.map((c) => c.children.length)) : 0;
    const heads = isMatrix
      ? ["", ...Array.from({length: cols}, (_, i) => `[${i}]`)]
      : ["Chỉ số", "Giá trị"];
    heads.forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    const thead = document.createElement("thead");
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    (array.children || []).forEach((child, index) => {
      const row = document.createElement("tr");
      const indexCell = document.createElement("td");
      indexCell.textContent = child.name || `[${index}]`;
      row.appendChild(indexCell);
      if (isMatrix) {
        child.children.forEach((cell) => {
          const td = document.createElement("td");
          td.textContent = cell.value ?? "—";
          td.style.whiteSpace = "nowrap";
          row.appendChild(td);
        });
      } else {
        const valueCell = document.createElement("td");
        valueCell.textContent = child.value || (child.type === "" ? "—" : "[]");
        valueCell.style.whiteSpace = "nowrap";
        row.appendChild(valueCell);
      }
      tbody.appendChild(row);
    });
    if (!(array.children || []).length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 2;
      cell.textContent = "(rỗng)";
      cell.style.opacity = ".6";
      row.appendChild(cell);
      tbody.appendChild(row);
    }
    if (total > loaded) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = isMatrix ? cols + 1 : 2;
      cell.textContent = `… còn ${total - loaded} phần tử chưa tải`;
      cell.style.opacity = ".7";
      row.appendChild(cell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    scroller.appendChild(table);
    card.appendChild(scroller);
    fragment.appendChild(card);
  });

  container.className = "";
  container.replaceChildren(fragment);
}

function drawFrame(data) {
  setDebugLive(true);
  renderDebugSource(data.line);
  $("debug-line-label").textContent = data.line ? `Dòng: ${data.line}` : "Dòng: —";
  renderDebugVariables(data.variables);
  renderDebugArrays(data.variables);
  renderDebugTable(
    "debug-stack",
    data.stack,
    "Chưa có lời gọi hàm.",
    [{key: "function"}, {key: "line"}]
  );
  $("debug-output").textContent = data.stdout || "(chưa có output)";
}

function renderDebugState(data) {
  if (!data || typeof data !== "object") {
    setDebugStatus("Backend không trả về trạng thái debug hợp lệ.", "Lỗi debug", "error");
    return;
  }
  debugFinished = Boolean(data.finished);
  drawFrame(data);
  recordFrame(data);
  if (data.finished) {
    stopDebugTimer();
    setDebugStatus(data.error || "Chương trình đã kết thúc.", "Hoàn tất", data.error ? "error" : "success");
    setDebugButtons(true, true);
    $("debug-pause").disabled = true;
  } else {
    const fn = data.function ? ` trong ${data.function}()` : "";
    if (data.error) {
      setDebugStatus(data.error, "Lỗi chạy", "error");
    } else {
      setDebugStatus(`Đang dừng${fn}${data.line ? ` tại dòng ${data.line}` : ""}.`, "Đang debug", "success");
    }
    setDebugButtons(true, false);
  }
}


async function debugApi(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Backend trả về dữ liệu không hợp lệ (HTTP ${response.status}). ` +
      text.slice(0, 300)
    );
  }

  if (!response.ok) {
    throw new Error(
      data.detail || data.error || `API lỗi (${response.status})`
    );
  }

  return data;
}

function markDebugSourceChanged() {
  // Khi đang debug, ô soạn code bị ẩn; nếu code bị đổi (chọn mẫu khác / khôi phục ví dụ) thì kết thúc phiên cũ.
  if (debugSessionId) {
    endDebugSession("Mã nguồn đã thay đổi nên phiên debug cũ đã dừng. Bấm Bắt đầu debug để chạy lại.");
  }
}

function stopDebugTimer() {
  if (debugTimer !== null) clearTimeout(debugTimer);
  debugTimer = null;
  $("debug-pause").disabled = !debugSessionId || debugFinished;
  $("debug-pause").textContent = "▶ Tiếp tục";
}

async function performDebugStep(into = true) {
  if (!debugSessionId || debugBusy) return null;
  // Đang xem lại một bước cũ: "tiến" nghĩa là đi tiếp trong bản ghi cho tới khi bắt kịp bước hiện tại.
  if (replay.idx >= 0 && replay.idx < replay.frames.length - 1) {
    replayGo(replay.idx + 1);
    return replay.frames[replay.idx];
  }
  debugBusy = true;
  $("debug-step").disabled = true;
  $("debug-into").disabled = true;
  try {
    const data = await debugApi(`/api/debug/${debugSessionId}/step`, {into});
    renderDebugState(data);
    return data;
  } catch (error) {
    stopDebugTimer();
    setDebugStatus(error.message, "Lỗi debug", "error");
    $("debug-step").disabled = false;
    $("debug-into").disabled = false;
    return null;
  } finally {
    debugBusy = false;
    if (debugSessionId) {
      $("debug-step").disabled = debugFinished;
      $("debug-into").disabled = debugFinished;
    }
  }
}

function scheduleAutoStep() {
  if (!debugSessionId || debugTimer !== null) return;
  $("debug-pause").disabled = false;
  $("debug-pause").textContent = "Ⅱ Tạm dừng";
  const tick = async () => {
    if (!debugSessionId || debugTimer === null) return;
    const data = await performDebugStep(true);
    if (!data || data.finished || !debugSessionId || debugTimer === null) {
      stopDebugTimer();
      return;
    }
    debugTimer = setTimeout(tick, debugSpeed);
  };
  debugTimer = setTimeout(tick, debugSpeed);
}

$("debug-start").addEventListener("click", async () => {
  stopDebugTimer();
  if (debugSessionId) {
    try { await debugApi(`/api/debug/${debugSessionId}/stop`); } catch {}
    debugSessionId = null;
  }
  const code = $("code").value;
  if (!code.trim()) {
    setDebugStatus("Hãy nhập code C++ trước khi bắt đầu.", "Thiếu code", "error");
    return;
  }
  debugSourceCode = code;
  replayReset(code, $("stdin").value);
  $("debug-start").disabled = true;
  setDebugStatus("Đang tạo debugger và biên dịch bằng GDB…", "Đang chuẩn bị", "neutral");
  $("debug-variables").textContent = "Đang chờ dữ liệu biến…";
  $("debug-stack").textContent = "Đang chờ call stack…";
  $("debug-output").textContent = "(chưa có output)";
  try {
    const data = await debugApi("/api/debug/start", {code, input: $("stdin").value});
    debugSessionId = data.sessionId;
    renderDebugState(data);
  } catch (error) {
    // Lỗi biên dịch / không bắt đầu được: về lại ô soạn code để người dùng sửa, lý do hiện ở thanh trạng thái.
    setDebugLive(false);
    setDebugStatus(error.message, "Lỗi debug", "error");
    $("debug-start").disabled = false;
  }
});

$("debug-pause").addEventListener("click", () => {
  if (debugTimer !== null) {
    stopDebugTimer();
    setDebugStatus("Đã tạm dừng. Bấm Tiến bước để chạy đúng một bước, hoặc bấm Tiếp tục để tự chạy lại.", "Tạm dừng", "neutral");
  } else if (debugSessionId && !debugFinished) {
    scheduleAutoStep();
    setDebugStatus(`Đang tự chạy mỗi ${debugSpeed} ms.`, "Đang debug", "success");
  }
});

$("debug-step").addEventListener("click", async () => {
  stopDebugTimer();
  await performDebugStep(false);
});

$("debug-into").addEventListener("click", async () => {
  stopDebugTimer();
  await performDebugStep(true);
});

$("debug-stop").addEventListener("click", () => endDebugSession());

$("debug-speed").addEventListener("change", () => {
  debugSpeed = Number($("debug-speed").value);
  if (debugSessionId && debugTimer !== null) {
    stopDebugTimer();
    scheduleAutoStep();
  }
});

// ---------------------------------------------------------------
// Chia sẻ code bằng link: code + input được nén rồi nhét vào phần
// sau dấu # của URL. Không lưu gì trên máy chủ, nên link không hết hạn.
// ---------------------------------------------------------------
const SHARE_MAX_URL = 12000;

function bytesToB64Url(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipeThrough(bytes, stream) {
  const result = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await result.arrayBuffer());
}

async function encodeShare(payload) {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "function") {
    try {
      return "z" + bytesToB64Url(await pipeThrough(raw, new CompressionStream("deflate-raw")));
    } catch (error) { /* dùng bản không nén */ }
  }
  return "p" + bytesToB64Url(raw);
}

async function decodeShare(text) {
  const kind = text[0];
  let bytes = b64UrlToBytes(text.slice(1));
  if (kind === "z") bytes = await pipeThrough(bytes, new DecompressionStream("deflate-raw"));
  else if (kind !== "p") throw new Error("định dạng không hợp lệ");
  return JSON.parse(new TextDecoder().decode(bytes));
}

let toastTimer = null;
function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    area.remove();
    return ok;
  }
}

$("share-code").addEventListener("click", async () => {
  const payload = {c: $("code").value, i: $("stdin").value, v: $("workspace").dataset.view === "debug" ? "debug" : "run"};
  if (!payload.c.trim()) { showToast("Chưa có code để chia sẻ.", true); return; }
  try {
    const encoded = await encodeShare(payload);
    const url = `${location.origin}${location.pathname}#${encoded}`;
    if (url.length > SHARE_MAX_URL) {
      showToast("Code quá dài để chia sẻ bằng link. Hãy rút gọn code lại.", true);
      return;
    }
    history.replaceState(null, "", `#${encoded}`);
    showToast((await copyText(url)) ? "Đã sao chép link chia sẻ!" : "Không tự sao chép được. Hãy copy link trên thanh địa chỉ.", false);
  } catch (error) {
    showToast("Không tạo được link chia sẻ.", true);
  }
});

async function loadSharedCode() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash || !/^[zp][A-Za-z0-9_-]+$/.test(hash)) return;
  try {
    const payload = await decodeShare(hash);
    if (typeof payload.c !== "string") throw new Error("thiếu code");
    if (Array.isArray(payload.f)) { enterReplayView(payload); return; }
    $("code").value = payload.c;
    $("stdin").value = typeof payload.i === "string" ? payload.i : "";
    updateCodeHighlight();
    updateLineCount();
    if (typeof setView === "function" && payload.v === "debug") setView("debug");
    showToast("Đã mở code được chia sẻ.");
  } catch (error) {
    showToast("Link chia sẻ bị hỏng hoặc không đọc được.", true);
  }
}
loadSharedCode();


// ---------------------------------------------------------------
// Tìm lỗi bằng random test: 3 chương trình (code của bạn / code đúng / generator)
// dùng chung một ô soạn code, chuyển qua lại bằng các tab.
// ---------------------------------------------------------------
const BRUTE_HINT = `// Viết lời giải ĐƠN GIẢN nhưng CHẮC CHẮN ĐÚNG ở đây (chậm cũng được).
// Thường là vét cạn: thử hết mọi khả năng rồi chọn kết quả tốt nhất.
// Chương trình này đọc input và in output giống hệt đề bài.
#include <bits/stdc++.h>
using namespace std;

int main() {
    // ...
}
`;

const GEN_HEAD = `#include <bits/stdc++.h>
using namespace std;

// Generator: sinh ra MỘT test. seed = số thứ tự test (1, 2, 3, ...), nên mỗi test khác nhau.
// Giữ giới hạn nhỏ (n <= 8, giá trị nhỏ) để test lỗi dễ đọc.
int main(int argc, char* argv[]) {
    int seed = atoi(argv[1]);
    mt19937 rng(seed);
    auto rnd = [&](int l, int r) { return (int)(rng() % (r - l + 1)) + l; };

`;

const GEN_TEMPLATES = {
  array: GEN_HEAD + `    int n = rnd(1, 8);              // sửa giới hạn n
    cout << n << "\\n";
    for (int i = 0; i < n; i++) cout << rnd(-10, 10) << " ";   // sửa khoảng giá trị
    cout << "\\n";
}
`,
  query: GEN_HEAD + `    int n = rnd(1, 8), q = rnd(1, 5);
    cout << n << " " << q << "\\n";
    for (int i = 0; i < n; i++) cout << rnd(1, 20) << " ";
    cout << "\\n";
    while (q--) {
        int l = rnd(1, n), r = rnd(1, n);
        if (l > r) swap(l, r);
        cout << l << " " << r << "\\n";
    }
}
`,
  two: GEN_HEAD + `    cout << rnd(1, 30) << " " << rnd(1, 30) << "\\n";   // sửa khoảng giá trị a, b
}
`,
  string: GEN_HEAD + `    int n = rnd(1, 8);
    string s;
    for (int i = 0; i < n; i++) s += char('a' + rnd(0, 2));   // chỉ dùng 3 chữ a, b, c
    cout << s << "\\n";
}
`,
  graph: GEN_HEAD + `    int n = rnd(2, 6), m = rnd(1, 8);
    cout << n << " " << m << "\\n";
    for (int i = 0; i < m; i++) {
        int u = rnd(1, n), v = rnd(1, n);
        cout << u << " " << v << "\\n";
    }
}
`,
};

const STRESS_HINTS = {
  mine: "Code đang bị sai, cần kiểm tra.",
  brute: "Lời giải chậm nhưng chắc chắn đúng (vét cạn). Phải đọc/in giống code của bạn.",
  gen: "Đọc seed từ argv[1] và in ra một test hợp lệ theo đề bài.",
};

const stressState = {cancel: false, tab: "mine", buffers: {mine: "", brute: BRUTE_HINT, gen: GEN_TEMPLATES.array}, preCode: "", running: false};

function paintStressTabs() {
  document.querySelectorAll(".stress-tab").forEach((button) => {
    const active = button.dataset.tab === stressState.tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("gen-template-wrap").hidden = stressState.tab !== "gen";
  $("stress-tab-hint").textContent = STRESS_HINTS[stressState.tab];
}

function loadEditorText(text) {
  $("code").value = text;
  $("code").scrollTop = 0;
  updateCodeHighlight();
  updateLineCount();
}

function enterStress() {
  stressState.tab = "mine";
  stressState.preCode = $("code").value;
  paintStressTabs();
}

function leaveStress() {
  stressState.buffers[stressState.tab] = $("code").value;
  const mine = stressState.buffers.mine;
  stressState.tab = "mine";
  loadEditorText(mine);
  if (mine !== stressState.preCode && typeof markDebugSourceChanged === "function") markDebugSourceChanged();
}

function switchStressTab(tab) {
  if (tab === stressState.tab) return;
  stressState.buffers[stressState.tab] = $("code").value;
  stressState.tab = tab;
  loadEditorText(stressState.buffers[tab]);
  paintStressTabs();
}

document.querySelectorAll(".stress-tab").forEach((button) => {
  button.addEventListener("click", () => switchStressTab(button.dataset.tab));
});

$("gen-template").addEventListener("change", () => {
  if (stressState.tab !== "gen") return;
  loadEditorText(GEN_TEMPLATES[$("gen-template").value]);
});

function stressEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stressBlock(label, text, extraClass = "") {
  const wrap = document.createElement("div");
  wrap.appendChild(stressEl("div", "stress-block-label", label));
  wrap.appendChild(stressEl("pre", `stress-pre ${extraClass}`.trim(), text === "" ? "(trống)" : text));
  return wrap;
}

function setStressBadge(text, cls) {
  $("stress-badge").textContent = text;
  $("stress-badge").className = `result-badge ${cls}`;
}

function useInputFromStress(input, view) {
  $("stdin").value = input;
  setView(view);
  showToast(view === "debug" ? "Đã nạp input lỗi. Bấm Bắt đầu debug." : "Đã nạp input lỗi vào ô Input.");
}

const STRESS_WHICH = {mine: "Code của bạn", brute: "Code đúng", gen: "Generator"};

function renderStressResult(data) {
  const box = $("stress-result");
  box.textContent = "";

  if (data.status === "ok") {
    setStressBadge("Không thấy lỗi", "success");
    box.appendChild(stressEl("p", "stress-verdict ok", `Không có khác biệt trong ${data.tests} test.`));
    if (data.cancelled) box.appendChild(stressEl("p", "muted-text", "Bạn đã dừng sớm, chưa chạy hết số test đã chọn."));
    box.appendChild(stressEl("p", "muted-text", data.timeLimited
      ? "Đã dừng sớm vì hết thời gian cho phép. Có thể thử lại để chạy thêm test khác, hoặc rút gọn generator."
      : "Chưa tìm ra test sai không có nghĩa là code chắc chắn đúng. Thử thêm giá trị đặc biệt (n = 1, số âm, số bằng nhau…) trong generator."));
    return;
  }

  if (data.status === "found") {
    const labels = {
      wrong_answer: "Đáp án khác code đúng",
      runtime: "Code của bạn bị lỗi khi chạy",
      timeout: "Code của bạn chạy quá lâu",
    };
    setStressBadge("Tìm thấy lỗi", "error");
    box.appendChild(stressEl("p", "stress-verdict bad", `${labels[data.kind] || "Có lỗi"} ở test #${data.seed}`));
    if (data.message) box.appendChild(stressEl("p", "muted-text", data.message));
    const inputSize = typeof data.inputSize === "number" ? data.inputSize : (data.input || "").length;
    const tooBig = inputSize > 20000;     // ô Input của web nhận tối đa 20.000 ký tự
    const clipped = (data.input || "").includes("[đã cắt bớt]") || inputSize > (data.input || "").length;
    if (clipped) {
      box.appendChild(stressEl("p", "stress-verdict bad",
        `Cảnh báo: input của test này dài ${inputSize.toLocaleString("vi-VN")} ký tự nên chỉ hiện phần đầu. ` +
        "Nếu bạn copy phần này ra chạy ở máy thì sẽ ra kết quả KHÁC (vì thiếu dữ liệu). " +
        "Hãy giảm giới hạn trong Generator (ví dụ n ≤ 8, m ≤ 10) để test lỗi ngắn, đọc được và chạy lại được."));
    }
    box.appendChild(stressBlock("Input của test lỗi" + (clipped ? " (chỉ phần đầu)" : ""), data.input || ""));
    const cols = stressEl("div", "stress-cols");
    cols.appendChild(stressBlock("Code của bạn in ra", data.mine || "", "bad"));
    cols.appendChild(stressBlock("Code đúng in ra", data.brute || "", "good"));
    box.appendChild(cols);
    if (data.stderr) box.appendChild(stressBlock("Thông báo lỗi", data.stderr, "bad"));

    const actions = stressEl("div", "stress-actions");
    const copy = stressEl("button", "text-button", "Chép input");
    copy.type = "button";
    copy.addEventListener("click", async () => showToast((await copyText(data.input || "")) ? "Đã chép input." : "Không chép được.", false));
    const run = stressEl("button", "share-button", "Chạy với input này");
    run.type = "button";
    run.addEventListener("click", () => useInputFromStress(data.input || "", "run"));
    const debug = stressEl("button", "share-button", "Debug với input này");
    debug.type = "button";
    debug.addEventListener("click", () => useInputFromStress(data.input || "", "debug"));
    const soi = stressEl("button", "share-button", "Soi chỗ lệch");
    soi.type = "button";
    soi.addEventListener("click", () => {
      $("diverge-input").value = data.input || "";
      $("diverge-panel").scrollIntoView({behavior: "smooth", block: "nearest"});
      runDiverge();
    });
    if (!tooBig && !clipped) actions.append(run, debug, copy, soi);
    box.appendChild(actions);
    return;
  }

  // Các lỗi khác: biên dịch, generator, code đúng, môi trường...
  setStressBadge("Có lỗi", "error");
  const whichName = STRESS_WHICH[data.which] || "";
  const titles = {
    compile: `Lỗi biên dịch ${whichName ? `(tab ${whichName})` : ""}`,
    generator: `Generator bị lỗi ở seed ${data.seed ?? ""}`,
    brute: `Code đúng bị lỗi ở test #${data.seed ?? ""}`,
    missing: `Chưa có ${whichName.toLowerCase()}`,
  };
  box.appendChild(stressEl("p", "stress-verdict bad", titles[data.kind] || "Không chạy được"));
  if (data.message) box.appendChild(stressEl("pre", "stress-pre bad", data.message));
  if (data.input) box.appendChild(stressBlock("Input lúc đó", data.input));
  if (data.stderr) box.appendChild(stressBlock("Thông báo lỗi", data.stderr, "bad"));
  if (data.kind === "compile" && data.which) {
    const go = stressEl("button", "share-button", `Mở tab ${whichName}`);
    go.type = "button";
    go.addEventListener("click", () => switchStressTab(data.which));
    box.appendChild(go);
  }
}

$("stress-run").addEventListener("click", async () => {
  if (stressState.running) return;
  stressState.buffers[stressState.tab] = $("code").value;
  const {mine, brute, gen} = stressState.buffers;

  if (!mine.trim()) { showToast("Tab “Code của bạn” đang trống.", true); switchStressTab("mine"); return; }
  if (brute.trim() === BRUTE_HINT.trim() || !brute.trim()) {
    showToast("Hãy viết lời giải đúng ở tab “Code đúng” trước.", true);
    switchStressTab("brute");
    return;
  }

  stressState.running = true;
  $("stress-run").disabled = true;
  $("stress-run-label").textContent = "Đang thử các test…";
  setStressBadge("Đang chạy", "neutral");
  $("stress-result").textContent = "";
  $("stress-result").appendChild(stressEl("p", "muted-text", "Đang biên dịch và chạy các test. Có thể mất tới ~20 giây…"));

  try {
    // Chạy theo từng đợt ngắn (mỗi đợt tiếp nối seed của đợt trước) cho tới khi đủ số test,
    // nên máy chủ chậm chỉ làm lâu hơn chứ không làm mất test.
    const total = Number($("stress-tests").value);
    let done = 0;
    let data = null;
    stressState.cancel = false;
    $("stress-stop").hidden = false;
    while (done < total) {
      const response = await fetch("/api/stress", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({mine, brute, gen, tests: total - done, start: done + 1}),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail ? JSON.stringify(detail.detail) : `HTTP ${response.status}`);
      }
      data = await response.json();
      if (data.status !== "ok") break;          // tìm thấy lỗi hoặc có lỗi khác: dừng ngay
      done += Math.max(1, data.tests || 0);
      if (done < total) {
        if (stressState.cancel) break;
        $("stress-run-label").textContent = `Đã thử ${done}/${total} test…`;
        $("stress-result").textContent = "";
        $("stress-result").appendChild(stressEl("p", "muted-text", `Đã chạy ${done}/${total} test, chưa thấy khác biệt. Đang chạy tiếp…`));
      }
    }
    if (data && data.status === "ok") {
      data.tests = done;
      data.timeLimited = false;
      data.cancelled = done < total;
    }
    renderStressResult(data);
  } catch (error) {
    setStressBadge("Lỗi kết nối", "error");
    $("stress-result").textContent = "";
    $("stress-result").appendChild(stressEl("p", "stress-verdict bad", `Không gọi được API: ${error.message}`));
  } finally {
    stressState.running = false;
    $("stress-stop").hidden = true;
    $("stress-run").disabled = false;
    $("stress-run-label").textContent = "Tìm lỗi";
  }
});

$("stress-stop").addEventListener("click", () => {
  stressState.cancel = true;
  $("stress-stop").hidden = true;
});


// ---- Soi chỗ lệch giữa 2 code ----
function sourceLine(text, line) {
  if (!line) return "";
  return (text.split("\n")[line - 1] || "").trim();
}

function renderDiverge(data) {
  const box = $("diverge-result");
  box.textContent = "";
  const buf = stressState.buffers;
  if (data.status !== "ok") {
    setDivergeBadge("Có lỗi", "error");
    const who = STRESS_WHICH[data.which] || "";
    const head = data.kind === "compile" ? `Lỗi biên dịch${who ? ` (${who})` : ""}` : "Không soi được";
    box.appendChild(stressEl("p", "stress-verdict bad", head));
    if (data.message) box.appendChild(stressEl("pre", "stress-pre bad", data.message));
    return;
  }
  const list = data.divergences || [];
  const notes = [];
  for (const k of ["mine", "brute"]) {
    if (data.truncated[k]) notes.push(`${STRESS_WHICH[k]} chạy quá dài nên chỉ theo dõi phần đầu.`);
    if (data.signal[k]) notes.push(`${STRESS_WHICH[k]} bị dừng bởi tín hiệu ${data.signal[k]}${data.signalLine[k] ? ` ở dòng ${data.signalLine[k]}` : ""}.`);
  }
  if (!list.length) {
    setDivergeBadge("Không thấy lệch", "neutral");
    box.appendChild(stressEl("p", "stress-verdict", data.commonVars
      ? "Các biến trùng tên đều có lịch sử giá trị giống nhau."
      : "Hai code không có biến nào trùng tên để so sánh."));
    if (!data.output.same) box.appendChild(stressEl("p", "muted-text", "Nhưng output khác nhau, nên chỗ lệch nằm ở biến/công thức khác tên. Thử đặt tên biến giống nhau ở 2 code."));
  } else {
    setDivergeBadge("Tìm thấy chỗ lệch", "error");
    box.appendChild(stressEl("p", "stress-verdict bad", "Biến lệch sớm nhất (xếp theo thời điểm xảy ra):"));
    list.forEach((d, i) => {
      const item = stressEl("div", "diverge-item");
      item.appendChild(stressEl("h4", "", `${i + 1}. Biến “${d.name}”${d.func === "main" || d.func === "(toàn cục)" ? "" : ` trong ${d.func}()`}${d.func === "(toàn cục)" ? " (toàn cục)" : ""}`));
      const sides = stressEl("div", "diverge-side");
      for (const [k, cls] of [["mine", "bad"], ["brute", "good"]]) {
        const s = d[k];
        const col = document.createElement("div");
        col.appendChild(stressEl("div", "stress-block-label", STRESS_WHICH[k]));
        const val = s.value === null ? "(không có giá trị mới — chạy xong rồi)" : s.value;
        col.appendChild(stressEl("pre", `stress-pre ${cls}`, val));
        if (s.line) col.appendChild(stressEl("div", "diverge-line", `Dòng ${s.line}: ${sourceLine(buf[k], s.line)}`));
        sides.appendChild(col);
      }
      item.appendChild(sides);
      if (d.before !== null) item.appendChild(stressEl("div", "diverge-line", `Trước đó 2 bên đều bằng: ${d.before}`));
      box.appendChild(item);
    });
    if (data.totalDivergent > list.length) box.appendChild(stressEl("p", "muted-text", `Còn ${data.totalDivergent - list.length} biến lệch khác (thường là hệ quả của biến đầu tiên).`));
    box.appendChild(stressEl("p", "muted-text", "Gợi ý: dòng đầu tiên làm biến khác đi thường là nơi chứa lỗi. Bạn có thể bấm “Debug với input này” để đi từng bước."));
  }
  if (!data.output.same && data.output.line) {
    box.appendChild(stressEl("p", "muted-text", `Output bắt đầu khác ở dòng ${data.output.line}: bạn in “${data.output.mine ?? ""}”, code đúng in “${data.output.brute ?? ""}”.`));
  }
  notes.forEach((n) => box.appendChild(stressEl("p", "muted-text", n)));
}

function setDivergeBadge(text, cls) {
  $("diverge-badge").textContent = text;
  $("diverge-badge").className = `result-badge ${cls}`;
}

let divergeRunning = false;
async function runDiverge() {
  if (divergeRunning) return;
  stressState.buffers[stressState.tab] = $("code").value;
  const {mine, brute} = stressState.buffers;
  if (!mine.trim() || !brute.trim() || brute.trim() === BRUTE_HINT.trim()) {
    showToast("Cần có đủ “Code của bạn” và “Code đúng” trước.", true);
    return;
  }
  divergeRunning = true;
  $("diverge-run").disabled = true;
  setDivergeBadge("Đang chạy", "neutral");
  $("diverge-result").textContent = "";
  $("diverge-result").appendChild(stressEl("p", "muted-text", "Đang chạy từng dòng cả 2 code, có thể mất 10–40 giây…"));
  try {
    const response = await fetch("/api/diverge", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({mine, brute, input: $("diverge-input").value}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderDiverge(await response.json());
  } catch (error) {
    setDivergeBadge("Lỗi kết nối", "error");
    $("diverge-result").textContent = "";
    $("diverge-result").appendChild(stressEl("p", "stress-verdict bad", `Không gọi được API: ${error.message}`));
  } finally {
    divergeRunning = false;
    $("diverge-run").disabled = false;
  }
}
$("diverge-run").addEventListener("click", runDiverge);


// ---- Giải thích vì sao crash (có hình minh họa) ----
function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

const SVG_HEAD = (h) => `<svg viewBox="0 0 640 ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Manrope, system-ui, sans-serif" role="img">
<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fb7185"/></marker>
<marker id="arrg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#9693aa"/></marker></defs>`;
const C = {cell: "#232233", line: "#4b4a63", text: "#f0eff8", mute: "#9693aa", red: "#fb7185", redBg: "#3a1823", ok: "#5eead4"};

function figOob(d) {
  const n = d.size, idx = d.indexValue;
  const all = n <= 10;
  const slots = [];                                  // {i, gap}
  if (all) for (let i = 0; i < n; i++) slots.push({i});
  else { for (let i = 0; i < 4; i++) slots.push({i}); slots.push({gap: true}); for (let i = n - 3; i < n; i++) slots.push({i}); }
  const bad = idx < 0 ? "before" : "after";
  const list = bad === "before" ? [{bad: true}, ...slots] : [...slots, ...(idx > n ? [{gap: true}] : []), {bad: true}];
  const W = 52;
  const total = list.length * W;
  const x0 = Math.max(16, (640 - total) / 2);
  let out = SVG_HEAD(190);
  let badX = 0;
  list.forEach((slot, k) => {
    const x = x0 + k * W;
    if (slot.gap) { out += `<text x="${x + 22}" y="98" fill="${C.mute}" font-size="20" text-anchor="middle">…</text>`; return; }
    if (slot.bad) {
      badX = x;
      out += `<rect x="${x}" y="70" width="46" height="46" rx="6" fill="${C.redBg}" stroke="${C.red}" stroke-width="2" stroke-dasharray="5 4"/>`;
      out += `<text x="${x + 23}" y="98" fill="${C.red}" font-size="16" font-weight="800" text-anchor="middle">?</text>`;
      out += `<text x="${x + 23}" y="138" fill="${C.red}" font-size="12" font-weight="800" text-anchor="middle">${esc(idx)}</text>`;
      return;
    }
    const val = d.values && d.values[slot.i] !== undefined ? d.values[slot.i] : "";
    out += `<rect x="${x}" y="70" width="46" height="46" rx="6" fill="${C.cell}" stroke="${C.line}"/>`;
    out += `<text x="${x + 23}" y="98" fill="${C.text}" font-size="13" font-family="monospace" text-anchor="middle">${esc(String(val).length > 6 ? String(val).slice(0, 5) + "…" : val)}</text>`;
    out += `<text x="${x + 23}" y="138" fill="${C.mute}" font-size="12" text-anchor="middle">${slot.i}</text>`;
  });
  const label = d.base && d.base !== "?" ? `${d.expr || d.base + "[" + d.index + "]"}` : `chỉ số ${idx}`;
  out += `<line x1="${badX + 23}" y1="34" x2="${badX + 23}" y2="64" stroke="${C.red}" stroke-width="2.5" marker-end="url(#arr)"/>`;
  out += `<text x="${badX + 23}" y="24" fill="${C.red}" font-size="13" font-weight="800" text-anchor="middle">${esc(label)}</text>`;
  const first = x0 + (bad === "before" ? W : 0);
  out += `<text x="${first}" y="172" fill="${C.ok}" font-size="12.5" font-weight="700">${d.base && d.base !== "?" ? esc(d.base) + " có " : "Có "}${n} phần tử: chỉ số hợp lệ từ 0 đến ${n - 1}</text>`;
  return out + "</svg>";
}

function figNull(d) {
  const name = d && d.name ? d.name : "con trỏ";
  let out = SVG_HEAD(150);
  out += `<rect x="60" y="45" width="170" height="56" rx="8" fill="${C.cell}" stroke="${C.line}"/>`;
  out += `<text x="145" y="68" fill="${C.mute}" font-size="11" text-anchor="middle">${esc(d && d.type ? d.type : "con trỏ")}</text>`;
  out += `<text x="145" y="90" fill="${C.text}" font-size="15" font-weight="800" font-family="monospace" text-anchor="middle">${esc(name)} = nullptr</text>`;
  out += `<line x1="232" y1="73" x2="388" y2="73" stroke="${C.red}" stroke-width="2.5" stroke-dasharray="6 5" marker-end="url(#arr)"/>`;
  out += `<rect x="395" y="45" width="185" height="56" rx="8" fill="${C.redBg}" stroke="${C.red}" stroke-width="2" stroke-dasharray="5 4"/>`;
  out += `<text x="487" y="78" fill="${C.red}" font-size="13" font-weight="800" text-anchor="middle">địa chỉ 0 (không có gì)</text>`;
  out += `<text x="320" y="135" fill="${C.mute}" font-size="12.5" text-anchor="middle">Đọc/ghi qua con trỏ rỗng → hệ điều hành dừng chương trình</text>`;
  return out + "</svg>";
}

function figDiv(d) {
  const op = d && d.op === "%" ? "%" : "/";
  const div = d && d.divisor ? d.divisor : "số chia";
  let out = SVG_HEAD(150);
  out += `<rect x="90" y="40" width="130" height="60" rx="8" fill="${C.cell}" stroke="${C.line}"/>`;
  out += `<text x="155" y="76" fill="${C.text}" font-size="14" text-anchor="middle">số bị chia</text>`;
  out += `<text x="260" y="82" fill="${C.text}" font-size="30" font-weight="800" text-anchor="middle">${op}</text>`;
  out += `<rect x="300" y="40" width="150" height="60" rx="8" fill="${C.redBg}" stroke="${C.red}" stroke-width="2"/>`;
  out += `<text x="375" y="64" fill="${C.mute}" font-size="11" text-anchor="middle">${esc(div)}</text>`;
  out += `<text x="375" y="90" fill="${C.red}" font-size="22" font-weight="800" text-anchor="middle">= 0</text>`;
  out += `<text x="500" y="82" fill="${C.text}" font-size="24" font-weight="800" text-anchor="middle">=</text>`;
  out += `<text x="560" y="82" fill="${C.red}" font-size="26" font-weight="800" text-anchor="middle">✕</text>`;
  out += `<text x="320" y="135" fill="${C.mute}" font-size="12.5" text-anchor="middle">Không có kết quả nào cho phép chia cho 0 → chương trình bị dừng</text>`;
  return out + "</svg>";
}

function figStack(d) {
  const frames = (d.stack || []).filter((f) => f.args && f.args.length).slice(0, 3);
  const depth = d.capped ? `hơn ${d.totalFrames.toLocaleString("vi-VN")}` : d.userFrames.toLocaleString("vi-VN");
  const fn = d.func || "f";
  const label = (f) => `${f.func}(${f.args.map((a) => `${a[0]}=${a[1]}`).join(", ")})`;
  let out = SVG_HEAD(300);
  let y = 262;
  const box = (text, fill, stroke, color = C.text) => {
    out += `<rect x="170" y="${y}" width="300" height="32" rx="6" fill="${fill}" stroke="${stroke}"/>`;
    out += `<text x="320" y="${y + 21}" fill="${color}" font-size="13" font-family="monospace" text-anchor="middle">${esc(text)}</text>`;
    y -= 40;
  };
  box("main()", C.cell, C.line);
  out += `<text x="320" y="${y + 24}" fill="${C.mute}" font-size="14" text-anchor="middle">⋮ ${esc(depth)} lần gọi ${esc(fn)}() ⋮</text>`;
  y -= 34;
  frames.slice().reverse().forEach((f) => box(label(f), C.cell, C.line));
  box("Hết chỗ trên stack → crash", C.redBg, C.red, C.red);
  out += `<line x1="500" y1="250" x2="500" y2="40" stroke="${C.mute}" stroke-width="2" marker-end="url(#arrg)"/>`;
  out += `<text x="512" y="150" fill="${C.mute}" font-size="12">gọi sâu thêm</text>`;
  return out + "</svg>";
}

function figAlloc(d) {
  const v = d.detail ? d.detail.value : null;
  let big = "một số cực lớn";
  if (v !== null && v < 0) big = (BigInt(2) ** BigInt(64) + BigInt(v)).toString();
  else if (v !== null) big = Number(v).toLocaleString("vi-VN");
  let out = SVG_HEAD(150);
  out += `<rect x="40" y="40" width="190" height="60" rx="8" fill="${C.cell}" stroke="${C.line}"/>`;
  out += `<text x="135" y="63" fill="${C.mute}" font-size="11" text-anchor="middle">${esc(d.detail ? d.detail.expr : "kích thước")}</text>`;
  out += `<text x="135" y="88" fill="${C.text}" font-size="20" font-weight="800" text-anchor="middle">${esc(v === null ? "?" : v)}</text>`;
  out += `<line x1="232" y1="70" x2="290" y2="70" stroke="${C.mute}" stroke-width="2" marker-end="url(#arrg)"/>`;
  out += `<rect x="295" y="40" width="300" height="60" rx="8" fill="${C.redBg}" stroke="${C.red}" stroke-width="2"/>`;
  out += `<text x="445" y="63" fill="${C.mute}" font-size="11" text-anchor="middle">${v !== null && v < 0 ? "số âm bị đổi thành số không dấu" : "số phần tử cần cấp phát"}</text>`;
  out += `<text x="445" y="88" fill="${C.red}" font-size="${big.length > 14 ? 14 : 18}" font-weight="800" text-anchor="middle">${esc(big)}</text>`;
  out += `<text x="320" y="135" fill="${C.mute}" font-size="12.5" text-anchor="middle">Máy không có đủ bộ nhớ cho chừng đó phần tử → bad_alloc / length_error</text>`;
  return out + "</svg>";
}

function figNoReturn(d) {
  let out = SVG_HEAD(150);
  out += `<rect x="40" y="45" width="150" height="50" rx="8" fill="${C.cell}" stroke="${C.line}"/>`;
  out += `<text x="115" y="75" fill="${C.text}" font-size="13" text-anchor="middle">vào ${esc(d.func || "hàm")}()</text>`;
  out += `<line x1="192" y1="70" x2="240" y2="70" stroke="${C.mute}" stroke-width="2" marker-end="url(#arrg)"/>`;
  out += `<rect x="245" y="45" width="170" height="50" rx="8" fill="${C.cell}" stroke="${C.line}"/>`;
  out += `<text x="330" y="67" fill="${C.text}" font-size="12" text-anchor="middle">các điều kiện if</text>`;
  out += `<text x="330" y="84" fill="${C.mute}" font-size="11" text-anchor="middle">không nhánh nào return</text>`;
  out += `<line x1="417" y1="70" x2="455" y2="70" stroke="${C.red}" stroke-width="2.5" marker-end="url(#arr)"/>`;
  out += `<rect x="460" y="45" width="150" height="50" rx="8" fill="${C.redBg}" stroke="${C.red}" stroke-width="2"/>`;
  out += `<text x="535" y="67" fill="${C.red}" font-size="13" font-weight="800" text-anchor="middle">gặp dấu }</text>`;
  out += `<text x="535" y="84" fill="${C.red}" font-size="11" text-anchor="middle">mà chưa return</text>`;
  out += `<text x="320" y="135" fill="${C.mute}" font-size="12.5" text-anchor="middle">Hàm có kiểu trả về nhưng có đường chạy kết thúc mà không return</text>`;
  return out + "</svg>";
}

function figChain(d) {
  const frames = (d.stack || []).slice().reverse().slice(-5);
  let out = SVG_HEAD(150);
  const w = Math.min(150, 560 / Math.max(1, frames.length) - 20);
  frames.forEach((f, k) => {
    const x = 40 + k * (w + 30);
    const last = k === frames.length - 1;
    out += `<rect x="${x}" y="45" width="${w}" height="56" rx="8" fill="${last ? C.redBg : C.cell}" stroke="${last ? C.red : C.line}" stroke-width="${last ? 2 : 1}"/>`;
    out += `<text x="${x + w / 2}" y="68" fill="${last ? C.red : C.text}" font-size="13" font-weight="800" font-family="monospace" text-anchor="middle">${esc(f.func)}()</text>`;
    out += `<text x="${x + w / 2}" y="88" fill="${C.mute}" font-size="11" text-anchor="middle">dòng ${esc(f.line)}</text>`;
    if (!last) out += `<line x1="${x + w + 2}" y1="73" x2="${x + w + 26}" y2="73" stroke="${C.mute}" stroke-width="2" marker-end="url(#arrg)"/>`;
  });
  out += `<text x="320" y="135" fill="${C.mute}" font-size="12.5" text-anchor="middle">Chuỗi hàm đang chạy lúc lỗi (hàm cuối là nơi xảy ra lỗi)</text>`;
  return out + "</svg>";
}

function overflowFacts(dt) {
  const bits = BigInt(dt.bits || 32);
  const max = (2n ** (bits - 1n)) - 1n;
  const min = -max - 1n;
  const A = BigInt(dt.a);
  const B = dt.b !== null && dt.b !== undefined ? BigInt(dt.b) : 0n;
  const real = dt.op === "+" ? A + B : dt.op === "-" ? A - B : dt.op === "*" ? A * B : -A;
  const wrapped = BigInt.asIntN(Number(bits), real);
  const fmt = (x) => x.toLocaleString("vi-VN");
  const expr = dt.op === "neg" ? `-(${fmt(A)})` : `${fmt(A)} ${dt.op === "*" ? "×" : dt.op} ${fmt(B)}`;
  return {max, min, A, B, real, wrapped, fmt, expr};
}

function figOverflow(dt) {
  const f = overflowFacts(dt);
  let out = SVG_HEAD(200);
  out += `<text x="320" y="34" fill="${C.text}" font-size="16" font-weight="800" font-family="monospace" text-anchor="middle">${esc(f.expr)} = ${esc(f.fmt(f.real))}</text>`;
  out += `<text x="320" y="54" fill="${C.mute}" font-size="11.5" text-anchor="middle">kết quả thật (toán học)</text>`;
  // thanh biểu diễn phạm vi của kiểu số
  out += `<rect x="60" y="82" width="420" height="30" rx="6" fill="${C.cell}" stroke="${C.line}"/>`;
  const ratio = Number(f.A) / Number(f.max);
  const fill = Math.max(0, Math.min(1, ratio));
  if (fill > 0) out += `<rect x="60" y="82" width="${(420 * fill).toFixed(1)}" height="30" rx="6" fill="#134e4a"/>`;
  out += `<rect x="480" y="82" width="110" height="30" rx="6" fill="${C.redBg}" stroke="${C.red}" stroke-dasharray="5 4"/>`;
  out += `<text x="535" y="102" fill="${C.red}" font-size="12" font-weight="800" text-anchor="middle">vượt giới hạn</text>`;
  out += `<line x1="480" y1="74" x2="480" y2="120" stroke="${C.text}" stroke-width="2"/>`;
  out += `<text x="60" y="132" fill="${C.mute}" font-size="11" text-anchor="start">${esc(f.fmt(f.min))}</text>`;
  out += `<text x="480" y="132" fill="${C.text}" font-size="11" font-weight="800" text-anchor="middle">${esc(f.fmt(f.max))}</text>`;
  out += `<text x="270" y="102" fill="${C.ok}" font-size="12" text-anchor="middle">${esc(dt.type)} chứa được</text>`;
  out += `<path d="M535 118 C 535 170, 170 170, 150 118" fill="none" stroke="${C.red}" stroke-width="2.5" marker-end="url(#arr)"/>`;
  out += `<text x="320" y="180" fill="${C.red}" font-size="13" font-weight="800" text-anchor="middle">quay vòng thành ${esc(f.fmt(f.wrapped))}</text>`;
  return out + "</svg>";
}

function crashText(d) {
  const line = d.line ? `dòng ${d.line}` : "một dòng trong code";
  const tips = [];
  const dt = d.detail;
  switch (d.kind) {
    case "oob": {
      const named = dt.base && dt.base !== "?";
      const what = dt.containerKind === "vector" ? "vector" : dt.containerKind === "string" ? "string" : "mảng";
      const idxText = named ? `<code>${esc(dt.expr || `${dt.base}[${dt.index}]`)}</code> với chỉ số <b>${esc(dt.indexValue)}</b>` : `chỉ số <b>${esc(dt.indexValue)}</b>`;
      let why = `Ở ${line}, code truy cập ${idxText}, nhưng ${named ? `<code>${esc(dt.base)}</code>` : what} chỉ có <b>${dt.size}</b> phần tử (chỉ số hợp lệ: 0 … ${dt.size - 1}).`;
      if (dt.indexValue === dt.size) tips.push("Chỉ số vượt đúng 1 ô: thường do vòng lặp dùng <code>&lt;=</code> thay vì <code>&lt;</code>, hoặc đánh số từ 1 mà mảng chỉ khai báo đủ n phần tử (cần <code>n + 1</code>).");
      if (dt.indexValue < 0) tips.push("Chỉ số âm: kiểm tra phép trừ như <code>i - 1</code> khi <code>i = 0</code>, hoặc biến chưa được gán giá trị.");
      if (dt.indexValue > dt.size) tips.push("Chỉ số lớn hơn hẳn kích thước: kiểm tra xem kích thước mảng/vector có theo đúng giới hạn của đề không, và chỉ số có bị tính sai không.");
      tips.push("In ra hoặc debug giá trị của biến chỉ số ngay trước dòng này để xem vì sao nó có giá trị đó.");
      if (dt.containerKind === "array") tips.push("Lưu ý: với mảng thường, lỗi này nhiều khi KHÔNG crash khi chạy bình thường mà chỉ làm kết quả sai (ghi đè ô nhớ khác). Lần này web bật chế độ kiểm tra nên bắt được.");
      return {title: `Truy cập ngoài phạm vi ${what}`, why, tips, fig: figOob(dt)};
    }
    case "overflow": {
      const f = overflowFacts(dt);
      const vars = (d.locals || []).map((v) => `<code>${esc(v[0])} = ${esc(v[1])}</code>`).join(", ");
      const tips = [`Đổi biến chứa kết quả (tổng, tích, đếm...) sang <code>long long</code> (chứa tới khoảng 9,2 × 10<sup>18</sup>).`,
        "Khi nhân hai số <code>int</code> rồi gán vào <code>long long</code>, phải ép kiểu TRƯỚC khi nhân: <code>1LL * a * b</code> (viết <code>(long long)(a * b)</code> là vẫn sai).",
        `Kiểu <code>${esc(dt.type)}</code> chỉ chứa từ ${f.fmt(f.min)} đến ${f.fmt(f.max)}. Hãy ước lượng giá trị lớn nhất theo giới hạn của đề để chọn kiểu phù hợp.`];
      return {title: "Tràn số nguyên (integer overflow)",
        why: `Ở dòng ${dt.line}, phép <code>${esc(f.expr)}</code> có kết quả thật là <b>${esc(f.fmt(f.real))}</b>, nhưng kiểu <code>${esc(dt.type)}</code> chỉ chứa tối đa <b>${esc(f.fmt(f.max))}</b>. Kết quả bị “quay vòng” thành <b>${esc(f.fmt(f.wrapped))}</b>. Chương trình vẫn chạy tiếp nên không crash, chỉ cho ra đáp án sai.` +
          (vars ? ` Lúc tràn lần đầu: ${vars}.` : "") + (dt.places > 1 ? ` Có ${dt.places} chỗ trong code bị tràn.` : ""),
        tips, fig: figOverflow(dt)};
    }
    case "stack_overflow":
      return {title: "Tràn stack: hàm tự gọi lại quá sâu",
        why: `Hàm <code>${esc(d.func)}()</code> đã gọi lồng nhau ${d.capped ? "hơn " + d.totalFrames.toLocaleString("vi-VN") : "khoảng " + d.userFrames.toLocaleString("vi-VN")} tầng mà chưa dừng. Mỗi lần gọi hàm chiếm một ít bộ nhớ stack (khoảng 8 MB), hết chỗ thì hệ điều hành dừng chương trình (SIGSEGV).`,
        tips: ["Kiểm tra <b>điều kiện dừng</b> của đệ quy: có đường nào không bao giờ chạm tới nó không (ví dụ tham số tăng thay vì giảm)?", "Nếu đệ quy hợp lệ nhưng sâu tới hàng trăm nghìn tầng, hãy đổi sang vòng lặp hoặc dùng stack tự quản lý.", "Xem phần Call stack bên dưới: giá trị tham số ở các tầng cho thấy nó đang đi theo hướng nào."],
        fig: figStack(d)};
    case "div0":
      return {title: "Chia cho 0",
        why: `Ở ${line}, phép <code>${esc(dt ? dt.expr : "chia")}</code> có số chia ${dt ? `<code>${esc(dt.divisor)}</code> ` : ""}bằng <b>0</b>.`,
        tips: ["Kiểm tra trước khi chia: <code>if (b != 0)</code>.", "Tìm xem vì sao số chia bằng 0: biến chưa gán, đọc input sai, hoặc phép tính trước đó ra 0 (ví dụ <code>n - n</code>, phép chia nguyên làm tròn xuống 0)."],
        fig: figDiv(dt)};
    case "null":
    case "segv": {
      const nm = dt && dt.name ? `<code>${esc(dt.name)}</code>` : "một con trỏ";
      return {title: d.kind === "null" ? "Dùng con trỏ rỗng (nullptr)" : "Truy cập vùng nhớ không hợp lệ",
        why: d.kind === "null" ? `Ở ${line}, ${nm} đang bằng <b>nullptr</b> (địa chỉ 0) nhưng code vẫn đọc/ghi qua nó.` : `Ở ${line}, chương trình đọc/ghi vào một địa chỉ bộ nhớ không thuộc về nó${d.faultAddr != null ? ` (địa chỉ 0x${Number(d.faultAddr).toString(16)})` : ""}.`,
        tips: ["Kiểm tra con trỏ trước khi dùng: <code>if (p != nullptr)</code>.", "Xem lại chỗ gán/tạo con trỏ (<code>new</code>, kết quả tìm kiếm, <code>find</code>...), có trường hợp nó trả về rỗng không?", "Nếu dùng chỉ số mảng rất lớn/âm làm địa chỉ bị lệch xa, hãy kiểm tra các biến chỉ số ở dòng này."],
        fig: d.kind === "null" ? figNull(dt) : figChain(d)};
    }
    case "alloc":
      return {title: "Xin cấp phát quá nhiều bộ nhớ",
        why: `Ở ${line}, code xin tạo một vùng nhớ có kích thước ${dt ? `<code>${esc(dt.expr)}</code> = <b>${esc(dt.value)}</b>` : "quá lớn"}${dt && dt.value < 0 ? ". Số âm khi đưa vào kích thước (kiểu không dấu) biến thành một số khổng lồ" : ""}.`,
        tips: ["In ra giá trị kích thước trước khi tạo vector/mảng để xem có bị âm hoặc quá lớn không.", "Kiểm tra đã đọc đúng input chưa (thứ tự đọc n, m, ...).", "Nếu cần mảng lớn thật, đặt nó ở phạm vi toàn cục hoặc giảm kích thước."],
        fig: figAlloc(d)};
    case "noreturn":
      return {title: "Hàm thiếu lệnh return",
        why: `Hàm <code>${esc(d.func || "")}()</code> có kiểu trả về, nhưng khi chạy tới dấu <code>}</code> ở ${line} thì chưa gặp <code>return</code> nào. Hành vi này không xác định, thường gây crash hoặc kết quả sai.`,
        tips: ["Thêm <code>return</code> cho mọi nhánh, kể cả nhánh <code>else</code> cuối cùng.", "Kiểm tra các điều kiện <code>if</code> có bao phủ hết mọi trường hợp (ví dụ x = 0, giá trị âm) không."],
        fig: figNoReturn(d)};
    case "stl_assert":
      return {title: "Dùng sai hàm của thư viện chuẩn (STL)",
        why: `Ở ${line}, thư viện chuẩn phát hiện thao tác không hợp lệ: <code>${esc(d.message)}</code>. Hay gặp nhất là gọi <code>back()</code>, <code>front()</code>, <code>pop_back()</code>, <code>top()</code> trên container RỖNG, hoặc dùng iterator sai.`,
        tips: ["Kiểm tra <code>empty()</code> trước khi lấy phần tử.", "Kiểm tra iterator có bằng <code>end()</code> không trước khi dùng <code>*it</code>."],
        fig: figChain(d)};
    case "exception":
      return {title: `Ném ngoại lệ ${d.exception} mà không ai bắt`,
        why: `Ở ${line}, chương trình ném ngoại lệ <code>${esc(d.exception)}</code>${d.message ? `: <b>${esc(d.message)}</b>` : ""} và không có <code>catch</code> nào xử lý nên chương trình bị dừng.`,
        tips: ["Đọc thông điệp lỗi ở trên để biết nguyên nhân (ví dụ <code>stoi</code> với chuỗi không phải số, <code>.at()</code> ngoài biên, <code>map.at</code> với khóa chưa có).", "Nếu muốn chương trình tiếp tục, bọc đoạn đó trong <code>try { ... } catch (...) { ... }</code>."],
        fig: figChain(d)};
    case "memory":
      return {title: "Lỗi quản lý bộ nhớ (heap/stack bị hỏng)",
        why: `Thư viện phát hiện bộ nhớ bị ghi đè hoặc giải phóng sai: <code>${esc(d.message)}</code>. Nguyên nhân thường gặp: <code>delete</code> 2 lần, <code>delete</code> con trỏ không phải do <code>new</code>, hoặc ghi vượt biên mảng ở đâu đó TRƯỚC dòng báo lỗi.`,
        tips: ["Tìm các chỗ ghi vào mảng/vector bằng chỉ số có thể vượt biên (dùng tab Tìm lỗi hoặc chạy debug).", "Mỗi <code>new</code> chỉ nên có đúng một <code>delete</code>; dùng <code>vector</code>/<code>unique_ptr</code> thay cho <code>new/delete</code> thủ công."],
        fig: figChain(d)};
    default:
      return {title: `Chương trình bị dừng bởi tín hiệu ${d.signal || ""}`,
        why: `Chương trình dừng ở ${line}${d.func ? ` trong hàm <code>${esc(d.func)}()</code>` : ""}.${d.ubMessage ? ` Thông báo: <code>${esc(d.ubMessage)}</code>.` : ""}${d.message ? ` Thông báo: <code>${esc(d.message)}</code>.` : ""}`,
        tips: ["Xem Call stack và giá trị biến bên dưới để biết trạng thái lúc lỗi.", "Bấm chế độ Debug và đi từng bước tới dòng này với cùng input."],
        fig: figChain(d)};
  }
}

function renderCrash(data) {
  const box = $("crash-box");
  box.textContent = "";
  box.hidden = false;
  const add = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; box.appendChild(n); return n; };

  if (data.status !== "ok") {
    add("h3", "", data.kind === "compile" ? "Lỗi biên dịch" : "Chưa giải thích được");
    add("p", "", esc(data.message || "Có lỗi xảy ra."));
    return;
  }
  if (data.kind === "no_crash") {
    add("h3", "", "Không phát hiện lỗi ngầm hay crash với input này");
    add("p", "", `Đã chạy lại với chế độ kiểm tra (chỉ số mảng/vector, con trỏ null, chia 0, thiếu return, tràn số int), chương trình thoát bình thường${data.exitCode ? ` với mã <b>${esc(data.exitCode)}</b> (code tự trả về mã khác 0, ví dụ <code>return ${esc(data.exitCode)};</code> trong <code>main</code> hoặc <code>exit(${esc(data.exitCode)})</code>)` : ""}.`);
    add("p", "", "Nếu trên máy khác vẫn bị lỗi, hãy kiểm tra input có giống hệt không (bao gồm cả khoảng trắng và dòng cuối).");
    return;
  }
  if (data.kind === "timeout") {
    add("h3", "", "Chương trình chạy quá lâu");
    add("p", "", "Nó không kết thúc trong thời gian cho phép (có thể là vòng lặp vô hạn hoặc thuật toán quá chậm), nên không có crash để giải thích. Hãy dùng chế độ Debug để xem vòng lặp đang quanh quẩn ở đâu.");
    return;
  }

  const t = crashText(data);
  add("h3", "", esc(t.title));
  add("p", "", t.why);
  const fig = add("div", "crash-fig");
  fig.innerHTML = t.fig;
  if (data.lineText && data.line) add("div", "crash-src", `${esc(data.line)} │ ${esc(data.lineText)}`);
  const ul = add("div", "");
  ul.innerHTML = `<p><b>Cách xử lý gợi ý</b></p><ul class="crash-tips">${t.tips.map((x) => `<li>${x}</li>`).join("")}</ul>`;

  if (data.overflow && data.kind !== "overflow") {
    const o = overflowFacts(data.overflow);
    add("p", "", `<b>Ngoài ra</b> trước khi lỗi, chương trình đã bị tràn số ở dòng ${esc(data.overflow.line)}: <code>${esc(o.expr)}</code> vượt giới hạn của <code>${esc(data.overflow.type)}</code>. Đây có thể là nguyên nhân gốc, hãy đổi sang <code>long long</code> rồi chạy lại.`);
  }

  if ((data.stack && data.stack.length) || (data.locals && data.locals.length)) {
    const det = add("details", "crash-stack");
    const frames = (data.stack || []).map((f) => `<li>${esc(f.func)}(${esc((f.args || []).map((a) => `${a[0]}=${a[1]}`).join(", "))}) — dòng ${esc(f.line)}</li>`).join("");
    const locals = (data.locals || []).map((v) => `<li>${esc(v[0])} = ${esc(v[1])}</li>`).join("");
    det.innerHTML = `<summary>Call stack và giá trị biến lúc lỗi</summary>` +
      (frames ? `<p>Các hàm đang chạy (mới nhất ở trên):</p><ol>${frames}</ol>` : "") +
      (locals ? `<p>Biến trong hàm <code>${esc(data.func)}</code>:</p><ol>${locals}</ol>` : "");
  }
  if (data.stderr) {
    const det = add("details", "crash-stack");
    det.innerHTML = `<summary>Thông báo gốc của chương trình</summary><div class="crash-src">${esc(data.stderr)}</div>`;
  }
}

$("explain-crash").addEventListener("click", async () => {
  const button = $("explain-crash");
  button.disabled = true;
  button.textContent = "Đang phân tích…";
  const box = $("crash-box");
  box.hidden = false;
  box.textContent = "Đang chạy lại chương trình với chế độ kiểm tra, có thể mất 5–30 giây…";
  try {
    const response = await fetch("/api/crash", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({code: lastRun.code, input: lastRun.input}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderCrash(await response.json());
  } catch (error) {
    box.textContent = `Không gọi được API: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "Phân tích lại";
  }
});


// ---------------------------------------------------------------
// Phát lại như video: ghi từng bước debug, tua tới/lui, phát tự động,
// chia sẻ bằng link hoặc tải về 1 file .html mở được ở mọi nơi (không cần máy chủ).
// ---------------------------------------------------------------
function frameCopy(data) {
  return {
    line: data.line || 0, function: data.function || "",
    variables: data.variables || [], stack: (data.stack || []).map((x) => ({function: x.function, line: x.line})),
    stdout: data.stdout || "", finished: Boolean(data.finished), error: data.error || "",
  };
}

function replayReset(code, input) {
  replayStop();
  replay.frames = [];
  replay.idx = -1;
  replay.viewOnly = false;
  replay.code = code;
  replay.input = input;
  replayRefresh();
}

function recordFrame(data) {
  if (replay.viewOnly) return;
  if (replay.frames.length >= REPLAY_MAX_FRAMES) return;
  replay.frames.push(frameCopy(data));
  replay.idx = replay.frames.length - 1;
  replayRefresh();
}

function replayRefresh() {
  const n = replay.frames.length;
  $("replay-bar").hidden = n === 0;
  $("rp-slider").max = String(Math.max(0, n - 1));
  $("rp-slider").value = String(Math.max(0, replay.idx));
  $("rp-label").textContent = n ? `Bước ${replay.idx + 1}/${n}` : "";
  $("rp-prev").disabled = replay.idx <= 0;
  $("rp-first").disabled = replay.idx <= 0;
  $("rp-next").disabled = replay.idx >= n - 1;
  $("rp-play").textContent = replay.timer !== null ? "Ⅱ Dừng" : "▶ Phát";
  $("rp-share").disabled = n < 2 || replay.recording;
  $("rp-download").disabled = n < 2 || replay.recording;
  $("rp-record").hidden = replay.viewOnly;
  $("rp-record").disabled = !replay.recording && (!debugSessionId || debugFinished);
  $("rp-record").textContent = replay.recording ? "■ Dừng ghi" : "⏩ Ghi cả chương trình";
}

function replayGo(index) {
  const n = replay.frames.length;
  if (!n) return;
  replay.idx = Math.max(0, Math.min(n - 1, index));
  const frame = replay.frames[replay.idx];
  drawFrame(frame);
  const fn = frame.function ? ` trong ${frame.function}()` : "";
  const live = debugSessionId && replay.idx === n - 1 && !replay.viewOnly;
  setDebugStatus(frame.error || `Bước ${replay.idx + 1}/${n}${fn}${frame.line ? ` · dòng ${frame.line}` : ""}${frame.finished ? " · chương trình kết thúc" : ""}`,
    replay.viewOnly ? "Phát lại" : (live ? "Đang debug" : "Đang xem lại"), frame.error ? "error" : "success");
  replayRefresh();
}

function replayStop() {
  if (replay.timer !== null) clearTimeout(replay.timer);
  replay.timer = null;
}

function replayPlay() {
  if (replay.timer !== null) { replayStop(); replayRefresh(); return; }
  stopDebugTimer();
  if (replay.idx >= replay.frames.length - 1) replayGo(0);
  const tick = () => {
    if (replay.idx >= replay.frames.length - 1) { replayStop(); replayRefresh(); return; }
    replayGo(replay.idx + 1);
    if (replay.idx >= replay.frames.length - 1) { replayStop(); replayRefresh(); return; }
    replay.timer = setTimeout(tick, Number($("rp-speed").value));
  };
  replay.timer = setTimeout(tick, 150);
  replayRefresh();
}

$("rp-play").addEventListener("click", replayPlay);
$("rp-first").addEventListener("click", () => { replayStop(); replayGo(0); });
$("rp-prev").addEventListener("click", () => { replayStop(); stopDebugTimer(); replayGo(replay.idx - 1); });
$("rp-next").addEventListener("click", () => { replayStop(); stopDebugTimer(); replayGo(replay.idx + 1); });
$("rp-slider").addEventListener("input", () => { replayStop(); stopDebugTimer(); replayGo(Number($("rp-slider").value)); });
$("rp-speed").addEventListener("change", () => {
  if (replay.timer !== null) { replayStop(); replayPlay(); }
});

// Chạy nhanh toàn bộ chương trình để ghi lại (dừng khi kết thúc, khi bấm Dừng ghi hoặc đủ số bước tối đa).
$("rp-record").addEventListener("click", async () => {
  if (replay.recording) { replay.recording = false; return; }
  if (!debugSessionId || debugFinished || debugBusy) return;
  stopDebugTimer();
  replayStop();
  replay.recording = true;
  if (replay.frames.length) replayGo(replay.frames.length - 1);
  replayRefresh();
  try {
    while (replay.recording && debugSessionId && !debugFinished && replay.frames.length < REPLAY_MAX_FRAMES) {
      const data = await performDebugStep(true);
      if (!data) break;
      $("rp-label").textContent = `Đang ghi… ${replay.frames.length} bước`;
    }
  } finally {
    const reachedCap = replay.frames.length >= REPLAY_MAX_FRAMES && !debugFinished;
    replay.recording = false;
    replayRefresh();
    showToast(reachedCap
      ? `Đã ghi tối đa ${REPLAY_MAX_FRAMES} bước đầu tiên. Bấm ▶ Phát để xem lại.`
      : `Đã ghi ${replay.frames.length} bước. Bấm ▶ Phát để xem lại, hoặc chia sẻ.`);
    replayGo(0);
  }
});

// ---- Đóng gói để chia sẻ (bỏ các trường mặc định, chỉ lưu phần thay đổi) ----
function slimVars(vars) {
  return (vars || []).map((v) => {
    const o = {n: v.name, v: v.value, t: v.type};
    if (v.uninitialized) o.u = 1;
    if (v.arrayLike) o.a = 1;
    if (v.expandable) o.e = 1;
    if (v.numChildren) o.k = v.numChildren;
    if (v.children && v.children.length) o.c = v.children;
    return o;
  });
}

function fatVars(vars) {
  return vars.map((o) => ({
    name: o.n, value: o.v, type: o.t, uninitialized: Boolean(o.u), arrayLike: Boolean(o.a),
    expandable: Boolean(o.e), numChildren: o.k || 0, children: o.c || [],
  }));
}

function packFrames(frames) {
  let prevV = null, prevS = null, prevOut = "";
  return frames.map((f) => {
    const vJ = JSON.stringify(slimVars(f.variables));
    const sJ = JSON.stringify(f.stack.map((x) => [x.function, x.line]));
    const outAppend = f.stdout.startsWith(prevOut);
    const row = [
      f.line, f.function,
      vJ === prevV ? 0 : JSON.parse(vJ),
      sJ === prevS ? 0 : JSON.parse(sJ),
      outAppend ? 1 : 0, outAppend ? f.stdout.slice(prevOut.length) : f.stdout,
      f.finished ? 1 : 0, f.error,
    ];
    prevV = vJ; prevS = sJ; prevOut = f.stdout;
    return row;
  });
}

function unpackFrames(rows) {
  let vars = [], stack = [], out = "";
  return rows.map((r) => {
    if (r[2] !== 0) vars = fatVars(r[2]);
    if (r[3] !== 0) stack = r[3].map((x) => ({function: x[0], line: x[1]}));
    out = r[4] ? out + r[5] : r[5];
    return {line: r[0], function: r[1], variables: vars, stack, stdout: out, finished: Boolean(r[6]), error: r[7] || ""};
  });
}

function replayPayload() {
  const origin = /^https?:/.test(location.protocol) ? location.origin + location.pathname : (replay.origin || "");
  return {c: replay.code, i: replay.input, o: origin, f: packFrames(replay.frames)};
}

$("rp-share").addEventListener("click", async () => {
  try {
    const encoded = await encodeShare(replayPayload());
    const url = `${location.origin}${location.pathname}#${encoded}`;
    if (url.length > 60000) {
      showToast("Bản ghi quá dài để chia sẻ bằng link. Hãy bấm “Tải file .html” rồi gửi file.", true);
      return;
    }
    history.replaceState(null, "", `#${encoded}`);
    const ok = await copyText(url);
    showToast(ok
      ? (url.length > 8000 ? "Đã chép link (khá dài, nếu app chat cắt link thì dùng “Tải file .html”)." : "Đã sao chép link phát lại!")
      : "Không tự sao chép được. Hãy copy link trên thanh địa chỉ.", !ok);
  } catch (error) {
    showToast("Không tạo được link phát lại.", true);
  }
});

async function buildReplayHtml() {
  const [html, css, js] = await Promise.all(["./", "./static/app.css", "./static/app.js"].map(async (u) => {
    const response = await fetch(u);
    if (!response.ok) throw new Error(u);
    return response.text();
  }));
  const data = JSON.stringify(replayPayload()).replace(/</g, "\\u003c");
  const script = `<script>window.__REPLAY__=${data};<\/script>\n<script>${js.replace(/<\/script/gi, "<\\/script")}<\/script>`;
  return html
    .replace(/<link rel="stylesheet" href="\/static\/app\.css"\s*\/?>/, () => `<style>${css}</style>`)
    .replace(/<script src="\/static\/app\.js"><\/script>/, () => script)
    .replace(/<title>[^<]*<\/title>/, "<title>C++ Flow – Phát lại</title>");
}

$("rp-download").addEventListener("click", async () => {
  try {
    const text = await buildReplayHtml();
    const blob = new Blob([text], {type: "text/html;charset=utf-8"});
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "cpp-flow-replay.html";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    showToast("Đã tải file phát lại. Gửi file này cho bạn bè, mở bằng trình duyệt là xem được.");
  } catch (error) {
    showToast("Không tạo được file phát lại (cần mở web qua máy chủ).", true);
  }
});

// ---- Chế độ chỉ xem (mở từ link hoặc từ file .html được chia sẻ) ----
function enterReplayView(payload) {
  const frames = unpackFrames(payload.f);
  if (!frames.length) { showToast("Bản phát lại trống.", true); return; }
  document.body.classList.add("replay-view");
  replay.viewOnly = true;
  replay.frames = frames;
  replay.code = String(payload.c || "");
  replay.input = String(payload.i || "");
  replay.origin = String(payload.o || "");
  debugSourceCode = replay.code;
  $("code").value = replay.code;
  $("stdin").value = replay.input;
  updateCodeHighlight();
  updateLineCount();
  setView("debug");
  const open = $("rp-open");
  if (replay.origin) { open.href = replay.origin; open.hidden = false; }
  $("rp-download").hidden = !/^https?:/.test(location.protocol);
  replayGo(0);
  setTimeout(replayPlay, 700);
}

$("rp-open").addEventListener("click", (event) => {
  // Nút "Tự thử với code này": nạp code + input vào web để người xem chạy/debug tiếp.
  event.preventDefault();
  (async () => {
    const encoded = await encodeShare({c: replay.code, i: replay.input, v: "debug"});
    const base = replay.origin || (location.origin + location.pathname);
    window.open(`${base}#${encoded}`, "_blank", "noopener");
  })();
});

if (window.__REPLAY__) enterReplayView(window.__REPLAY__);


// ---------------------------------------------------------------
// Diễn đàn: đăng code, like/unlike, bình luận, ghi chú theo dòng.
// Mọi nội dung người dùng chỉ được đưa vào trang bằng textContent (không bao giờ là HTML).
// ---------------------------------------------------------------
const forum = {admin: false, key: "", sort: "new", query: "", page: 1, status: null, postId: null, post: null, loaded: false, busy: false};

function forumKey() {
  if (forum.key) return forum.key;
  let key = "";
  try { key = localStorage.getItem("cppflow_forum_key") || ""; } catch (e) { key = ""; }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    key = bytesToB64Url(bytes);
    try { localStorage.setItem("cppflow_forum_key", key); } catch (e) { /* dùng tạm trong phiên */ }
  }
  forum.key = key;
  return key;
}

function forumName() {
  try { return localStorage.getItem("cppflow_forum_name") || ""; } catch (e) { return ""; }
}
function saveForumName(name) {
  try { localStorage.setItem("cppflow_forum_name", name); } catch (e) { /* bỏ qua */ }
}
function adminToken() {
  try { return sessionStorage.getItem("cppflow_admin") || ""; } catch (e) { return ""; }
}

async function forumApi(method, path, body) {
  const headers = {"X-Forum-Key": forumKey()};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = adminToken();
  if (token) headers["X-Admin-Token"] = token;
  const response = await fetch(path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
  let data = {};
  try { data = await response.json(); } catch (e) { /* không phải JSON */ }
  if (!response.ok) throw new Error(data.message || data.detail || `Lỗi ${response.status}`);
  return data;
}

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} ngày trước`;
  return new Date(ts * 1000).toLocaleDateString("vi-VN");
}

function fEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showForumPane(name) {
  $("forum-list-view").hidden = name !== "list";
  $("forum-new-view").hidden = name !== "new";
  $("forum-post-view").hidden = name !== "post";
  window.scrollTo({top: 0});
}

async function forumEnter() {
  if (!forum.status) {
    try {
      forum.status = await (await fetch("/api/forum/status")).json();
    } catch (e) { forum.status = {enabled: false}; }
    const note = $("forum-note");
    if (forum.status.storage === "sqlite") {
      note.textContent = "Diễn đàn đang chạy ở chế độ thử (chưa nối cơ sở dữ liệu), bài đăng sẽ mất khi máy chủ khởi động lại.";
      note.hidden = false;
    }
    $("forum-admin").hidden = !forum.status.adminEnabled;
    if (forum.status.adminEnabled && adminToken()) {
      try { await forumApi("GET", "/api/forum/admin/check"); setAdminMode(true); } catch (e) { setAdminMode(false); }
    }
  }
  if (forum.postId) return;                 // đang mở một bài: giữ nguyên
  if ($("forum-new-view").hidden === false) return;
  showForumPane("list");
  if (!forum.loaded) await forumLoadList(true);
}

async function forumLoadList(reset) {
  if (forum.busy) return;
  forum.busy = true;
  if (reset) { forum.page = 1; $("forum-cards").replaceChildren(fEl("p", "forum-empty", "Đang tải…")); }
  try {
    const data = await forumApi("GET", `/api/forum/posts?sort=${forum.sort}&q=${encodeURIComponent(forum.query)}&page=${forum.page}`);
    const box = $("forum-cards");
    if (reset) box.replaceChildren();
    if (reset && !data.posts.length) box.appendChild(fEl("p", "forum-empty", forum.query ? "Không có bài nào khớp." : "Chưa có bài nào. Hãy là người đăng đầu tiên!"));
    data.posts.forEach((post) => box.appendChild(forumCard(post)));
    $("forum-more").hidden = !data.hasMore;
    forum.loaded = true;
  } catch (error) {
    $("forum-cards").replaceChildren(fEl("p", "forum-empty", error.message));
  } finally {
    forum.busy = false;
  }
}

function forumCard(post) {
  const card = fEl("article", "forum-card");
  card.tabIndex = 0;
  card.appendChild(fEl("h3", "", post.title));
  const meta = fEl("div", "forum-meta");
  [post.author, timeAgo(post.createdAt), `👍 ${post.likes}`, `👎 ${post.dislikes}`, `💬 ${post.comments}`, `${post.lines} dòng`]
    .forEach((text) => meta.appendChild(fEl("span", "", text)));
  card.appendChild(meta);
  if (post.description) card.appendChild(fEl("p", "forum-desc", post.description));
  card.appendChild(fEl("pre", "forum-pre", post.preview));
  const open = () => forumOpenPost(post.id);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  return card;
}

let forumSearchTimer = null;
$("forum-search").addEventListener("input", () => {
  clearTimeout(forumSearchTimer);
  forumSearchTimer = setTimeout(() => { forum.query = $("forum-search").value.trim(); forumLoadList(true); }, 350);
});
$("forum-sort").addEventListener("change", () => { forum.sort = $("forum-sort").value; forumLoadList(true); });
$("forum-more").addEventListener("click", () => { forum.page += 1; forumLoadList(false); });

// ---- Quản trị viên ----
const REASON_LABELS = {spam: "Spam", scam: "Link/lừa đảo", malware: "Code độc hại", inappropriate: "Không phù hợp", other: "Khác"};

function askReportReason() {
  const dialog = $("report-dialog");
  return new Promise((resolve) => {
    const form = $("report-form");
    const done = () => {
      dialog.removeEventListener("close", done);
      const value = dialog.returnValue === "send" ? (new FormData(form).get("reason") || "other") : null;
      resolve(value);
    };
    dialog.returnValue = "";
    dialog.addEventListener("close", done);
    dialog.showModal();
  });
}

function setAdminMode(on) {
  forum.admin = on;
  $("forum-admin-bar").hidden = !on;
  $("forum-admin").textContent = on ? "Thoát quản trị" : "Quản trị";
  if (!on) showForumTab("posts");
  else forumApi("GET", "/api/forum/admin/queue").then((d) => {
    $("fa-count").textContent = String(d.pending);
    $("fa-count").hidden = d.pending === 0;
  }).catch(() => {});
}

function showForumTab(tab) {
  const queue = tab === "queue";
  $("forum-queue").hidden = !queue;
  $("forum-cards").hidden = queue;
  $("forum-more").parentElement.hidden = queue;
  $("fa-tab-posts").classList.toggle("active", !queue);
  $("fa-tab-queue").classList.toggle("active", queue);
  if (queue) forumLoadQueue();
}

async function forumLoadQueue() {
  const box = $("forum-queue");
  box.replaceChildren(fEl("p", "forum-empty", "Đang tải…"));
  try {
    const data = await forumApi("GET", "/api/forum/admin/queue");
    $("fa-count").textContent = String(data.pending);
    $("fa-count").hidden = data.pending === 0;
    box.replaceChildren();
    if (!data.items.length) box.appendChild(fEl("p", "forum-empty", "Không có nội dung nào đang bị báo cáo. 🎉"));
    data.items.forEach((item) => box.appendChild(queueCard(item)));
  } catch (error) {
    box.replaceChildren(fEl("p", "forum-empty", error.message));
  }
}

function queueCard(item) {
  const card = fEl("article", "forum-card q-card");
  const chips = fEl("div", "q-chips");
  chips.appendChild(fEl("span", `q-chip ${item.pending ? "pending" : "shown"}`, item.pending ? "Đang bị ẩn, chờ duyệt" : "Đang hiển thị"));
  chips.appendChild(fEl("span", "q-chip", item.kind === "post" ? "Bài đăng" : `Bình luận${item.line ? ` (dòng ${item.line})` : ""}`));
  chips.appendChild(fEl("span", "q-chip", `${item.reports} báo cáo`));
  Object.entries(item.reasons).forEach(([reason, n]) => chips.appendChild(fEl("span", "q-chip", `${REASON_LABELS[reason] || reason} ×${n}`)));
  card.appendChild(chips);
  if (item.title) card.appendChild(fEl("h3", "", item.title));
  card.appendChild(fEl("div", "forum-meta", `${item.author} · ${timeAgo(item.createdAt)}`));
  if (item.text) card.appendChild(fEl("p", "q-body", item.text));
  if (item.code) card.appendChild(fEl("pre", "forum-pre", item.code));
  const actions = fEl("div", "fp-actions");
  const keep = fEl("button", "share-button", "Giữ lại (bỏ qua báo cáo)");
  const del = fEl("button", "share-button", "Xóa");
  const resolve = async (action) => {
    if (action === "delete" && !confirm("Xóa nội dung này?")) return;
    try {
      await forumApi("POST", `/api/forum/admin/${item.kind}/${item.id}/resolve`, {action});
      showToast(action === "keep" ? "Đã giữ lại nội dung." : "Đã xóa nội dung.");
      forum.loaded = false;
      forumLoadQueue();
    } catch (e) { showToast(e.message, true); }
  };
  keep.addEventListener("click", () => resolve("keep"));
  del.addEventListener("click", () => resolve("delete"));
  actions.append(keep, del);
  if (item.kind === "post" && !item.pending) {
    const view = fEl("button", "share-button", "Xem bài");
    view.addEventListener("click", () => forumOpenPost(item.id));
    actions.appendChild(view);
  }
  card.appendChild(actions);
  return card;
}

$("fa-tab-posts").addEventListener("click", () => showForumTab("posts"));
$("fa-tab-queue").addEventListener("click", () => showForumTab("queue"));

$("forum-admin").addEventListener("click", async () => {
  if (forum.admin) {
    try { sessionStorage.removeItem("cppflow_admin"); } catch (e) { /* bỏ qua */ }
    setAdminMode(false);
    showToast("Đã thoát chế độ quản trị.");
    forumLoadList(true);
    return;
  }
  const token = prompt("Nhập mã quản trị:");
  if (!token) return;
  try { sessionStorage.setItem("cppflow_admin", token.trim()); } catch (e) { /* bỏ qua */ }
  try {
    await forumApi("GET", "/api/forum/admin/check");
    setAdminMode(true);
    showToast("Đã bật chế độ quản trị.");
    forumLoadList(true);
    showForumTab("queue");
  } catch (error) {
    try { sessionStorage.removeItem("cppflow_admin"); } catch (e) { /* bỏ qua */ }
    showToast("Mã quản trị không đúng.", true);
  }
});

// ---- Đăng bài ----
$("forum-new").addEventListener("click", () => {
  $("fn-name").value = forumName();
  $("fn-error").hidden = true;
  showForumPane("new");
});
$("forum-new-back").addEventListener("click", () => showForumPane(forum.postId ? "post" : "list"));
$("fn-fill").addEventListener("click", () => {
  $("fn-code").value = $("code").value;
  if (!$("fn-input").value) $("fn-input").value = $("stdin").value;
});
$("fn-submit").addEventListener("click", async () => {
  const button = $("fn-submit");
  const error = $("fn-error");
  error.hidden = true;
  button.disabled = true;
  try {
    const name = $("fn-name").value.trim();
    saveForumName(name);
    const data = await forumApi("POST", "/api/forum/posts", {
      title: $("fn-title").value, description: $("fn-desc").value, code: $("fn-code").value,
      input: $("fn-input").value, author: name,
    });
    ["fn-title", "fn-desc", "fn-code", "fn-input"].forEach((id) => { $(id).value = ""; });
    forum.loaded = false;
    showToast("Đã đăng bài!");
    await forumOpenPost(data.id);
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

// ---- Xem một bài ----
function forumBack() {
  forum.postId = null;
  forum.post = null;
  history.replaceState(null, "", location.pathname + location.search);
  showForumPane("list");
  if (!forum.loaded) forumLoadList(true);
}

async function forumOpenPost(id) {
  forum.postId = id;
  const view = $("forum-post-view");
  view.replaceChildren(fEl("p", "forum-empty", "Đang tải…"));
  showForumPane("post");
  try {
    forum.post = await forumApi("GET", `/api/forum/posts/${id}`);
    history.replaceState(null, "", `#f${id}`);
    forumRenderPost();
  } catch (error) {
    forum.postId = null;
    view.replaceChildren();
    const back = fEl("button", "share-button", "← Về danh sách");
    back.addEventListener("click", forumBack);
    view.append(fEl("p", "forum-empty", error.message), back);
  }
}

function forumRenderPost() {
  const post = forum.post;
  const view = $("forum-post-view");
  const box = fEl("div", "fp");

  const back = fEl("button", "text-button", "← Về danh sách");
  back.addEventListener("click", forumBack);
  box.appendChild(back);
  box.appendChild(fEl("h2", "", post.title));
  const meta = fEl("div", "forum-meta");
  [post.author, timeAgo(post.createdAt), `${post.lines} dòng`].forEach((t) => meta.appendChild(fEl("span", "", t)));
  box.appendChild(meta);
  if (post.description) box.appendChild(fEl("p", "forum-desc", post.description));

  // hàng nút
  const actions = fEl("div", "fp-actions");
  const likeBtn = fEl("button", `share-button vote-btn${post.myVote === 1 ? " active" : ""}`, `👍 ${post.likes}`);
  const dislikeBtn = fEl("button", `share-button vote-btn down${post.myVote === -1 ? " active" : ""}`, `👎 ${post.dislikes}`);
  const castVote = async (value) => {
    try {
      const result = await forumApi("POST", `/api/forum/posts/${post.id}/vote`, {value: post.myVote === value ? 0 : value});
      Object.assign(post, {likes: result.likes, dislikes: result.dislikes, myVote: result.myVote});
      forum.loaded = false;
      forumRenderPost();
    } catch (e) { showToast(e.message, true); }
  };
  likeBtn.addEventListener("click", () => castVote(1));
  dislikeBtn.addEventListener("click", () => castVote(-1));
  const openRun = fEl("button", "share-button", "Mở trong trình soạn");
  const openDebug = fEl("button", "share-button", "Debug code này");
  const loadIntoEditor = (view) => {
    markDebugSourceChanged();
    $("code").value = post.code;
    $("stdin").value = post.input || "";
    updateCodeHighlight();
    updateLineCount();
    setView(view);
  };
  openRun.addEventListener("click", () => loadIntoEditor("run"));
  openDebug.addEventListener("click", () => loadIntoEditor("debug"));
  const copyLink = fEl("button", "share-button", "Chép link bài");
  copyLink.addEventListener("click", async () => {
    const ok = await copyText(`${location.origin}${location.pathname}#f${post.id}`);
    showToast(ok ? "Đã sao chép link bài." : "Không tự sao chép được.", !ok);
  });
  const reportBtn = fEl("button", "share-button", "Báo cáo");
  reportBtn.addEventListener("click", async () => {
    const reason = await askReportReason();
    if (!reason) return;
    try {
      const r = await forumApi("POST", `/api/forum/post/${post.id}/report`, {reason});
      showToast(r.hidden ? "Bài đã bị ẩn tạm thời và chờ quản trị viên duyệt." : "Đã gửi báo cáo, cảm ơn bạn.");
      if (r.hidden) { forum.loaded = false; forumBack(); }
    } catch (e) { showToast(e.message, true); }
  });
  actions.append(likeBtn, dislikeBtn, openRun, openDebug, copyLink, reportBtn);
  if (post.canDelete) {
    const del = fEl("button", "share-button", "Xóa bài");
    del.addEventListener("click", async () => {
      if (!confirm("Xóa bài này?")) return;
      try { await forumApi("DELETE", `/api/forum/post/${post.id}`); forum.loaded = false; showToast("Đã xóa bài."); forumBack(); }
      catch (e) { showToast(e.message, true); }
    });
    actions.appendChild(del);
  }
  box.appendChild(actions);

  // code theo từng dòng, ghi chú dưới dòng tương ứng
  box.appendChild(fEl("p", "muted-text", "Bấm vào số dòng để ghi chú cho dòng đó."));
  const byLine = {};
  post.commentList.filter((c) => c.line).forEach((c) => { (byLine[c.line] = byLine[c.line] || []).push(c); });
  const codeBox = fEl("div", "fp-code");
  post.code.split("\n").forEach((text, index) => {
    const n = index + 1;
    const row = fEl("div", "fp-line");
    const num = fEl("button", "fp-num", String(n));
    num.title = `Ghi chú cho dòng ${n}`;
    row.append(num, fEl("span", "fp-text", text || " "));
    codeBox.appendChild(row);
    (byLine[n] || []).forEach((c) => codeBox.appendChild(forumNote(c, "fp-note", true)));
    num.addEventListener("click", () => forumInlineForm(codeBox, row, n));
  });
  box.appendChild(codeBox);

  // bình luận chung
  const general = post.commentList.filter((c) => !c.line);
  const total = post.commentList.length;
  box.appendChild(fEl("h3", "", `Bình luận (${total})`));
  const list = fEl("div", "fp-comments");
  if (!general.length) list.appendChild(fEl("p", "muted-text", "Chưa có bình luận chung."));
  general.forEach((c) => list.appendChild(forumNote(c, "fp-comment", false)));
  box.appendChild(list);

  const form = fEl("div", "fp-form");
  const name = fEl("input", "forum-input");
  name.placeholder = "Tên của bạn (Ẩn danh)";
  name.maxLength = 30;
  name.value = forumName();
  const text = fEl("textarea", "forum-input wide");
  text.rows = 3;
  text.maxLength = 1000;
  text.placeholder = "Viết bình luận… (không chứa link)";
  const send = fEl("button", "share-button forum-primary", "Gửi bình luận");
  send.addEventListener("click", () => forumSendComment(post.id, name, text, null, send));
  form.append(name, text, send);
  box.appendChild(form);

  view.replaceChildren(box);
}

function forumNote(c, className, isLine) {
  const node = fEl("div", className);
  node.appendChild(fEl("b", "", c.author));
  node.appendChild(fEl("span", "mini", `${isLine ? `dòng ${c.line} · ` : ""}${timeAgo(c.createdAt)}`));
  if (c.canDelete) {
    const del = fEl("button", "mini-btn", "xóa");
    del.addEventListener("click", async () => {
      try { await forumApi("DELETE", `/api/forum/comment/${c.id}`); forumOpenPost(forum.postId); }
      catch (e) { showToast(e.message, true); }
    });
    node.appendChild(del);
  }
  const report = fEl("button", "mini-btn", "báo cáo");
  report.addEventListener("click", async () => {
    const reason = await askReportReason();
    if (!reason) return;
    try { const r = await forumApi("POST", `/api/forum/comment/${c.id}/report`, {reason}); showToast(r.hidden ? "Bình luận đã bị ẩn tạm thời và chờ quản trị viên duyệt." : "Đã gửi báo cáo, cảm ơn bạn."); if (r.hidden) forumOpenPost(forum.postId); }
    catch (e) { showToast(e.message, true); }
  });
  node.appendChild(report);
  node.appendChild(document.createElement("br"));
  node.appendChild(document.createTextNode(c.body));
  return node;
}

function forumInlineForm(codeBox, row, line) {
  codeBox.querySelectorAll(".fp-inline").forEach((n) => n.remove());
  const form = fEl("div", "fp-inline");
  const name = fEl("input", "forum-input");
  name.placeholder = "Tên của bạn (Ẩn danh)";
  name.maxLength = 30;
  name.value = forumName();
  const text = fEl("textarea", "forum-input");
  text.rows = 2;
  text.maxLength = 1000;
  text.placeholder = `Ghi chú cho dòng ${line}…`;
  const bar = fEl("div", "fp-actions");
  const send = fEl("button", "share-button forum-primary", "Lưu ghi chú");
  const cancel = fEl("button", "text-button", "Hủy");
  cancel.addEventListener("click", () => form.remove());
  send.addEventListener("click", () => forumSendComment(forum.postId, name, text, line, send));
  bar.append(send, cancel);
  form.append(name, text, bar);
  // chèn ngay dưới dòng (và dưới các ghi chú đã có của dòng đó)
  let anchor = row;
  while (anchor.nextSibling && anchor.nextSibling.classList && anchor.nextSibling.classList.contains("fp-note")) anchor = anchor.nextSibling;
  anchor.after(form);
  text.focus();
}

async function forumSendComment(postId, nameInput, textInput, line, button) {
  button.disabled = true;
  try {
    saveForumName(nameInput.value.trim());
    await forumApi("POST", `/api/forum/posts/${postId}/comments`, {body: textInput.value, line, author: nameInput.value.trim()});
    forum.loaded = false;
    await forumOpenPost(postId);
    showToast(line ? "Đã lưu ghi chú." : "Đã gửi bình luận.");
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
  }
}

// Link trực tiếp tới một bài: #f<số>
(function openForumFromHash() {
  const match = /^#f(\d+)$/.exec(location.hash);
  if (!match) return;
  setView("forum");
  forumOpenPost(Number(match[1]));
})();
