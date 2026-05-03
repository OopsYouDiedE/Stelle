export function debugHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stelle Debug & Hot-Swap</title>
<style>
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #101113;
  color: #eceff3;
}
* { box-sizing: border-box; }
body { margin: 0; background: #101113; }
main { max-width: 1180px; margin: 0 auto; padding: 28px; }
header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 24px; }
h1, h2, h3, p { margin: 0; }
h1 { font-size: 26px; font-weight: 700; letter-spacing: 0; }
h2 { font-size: 16px; margin-bottom: 12px; color: #f6f7f9; }
h3 { font-size: 14px; margin-bottom: 6px; color: #ffffff; }
p, .muted { color: #aab1bd; font-size: 13px; line-height: 1.5; }
button {
  border: 1px solid #3a404b;
  background: #1b1e24;
  color: #f6f7f9;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}
button:hover:not(:disabled) { background: #252a32; border-color: #4a505b; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: #2b5c46; border-color: #3b7d5f; }
button.primary:hover:not(:disabled) { background: #3b7d5f; }
button.danger { background: #6b2b2b; border-color: #8b3b3b; }
button.danger:hover:not(:disabled) { background: #8b3b3b; }

.grid { display: grid; gap: 16px; }
.stats { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-bottom: 18px; }
.panels { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-items: start; }
.card {
  background: #171a20;
  border: 1px solid #2b3038;
  border-radius: 8px;
  padding: 16px;
}
.stat .value { font-size: 30px; font-weight: 700; margin-top: 6px; }
.list { display: grid; gap: 8px; }
.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid #282d35;
  border-radius: 6px;
  background: #111419;
}
.row-main { min-width: 0; flex: 1; }
.row-actions { display: flex; gap: 6px; align-items: center; flex: 0 0 auto; }
.name { font-size: 13px; color: #f6f7f9; overflow-wrap: anywhere; font-weight: 600; }
.meta { color: #8f98a7; font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
.pill {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 12px;
  background: #252b33;
  color: #c7ced8;
  white-space: nowrap;
}
.pill.on { background: #123f2b; color: #8df0b0; }
.pill.off { background: #3f2424; color: #ffaaa5; }
.pill.loading { background: #3d3b22; color: #f0e68d; }
.empty { color: #737d8c; font-size: 13px; padding: 10px 0; }
details { margin-top: 16px; }
summary { cursor: pointer; color: #cfd6e0; margin-bottom: 10px; font-size: 14px; }
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #0b0d10;
  border: 1px solid #2b3038;
  border-radius: 8px;
  padding: 14px;
  color: #d8dee8;
  max-height: 520px;
  overflow: auto;
  font-size: 12px;
}
.error { color: #ffaaa5; }

/* Available Plugins List */
#available-plugins { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #2b3038; }
.available-row { opacity: 0.8; border-style: dashed; }
</style>
<script src="/socket.io/socket.io.js"></script>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Stelle Runtime Debug</h1>
      <p id="subtitle">Connecting to server...</p>
    </div>
    <button id="refresh" type="button">Refresh Snapshot</button>
  </header>
  <section class="grid stats" id="stats"></section>
  <section class="grid panels">
    <article class="card">
      <h2>Packages (Hot-Swap)</h2>
      <div class="list" id="packages"></div>
      <details id="available-plugins-container">
        <summary>Load Unregistered Packages</summary>
        <div class="list" id="available-plugins"></div>
      </details>
    </article>
    <article class="card"><h2>Debug Providers</h2><div class="list" id="providers"></div></article>
    <article class="card"><h2>Resources & Streams</h2><div class="list" id="resources"></div></article>
    <article class="card"><h2>Backpressure</h2><div class="list" id="backpressure"></div></article>
    <article class="card"><h2>Audit Log</h2><div class="list" id="audit"></div></article>
  </section>
  <details>
    <summary>Raw snapshot JSON</summary>
    <pre id="raw">loading</pre>
  </details>
</main>
<script>
const socket = io();
const ids = ["stats", "packages", "available-plugins", "providers", "resources", "backpressure", "audit", "raw", "subtitle"];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let currentSnapshot = null;
let currentAvailable = [];
let loadingStates = new Set(); // package IDs currently performing an operation

document.getElementById("refresh").addEventListener("click", load);

function apiUrl(path) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const base = "/api" + path;
  return token ? base + (base.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token) : base;
}

socket.on("connect", () => {
  el.subtitle.textContent = "Connected. Loading snapshot...";
  load();
});

socket.on("disconnect", () => {
  el.subtitle.textContent = "Disconnected from server.";
  el.subtitle.style.color = "#ffaaa5";
});

socket.on("package:update", () => {
  load(); // Reload snapshot on any package change
});

socket.on("package:event", (event) => {
  console.log("Package event:", event);
  if (event.type === "load_start" || event.type === "start_start" || event.type === "stop_start" || event.type === "unload_start") {
    loadingStates.add(event.packageId);
  } else {
    loadingStates.delete(event.packageId);
  }
  renderPackages(currentSnapshot?.packages || []);
  renderAvailable(currentAvailable);
});

async function apiAction(action, id) {
  loadingStates.add(id);
  renderPackages(currentSnapshot?.packages || []);
  renderAvailable(currentAvailable);
  try {
    const res = await fetch(apiUrl("/packages/" + encodeURIComponent(id) + "/" + action), { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
  } catch (err) {
    alert("Action " + action + " failed: " + err.message);
  } finally {
    loadingStates.delete(id);
    load();
  }
}

async function load() {
  try {
    const [snapRes, availRes] = await Promise.all([
      fetch(apiUrl("/snapshot")),
      fetch(apiUrl("/packages/available"))
    ]);
    const snapData = await snapRes.json();
    const availData = await availRes.json();
    
    if (!snapRes.ok || !snapData.ok) throw new Error(snapData.error || snapRes.statusText);
    
    currentSnapshot = snapData.snapshot ?? snapData;
    currentAvailable = availData.available || [];
    render(currentSnapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    el.subtitle.innerHTML = '<span class="error">' + escapeHtml(message) + '</span>';
  }
}

function render(snapshot) {
  const packages = snapshot.packages || [];
  const active = packages.filter(pkg => pkg.active);
  const capabilities = snapshot.capabilities || [];
  const windows = snapshot.windows || [];
  const providers = snapshot.providers || [];
  const resources = snapshot.resources || [];
  const streams = snapshot.streams || [];
  const backpressure = snapshot.backpressure || [];
  const audit = snapshot.auditLog || [];

  el.subtitle.textContent = "Security: " + (snapshot.securityMode || "unknown") + " | " + new Date().toLocaleString();
  el.subtitle.style.color = "";
  
  el.stats.innerHTML = [
    stat("Active packages", active.length + "/" + packages.length),
    stat("Capabilities", capabilities.length),
    stat("Windows", windows.length),
    stat("Providers", providers.length),
    stat("Resources", resources.length + streams.length),
  ].join("");

  renderPackages(packages);
  renderAvailable(currentAvailable);
  
  el.providers.innerHTML = list(providers, provider => row(provider.title || provider.id, provider.id + " | owner " + provider.ownerPackageId, provider.commandCount + " cmds"));
  el.resources.innerHTML = list([...resources, ...streams], item => row(item.id || item.uri || item.name || "resource", item.kind || item.mimeType || item.accessScope || "runtime data", item.debugReadable ? "debug" : "scoped"));
  el.backpressure.innerHTML = list(backpressure, item => row(item.id || item.owner || item.queue || "queue", "buffered=" + (item.buffered ?? 0) + " dropped=" + (item.dropped ?? 0), item.recommendedAction || item.status || "ok"));
  el.audit.innerHTML = list(audit.slice(-12).reverse(), item => row(item.providerId + ":" + item.commandId, item.reason || "audit", item.allowed ? "allowed" : "blocked", item.allowed));
  el.raw.textContent = JSON.stringify(snapshot, null, 2);
}

function renderPackages(packages) {
  el.packages.innerHTML = list(packages, pkg => {
    const isLoading = loadingStates.has(pkg.id);
    const stateStr = isLoading ? "working..." : (pkg.active ? "active" : "stopped");
    const pillClass = isLoading ? "loading" : (pkg.active ? "on" : "off");
    
    let actions = "";
    if (pkg.active) {
       actions += \`<button class="danger" onclick="apiAction('stop', '\${pkg.id}')" \${isLoading ? 'disabled' : ''}>Stop</button>\`;
    } else {
       actions += \`<button class="primary" onclick="apiAction('start', '\${pkg.id}')" \${isLoading ? 'disabled' : ''}>Start</button>\`;
       actions += \`<button onclick="apiAction('unload', '\${pkg.id}')" \${isLoading ? 'disabled' : ''}>Unload</button>\`;
    }
    
    return \`
      <div class="row">
        <div class="row-main">
          <div class="name">\${escapeHtml(pkg.displayName || pkg.id)}</div>
          <div class="meta">\${escapeHtml(pkg.id + " | " + pkg.kind + " | v" + pkg.version)}</div>
        </div>
        <div class="row-actions">
          <span class="pill \${pillClass}">\${stateStr}</span>
          \${actions}
        </div>
      </div>
    \`;
  });
}

function renderAvailable(available) {
  // Filter out those already in packages list
  const loadedIds = new Set((currentSnapshot?.packages || []).map(p => p.id));
  const trulyAvailable = available.filter(pkg => !loadedIds.has(pkg.id));
  
  document.getElementById("available-plugins-container").style.display = trulyAvailable.length > 0 ? "block" : "none";
  
  el["available-plugins"].innerHTML = list(trulyAvailable, pkg => {
    const isLoading = loadingStates.has(pkg.id);
    return \`
      <div class="row available-row">
        <div class="row-main">
          <div class="name">\${escapeHtml(pkg.displayName || pkg.id)}</div>
          <div class="meta">\${escapeHtml(pkg.id + " | " + pkg.kind + " | v" + pkg.version)}</div>
        </div>
        <div class="row-actions">
          <button onclick="apiAction('load', '\${pkg.id}')" \${isLoading ? 'disabled' : ''}>Load</button>
        </div>
      </div>
    \`;
  });
}

function stat(label, value) {
  return '<article class="card stat"><p>' + escapeHtml(label) + '</p><div class="value">' + escapeHtml(String(value)) + '</div></article>';
}

function list(items, map) {
  return items.length ? items.map(map).join("") : '<div class="empty">No data yet.</div>';
}

function row(name, meta, pill, enabled) {
  const cls = enabled === true ? " on" : enabled === false ? " off" : "";
  const pillHtml = pill ? '<span class="pill' + cls + '">' + escapeHtml(String(pill)) + '</span>' : '';
  return '<div class="row"><div class="row-main"><div class="name">' + escapeHtml(String(name)) + '</div><div class="meta">' + escapeHtml(String(meta || "")) + '</div></div>' + pillHtml + '</div>';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
</script>
</body>
</html>`;
}
