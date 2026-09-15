const state = {
  token: "",
  agentId: "TV3AHW",
  homeDir: "",
  projectDir: "D:/AusCode",
  threadId: "",
  models: [],
  ws: null,
  streaming: false,
  startedAt: 0,
  outTokens: 0,
  perm: localStorage.getItem("auscode.perm") || "full",
  selectedModels: [],
  slashItems: [],
  slashIndex: 0,
  pendingSkills: [],
};

const PERM = {
  confirm: { label: "变更前确认", hitl: { enabled: true, tools: "default" } },
  auto: { label: "自动编辑", hitl: { enabled: true, tools: ["bash", "execute"] } },
  plan: { label: "计划模式", hitl: { enabled: true, tools: "default" } },
  full: { label: "完全访问", hitl: { enabled: false, tools: "default" } },
};

const $ = (id) => document.getElementById(id);
const titles = {
  chat: "当前会话", cron: "自动化", usage: "Token 统计", memory: "记忆",
  models: "模型", skills: "技能", security: "权限", settings: "设置",
};

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (opts.body && !(opts.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && (data.detail || data.error || data.message)) || res.statusText);
  return data;
}

function fmt(n) {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function modelRefOf(m) {
  if (!m) return "";
  if (m.ref) return m.ref;
  if (m.model && String(m.model).includes("/")) return m.model;
  const name = m.provider_name || "";
  const id = m.model || m.name || m.id || "";
  return name && id ? `${name}/${id}` : String(id);
}

function extractText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (part.type === "text") return part.text || "";
      if (part.type === "thinking") return "";
      return part.text || part.content || "";
    }).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    if (content.text) return String(content.text);
    if (content.content) return extractText(content.content);
  }
  return "";
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

function addBubble(role, text, meta = {}) {
  const wrap = document.createElement("div");
  wrap.className = `bubble-wrap ${role}`;
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  const visible = extractText(text) || (typeof text === "string" ? text : "");
  el.textContent = visible;
  wrap.appendChild(el);
  const actions = document.createElement("div");
  actions.className = "bubble-actions";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.title = "复制";
  copyBtn.textContent = "⧉";
  copyBtn.onclick = () => copyText(el.textContent);
  actions.appendChild(copyBtn);
  if (role === "user") {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.title = "编辑并重发";
    editBtn.textContent = "✎";
    editBtn.onclick = () => beginEdit(wrap, el);
    actions.appendChild(editBtn);
  }
  if (role === "assistant") {
    const forkBtn = document.createElement("button");
    forkBtn.type = "button";
    forkBtn.title = "分流到新对话";
    forkBtn.textContent = "⑂";
    forkBtn.onclick = () => forkFrom(wrap, el.textContent);
    actions.appendChild(forkBtn);
  }
  wrap.dataset.msgId = meta.id || "";
  wrap.dataset.role = role;
  wrap.appendChild(actions);
  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
  return el;
}

function beginEdit(wrap, el) {
  if (wrap.querySelector(".bubble-edit")) return;
  const ta = document.createElement("textarea");
  ta.className = "bubble-edit";
  ta.value = el.textContent;
  const row = document.createElement("div");
  row.className = "row";
  const ok = document.createElement("button");
  ok.className = "primary";
  ok.textContent = "重发";
  const cancel = document.createElement("button");
  cancel.className = "ghost";
  cancel.textContent = "取消";
  ok.onclick = async () => {
    const text = ta.value.trim();
    if (!text) return;
    while (wrap.nextSibling) wrap.nextSibling.remove();
    el.textContent = text;
    ta.remove();
    row.remove();
    await send(text, { fromEdit: true });
  };
  cancel.onclick = () => { ta.remove(); row.remove(); };
  wrap.appendChild(ta);
  row.appendChild(ok);
  row.appendChild(cancel);
  wrap.appendChild(row);
  ta.focus();
}

async function forkFrom(wrap, content) {
  if (!state.threadId) return;
  const after = [];
  let node = wrap.nextSibling;
  while (node) {
    if (node.classList && node.classList.contains("bubble-wrap") && node.dataset.role === "assistant") after.push(node);
    node = node.nextSibling;
  }
  const fromEnd = after.length + 1;
  const created = await api(`/api/agents/${state.agentId}/threads/${state.threadId}/fork`, {
    method: "POST",
    body: JSON.stringify({
      message_id: wrap.dataset.msgId || null,
      content,
      assistant_turns_from_end: fromEnd,
    }),
  });
  const nid = created.thread_id || created.id;
  if (nid) await openThread(nid);
}

let thinkTimer = null;
let thinkStartedAt = 0;
let workStartedAt = 0;
let traceCounts = { think: 0, tool: 0, read: 0, cmd: 0 };
function secText(sec) {
  if (sec < 60) return `${sec}秒`;
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}
function traceRoot() {
  let el = document.querySelector(".turn-trace.live");
  if (!el) {
    el = document.createElement("div");
    el.className = "turn-trace live";
    el.innerHTML = `<button type="button" class="trace-head">工作中 0秒</button><div class="trace-body"></div><button type="button" class="trace-summary hidden"></button>`;
    el.querySelector(".trace-head").onclick = () => el.classList.toggle("collapsed");
    el.querySelector(".trace-summary").onclick = () => el.classList.toggle("collapsed");
    $("messages").appendChild(el);
    workStartedAt = Date.now();
    traceCounts = { think: 0, tool: 0, read: 0, cmd: 0 };
  }
  return el;
}
function tickTimers() {
  const el = document.querySelector(".turn-trace.live");
  if (!el) return;
  const head = el.querySelector(".trace-head");
  if (head) head.textContent = `工作中 ${secText(Math.floor((Date.now() - workStartedAt) / 1000))}`;
  const think = el.querySelector(".think-block.live .think-head");
  if (think) think.textContent = `思考 · ${secText(Math.floor((Date.now() - thinkStartedAt) / 1000))}`;
}
function ensureTimer() {
  if (!thinkTimer) thinkTimer = setInterval(tickTimers, 250);
}
function startWork() {
  const el = traceRoot();
  el.classList.remove("collapsed");
  ensureTimer();
  tickTimers();
  return el;
}
function stopWork() {
  const el = document.querySelector(".turn-trace.live");
  if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
  if (!el) return;
  finishThinkStatus();
  el.querySelectorAll(".tool-line.live").forEach((n) => n.classList.remove("live"));
  el.classList.remove("live");
  el.classList.add("collapsed");
  const sec = Math.max(1, Math.floor((Date.now() - workStartedAt) / 1000));
  const head = el.querySelector(".trace-head");
  if (head) head.textContent = `用时 ${secText(sec)}`;
  const parts = [];
  if (traceCounts.think) parts.push(`${traceCounts.think} 次思考`);
  if (traceCounts.tool) parts.push(`${traceCounts.tool} 次工具调用`);
  if (traceCounts.read) parts.push(`${traceCounts.read} 次文件读取`);
  if (traceCounts.cmd) parts.push(`${traceCounts.cmd} 次命令`);
  const summary = el.querySelector(".trace-summary");
  summary.textContent = parts.length ? `已执行：${parts.join(" · ")}` : "已执行";
  summary.classList.remove("hidden");
}
function startThinkStatus() {
  const root = startWork();
  let el = root.querySelector(".think-block.live");
  if (!el) {
    root.querySelectorAll(".tool-line.live").forEach((n) => n.classList.remove("live"));
    el = document.createElement("div");
    el.className = "think-block live open trace-step";
    el.innerHTML = `<button class="think-head" type="button">思考 · 0秒</button><div class="think-body"></div>`;
    el.querySelector(".think-head").onclick = () => el.classList.toggle("open");
    root.querySelector(".trace-body").appendChild(el);
    thinkStartedAt = Date.now();
    traceCounts.think += 1;
  }
  tickTimers();
  $("messages").scrollTop = $("messages").scrollHeight;
  return el;
}
function appendThink(text) {
  const el = startThinkStatus();
  const body = el.querySelector(".think-body");
  if (body && text) {
    body.textContent += text;
    body.scrollTop = body.scrollHeight;
  }
}
function finishThinkStatus() {
  const el = document.querySelector(".think-block.live");
  if (!el) return;
  const body = el.querySelector(".think-body");
  const hasText = Boolean(body && body.textContent.trim());
  el.classList.remove("live");
  el.classList.remove("open");
  if (!hasText) {
    el.remove();
    if (traceCounts.think > 0) traceCounts.think -= 1;
    return;
  }
  const sec = Math.max(1, Math.floor((Date.now() - thinkStartedAt) / 1000));
  const head = el.querySelector(".think-head");
  if (head) head.textContent = `思考 · 持续了 ${secText(sec)}`;
}

