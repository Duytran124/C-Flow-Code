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
  if (previousView !== "stress" && view === "stress") enterStress();
  else if (previousView === "stress" && view !== "stress") leaveStress();
  $("workspace").dataset.view = view;
  document.querySelectorAll(".hide-in-stress").forEach((element) => { element.hidden = view === "stress"; });
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

function renderDebugState(data) {
  if (!data || typeof data !== "object") {
    setDebugStatus("Backend không trả về trạng thái debug hợp lệ.", "Lỗi debug", "error");
    return;
  }
  debugFinished = Boolean(data.finished);
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
    add("p", "", `Đã chạy lại với chế độ kiểm tra (chỉ số mảng/vector, con trỏ null, chia 0, thiếu return), chương trình thoát bình thường${data.exitCode ? ` với mã <b>${esc(data.exitCode)}</b> (code tự trả về mã khác 0, ví dụ <code>return ${esc(data.exitCode)};</code> trong <code>main</code> hoặc <code>exit(${esc(data.exitCode)})</code>)` : ""}.`);
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
