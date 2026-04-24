export function renderDebugHtml(liveUrl: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stelle Debug</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #081018;
      --bg-soft: #0d1722;
      --panel: rgba(16, 25, 38, 0.96);
      --panel-soft: #142131;
      --line: rgba(255, 255, 255, 0.08);
      --line-strong: rgba(121, 214, 198, 0.22);
      --text: #e9eef8;
      --muted: #94a7bc;
      --accent: #79d6c6;
      --danger: #ef8a8a;
      --shadow: 0 24px 60px rgba(0, 0, 0, 0.32);
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top, rgba(78, 152, 178, 0.16), transparent 0 36%),
        linear-gradient(180deg, var(--bg) 0%, var(--bg-soft) 100%);
      color: var(--text);
    }
    body { padding: 16px; }
    * {
      scrollbar-width: thin;
      scrollbar-color: rgba(121, 214, 198, 0.55) rgba(255, 255, 255, 0.06);
    }
    *::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    *::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 999px;
    }
    *::-webkit-scrollbar-thumb {
      background: rgba(121, 214, 198, 0.55);
      border-radius: 999px;
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    a { color: #a7f3d0; }
    h1, h2, h3, p { margin: 0; }
    .app {
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 16px;
      min-height: calc(100vh - 32px);
    }
    .panel {
      min-height: 0;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .panel-head {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.02);
    }
    .panel-body {
      min-height: 0;
      height: calc(100% - 63px);
      padding: 16px;
      overflow: auto;
    }
    .topbar {
      display: grid;
      grid-template-columns: minmax(280px, 1.25fr) minmax(180px, 0.8fr) auto auto;
      gap: 12px;
      align-items: end;
      padding: 16px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(320px, 0.95fr) minmax(500px, 1.05fr);
      gap: 16px;
      min-height: 0;
    }
    .right {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 16px;
      min-height: 0;
    }
    .command-layout {
      display: grid;
      grid-template-columns: minmax(280px, 0.9fr) minmax(360px, 1.1fr);
      gap: 16px;
      min-height: 0;
      height: 100%;
    }
    .sub {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .pill-row, .toolbar, .meta-stack, .meta-grid, .command-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pill {
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
      color: var(--muted);
      font-size: 11px;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 2;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      background: linear-gradient(180deg, rgba(16, 25, 38, 0.98), rgba(16, 25, 38, 0.92));
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(8px);
    }
    .toolbar .search {
      flex: 1 1 220px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    select, input, textarea, button {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: var(--panel-soft);
      color: var(--text);
      padding: 10px 12px;
      font: inherit;
    }
    input::placeholder, textarea::placeholder { color: #7590aa; }
    textarea {
      min-height: 180px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
    }
    button {
      cursor: pointer;
      font-weight: 700;
      background: linear-gradient(135deg, rgba(73, 191, 169, 0.28), rgba(121, 214, 198, 0.16));
      border-color: rgba(121, 214, 198, 0.2);
    }
    button.secondary {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.08);
    }
    .status {
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.03);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .status.ok {
      color: #b6f3d8;
      border-color: rgba(92, 220, 170, 0.22);
    }
    .status.bad {
      color: #ffd4d4;
      border-color: rgba(239, 138, 138, 0.24);
    }
    .history-list, .command-list {
      display: grid;
      gap: 10px;
      min-height: 0;
    }
    .command-column, .meta-column {
      min-height: 0;
      display: grid;
    }
    .command-column {
      grid-template-rows: auto 1fr;
    }
    .command-scroll {
      min-height: 0;
      height: min(64vh, calc(100vh - 320px));
      max-height: 100%;
      overflow: auto;
      padding-right: 4px;
      scrollbar-gutter: stable;
      overscroll-behavior: contain;
    }
    .history-item, .command-item, .meta-card {
      padding: 12px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.025);
    }
    .history-item .content {
      margin-top: 8px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      line-height: 1.55;
    }
    .history-item small, .command-item small {
      display: block;
      margin-top: 6px;
      color: var(--muted);
      line-height: 1.45;
    }
    .command-item {
      cursor: pointer;
      transition: border-color .15s ease, transform .15s ease, background .15s ease;
    }
    .command-item:hover {
      transform: translateY(-1px);
      border-color: rgba(121, 214, 198, 0.18);
    }
    .command-item.active {
      border-color: rgba(121, 214, 198, 0.35);
      background: rgba(73, 191, 169, 0.09);
    }
    .command-item .name, .mono {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .command-item .name {
      font-size: 13px;
      color: #f4f8ff;
    }
    .meta-column {
      grid-template-rows: auto auto auto auto 1fr auto auto;
      gap: 12px;
    }
    .meta-card h3 {
      font-size: 12px;
      margin-bottom: 8px;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 8px;
    }
    .meta-kv {
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 12px;
      line-height: 1.55;
      color: var(--muted);
    }
    .meta-kv strong {
      display: block;
      margin-bottom: 4px;
      color: var(--text);
      font-weight: 600;
    }
    .hint-list {
      display: grid;
      gap: 8px;
      font-size: 12px;
      line-height: 1.55;
      color: var(--muted);
    }
    .hint-list div {
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.02);
    }
    pre {
      margin: 0;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: #0a131d;
      color: #dce7f5;
      white-space: pre-wrap;
      word-break: break-word;
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 12px;
      line-height: 1.55;
      max-height: 36vh;
    }
    @media (max-width: 1280px) {
      .topbar, .layout, .command-layout { grid-template-columns: 1fr; }
      .right { grid-template-rows: auto auto; }
      .command-layout { height: auto; }
      .command-scroll { height: min(46vh, calc(100vh - 360px)); }
    }
  </style>
</head>
<body>
  <div class="app">
    <section class="panel topbar">
      <div>
        <h1>Stelle 调试窗口</h1>
        <p class="sub">Live 页面: <a href="${liveUrl}" target="_blank" rel="noreferrer">${liveUrl}</a></p>
        <div class="pill-row">
          <span class="pill" id="current-cursor-pill">Current Cursor: -</span>
          <span class="pill" id="tool-count-pill">Tools: -</span>
          <span class="pill" id="filter-count-pill">Shown: -</span>
        </div>
      </div>
      <label>
        当前 Cursor
        <select id="cursor-select"></select>
      </label>
      <button id="switch-btn">切换 Cursor</button>
      <button id="refresh-btn" class="secondary">刷新</button>
    </section>

    <section class="layout">
      <section class="panel">
        <div class="panel-head">
          <h2>上下文 History</h2>
          <p class="sub">显示当前 Cursor 最近 observation stream 的内容。</p>
        </div>
        <div class="panel-body">
          <div id="history-list" class="history-list"></div>
        </div>
      </section>

      <section class="right">
        <section class="panel">
          <div class="panel-head">
            <h2>可用 Tools</h2>
            <p class="sub">支持搜索、分类和滚动查看，不会再把一长串工具直接堆满整个面板。</p>
          </div>
          <div class="panel-body">
            <div class="command-layout">
              <div class="command-column">
                <div class="toolbar">
                  <input id="tool-search" class="search" type="search" placeholder="搜索工具名、摘要、namespace">
                  <select id="tool-scope-filter">
                    <option value="all">全部</option>
                    <option value="cursor">当前 Cursor</option>
                    <option value="stelle">Stelle</option>
                  </select>
                </div>
                <div class="command-scroll">
                  <div id="command-list" class="command-list"></div>
                </div>
              </div>
              <div class="meta-column">
                <div class="meta-card">
                  <h3>Selected Tool</h3>
                  <div class="mono" id="command-name">未选中工具</div>
                  <div class="sub" id="command-summary">先从左侧选择一个工具，右边会显示用途、权限和输入结构。</div>
                </div>
                <div id="command-badges" class="meta-grid"></div>
                <div class="meta-card">
                  <h3>Input Schema</h3>
                  <div id="command-schema" class="hint-list"></div>
                </div>
                <div class="meta-card">
                  <h3>Usage Notes</h3>
                  <div id="command-notes" class="hint-list"></div>
                </div>
                <label>
                  输入 JSON
                  <span class="sub" id="command-example-note">会按当前 tool 自动预填示例输入。</span>
                  <textarea id="command-input" placeholder="{}">{}</textarea>
                </label>
                <div class="command-actions">
                  <button id="fill-example-btn" class="secondary">重置示例</button>
                  <button id="execute-btn">执行 Tool</button>
                </div>
                <div id="status" class="status">等待操作...</div>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>工具返回结果</h2>
          </div>
          <div class="panel-body">
            <pre id="result-output">等待执行结果...</pre>
          </div>
        </section>
      </section>
    </section>
  </div>

  <script>
    const state = {
      snapshot: null,
      selectedCommand: "",
      commands: [],
      filteredCommands: [],
    };

    const els = {
      cursorSelect: document.getElementById("cursor-select"),
      historyList: document.getElementById("history-list"),
      commandList: document.getElementById("command-list"),
      commandName: document.getElementById("command-name"),
      commandSummary: document.getElementById("command-summary"),
      commandBadges: document.getElementById("command-badges"),
      commandSchema: document.getElementById("command-schema"),
      commandNotes: document.getElementById("command-notes"),
      commandInput: document.getElementById("command-input"),
      commandExampleNote: document.getElementById("command-example-note"),
      resultOutput: document.getElementById("result-output"),
      status: document.getElementById("status"),
      currentCursorPill: document.getElementById("current-cursor-pill"),
      toolCountPill: document.getElementById("tool-count-pill"),
      filterCountPill: document.getElementById("filter-count-pill"),
      toolSearch: document.getElementById("tool-search"),
      toolScopeFilter: document.getElementById("tool-scope-filter"),
    };

    document.getElementById("refresh-btn").addEventListener("click", () => loadSnapshot(false));
    document.getElementById("switch-btn").addEventListener("click", switchCursor);
    document.getElementById("execute-btn").addEventListener("click", executeCommand);
    document.getElementById("fill-example-btn").addEventListener("click", refillCurrentExample);
    els.toolSearch.addEventListener("input", renderCommands);
    els.toolScopeFilter.addEventListener("change", renderCommands);

    async function api(url, options) {
      const response = await fetch(url, Object.assign({
        headers: { "content-type": "application/json" },
        cache: "no-store",
      }, options || {}));
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || ("HTTP " + response.status));
      }
      return data;
    }

    async function loadSnapshot(silent) {
      try {
        const data = await api("/_debug/api/snapshot");
        state.snapshot = data.snapshot;
        renderSnapshot();
        if (!silent) setStatus("快照已刷新。", true);
      } catch (error) {
        setStatus("刷新失败: " + error.message, false);
      }
    }

    function renderSnapshot() {
      if (!state.snapshot) return;
      renderCursorSelect();
      renderHistory();
      renderCommands();
      const currentCursorId = state.snapshot.core.attachment.currentCursorId;
      els.currentCursorPill.textContent = "Current Cursor: " + currentCursorId;
      els.toolCountPill.textContent = "Tools: " + state.commands.length;
      els.filterCountPill.textContent = "Shown: " + state.filteredCommands.length;
      setStatus("当前 Cursor: " + currentCursorId, true);
    }

    function renderCursorSelect() {
      const snapshot = state.snapshot;
      const currentCursorId = snapshot.core.attachment.currentCursorId;
      const previousValue = els.cursorSelect.value;
      els.cursorSelect.innerHTML = "";
      (snapshot.cursors || []).forEach((cursor) => {
        const option = document.createElement("option");
        option.value = cursor.identity.id;
        option.textContent = cursor.identity.displayName + " (" + cursor.identity.id + ")";
        option.selected = previousValue
          ? previousValue === cursor.identity.id
          : currentCursorId === cursor.identity.id;
        els.cursorSelect.appendChild(option);
      });
    }

    function renderHistory() {
      const items = state.snapshot.currentObservation?.stream || [];
      els.historyList.innerHTML = "";
      if (!items.length) {
        els.historyList.innerHTML = "<div class=\\"history-item\\"><small>当前没有可显示的上下文记录。</small></div>";
        return;
      }
      items.forEach((item) => {
        const node = document.createElement("div");
        node.className = "history-item";
        node.innerHTML =
          "<div><strong>" + escapeHtml((item.type || "item") + " / " + (item.source || "unknown")) + "</strong></div>" +
          "<small>" + escapeHtml(formatTime(item.timestamp)) + "</small>" +
          "<div class=\\"content\\">" + escapeHtml(renderHistoryContent(item)) + "</div>";
        els.historyList.appendChild(node);
      });
    }

    function renderCommands() {
      const snapshot = state.snapshot;
      const cursorToolSet = new Set((snapshot.core.toolView?.cursorTools || []).map(fullName));
      const stelleToolSet = new Set((snapshot.core.toolView?.stelleTools || []).map(fullName));
      const allMeta = new Map((snapshot.tools || []).map((tool) => [fullName(tool.identity), tool]));

      state.commands = Array.from(new Set([].concat(Array.from(cursorToolSet), Array.from(stelleToolSet))))
        .map((name) => allMeta.get(name))
        .filter(Boolean)
        .map((tool) => Object.assign({}, tool, {
          debugScope: cursorToolSet.has(fullName(tool.identity)) && stelleToolSet.has(fullName(tool.identity))
            ? "both"
            : cursorToolSet.has(fullName(tool.identity))
              ? "cursor"
              : "stelle",
        }))
        .sort((a, b) => fullName(a.identity).localeCompare(fullName(b.identity)));

      const search = (els.toolSearch.value || "").trim().toLowerCase();
      const scope = els.toolScopeFilter.value || "all";
      state.filteredCommands = state.commands.filter((tool) => {
        const name = fullName(tool.identity);
        const summary = (tool.description?.summary || "").toLowerCase();
        const namespace = (tool.identity.namespace || "").toLowerCase();
        const matchesSearch = !search || name.toLowerCase().includes(search) || summary.includes(search) || namespace.includes(search);
        const matchesScope = scope === "all" || tool.debugScope === scope || tool.debugScope === "both";
        return matchesSearch && matchesScope;
      });

      if (!state.selectedCommand || !state.filteredCommands.some((tool) => fullName(tool.identity) === state.selectedCommand)) {
        state.selectedCommand = state.filteredCommands[0]
          ? fullName(state.filteredCommands[0].identity)
          : (state.commands[0] ? fullName(state.commands[0].identity) : "");
      }

      els.commandList.innerHTML = "";
      if (!state.filteredCommands.length) {
        els.commandList.innerHTML = "<div class=\\"command-item\\"><small>当前筛选条件下没有匹配到工具。</small></div>";
        renderCommandDetail(null);
        els.filterCountPill.textContent = "Shown: 0";
        return;
      }

      state.filteredCommands.forEach((tool) => {
        const name = fullName(tool.identity);
        const node = document.createElement("div");
        node.className = "command-item" + (name === state.selectedCommand ? " active" : "");
        node.innerHTML =
          "<div class=\\"name\\">" + escapeHtml(name) + "</div>" +
          "<small>" + escapeHtml(tool.description.summary || "No summary") + "</small>" +
          "<small>scope: " + escapeHtml(tool.debugScope) + " | authority: " + escapeHtml(tool.identity.authorityClass) + "</small>";
        node.addEventListener("click", () => {
          state.selectedCommand = name;
          renderCommands();
        });
        els.commandList.appendChild(node);
      });

      els.filterCountPill.textContent = "Shown: " + state.filteredCommands.length;
      renderCommandDetail(state.commands.find((tool) => fullName(tool.identity) === state.selectedCommand) || null);
    }

    function renderCommandDetail(tool) {
      if (!tool) {
        els.commandName.textContent = "未选中工具";
        els.commandSummary.textContent = "先从左侧选择一个工具，右边会显示用途、权限和输入结构。";
        els.commandBadges.innerHTML = "";
        els.commandSchema.innerHTML = "<div>没有可展示的输入结构。</div>";
        els.commandNotes.innerHTML = "<div>工具说明会显示在这里。</div>";
        els.commandInput.value = "{}";
        if (els.commandExampleNote) {
          els.commandExampleNote.textContent = "会按当前 tool 自动预填示例输入。";
        }
        delete els.commandInput.dataset.lockedFor;
        return;
      }

      const name = fullName(tool.identity);
      const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
      const properties = tool.inputSchema?.properties || {};
      const propertyNames = Object.keys(properties);

      els.commandName.textContent = name;
      els.commandSummary.textContent = tool.description.summary || "No summary";
      els.commandBadges.innerHTML = [
        badge("Authority Class", tool.identity.authorityClass || "-"),
        badge("Level", tool.authority?.level || "-"),
        badge("Scopes", (tool.authority?.scopes || []).join(", ") || "-"),
        badge("Required", required.length ? required.join(", ") : "none"),
        badge("Confirmation", tool.authority?.requiresUserConfirmation ? "required" : "not required"),
        badge("Visibility", tool.debugScope || "-"),
      ].join("");

      if (!propertyNames.length) {
        els.commandSchema.innerHTML = "<div>这个工具不需要输入参数。</div>";
      } else {
        els.commandSchema.innerHTML = propertyNames.map((key) => {
          const spec = properties[key] || {};
          const type = spec.type || inferType(spec);
          const description = spec.description || "无字段说明";
          return "<div><strong>" + escapeHtml(key) + "</strong> (" + escapeHtml(String(type)) + ")" +
            (required.includes(key) ? " [required]" : " [optional]") +
            "<br>" + escapeHtml(String(description)) + "</div>";
        }).join("");
      }

      els.commandNotes.innerHTML = [
        "<div><strong>When to use</strong><br>" + escapeHtml(tool.description?.whenToUse || "未提供说明") + "</div>",
        "<div><strong>When not to use</strong><br>" + escapeHtml(tool.description?.whenNotToUse || "未提供限制说明") + "</div>",
      ].join("");

      if (els.commandExampleNote) {
        els.commandExampleNote.textContent = "已按字段名和类型预填示例；直接改值即可执行。";
      }
      if (els.commandInput.dataset.lockedFor !== name) {
        els.commandInput.value = JSON.stringify(buildExampleInput(tool), null, 2);
        els.commandInput.dataset.lockedFor = name;
      }
    }

    function badge(label, value) {
      return "<div class=\\"meta-kv\\"><strong>" + escapeHtml(label) + "</strong>" + escapeHtml(value) + "</div>";
    }

    function buildExampleInput(tool) {
      const example = {};
      const properties = tool.inputSchema?.properties || {};
      Object.keys(properties).forEach((key) => {
        const spec = properties[key] || {};
        example[key] = sampleValueForSpec(key, spec);
      });
      return example;
    }

    function sampleValueForSpec(key, spec) {
      const type = spec.type || inferType(spec);
      const normalized = String(key || "").toLowerCase();
      if (Array.isArray(spec.enum) && spec.enum.length) return spec.enum[0];
      if (normalized === "cursor_id") return els.cursorSelect.value || "discord";
      if (normalized.includes("channel_id")) return "123456789012345678";
      if (normalized.includes("message_id")) return "123456789012345679";
      if (normalized.includes("guild_id")) return "123456789012345680";
      if (normalized.includes("user_id")) return "123456789012345681";
      if (normalized.includes("reply_to")) return "123456789012345679";
      if (normalized === "content") return "请把这里替换成你要发送的内容";
      if (normalized === "text") return "请把这里替换成要处理的文本";
      if (normalized.includes("query")) return "请输入搜索关键词";
      if (normalized.includes("expression")) return "1 + 2 * 3";
      if (normalized.includes("command")) return "echo hello";
      if (normalized.includes("url")) return "https://example.com";
      if (normalized.includes("path") || normalized.includes("file")) return "README.md";
      if (normalized.includes("reason")) return "debug panel manual action";
      if (normalized.includes("summary")) return "debug note";
      if (normalized.includes("name")) return "example";
      if (normalized.includes("before") || normalized.includes("after")) return new Date().toISOString();
      if (normalized.includes("limit") || normalized.includes("max")) return 20;
      if (normalized.includes("timeout")) return 10000;
      if (type === "integer" || type === "number") return 0;
      if (type === "boolean") return false;
      if (type === "array") {
        if (spec.items?.type === "string" && normalized.includes("mention")) return ["123456789012345681"];
        return [];
      }
      if (type === "object") return {};
      return "";
    }

    function inferType(spec) {
      if (Array.isArray(spec.enum) && spec.enum.length) return typeof spec.enum[0];
      return "string";
    }

    function refillCurrentExample() {
      const tool = state.commands.find((item) => fullName(item.identity) === state.selectedCommand);
      if (!tool) return;
      els.commandInput.value = JSON.stringify(buildExampleInput(tool), null, 2);
      els.commandInput.dataset.lockedFor = fullName(tool.identity);
      setStatus("示例输入已重置。", true);
    }

    async function switchCursor() {
      try {
        await api("/_debug/api/switch-cursor", {
          method: "POST",
          body: JSON.stringify({
            cursorId: els.cursorSelect.value,
            reason: "debug command window switch cursor",
          }),
        });
        await loadSnapshot(true);
        setStatus("已切换到 " + els.cursorSelect.value, true);
      } catch (error) {
        setStatus("切换失败: " + error.message, false);
      }
    }

    async function executeCommand() {
      if (!state.selectedCommand) {
        setStatus("请先选择一个工具。", false);
        return;
      }
      try {
        const input = els.commandInput.value.trim() ? JSON.parse(els.commandInput.value) : {};
        const data = await api("/_debug/api/use-tool", {
          method: "POST",
          body: JSON.stringify({
            name: state.selectedCommand,
            cursorId: els.cursorSelect.value,
            input,
            returnToInner: false,
          }),
        });
        els.resultOutput.textContent = JSON.stringify(data.result, null, 2);
        await loadSnapshot(true);
        setStatus("执行完成: " + state.selectedCommand, true);
      } catch (error) {
        els.resultOutput.textContent = String(error.message || error);
        setStatus("执行失败: " + error.message, false);
      }
    }

    function renderHistoryContent(item) {
      if (typeof item.content === "string" && item.content.trim()) return item.content;
      if (item.resourceRef) return JSON.stringify(item.resourceRef, null, 2);
      if (item.metadata) return JSON.stringify(item.metadata, null, 2);
      return "(empty)";
    }

    function fullName(identity) {
      return identity.namespace + "." + identity.name;
    }

    function formatTime(timestamp) {
      if (!timestamp) return "-";
      try {
        return new Date(timestamp).toLocaleString();
      } catch {
        return String(timestamp);
      }
    }

    function setStatus(message, ok) {
      els.status.textContent = message;
      els.status.className = "status " + (ok ? "ok" : "bad");
    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    loadSnapshot(true);
    setInterval(() => loadSnapshot(true), 2500);
  </script>
</body>
</html>`;
}