function toolVerb(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("bash") || n.includes("exec") || n.includes("shell") || n.includes("terminal")) return "终端";
  if (n.includes("edit") || n.includes("write")) return "编辑";
  if (n.includes("read") || n.includes("cat")) return "读取";
  if (n.includes("glob") || n.includes("grep") || n.includes("search") || n.includes("ls")) return "查阅";
  if (n.includes("browser")) return "浏览";
  return "工具";
}
function shortPath(value) {
  const text = String(value || "").replace(/\\/g, "/");
  if (!text) return "";
  const parts = text.split("/").filter(Boolean);
  if (parts.length <= 2) return text;
  return `…/${parts.slice(-2).join("/")}`;
}
function clipText(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).replace(/[\uD800-\uDBFF]$/, "")}…`;
}
function toolSummary(name, args) {
  if (!args) return clipText(name, 48);
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return clipText(args, 56); }
  }
  const cmd = args.command || args.cmd || args.query || "";
  const path = args.path || args.file || args.filename || args.file_path || "";
  const pattern = args.pattern || args.glob || "";
  return clipText([cmd, shortPath(path), pattern].filter(Boolean).join(" ") || name, 56);
}
function upsertToolCard(id, name, status, args) {
  const root = startWork();
  finishThinkStatus();
  const key = String(id || name);
  const body = root.querySelector(".trace-body");
  let el = [...body.querySelectorAll(".tool-line")].find((n) => n.dataset.tool === key);
  const verb = toolVerb(name);
  if (!el) {
    body.querySelectorAll(".tool-line.live").forEach((n) => n.classList.remove("live"));
    el = document.createElement("div");
    el.className = "tool-line live trace-step";
    el.dataset.tool = key;
    body.appendChild(el);
    if (verb === "读取" || verb === "查阅") traceCounts.read += 1;
    else if (verb === "终端") traceCounts.cmd += 1;
    else traceCounts.tool += 1;
  }
  const extra = status === "等待确认" ? " · 待确认" : (status === "调用中" ? " · 进行中" : "");
  el.classList.toggle("live", status === "调用中" || status === "等待确认");
  el.classList.toggle("done", status === "完成");
  el.innerHTML = `<b>${verb}</b> ${toolSummary(name, args)}${extra}`;
  $("messages").scrollTop = $("messages").scrollHeight;
}
function handleToolFrame(frame) {
  const t = frame.type || "";
  const name = frame.name || frame.tool || frame.tool_name || (frame.data && (frame.data.name || frame.data.tool)) || "工具";
  const id = frame.id || frame.tool_call_id || (frame.data && frame.data.id) || name;
  const args = frame.args || frame.input || (frame.data && (frame.data.args || frame.data.input));
  if (t === "tool_start" || t === "tool_call" || t === "tool_use") {
    upsertToolCard(id, name, "调用中", args);
    return true;
  }
  if (t === "tool_result" || t === "tool_end" || t === "tool") {
    upsertToolCard(id, name, "完成", args || frame.output || frame.result);
    return true;
  }
  if (t === "hitl_required") {
    upsertToolCard(id, name, "等待确认", args);
    return true;
  }
  return false;
}

function setPermLabel() {
  $("permBtn").textContent = PERM[state.perm].label;
}

async function applyPerm(mode) {
  state.perm = mode;
  localStorage.setItem("auscode.perm", mode);
  setPermLabel();
  $("permMenu").classList.remove("open");
  const hitl = PERM[mode].hitl;
  await api("/api/admin/security", { method: "PUT", body: JSON.stringify({ hitl }) });
}

function connectWs() {
  if (state.ws) try { state.ws.close(); } catch {}
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/agents/${state.agentId}/chat/ws?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;
  let assistantEl = null;
  ws.onmessage = (ev) => {
    let frame;
    try { frame = JSON.parse(ev.data); } catch { return; }
    const t = frame.type;
    if (handleToolFrame(frame)) return;
    if (t === "reasoning") {
      appendThink(frame.content || frame.text || "");
      return;
    }
    if (t === "token" || t === "text" || t === "delta") {
      const piece = frame.content || frame.text || frame.delta || "";
      if (!piece) return;
            finishThinkStatus();
            if (!assistantEl) assistantEl = addBubble("assistant", "", { id: frame.message_id || "" });
            assistantEl.textContent += extractText(piece) || String(piece);
      state.outTokens += 1;
      const sec = Math.max(0.001, (Date.now() - state.startedAt) / 1000);
      $("tokSpeed").textContent = `${Math.round(state.outTokens / sec)} tok/s`;
      $("messages").scrollTop = $("messages").scrollHeight;
      return;
    }
    if (t === "usage") {
      const u = frame.data || frame;
      $("turnUsage").textContent = `${fmt(u.input_tokens || u.input)} 入 / ${fmt(u.output_tokens || u.output)} 出`;
      const hit = u.cache_hit_percent ?? u.cache_read_tokens;
      if (hit != null) $("turnCache").textContent = typeof hit === "number" && hit <= 100 ? `${hit}%` : fmt(hit);
      return;
    }
    if (t === "done" || t === "turn_end") {
      finishThinkStatus();
      stopWork();
      state.streaming = false;
      assistantEl = null;
      if (frame.thread_id) {
        state.threadId = frame.thread_id;
        localStorage.setItem("auscode.thread", frame.thread_id);
      }
      refreshContext();
      refreshUsage();
    }
    if (t === "error" || t === "turn_error") addBubble("think", frame.message || JSON.stringify(frame));
        if (t === "state_snapshot" || t === "state_update") {
      const msgs = (frame.data && frame.data.messages) || [];
      msgs.forEach((m) => {
        const role = m.role || m.type;
        const blocks = Array.isArray(m.content) ? m.content : [];
        blocks.forEach((b) => {
          if (!b || typeof b !== "object") return;
          if (b.type === "tool_use") handleToolFrame({ type: "tool_use", name: b.name, id: b.id, args: b.input });
          if (b.type === "tool_result") handleToolFrame({ type: "tool_result", id: b.id, output: b.output || b.content });
        });
        if (role === "tool") handleToolFrame({ type: "tool_result", name: m.name, id: m.tool_call_id, output: m.content });
      });
      const last = msgs[msgs.length - 1];
      if (last && (last.type === "ai" || last.role === "assistant") && last.content) {
        const visible = extractText(last.content);
        if (visible) {
          finishThinkStatus();
          if (!assistantEl) assistantEl = addBubble("assistant", "");
          assistantEl.textContent = visible;
        }
      }
    }
  };
}

async function send(preset, opts = {}) {
  const text = (preset != null ? preset : $("prompt").value).trim();
  if (!text || state.streaming) return;
  if (preset == null) $("prompt").value = "";
  if (!opts.fromEdit) addBubble("user", text);
  state.streaming = true;
  state.startedAt = Date.now();
  state.outTokens = 0;
  startThinkStatus();
  if (!state.ws || state.ws.readyState !== 1) connectWs();
  const waitOpen = () => new Promise((resolve) => {
    if (state.ws.readyState === 1) return resolve();
    state.ws.addEventListener("open", resolve, { once: true });
  });
  await waitOpen();
  const model = $("modelSelect").value;
  const effort = $("effortSelect").value;
  const payload = {
    type: "user_turn",
    text,
    thread_id: state.threadId || undefined,
    model,
    default_model: model,
    reasoning_mode: effort === "low" ? "disabled" : "enabled",
    reasoning_effort: effort,
  };
  if (state.perm === "plan") payload.skills = [];
  else if (state.pendingSkills.length) payload.skills = [...state.pendingSkills];
  state.pendingSkills = [];
  hideSlash();
  state.ws.send(JSON.stringify(payload));
}

function hideSlash() {
  const menu = $("slashMenu");
  if (menu) { menu.classList.add("hidden"); menu.innerHTML = ""; }
  state.slashItems = [];
  state.slashIndex = 0;
}

async function ensureSlashCatalog() {
  const [cmds, skills] = await Promise.all([
    api("/api/slash/commands?origin=ui").catch(() => ({ commands: [] })),
    api(`/api/agents/${state.agentId}/skills`).catch(() => []),
  ]);
  const skillRows = Array.isArray(skills) ? skills : (skills.items || []);
  state.slashCatalog = {
    commands: cmds.commands || [],
    skills: skillRows.filter((s) => s.enabled !== false),
  };
  return state.slashCatalog;
}

function slashQuery() {
  const text = $("prompt").value;
  const at = text.lastIndexOf("/");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(text[at - 1])) return null;
  return { at, q: text.slice(at + 1) };
}

function placeSlashMenu() {
  const menu = $("slashMenu");
  const box = $("prompt");
  if (!menu || !box) return;
  const rect = box.getBoundingClientRect();
  menu.style.left = `${Math.max(16, rect.left)}px`;
  menu.style.width = `${Math.max(240, rect.width)}px`;
  menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  menu.style.top = "auto";
}

function renderSlash(items, index) {
  const menu = $("slashMenu");
  if (!items.length) { hideSlash(); return; }
  state.slashItems = items;
  state.slashIndex = Math.max(0, Math.min(index, items.length - 1));
  menu.classList.remove("hidden");
  menu.innerHTML = items.map((it, i) =>
    `<button type="button" data-i="${i}" class="${i === state.slashIndex ? "on" : ""}"><b>${it.label}</b><small>${it.hint || ""}</small></button>`
  ).join("");
  placeSlashMenu();
}

async function updateSlash() {
  const hit = slashQuery();
  if (hit == null) { hideSlash(); return; }
  const cat = await ensureSlashCatalog();
  const q = hit.q.toLowerCase();
  const skills = cat.skills.map((s) => {
    const slug = s.slug || s.name || "";
    const zh = (s.label && (s.label.zh || s.label)) || s.name || "";
    return {
      kind: "skill",
      id: slug,
      label: `/${slug}`,
      hint: zh,
      search: `${slug} ${zh} ${s.name || ""}`.toLowerCase(),
    };
  });
  const commands = cat.commands.map((c) => ({
    kind: "command",
    id: c.name,
    label: c.command || `/${c.name}`,
    hint: c.label_zh || c.description_zh || "",
    action: c.client_action,
  }));
  const items = [...skills, ...commands].filter((it) => {
    if (!q) return true;
    const hay = `${it.search || ""} ${it.label} ${it.hint || ""}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 12);
  renderSlash(items, 0);
}

