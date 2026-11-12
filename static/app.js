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

function updateCodeHighlight() {
  const editor = $("code");
  const highlight = $("code-highlight");
  if (!editor || !highlight) return;

  highlight.innerHTML = cppHighlight.highlight(editor.value);
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
}

$("code").addEventListener("input", updateCodeHighlight);

$("code").addEventListener("scroll", () => {
  const highlight = $("code-highlight");
  highlight.scrollTop = $("code").scrollTop;
  highlight.scrollLeft = $("code").scrollLeft;
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

document.querySelectorAll(".mode-tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".mode-tab").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    currentMode = button.dataset.mode;
    const descriptions = {
      normal: "Dùng Debugger từng bước để theo dõi dòng hiện tại, biến và call stack. Các tab Đồ thị/Cây hiện vẫn là ví dụ C++ thông thường.",
      graph: "Chế độ Đồ thị hiện có ví dụ code C++ để chạy. Vẽ đỉnh/cạnh và đồng bộ BFS, DFS, Dijkstra sẽ được bổ sung ở giai đoạn sau.",
      tree: "Chế độ Cây hiện có ví dụ code C++ để chạy. Vẽ nút và đồng bộ thao tác Segment Tree/Fenwick Tree sẽ được bổ sung ở giai đoạn sau."
    };
    $("mode-description").textContent = descriptions[currentMode];
    $("code").value = examples[currentMode];
    updateCodeHighlight();
    updateLineCount();
    if (typeof markDebugSourceChanged === "function") markDebugSourceChanged();
    $("stdin").value = exampleInputs[currentMode];
    clearOutput();
  });
});

$("reset-code").addEventListener("click", () => {
  $("code").value = examples[currentMode];
  updateCodeHighlight();
  updateLineCount();
  if (typeof markDebugSourceChanged === "function") markDebugSourceChanged();
  $("stdin").value = exampleInputs[currentMode];
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

function clearOutput() {
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
      badge.innerHTML = `<span class="status-dot"></span> Backend đang hoạt động · ${modeLabel}`;
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
  document.querySelectorAll(".speed-option").forEach((button) => {
    button.disabled = !active;
  });
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

function renderDebugVariables(rows) {
  const container = $("debug-variables");
  const scalarRows = (rows || []).filter((variable) => {
    const type = String(variable.type || "");
    const isArray = Boolean(variable.arrayLike)
      || type.includes("[")
      || type.includes("vector<")
      || type.includes("std::array<");
    return !isArray;
  });

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
    [variable.name ?? "—", variable.type || "—", variable.value ?? "—"].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = String(value);
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
  const arrays = (rows || []).filter((variable) => {
    const type = String(variable.type || "");
    return Boolean(variable.arrayLike)
      || type.includes("[")
      || type.includes("vector<")
      || type.includes("std::array<");
  });

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

    const headRow = document.createElement("tr");
    const indexHead = document.createElement("th");
    indexHead.textContent = "Chỉ số";
    headRow.appendChild(indexHead);
    const valueHead = document.createElement("th");
    valueHead.textContent = "Giá trị";
    headRow.appendChild(valueHead);
    const thead = document.createElement("thead");
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    (array.children || []).forEach((child, index) => {
      const row = document.createElement("tr");
      const indexCell = document.createElement("td");
      indexCell.textContent = child.name || `[${index}]`;
      const valueCell = document.createElement("td");
      valueCell.textContent = child.value ?? "—";
      valueCell.style.whiteSpace = "nowrap";
      row.append(indexCell, valueCell);
      tbody.appendChild(row);
    });
    if (total > loaded) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 2;
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
    setDebugStatus(`Đang dừng${fn}${data.line ? ` tại dòng ${data.line}` : ""}.`, "Đang debug", "success");
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
  if (debugSessionId) {
    stopDebugTimer();
    setDebugStatus("Mã nguồn đã thay đổi. Phiên debug vẫn dùng bản code lúc bắt đầu; hãy dừng và bắt đầu lại để áp dụng.", "Code đã đổi", "neutral");
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
  $("debug-source").textContent = "Đang biên dịch…";
  $("debug-variables").textContent = "Đang chờ dữ liệu biến…";
  $("debug-stack").textContent = "Đang chờ call stack…";
  $("debug-output").textContent = "(chưa có output)";
  try {
    const data = await debugApi("/api/debug/start", {code, input: $("stdin").value});
    debugSessionId = data.sessionId;
    renderDebugState(data);
  } catch (error) {
    setDebugStatus(error.message, "Lỗi debug", "error");
    $("debug-source").textContent = "Không thể bắt đầu debugger.";
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

$("debug-stop").addEventListener("click", async () => {
  stopDebugTimer();
  const oldId = debugSessionId;
  debugSessionId = null;
  if (oldId) {
    try { await debugApi(`/api/debug/${oldId}/stop`); } catch {}
  }
  debugBusy = false;
  debugFinished = true;
  setDebugStatus("Đã dừng phiên debug.", "Đã dừng", "neutral");
  $("debug-start").disabled = false;
  $("debug-pause").disabled = true;
  $("debug-step").disabled = true;
  $("debug-into").disabled = true;
  $("debug-stop").disabled = true;
  document.querySelectorAll(".speed-option").forEach((button) => { button.disabled = true; });
});

document.querySelectorAll(".speed-option").forEach((button) => {
  button.addEventListener("click", () => {
    debugSpeed = Number(button.dataset.speed);
    document.querySelectorAll(".speed-option").forEach((b) => b.classList.toggle("active", b === button));
    if (debugSessionId && debugTimer !== null) {
      stopDebugTimer();
      scheduleAutoStep();
    }
  });
});

// Stop auto stepping when the user edits source: the current debug session runs a snapshot.
$("code").addEventListener("input", markDebugSourceChanged);