function applySlash(item) {
  const hit = slashQuery();
  const box = $("prompt");
  const before = hit ? box.value.slice(0, hit.at) : box.value;
  if (item.kind === "skill") {
    state.pendingSkills = [item.id];
    box.value = `${before}/${item.id} `;
  } else if (item.action === "new_chat") {
    hideSlash();
    newThread();
    box.value = before;
    return;
  } else {
    box.value = `${before}${item.label} `;
  }
  hideSlash();
  box.focus();
}

async function loadThreads() {
  const rows = await api(`/api/agents/${state.agentId}/threads`);
  const box = $("threadList");
  box.innerHTML = "";
  (rows || []).forEach((t) => {
    const el = document.createElement("div");
    el.className = "thread" + (t.thread_id === state.threadId ? " active" : "");
    el.dataset.thread = t.thread_id;
    el.innerHTML = `<b>${t.title || "未命名"}</b><small>${t.channel_type || ""}</small><button type="button" class="del" title="删除" data-del="${t.thread_id}">×</button>`;
    box.appendChild(el);
  });
  box.onclick = async (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      const id = del.dataset.del;
      await api(`/api/agents/${state.agentId}/threads/${id}`, { method: "DELETE" });
      if (state.threadId === id) {
        state.threadId = "";
        localStorage.removeItem("auscode.thread");
        $("messages").innerHTML = "";
        $("pageTitle").textContent = "当前会话";
      }
      loadThreads();
      return;
    }
    const item = e.target.closest(".thread");
    if (item && item.dataset.thread) openThread(item.dataset.thread);
  };
}

async function openThread(id) {
  state.threadId = id;
  localStorage.setItem("auscode.thread", id);
  const hist = await api(`/api/agents/${state.agentId}/threads/${id}/history`);
  $("messages").innerHTML = "";
  const msgs = hist.messages || hist.items || [];
  msgs.forEach((m) => {
    const role = m.role || m.type;
    const content = extractText(m.content);
    const blocks = Array.isArray(m.content) ? m.content : [];
    const thinking = blocks.filter((b) => b && b.type === "thinking").map((b) => b.thinking || b.text || "").join("");
    if (thinking) {
      const el = startThinkStatus();
      el.querySelector(".think-body").textContent = thinking;
      finishThinkStatus();
    }
    blocks.forEach((b) => {
      if (!b || typeof b !== "object") return;
      if (b.type === "tool_use") handleToolFrame({ type: "tool_use", name: b.name, id: b.id, args: b.input });
      if (b.type === "tool_result") handleToolFrame({ type: "tool_result", id: b.id, name: b.name, output: b.output || b.content });
    });
    if (role === "tool") {
      handleToolFrame({ type: "tool_result", name: m.name, id: m.tool_call_id || m.id, output: m.content });
      return;
    }
    if (!content) return;
    if (role === "user" || role === "human") addBubble("user", content, { id: m.id });
    else if (role === "assistant" || role === "ai") addBubble("assistant", content, { id: m.id });
  });
  const first = extractText(msgs[0] && msgs[0].content);
  $("pageTitle").textContent = (first || "当前会话").slice(0, 24);
  await loadThreads();
  await refreshContext();
}

async function refreshContext() {
  if (!state.threadId) return;
  try {
    const ctx = await api(`/api/agents/${state.agentId}/threads/${state.threadId}/context-usage`);
    const used = ctx.used_tokens || 0;
    const max = ctx.max_tokens || 128000;
    $("ctxPct").textContent = `${Math.round(used * 100 / max)}% · ${fmt(used)}/${fmt(max)}`;
    const segs = ctx.segments || [];
    $("ctxMenu").innerHTML = `<div style="margin-bottom:8px">已用 ${Math.round(used * 100 / max)}%，这是当前上下文窗口占用。</div>` +
      (segs.map((s) => `<div class="kv"><span>${s.label || s.key}</span><b>${fmt(s.tokens)}</b></div>`).join("") || "<div>暂无分段</div>");
  } catch {}
}

state.usageWindow = state.usageWindow || "last_7d";
const MODEL_COLORS = ["#9ec4d4", "#e3b6b6", "#c4b7d6", "#b7cfc4", "#e6c9b2", "#b9c7e0", "#d9b8c8"];
const PRICE_DEFAULTS = { input: 2, output: 8, cache_read: 0.2, cache_write: 2 };
function loadPrices() {
  try { return { ...PRICE_DEFAULTS, ...JSON.parse(localStorage.getItem("auscode.prices") || "{}") }; }
  catch { return { ...PRICE_DEFAULTS }; }
}
function savePrices(prices) {
  localStorage.setItem("auscode.prices", JSON.stringify(prices));
}
function money(n) {
  const v = Number(n || 0);
  if (v === 0) return "¥0.00";
  if (v < 0.01) return `¥${v.toFixed(4)}`;
  return `¥${v.toFixed(2)}`;
}
function calcCost(u, prices) {
  const perM = (tokens, rate) => Number(tokens || 0) / 1e6 * Number(rate || 0);
  const input = perM(u.uncached_input_tokens ?? u.input_tokens, prices.input);
  const output = perM(u.output_tokens, prices.output);
  const cacheRead = perM(u.cache_read_tokens, prices.cache_read);
  const cacheWrite = perM(u.cache_write_tokens, prices.cache_write);
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

async function refreshUsage() {
  const [u5, today] = await Promise.all([
    api("/api/usage/summary?window=last_5h&granularity=total"),
    api("/api/usage/summary?window=today&granularity=total"),
  ]);
  $("usage5h").textContent = fmt(u5.total_tokens);
  $("usageIo").textContent = `入 ${fmt(u5.input_tokens)} / 出 ${fmt(u5.output_tokens)}`;
  $("usageToday").textContent = `今日 入 ${fmt(today.input_tokens)} / 出 ${fmt(today.output_tokens)}`;
  if (!$("usageBox")) return;
  const win = state.usageWindow;
  const [day, models] = await Promise.all([
    api(`/api/usage/summary?window=${win}&granularity=by_day`),
    api(`/api/usage/summary?window=${win}&granularity=by_model`),
  ]);
  const u = day;
  const hit = Number(u.cache_hit_percent || 0);
  const buckets = u.buckets || [];
  const maxDay = Math.max(1, ...buckets.map((b) => Number(b.total_tokens || 0)));
  const peak = Math.max(0, ...buckets.map((b) => Number(b.total_tokens || 0)));
  const modelRows = (models.buckets || []).map((b) => ({
    name: b.label || b.key || b.model || "未知",
    tokens: Number(b.total_tokens || 0),
  })).sort((a, b) => b.tokens - a.tokens);
  const modelTotal = modelRows.reduce((s, r) => s + r.tokens, 0) || 1;
  let acc = 0;
  const stops = modelRows.map((r, i) => {
    const start = acc;
    acc += r.tokens / modelTotal;
    return `${MODEL_COLORS[i % MODEL_COLORS.length]} ${start}turn ${acc}turn`;
  }).join(", ");
  const dayCols = buckets.slice(-14).map((b) => {
    const total = Number(b.total_tokens || 0) || 1;
    const h = Math.max(8, Math.round(Number(b.total_tokens || 0) * 128 / maxDay));
    const inP = Math.round(Number(b.uncached_input_tokens || b.input_tokens || 0) * 100 / total);
    const caP = Math.round(Number(b.cache_read_tokens || 0) * 100 / total);
    const ouP = Math.max(0, 100 - inP - caP);
    return `<div class="chart-col" title="${b.label} 合计 ${fmt(b.total_tokens)}">
      <div class="chart-stack" style="height:${h}px">
        <i class="in" style="height:${inP}%"></i>
        <i class="ca" style="height:${caP}%"></i>
        <i class="ou" style="height:${ouP}%"></i>
      </div>
      <em>${String(b.label || "").slice(5)}</em>
    </div>`;
  }).join("");
  const prices = loadPrices();
  const cost = calcCost(u, prices);
  const winBtns = [["today","今日"],["last_7d","近 7 日"],["last_30d","近 30 日"],["all","累计"]].map(([id, label]) =>
    `<button data-win="${id}" class="${id === win ? "on" : ""}">${label}</button>`
  ).join("");
  $("usageBox").innerHTML = `
    <h3>使用统计</h3>
    <div class="seg">${winBtns}</div>
    <div class="hit-wrap">
      <div class="kv" style="border:0;padding-top:0"><span>花费估算</span><b class="cost-total">${money(cost.total)}</b></div>
      <p class="muted">单价按每百万 token（¥ / 1M）自己填，只存在本机浏览器。</p>
      <div class="price-grid">
        <label>输入（未缓存）<input id="priceInput" type="number" min="0" step="0.01" value="${prices.input}"></label>
        <label>输出<input id="priceOutput" type="number" min="0" step="0.01" value="${prices.output}"></label>
        <label>缓存命中输入<input id="priceCacheRead" type="number" min="0" step="0.01" value="${prices.cache_read}"></label>
        <label>缓存写入<input id="priceCacheWrite" type="number" min="0" step="0.01" value="${prices.cache_write}"></label>
      </div>
      <div class="kv"><span>输入花费</span><b>${money(cost.input)}</b></div>
      <div class="kv"><span>输出花费</span><b>${money(cost.output)}</b></div>
      <div class="kv"><span>缓存命中花费</span><b>${money(cost.cacheRead)}</b></div>
      <div class="kv"><span>缓存写入花费</span><b>${money(cost.cacheWrite)}</b></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card input"><span>累计 Token</span><b>${fmt(u.total_tokens)}</b></div>
      <div class="stat-card cache"><span>峰值（单日）</span><b>${fmt(peak)}</b></div>
      <div class="stat-card output"><span>调用 / 轮次</span><b>${u.model_calls} / ${u.turns}</b></div>
      <div class="stat-card think"><span>缓存命中</span><b>${hit}%</b></div>
    </div>
    <div class="hit-wrap">
      <div class="kv" style="border:0;padding-top:0"><span>缓存 / 输入 / 输出</span><b>命中 ${hit}%</b></div>
      <div class="hit-bar"><span class="hit" style="width:${hit}%"></span><span class="miss" style="width:${Math.max(0, 100 - hit)}%"></span></div>
      <div class="legend" style="margin-top:10px">
        <span><i class="ca"></i>缓存读取 ${fmt(u.cache_read_tokens)}</span>
        <span><i class="in"></i>未缓存输入 ${fmt(u.uncached_input_tokens)}</span>
        <span><i class="ou"></i>输出 ${fmt(u.output_tokens)}</span>
      </div>
    </div>
    <div class="hit-wrap">
      <div class="kv" style="border:0;padding-top:0"><span>模型用量</span><b></b></div>
      <div class="donut-wrap">
        <div class="donut" style="background:conic-gradient(${stops || "#eee4d6 0 1turn"})" data-label="${fmt(modelTotal)}\ntokens"></div>
        <div class="model-list">
          ${modelRows.map((r, i) => `<div class="kv"><span><i class="dot" style="background:${MODEL_COLORS[i % MODEL_COLORS.length]}"></i> ${r.name}</span><b>${Math.round(r.tokens * 100 / modelTotal)}% · ${fmt(r.tokens)}</b></div>`).join("") || "<p>还没有按模型拆分</p>"}
        </div>
      </div>
    </div>
    <p><button class="ghost" id="usageExport">导出 Excel</button></p>
  `;
  $("usageBox").querySelectorAll("[data-win]").forEach((btn) => {
    btn.onclick = () => { state.usageWindow = btn.dataset.win; refreshUsage(); };
  });
  const bindPrice = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.onchange = el.onblur = () => {
      const next = loadPrices();
      next[key] = Number(el.value || 0);
      savePrices(next);
      refreshUsage();
    };
  };
  bindPrice("priceInput", "input");
  bindPrice("priceOutput", "output");
  bindPrice("priceCacheRead", "cache_read");
  bindPrice("priceCacheWrite", "cache_write");
  const exp = $("usageExport");
  if (exp) exp.onclick = async () => {
    const res = await fetch(`/api/usage/export.xlsx?window=${win}`, { headers: { Authorization: `Bearer ${state.token}` } });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "auscode-usage.xlsx";
    a.click();
  };
}

async function loadModels() {
  const rows = await api("/api/providers/resolved");
  state.models = rows || [];
  $("modelSelect").innerHTML = state.models.map((m) => {
    const ref = modelRefOf(m);
    return `<option value="${ref}">${m.provider_name} / ${m.name}</option>`;
  }).join("");
  try {
    const active = await api("/api/providers/active-model");
    const ref = active.provider_name && active.model ? `${active.provider_name}/${active.model}` : "";
    if (ref && [...$("modelSelect").options].some((o) => o.value === ref)) {
      $("modelSelect").value = ref;
    } else if ($("modelSelect").options.length) {
      $("modelSelect").selectedIndex = 0;
    }
  } catch {}
}

function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => {
    p.classList.remove("active");
    p.style.display = "";
  });
  document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
  const page = $("page-" + name);
  if (!page) return;
  page.classList.add("active");
  $("crumb").textContent = titles[name] || name;
  if (name === "chat") {
    const title = document.querySelector(".thread.active b");
    $("pageTitle").textContent = title ? title.textContent : "当前会话";
  } else {
    $("pageTitle").textContent = titles[name] || name;
  }
  const loaders = {
    cron: loadCron, usage: refreshUsage, memory: loadMemory,
    models: loadModelPage, skills: loadSkills, security: loadSecurity,
    settings: loadWorkspaceSettings,
  };
  if (loaders[name]) loaders[name]();
}

async function loadCron() {
  const rows = await api(`/api/agents/${state.agentId}/cron`);
  $("cronBox").innerHTML = `
    <h3>自动化</h3>
    <p style="color:var(--muted);margin:0">用 cron 或 @every 表达式定时让助手跑一句提示词。</p>
    <div class="form-grid">
      <input id="cronName" placeholder="名称，可选" />
      <input id="cronTrigger" placeholder="例如 @every 1h 或 0 9 * * *" />
    </div>
    <textarea id="cronPrompt" placeholder="到点要执行的提示词"></textarea>
    <div class="row"><button class="primary" id="cronAdd">添加任务</button></div>
    <div id="cronMsg" style="color:var(--muted)"></div>
    ${(rows || []).map((c) => `
      <div class="list-item">
        <b>${c.name || c.cron_id}</b>
        <div style="color:var(--muted)">${c.trigger || c.schedule || ""} · ${c.enabled === false ? "停用" : "启用"}</div>
        <button class="ghost" data-run="${c.cron_id || c.id}">立即跑一次</button>
        <button class="ghost" data-del="${c.cron_id || c.id}">删除</button>
      </div>`).join("") || "<p>还没有定时任务</p>"}
  `;
  $("cronAdd").onclick = async () => {
    try {
      await api(`/api/agents/${state.agentId}/cron`, {
        method: "POST",
        body: JSON.stringify({
          name: $("cronName").value.trim() || null,
          trigger: $("cronTrigger").value.trim(),
          prompt: $("cronPrompt").value.trim(),
        }),
      });
      loadCron();
    } catch (err) { $("cronMsg").textContent = String(err.message || err); }
  };
  $("cronBox").onclick = async (e) => {
    const run = e.target.dataset.run;
    const del = e.target.dataset.del;
    if (run) await api(`/api/agents/${state.agentId}/cron/${run}/run-now`, { method: "POST" });
    if (del) await api(`/api/agents/${state.agentId}/cron/${del}`, { method: "DELETE" });
    if (run || del) loadCron();
  };
}

function memoryText(it) {
  if (!it) return "";
  if (typeof it === "string") return it;
  return it.assertion || it.text || it.content || it.summary || "";
}
function memoryCard(it) {
  const text = memoryText(it);
  if (!text) return "";
  const id = it.id || "";
  const kind = it.kind || it.entity_type || "Fact";
  return `<div class="mem-card" data-id="${id}">
    <div class="muted">${kind}</div>
    <div class="mem-text">${text.replace(/</g, "&lt;")}</div>
    <div class="row">
      <button class="ghost" data-edit="${id}">修改</button>
      <button class="ghost" data-delmem="${id}">删除</button>
    </div>
  </div>`;
}
async function loadMemory() {
  const [counts, atoms] = await Promise.all([
    api(`/api/agents/${state.agentId}/memory/stats/counts`).catch(() => ({})),
    api(`/api/agents/${state.agentId}/memory/atoms/list`, { method: "POST", body: JSON.stringify({ include_deprecated: false }) }).catch(() => ({ items: [] })),
  ]);
  const items = atoms.items || [];
  $("memoryBox").innerHTML = `
    <h3>记忆</h3>
    <p class="muted">只显示结论，可手动补充或改掉过时内容。删除会把这条标为废弃。</p>
    <div class="kv"><span>记忆条数</span><b>${counts.atoms || items.length}</b></div>
    <textarea id="memNew" placeholder="新增一条记忆，例如：我主要在 Windows 上工作"></textarea>
    <div class="row"><button class="primary" id="memAdd">添加记忆</button></div>
    <div id="memMsg" class="muted"></div>
    <div class="mem-list">${items.map(memoryCard).join("") || "<p class='muted'>还没有记忆</p>"}</div>
  `;
  $("memAdd").onclick = async () => {
    const assertion = $("memNew").value.trim();
    if (!assertion) return;
    try {
      await api(`/api/agents/${state.agentId}/memory/atoms`, {
        method: "POST",
        body: JSON.stringify({ assertion, entity_type: "Fact", kind: "Fact", importance: "medium" }),
      });
      loadMemory();
    } catch (err) { $("memMsg").textContent = String(err.message || err); }
  };
  $("memoryBox").onclick = async (e) => {
    const edit = e.target.dataset.edit;
    const del = e.target.dataset.delmem;
    const card = e.target.closest(".mem-card");
    if (edit && card) {
      const old = card.querySelector(".mem-text").textContent;
      const next = prompt("修改这条记忆", old);
      if (!next || next === old) return;
      try {
        await api(`/api/agents/${state.agentId}/memory/atoms/${edit}:replace`, {
          method: "POST",
          body: JSON.stringify({ assertion: next, reason: "user edit" }),
        });
        loadMemory();
      } catch (err) { $("memMsg").textContent = String(err.message || err); }
    }
    if (del) {
      if (!confirm("删除这条记忆？")) return;
      try {
        await api(`/api/agents/${state.agentId}/memory/atoms/${del}:deprecate`, {
          method: "POST",
          body: JSON.stringify({ reason: "user delete" }),
        });
        loadMemory();
      } catch (err) { $("memMsg").textContent = String(err.message || err); }
    }
  };
}

async function loadModelPage() {
  await loadModels();
  const [providers, active, agents] = await Promise.all([
    api("/api/providers"),
    api("/api/providers/active-model").catch(() => ({})),
    api("/api/agents"),
  ]);
  const defaultRef = (agents[0] && agents[0].default_model) || (active.provider_name && active.model ? `${active.provider_name}/${active.model}` : "");
  $("modelsBox").innerHTML = `
    <h3>模型</h3>
    <p class="muted">在这里新增、修改、删除供应商，并指定默认模型。密钥只发给本机 AusCode。</p>
    <div class="form-grid">
      <input id="pName" placeholder="名称，例如 Piko Backup" />
      <input id="pUrl" placeholder="Base URL，例如 https://example.com/v1" />
      <input id="pKey" type="password" placeholder="API Key（修改时不填则保留原 Key）" />
      <select id="pKind"><option value="openai">OpenAI Compatible</option></select>
    </div>
    <div class="row">
      <button class="ghost" id="btnFetchModels">拉取模型</button>
      <button class="primary" id="btnSaveProvider">保存并测通</button>
      <button class="ghost hidden" id="btnCancelEdit">取消修改</button>
    </div>
    <div id="fetchedModels"></div>
    <div id="providerMsg" class="muted"></div>
    <div class="model-grid">
    ${(providers || []).map((p, i) => {
      const mid = (p.models && p.models[0] && (p.models[0].id || p.models[0].name)) || "";
      const ref = mid ? `${p.name}/${mid}` : "";
      const isDefault = defaultRef === ref || defaultRef.startsWith(p.name + "/");
      return `<div class="model-card" style="border-color:${MODEL_COLORS[i % MODEL_COLORS.length]}">
        <b>${p.name}</b> ${isDefault ? "<em>默认</em>" : ""}
        <div class="muted">${p.kind} · ${p.enabled ? "启用" : "停用"}</div>
        <div class="muted">${p.base_url || ""}</div>
        <div class="chips">${(p.models || []).map((m) => `<em>${m.id || m.name}</em>`).join("") || "<em>还没拉模型</em>"}</div>
        <div class="row">
          <button class="ghost" data-default="${p.id}" data-name="${p.name}" data-mid="${mid}">设为默认</button>
          <button class="ghost" data-edit="${p.id}">修改</button>
          <button class="ghost" data-del="${p.id}" data-name="${p.name}">删除</button>
        </div>
      </div>`;
    }).join("")}
    </div>
    <div id="modelMsg" class="muted"></div>
  `;
  $("btnFetchModels").onclick = () => fetchRemoteModels().catch((err) => { $("providerMsg").textContent = String(err.message || err); });
  $("btnSaveProvider").onclick = () => saveProvider().catch((err) => { $("providerMsg").textContent = String(err.message || err); });
  $("btnCancelEdit").onclick = () => { state.editingProviderId = null; loadModelPage(); };
  if (state.editingProviderId) {
    const row = (providers || []).find((p) => String(p.id) === String(state.editingProviderId));
    if (row) {
      $("pName").value = row.name;
      $("pName").readOnly = true;
      $("pUrl").value = row.base_url || "";
      $("btnSaveProvider").textContent = "保存修改";
      $("btnCancelEdit").classList.remove("hidden");
    }
  }
  $("modelsBox").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    try {
      if (btn.dataset.default) {
        const name = btn.dataset.name;
        const mid = btn.dataset.mid;
        if (!mid) { $("modelMsg").textContent = "这个供应商还没有模型"; return; }
        await api("/api/providers/active-model", { method: "PUT", body: JSON.stringify({ provider_name: name, model: mid }) });
        await api(`/api/agents/${state.agentId}`, { method: "PATCH", body: JSON.stringify({ default_model: `${name}/${mid}` }) });
        await loadModels();
        loadModelPage();
      }
      if (btn.dataset.edit) {
        state.editingProviderId = btn.dataset.edit;
        loadModelPage();
      }
      if (btn.dataset.del) {
        if (!confirm(`删除供应商「${btn.dataset.name}」？`)) return;
        await api(`/api/admin/providers/${btn.dataset.del}`, { method: "DELETE" });
        if (String(state.editingProviderId) === String(btn.dataset.del)) state.editingProviderId = null;
        await loadModels();
        loadModelPage();
      }
    } catch (err) { $("modelMsg").textContent = String(err.message || err); }
  };
}

async function loadSkills() {
  const [remote, local] = await Promise.all([
    api(`/api/agents/${state.agentId}/skills`),
    api("/api/ui/local-skills").catch(() => ({ items: [] })),
  ]);
  const rows = remote.items || remote || [];
  const locals = local.items || [];
  $("skillsBox").innerHTML = `
    <h3>技能</h3>
    <p class="muted">本机扫描 C:\\Users\\…\\.agents\\skills。点导入后，对话里就能用这些 SKILL.md。</p>
    <div class="row"><button class="primary" id="skillScan">重新扫描并导入本地技能</button></div>
    <div id="skillMsg" class="muted"></div>
    <h4>已加载</h4>
    ${rows.map((s) => `
      <div class="list-item">
        <b>${s.label?.zh || s.name || s.slug}</b>
        <div class="muted">${s.description || s.summary?.zh || ""}</div>
        <button class="ghost" data-skill="${s.name || s.slug}" data-on="${s.enabled ? "0" : "1"}">${s.enabled ? "停用" : "启用"}</button>
      </div>`).join("") || "<p>还没有技能</p>"}
    <h4>本机待导入</h4>
    ${locals.map((s) => `<div class="list-item"><b>${s.name}</b><div class="muted">${s.path}</div></div>`).join("") || "<p>没找到本地 .agents/skills</p>"}
  `;
  $("skillScan").onclick = async () => {
    $("skillMsg").textContent = "导入中…";
    try {
      for (const s of locals) {
        await api("/api/ui/local-skills/import", {
          method: "POST",
          body: JSON.stringify({ name: s.name, agent_id: state.agentId }),
        });
      }
      $("skillMsg").textContent = `已导入 ${locals.length} 个`;
      loadSkills();
    } catch (err) { $("skillMsg").textContent = String(err.message || err); }
  };
  $("skillsBox").onclick = async (e) => {
    const name = e.target.dataset.skill;
    if (!name) return;
    const on = e.target.dataset.on === "1";
    await api(`/api/agents/${state.agentId}/skills/${encodeURIComponent(name)}/${on ? "enable" : "disable"}`, { method: "POST" });
    loadSkills();
  };
}
function permModeFromPolicy(pol) {
  if (pol.hitl && pol.hitl.enabled === false) return "full";
  const tools = pol.hitl && pol.hitl.tools;
  if (Array.isArray(tools) && tools.length && !tools.includes("write_file")) return "auto";
  return "confirm";
}

async function loadSecurity() {
  const pol = await api("/api/admin/security");
  const tools = await api(`/api/agents/${state.agentId}/tool-settings`);
  const mode = permModeFromPolicy(pol);
  const guard = (pol.tool_guard && pol.tool_guard.mode) || "warn";
  $("securityBox").innerHTML = `
    <h3>权限与沙箱</h3>
    <p class="muted">这些开关会立刻生效，和输入栏的权限档位是同一套设置。</p>
    <div id="secMsg" class="muted"></div>
    <h4>权限档位</h4>
    <div class="seg" id="secModes">
      <button data-mode="confirm" class="${mode === "confirm" ? "on" : ""}">变更前确认</button>
      <button data-mode="auto" class="${mode === "auto" ? "on" : ""}">自动编辑</button>
      <button data-mode="plan" class="${mode === "plan" ? "on" : ""}">计划模式</button>
      <button data-mode="full" class="${mode === "full" ? "on" : ""}">完全访问</button>
    </div>
    <label class="switch-row"><input type="checkbox" id="secHitl" ${pol.hitl.enabled ? "checked" : ""}> 危险操作先问我</label>
    <label class="switch-row"><input type="checkbox" id="secFs" ${pol.filesystem.enabled ? "checked" : ""}> 限制敏感目录</label>
    <h4>命令护栏</h4>
    <div class="seg" id="secGuard">
      <button data-guard="off" class="${guard === "off" ? "on" : ""}">关闭</button>
      <button data-guard="warn" class="${guard === "warn" ? "on" : ""}">警告</button>
      <button data-guard="block" class="${guard === "block" ? "on" : ""}">拦截</button>
    </div>
    <h4>工具开关</h4>
    ${(tools.tools || []).map((t) => `
      <label class="switch-row">
        <input type="checkbox" data-tool="${t.name}" data-source="${t.source}" data-plugin="${t.plugin_id || ""}" ${t.enabled ? "checked" : ""} ${t.disableable === false ? "disabled" : ""}>
        <span>${t.label}</span>
        <small>${t.disableable === false ? "必开" : (t.enabled ? "开" : "关")}</small>
      </label>`).join("")}
  `;
  const msg = $("secMsg");
  $("secModes").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    try { await applyPerm(btn.dataset.mode); loadSecurity(); }
    catch (err) { msg.textContent = String(err.message || err); }
  };
  $("secHitl").onchange = async (e) => {
    try {
      await api("/api/admin/security", { method: "PUT", body: JSON.stringify({ hitl: { enabled: e.target.checked } }) });
      state.perm = e.target.checked ? "confirm" : "full";
      localStorage.setItem("auscode.perm", state.perm);
      setPermLabel();
    } catch (err) { msg.textContent = String(err.message || err); e.target.checked = !e.target.checked; }
  };
  $("secFs").onchange = async (e) => {
    try { await api("/api/admin/security", { method: "PUT", body: JSON.stringify({ filesystem: { enabled: e.target.checked } }) }); }
    catch (err) { msg.textContent = String(err.message || err); e.target.checked = !e.target.checked; }
  };
  $("secGuard").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    try {
      await api("/api/admin/security", { method: "PUT", body: JSON.stringify({ tool_guard: { enabled: btn.dataset.guard !== "off", mode: btn.dataset.guard } }) });
      loadSecurity();
    } catch (err) { msg.textContent = String(err.message || err); }
  };
  $("securityBox").onchange = async (e) => {
    const box = e.target;
    if (!box.dataset.tool) return;
    try {
      await api(`/api/agents/${state.agentId}/tool-settings/${encodeURIComponent(box.dataset.tool)}`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: box.checked,
          source: box.dataset.source || "builtin",
          plugin_id: box.dataset.plugin || null,
        }),
      });
    } catch (err) {
      msg.textContent = String(err.message || err);
      box.checked = !box.checked;
    }
  };
}

async function fetchRemoteModels() {
  let api_key = $("pKey").value;
  if (!api_key && state.editingProviderId) {
    const providers = await api("/api/providers");
    const row = (providers || []).find((p) => String(p.id) === String(state.editingProviderId));
    api_key = row && row.api_key;
  }
  const body = { kind: $("pKind").value, base_url: $("pUrl").value.trim(), api_key };
  $("providerMsg").textContent = "正在拉取模型…";
  const data = await api("/api/admin/providers/fetch-models", { method: "POST", body: JSON.stringify(body) });
  state.selectedModels = (data.models || []).map((m) => m.id);
  $("fetchedModels").innerHTML = (data.models || []).map((m) =>
    `<label class="list-item"><input type="checkbox" checked data-mid="${m.id}"> ${m.id}</label>`
  ).join("") || "没有返回模型";
  $("providerMsg").textContent = `拉到 ${(data.models || []).length} 个模型`;
}

async function saveProvider() {
  const name = $("pName").value.trim();
  const base_url = $("pUrl").value.trim();
  const api_key = $("pKey").value;
  if (!name || !base_url) {
    $("providerMsg").textContent = "名称和地址都要填";
    return;
  }
  if (!state.editingProviderId && !api_key) {
    $("providerMsg").textContent = "新建时必须填 API Key";
    return;
  }
  if (!/^https?:\/\//i.test(base_url)) {
    $("providerMsg").textContent = "Base URL 需要 http 或 https";
    return;
  }
  const boxes = [...document.querySelectorAll("#fetchedModels input:checked")];
  const models = (boxes.length ? boxes.map((b) => b.dataset.mid) : state.selectedModels).map((id) => ({ id, name: id, enabled: true }));
  $("providerMsg").textContent = "保存中…";
  let pid = state.editingProviderId;
  if (pid) {
    const patch = { kind: $("pKind").value, base_url };
    if (api_key) patch.api_key = api_key;
    if (models.length) patch.models = models;
    await api(`/api/admin/providers/${pid}`, { method: "PATCH", body: JSON.stringify(patch) });
  } else {
    if (!models.length) {
      $("providerMsg").textContent = "先拉取模型，再保存";
      return;
    }
    const created = await api("/api/admin/providers", {
      method: "POST",
      body: JSON.stringify({ name, kind: $("pKind").value, base_url, api_key, models }),
    });
    pid = created.id;
  }
  const mid = models[0] && models[0].id;
  if (mid) {
    const test = await api(`/api/admin/providers/${pid}/test`, {
      method: "POST",
      body: JSON.stringify({ model_id: mid }),
    });
    $("providerMsg").textContent = test.ok ? `已保存并测通（${test.latency_ms} ms）` : "已保存，但测通失败";
  } else {
    $("providerMsg").textContent = "已保存";
  }
  state.editingProviderId = null;
  await loadModels();
  loadModelPage();
}

async function loadWorkspaceSettings() {
  const agents = await api("/api/agents");
  const a = (agents || [])[0] || {};
  const root = (a.config && a.config.backend && a.config.backend.root_dir) || "";
  const virtual = !!(a.config && a.config.backend && a.config.backend.virtual_mode);
  $("wsCurrent").textContent = `当前：${root || "未设置"}`;
  $("wsCustom").value = root;
  $("wsVirtual").checked = virtual;
}
async function applyWorkspace(root) {
  const path = (root || $("wsCustom").value || "").trim();
  if (!path) { $("wsMsg").textContent = "请填写路径"; return; }
  $("wsMsg").textContent = "保存中…";
  const agents = await api("/api/agents");
  const a = (agents || [])[0];
  const cfg = { ...(a.config || {}) };
  cfg.backend = {
    ...(cfg.backend || {}),
    type: "local_shell",
    root_dir: path.replace(/\\/g, "/"),
    virtual_mode: $("wsVirtual").checked,
  };
  await api(`/api/agents/${a.agent_id}`, { method: "PATCH", body: JSON.stringify({ config: cfg }) });
  $("wsMsg").textContent = "已保存。新对话会按这个根目录读写文件。";
  loadWorkspaceSettings();
}

async function newThread() {
  const t = await api(`/api/agents/${state.agentId}/threads`, { method: "POST" });
  state.threadId = t.thread_id;
  $("messages").innerHTML = "";
  $("pageTitle").textContent = "新对话";
  await loadThreads();
}

async function boot() {
  const sess = await fetch("/api/ui/session").then((r) => r.json());
  if (!sess.ok) throw new Error(sess.error || "无法读取本机 Token");
  state.token = sess.token;
  state.agentId = sess.agent_id || state.agentId;
  state.homeDir = sess.home_dir || "";
  state.projectDir = sess.project_dir || "D:/AusCode";
  setPermLabel();
  await Promise.all([loadModels(), loadThreads(), refreshUsage(), ensureSlashCatalog().catch(() => {})]);
  const threads = await api(`/api/agents/${state.agentId}/threads`).catch(() => []);
  const saved = localStorage.getItem("auscode.thread");
  const pick = (threads || []).find((t) => t.thread_id === saved) || (threads || [])[0];
  if (pick && pick.thread_id) {
    try { await openThread(pick.thread_id); }
    catch { localStorage.removeItem("auscode.thread"); }
  }
  connectWs();
}

$("nav").onclick = (e) => {
  const btn = e.target.closest("button");
  if (btn) showPage(btn.dataset.page);
};
$("sendBtn").onclick = send;
$("prompt").addEventListener("keydown", (e) => {
  const menuOpen = state.slashItems.length && !$("slashMenu").classList.contains("hidden");
  if (menuOpen && e.key === "ArrowDown") {
    e.preventDefault();
    renderSlash(state.slashItems, state.slashIndex + 1);
    return;
  }
  if (menuOpen && e.key === "ArrowUp") {
    e.preventDefault();
    renderSlash(state.slashItems, state.slashIndex - 1);
    return;
  }
  if (menuOpen && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
    e.preventDefault();
    applySlash(state.slashItems[state.slashIndex]);
    return;
  }
  if (e.key === "Escape") hideSlash();
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
$("prompt").addEventListener("input", () => { updateSlash().catch(() => {}); });
$("slashMenu").onclick = (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  applySlash(state.slashItems[Number(btn.dataset.i)]);
};
$("btnNew").onclick = newThread;
$("btnDocs").onclick = () => window.open("/api/docs", "_blank");
$("permBtn").onclick = () => $("permMenu").classList.toggle("open");
$("permMenu").onclick = (e) => {
  const btn = e.target.closest("button");
  if (btn) applyPerm(btn.dataset.mode);
};
$("modelSelect").onchange = async () => {
  const ref = $("modelSelect").value;
  const slash = ref.indexOf("/");
  if (slash < 0) return;
  const provider_name = ref.slice(0, slash);
  const model = ref.slice(slash + 1);
  await api("/api/providers/active-model", { method: "PUT", body: JSON.stringify({ provider_name, model }) });
  await api(`/api/agents/${state.agentId}`, { method: "PATCH", body: JSON.stringify({ default_model: ref }) });
};
$("wsHome").onclick = () => applyWorkspace(state.homeDir).catch((err) => { $("wsMsg").textContent = String(err.message || err); });
$("wsProject").onclick = () => applyWorkspace(state.projectDir).catch((err) => { $("wsMsg").textContent = String(err.message || err); });
$("wsApply").onclick = () => applyWorkspace($("wsCustom").value).catch((err) => { $("wsMsg").textContent = String(err.message || err); });

boot().catch((err) => {
  const box = $("messages");
  if (box) box.innerHTML = `<div class="muted">启动失败：${err.message || err}</div>`;
});
