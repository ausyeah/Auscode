const state = {
  token: "",
  agentId: "TV3AHW",
  homeDir: "",
  projectDir: "D:/AusCode",
  threadId: "",
  models: [],
  ws: null,
  perm: localStorage.getItem("auscode.perm") || "full",
  fetchedModels: [],
  slashItems: [],
  slashIndex: 0,
  slashGen: 0,
  defaultEffort: localStorage.getItem("auscode.effort") || "medium",
  goals: {},
  goalTimer: null,
  goalKickTimer: null,
  composers: {},       // threadId -> { text, polishOriginal, polishResult, attachments, linkedThreads, pendingSkills }
  usageByThread: {},   // threadId -> { input, output, cacheRead, cacheWrite, uncached, hit, speed }
  outTokensByThread: {},
  startedAtByThread: {},
  liveTurns: {},
  todosByThread: {},
  openingThread: "",
  renamingThread: "",
  rebuildingThreads: false,
  openGen: 0,
  streamBuf: "",
  streamTimer: null,
  lastSpeedPaint: 0,
  assistantEl: null,
  assistantThread: "",
};
function composer(tid) {
  const id = tid || state.threadId;
  if (!id) return null;
  if (!state.composers[id]) {
    state.composers[id] = { text: "", polishOriginal: "", polishResult: "", attachments: [], linkedThreads: [], pendingSkills: [], pendingPlugins: [] };
  }
  return state.composers[id];
}
function usageFor(tid) {
  const id = tid || state.threadId;
  if (!state.usageByThread[id]) {
    state.usageByThread[id] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, uncached: 0, hit: null, speed: 0 };
  }
  return state.usageByThread[id];
}
function liveTurn(id) {
  const tid = id || state.threadId;
  if (!tid) return null;
  if (!state.liveTurns[tid]) {
    state.liveTurns[tid] = { text: "", thinking: "", tools: [], active: false, user: "", context: [] };
  }
  return state.liveTurns[tid];
}
function isThreadStreaming(tid) {
  const t = state.liveTurns[tid];
  return Boolean(t && t.active);
}
function frameThread(frame) {
  return String(frame.thread_id || "").trim();
}
function isCurrentFrame(frame) {
  const tid = frameThread(frame);
  return Boolean(tid) && tid === state.threadId;
}
function activeGoal() {
  return state.goals[state.threadId] || null;
}

const EFFORT_OPTIONS = [
  { value: "low", label: "思考：低" },
  { value: "medium", label: "思考：中" },
  { value: "high", label: "思考：高" },
  { value: "xhigh", label: "思考：最高" },
];
function effortMode(effort) {
  return effort === "low" ? "disabled" : "enabled";
}
function applyEffortSelect(effort) {
  const value = EFFORT_OPTIONS.some((o) => o.value === effort) ? effort : "medium";
  state.defaultEffort = value;
  localStorage.setItem("auscode.effort", value);
  const box = $("effortSelect");
  if (box) box.value = value;
}

const PERM = {
  confirm: { label: "变更前确认", hitl: { enabled: true, tools: "default" } },
  auto: { label: "自动编辑", hitl: { enabled: true, tools: ["bash", "execute"] } },
  plan: { label: "计划模式", hitl: { enabled: true, tools: "default" } },
  full: { label: "完全访问", hitl: { enabled: false, tools: "default" } },
};

const $ = (id) => document.getElementById(id);
const titles = {
  chat: "当前会话", cron: "自动化", usage: "Token 统计", memory: "记忆",
  models: "模型", skills: "技能", plugins: "插件", security: "权限", settings: "设置",
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
  if (!res.ok) {
    const err = data && (data.detail || data.error || data.message);
    const msg = typeof err === "string" ? err : (err && (err.message || err.code)) || res.statusText;
    throw new Error(msg);
  }
  return data;
}

function fmt(n) {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
function tok(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
  return `${fmt(n)} token`;
}
function tokPair(input, output) {
  return `入 ${tok(input)} / 出 ${tok(output)}`;
}
function speedText(n) {
  return `${Number(n || 0)} t/s`;
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

function attachmentPreviewUrl(att) {
  const path = att && (att.workspace_path || att.path || "");
  if (att && (att.url || att.access_url) && String(att.url || att.access_url).startsWith("blob:")) {
    return att.url || att.access_url;
  }
  if (!path) return "";
  const mime = att.media_type || att.mime_type || "";
  const q = `source=${encodeURIComponent(path)}${mime ? `&mime_type=${encodeURIComponent(mime)}` : ""}`;
  return `/api/agents/${encodeURIComponent(state.agentId)}/media/preview?${q}`;
}
async function fillAuthImage(img, url) {
  if (!url || !state.token) return;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    img.src = URL.createObjectURL(blob);
  } catch {}
}
function isImageAttachment(att) {
  const mime = String((att && (att.media_type || att.mime_type)) || "").toLowerCase();
  const kind = String((att && att.kind) || "").toLowerCase();
  const name = String((att && att.filename) || "");
  return kind === "image" || mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}
function addBubble(role, text, meta = {}) {
  if (meta.threadId && meta.threadId !== state.threadId) return null;
  const wrap = document.createElement("div");
  wrap.className = `bubble-wrap ${role}`;
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  const atts = meta.attachments || [];
  const images = atts.filter(isImageAttachment);
  const files = atts.filter((a) => !isImageAttachment(a));
  if (images.length) {
    const gallery = document.createElement("div");
    gallery.className = "bubble-images";
    images.forEach((att) => {
      const img = document.createElement("img");
      img.alt = att.filename || "图片";
      fillAuthImage(img, attachmentPreviewUrl(att));
      gallery.appendChild(img);
    });
    el.appendChild(gallery);
  }
  if (files.length) {
    const list = document.createElement("div");
    list.className = "bubble-files";
    files.forEach((att) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = att.filename || "附件";
      list.appendChild(chip);
    });
    el.appendChild(list);
  }
  if (text) setBubbleContent(el, text, { markdown: role === "assistant" });
  else if (!images.length && !files.length) setBubbleContent(el, "", { markdown: false });
  wrap.appendChild(el);
  const actions = document.createElement("div");
  actions.className = "bubble-actions";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.title = "复制";
  copyBtn.textContent = "⧉";
  copyBtn.onclick = () => copyText(el.dataset.raw || el.textContent);
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
    forkBtn.onclick = () => forkFrom(wrap, el.dataset.raw || el.textContent);
    actions.appendChild(forkBtn);
  }
  wrap.dataset.msgId = meta.id || "";
  wrap.dataset.role = role;
  wrap.appendChild(actions);
  const box = $("messages");
  if (meta.before && meta.before.parentNode === box) box.insertBefore(wrap, meta.before);
  else box.appendChild(wrap);
  if (!meta.before) box.scrollTop = box.scrollHeight;
  return el;
}

function beginEdit(wrap, el) {
  if (wrap.querySelector(".bubble-edit")) return;
  const ta = document.createElement("textarea");
  ta.className = "bubble-edit";
  ta.value = el.dataset.raw || el.textContent;
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
    setBubbleContent(el, text, { markdown: false });
    ta.remove();
    row.remove();
    await send(text, { fromEdit: true, threadId: state.threadId });
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
    el.dataset.pinned = "";
    const toggleTrace = () => {
      const open = el.classList.contains("collapsed");
      el.classList.toggle("collapsed", !open);
      el.dataset.pinned = open ? "1" : "";
    };
    el.querySelector(".trace-head").onclick = toggleTrace;
    el.querySelector(".trace-summary").onclick = toggleTrace;
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
  if (!thinkTimer) thinkTimer = setInterval(tickTimers, 1000);
}
function startWork() {
  const el = traceRoot();
  if (el.dataset.pinned !== "1") el.classList.add("collapsed");
  else el.classList.remove("collapsed");
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
    el.className = "think-block live trace-step";
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
function addContextBlock(title, body, meta = {}) {
  if (meta.threadId && meta.threadId !== state.threadId) return null;
  const el = document.createElement("div");
  el.className = "think-block context-block";
  const head = document.createElement("button");
  head.type = "button";
  head.className = "think-head";
  head.textContent = title || "接续上下文";
  const box = document.createElement("div");
  box.className = "think-body";
  box.textContent = body || "";
  head.onclick = () => el.classList.toggle("open");
  el.append(head, box);
  const host = $("messages");
  if (meta.before && meta.before.parentNode === host) host.insertBefore(el, meta.before);
  else host.appendChild(el);
  if (!meta.before) host.scrollTop = host.scrollHeight;
  return el;
}
function splitLinkedContext(content) {
  const raw = String(content || "");
  if (!raw.includes("【接续对话")) return { blocks: [], text: raw };
  const parts = raw.split(/\n\n(?=【接续对话)/);
  const blocks = [];
  const rest = [];
  parts.forEach((part) => {
    const piece = part.trim();
    if (!piece) return;
    if (piece.startsWith("【接续对话")) {
      const first = piece.split("\n")[0].replace(/^【|】$/g, "");
      blocks.push({ title: first, body: piece });
    } else {
      rest.push(piece);
    }
  });
  return { blocks, text: rest.join("\n\n").trim() };
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
function handleAskUser(name, args) {
  const root = startWork();
  const body = root.querySelector(".trace-body");
  const card = document.createElement("div");
  card.className = "ask-card";
  const q = (args && (args.question || args.prompt || args.text)) || "需要你选一下";
  const options = (args && (args.options || args.choices)) || [];
  const title = document.createElement("div");
  title.textContent = q;
  card.appendChild(title);
  const row = document.createElement("div");
  row.className = "ask-options";
  (Array.isArray(options) ? options : []).forEach((opt) => {
    const label = typeof opt === "string" ? opt : (opt.label || opt.value || "");
    const value = typeof opt === "string" ? opt : (opt.value || opt.label || "");
    if (!label) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.textContent = label;
    btn.onclick = () => {
      card.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      send(value, { fromGoal: true, threadId: state.threadId });
    };
    row.appendChild(btn);
  });
  card.appendChild(row);
  body.appendChild(card);
  root.classList.remove("collapsed");
}
function normalizeTodos(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    if (typeof it === "string") return { text: it, status: "pending" };
    return {
      text: it.content || it.text || it.title || "",
      status: String(it.status || "pending"),
    };
  }).filter((it) => it.text);
}
function todoMark(status) {
  const st = String(status || "").toLowerCase();
  if (st === "completed" || st === "done") return "✓";
  if (st === "in_progress" || st === "running") return "→";
  return "○";
}
function renderPlanMenu() {
  const pop = $("planPop");
  const menu = $("planMenu");
  const count = $("planCount");
  const items = (state.todosByThread[state.threadId] || []);
  const old = document.getElementById("todoStrip");
  if (old) old.remove();
  if (!items.length) {
    if (pop) pop.classList.add("hidden");
    if (count) count.textContent = "—";
    if (menu) {
      menu.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "这条对话还没有计划。";
      menu.appendChild(empty);
    }
    return;
  }
  if (pop) pop.classList.remove("hidden");
  const done = items.filter((it) => {
    const st = String(it.status || "").toLowerCase();
    return st === "completed" || st === "done";
  }).length;
  if (count) count.textContent = `${done}/${items.length}`;
  if (!menu) return;
  menu.replaceChildren();
  const head = document.createElement("div");
  head.className = "ctx-head";
  const left = document.createElement("span");
  left.textContent = "进程";
  const right = document.createElement("b");
  right.textContent = `${done}/${items.length}`;
  head.append(left, right);
  menu.appendChild(head);
  items.forEach((it) => {
    const row = document.createElement("div");
    const st = String(it.status || "pending").toLowerCase();
    row.className = `plan-item ${st}`;
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = todoMark(st);
    const text = document.createElement("span");
    text.textContent = it.text;
    row.append(mark, text);
    menu.appendChild(row);
  });
}
function handleTodoFrame(args, threadId) {
  const items = normalizeTodos(args && (args.todos || args.items || args.tasks));
  if (!items.length) return;
  const tid = threadId || state.threadId;
  if (!tid) return;
  state.todosByThread[tid] = items;
  if (tid === state.threadId) renderPlanMenu();
}
function ingestTodosFromBlocks(blocks, threadId) {
  (Array.isArray(blocks) ? blocks : []).forEach((b) => {
    if (!b || typeof b !== "object") return;
    const name = String(b.name || "").toLowerCase();
    if (!(name.includes("write_todos") || name.includes("todo"))) return;
    handleTodoFrame(b.input || b.args || b.output || b.content, threadId);
  });
}
function handleToolFrame(frame) {
  const t = frame.type || "";
  const name = frame.name || frame.tool || frame.tool_name || (frame.data && (frame.data.name || frame.data.tool)) || "工具";
  const id = frame.id || frame.tool_call_id || (frame.data && frame.data.id) || name;
  const args = frame.args || frame.input || (frame.data && (frame.data.args || frame.data.input));
  const lower = String(name || "").toLowerCase();
  if (lower.includes("ask_user") || lower.includes("askuser")) {
    handleAskUser(name, args);
    return true;
  }
  if (lower.includes("write_todos") || lower.includes("todo")) {
    handleTodoFrame(args, frame.thread_id || state.threadId);
    upsertToolCard(id, name, t.includes("result") || t.includes("end") ? "完成" : "调用中", args);
    return true;
  }
  if (lower === "task" || lower.includes("ask_agent")) {
    upsertToolCard(id, name, t.includes("result") || t.includes("end") ? "完成" : "调用中", args);
    return true;
  }
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
function updateStreamUI() {
  // Buttons always reflect the *visible* thread's stream only.
  const on = isThreadStreaming(state.threadId);
  const sendBtn = $("sendBtn");
  const stopBtn = $("stopBtn");
  if (sendBtn) sendBtn.classList.toggle("hidden", on);
  if (stopBtn) stopBtn.classList.toggle("hidden", !on);
  const ks = $("tokSpeed");
  if (ks && !on) ks.textContent = speedText(0);
}
function stopTurn() {
  const tid = state.threadId;
  if (!tid || !isThreadStreaming(tid)) return;
  const goal = state.goals[tid];
  if (goal && goal.status === "running") pauseGoal();
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: "cancel", thread_id: tid }));
  }
  const live = state.liveTurns[tid];
  if (live) live.active = false;
  finishThinkStatus();
  stopWork();
  updateStreamUI();
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
  ws.addEventListener("open", () => {
    const ids = new Set([state.threadId, ...Object.keys(state.liveTurns)]);
    Object.values(state.goals || {}).forEach((g) => {
      if (g && g.status === "running" && g.threadId) ids.add(g.threadId);
    });
    ids.forEach((id) => subscribeThread(id));
    scheduleGoalKick();
  });
  ws.onmessage = (ev) => {
    let frame;
    try { frame = JSON.parse(ev.data); } catch { return; }
    const t = frame.type;
    const tid = frameThread(frame);
    if (!tid && t !== "pong") return;
    const live = tid ? liveTurn(tid) : null;
    const here = isCurrentFrame(frame);
    let assistantEl = state.assistantEl;
    let assistantThread = state.assistantThread;
    if (here && assistantThread && assistantThread !== tid) { assistantEl = null; assistantThread = ""; }
    if (t === "tool_start" || t === "tool_call" || t === "tool_use" || t === "tool_result" || t === "tool_end" || t === "hitl_required") {
      if (live) {
        live.tools.push({ type: t, name: frame.name || frame.tool, id: frame.id || frame.tool_call_id, args: frame.args || frame.input, output: frame.output || frame.content });
        live.active = true;
      }
      const toolName = String(frame.name || frame.tool || "").toLowerCase();
      if (toolName.includes("write_todos") || toolName.includes("todo")) {
        handleTodoFrame(frame.args || frame.input, tid);
      }
      if (here) handleToolFrame(frame);
      return;
    }
    if (t === "reasoning") {
      const piece = frame.content || frame.text || "";
      if (live) { live.thinking += piece; live.active = true; }
      if (here) appendThink(piece);
      return;
    }
    if (t === "token" || t === "text" || t === "delta") {
      const piece = frame.content || frame.text || frame.delta || "";
      if (!piece) return;
      const chunk = extractText(piece) || String(piece);
      if (live) { live.text += chunk; live.active = true; }
      if (!here) return;
      finishThinkStatus();
      if (!assistantEl || assistantThread !== tid) {
        assistantEl = addBubble("assistant", "", { id: frame.message_id || "" });
        assistantThread = tid;
      }
      state.assistantEl = assistantEl;
      state.assistantThread = assistantThread;
      state.streamBuf += chunk;
      state.outTokensByThread[tid] = (state.outTokensByThread[tid] || 0) + 1;
      const u = usageFor(tid);
      const sec = Math.max(0.001, (Date.now() - (state.startedAtByThread[tid] || Date.now())) / 1000);
      u.speed = Math.round(state.outTokensByThread[tid] / sec);
      const flush = () => {
        if (!state.assistantEl || !state.streamBuf) return;
        setBubbleContent(state.assistantEl, (state.assistantEl.dataset.raw || "") + state.streamBuf, { markdown: true });
        state.streamBuf = "";
        $("messages").scrollTop = $("messages").scrollHeight;
      };
      if (!state.streamTimer) {
        state.streamTimer = setTimeout(() => {
          state.streamTimer = null;
          flush();
        }, 70);
      }
      const now = Date.now();
      if (now - (state.lastSpeedPaint || 0) > 200) {
        state.lastSpeedPaint = now;
        $("tokSpeed").textContent = speedText(u.speed);
      }
      return;
    }
    if (t === "usage") {
      const u = frame.data || frame;
      const input = Number(u.input_tokens ?? u.input ?? 0);
      const output = Number(u.output_tokens ?? u.output ?? 0);
      const cacheRead = Number(u.cache_read_tokens ?? 0);
      const cacheWrite = Number(u.cache_write_tokens ?? 0);
      const uncached = Number(u.uncached_input_tokens ?? Math.max(0, input - cacheRead));
      let hit = u.cache_hit_percent;
      if (hit == null && input > 0) hit = Math.round(cacheRead * 1000 / input) / 10;
      Object.assign(usageFor(tid), { input, output, cacheRead, cacheWrite, uncached, hit });
      if (!here) return;
      $("turnUsage").textContent = tokPair(input, output);
      $("turnCache").textContent = hit == null ? "—" : `${hit}% 命中`;
      renderSpeedMenu();
      return;
    }
    if (t === "done" || t === "turn_end") {
      const endedId = tid;
      if (live) live.active = false;
      if (here) {
        if (state.streamTimer) { clearTimeout(state.streamTimer); state.streamTimer = null; }
        if (state.assistantEl && state.streamBuf) {
          setBubbleContent(state.assistantEl, (state.assistantEl.dataset.raw || "") + state.streamBuf, { markdown: true });
          state.streamBuf = "";
        }
        finishThinkStatus();
        stopWork();
        updateStreamUI();
        if (assistantEl && assistantThread === tid) {
          setBubbleContent(assistantEl, assistantEl.dataset.raw || assistantEl.textContent, { markdown: true });
        }
        state.assistantEl = null;
        state.assistantThread = "";
        refreshContext();
        refreshUsage();
        renderSpeedMenu();
      }
      const endedText = (live && live.text) || "";
      if (endedId) delete state.liveTurns[endedId];
      onGoalTurnEnd(endedId, endedText);
      return;
    }
    if (t === "error" || t === "turn_error") {
      if (here) addBubble("think", frame.message || JSON.stringify(frame));
      if (live) live.active = false;
      if (here) { finishThinkStatus(); stopWork(); updateStreamUI(); }
      return;
    }
    if (t === "turn_status") {
      if (live && frame.active) live.active = true;
      if (here) { updateStreamUI(); }
      return;
    }
  };
}

async function send(preset, opts = {}) {
  const target = opts.threadId || state.threadId;
  const comp = composer(target);
  const fromBox = !opts.fromEdit && !opts.fromGoal && state.threadId === target;
  let text = (typeof preset === "string" ? preset : (fromBox ? $("prompt").value : (comp ? comp.text : ""))).trim();
  const files = (comp && comp.attachments) || [];
  const linked = (comp && comp.linkedThreads) || [];
  if (!text && !files.length && !linked.length) return;
  if (target && isThreadStreaming(target)) return;
  if (typeof preset !== "string" && fromBox) {
    $("prompt").value = "";
    if (comp) { comp.text = ""; comp.polishResult = ""; }
    $("undoPolishBtn") && $("undoPolishBtn").classList.add("hidden");
  }
  const shown = (typeof preset === "string" ? preset : text).trim() || (files.length ? `附件 ${files.map((f) => f.filename).join("、")}` : text);
  const contextBlocks = [];
  if (linked.length) {
    for (const t of linked) {
      try {
        const hist = await api(`/api/agents/${state.agentId}/threads/${t.id}/history?limit=20`);
        const msgs = (hist.messages || []).map((m) => {
          const role = m.role === "user" || m.role === "human" ? "用户" : "助手";
          return `${role}：${extractText(m.content).slice(0, 800)}`;
        }).filter((line) => !line.endsWith("："));
        const body = `【接续对话 ${t.title}】\n${msgs.join("\n")}`;
        contextBlocks.push({ title: `接续 · ${t.title || "未命名"}`, body });
      } catch {}
    }
    if (contextBlocks.length) text = `${contextBlocks.map((b) => b.body).join("\n\n")}\n\n${text}`.trim();
  }
  const live = liveTurn(target);
  if (live) {
    live.active = true;
    live.user = shown;
    live.context = contextBlocks;
    live.text = "";
    live.thinking = "";
    live.tools = [];
  }
  if (!opts.fromEdit && !opts.fromGoal) {
    contextBlocks.forEach((b) => addContextBlock(b.title, b.body, { threadId: target }));
    addBubble("user", shown, { threadId: target, attachments: files });
  }
  state.startedAtByThread[target] = Date.now();
  state.outTokensByThread[target] = 0;
  Object.assign(usageFor(target), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, uncached: 0, hit: null, speed: 0 });
  if (state.threadId === target) {
    $("turnUsage").textContent = "—";
    $("turnCache").textContent = "—";
    $("tokSpeed").textContent = speedText(0);
    updateStreamUI();
    startThinkStatus();
  }
  renderSpeedMenu();
  if (!state.ws || state.ws.readyState !== 1) connectWs();
  const waitOpen = () => new Promise((resolve) => {
    if (state.ws.readyState === 1) return resolve();
    state.ws.addEventListener("open", resolve, { once: true });
  });
  await waitOpen();
  const model = $("modelSelect").value;
  const effort = $("effortSelect").value;
  const content = [{ type: "text", text }];
  files.forEach((f) => {
    content.push({
      type: (f.media_type || "").startsWith("image/") ? "image" : "file",
      workspace_path: f.workspace_path || f.path,
      filename: f.filename,
      media_type: f.media_type,
    });
  });
  const payload = {
    type: "user_turn",
    text,
    messages: [{ role: "user", content }],
    thread_id: target || undefined,
    model,
    default_model: model,
    reasoning_mode: effortMode(effort),
    reasoning_effort: effort,
  };
  if (state.perm === "plan") payload.skills = [];
  else if (comp && comp.pendingSkills.length) payload.skills = [...comp.pendingSkills];
  if (comp && (comp.pendingPlugins || []).length) {
    const names = comp.pendingPlugins.map((p) => p.name || p.id).filter(Boolean);
    const hint = `请先调用这些插件工具完成请求：${names.join("、")}。不要只口头描述。`;
    payload.text = `${hint}\n\n${payload.text || ""}`.trim();
    if (payload.messages && payload.messages[0] && payload.messages[0].content) {
      payload.messages[0].content[0] = { type: "text", text: payload.text };
    }
  }
  if (comp) { comp.pendingSkills = []; comp.pendingPlugins = []; }
  hideSlash();
  if (comp) { comp.attachments = []; comp.linkedThreads = []; }
  renderComposerChips();
  if (payload.thread_id) {
    state.ws.send(JSON.stringify({ type: "subscribe", thread_id: payload.thread_id }));
  }
  state.ws.send(JSON.stringify(payload));
}

function renderComposerChips() {
  const box = $("composerChips");
  if (!box) return;
  box.replaceChildren();
  const comp = composer();
  const attachments = (comp && comp.attachments) || [];
  const linkedThreads = (comp && comp.linkedThreads) || [];
  const pendingSkills = (comp && comp.pendingSkills) || [];
  attachments.forEach((f, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = f.filename || "附件";
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.onclick = () => { comp.attachments.splice(i, 1); renderComposerChips(); };
    chip.appendChild(x);
    box.appendChild(chip);
  });
  linkedThreads.forEach((t, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `@ ${t.title}`;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.onclick = () => { comp.linkedThreads.splice(i, 1); renderComposerChips(); };
    chip.appendChild(x);
    box.appendChild(chip);
  });
  (comp.pendingPlugins || []).forEach((p, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `🔌 ${p.name || p.id}`;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = "去掉这个插件";
    x.onclick = () => {
      const slug = (comp.pendingPlugins[i] && comp.pendingPlugins[i].id) || "";
      comp.pendingPlugins.splice(i, 1);
      const boxEl = $("prompt");
      if (boxEl && slug) {
        const token = `/${slug}`;
        boxEl.value = boxEl.value.split(token).join("").replace(/ {2,}/g, " ").trimStart();
        comp.text = boxEl.value;
      }
      renderComposerChips();
    };
    chip.appendChild(x);
    box.appendChild(chip);
  });
  pendingSkills.forEach((id, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `$ ${id}`;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = "去掉这个技能";
    x.onclick = () => {
      const slug = comp.pendingSkills[i];
      comp.pendingSkills.splice(i, 1);
      const boxEl = $("prompt");
      if (boxEl && slug) {
        const token = `/${slug}`;
        boxEl.value = boxEl.value.split(token).join("").replace(/ {2,}/g, " ").trimStart();
        comp.text = boxEl.value;
      }
      renderComposerChips();
    };
    chip.appendChild(x);
    box.appendChild(chip);
  });
}

function filesFromClipboard(e) {
  const dt = e.clipboardData;
  if (!dt) return [];
  const out = [];
  const items = [...(dt.items || [])];
  items.forEach((item, i) => {
    if (item.kind !== "file") return;
    const file = item.getAsFile();
    if (!file) return;
    if (file.name && file.name !== "image.png" && file.name !== "blob") {
      out.push(file);
      return;
    }
    const ext = (file.type || "image/png").split("/")[1] || "png";
    out.push(new File([file], `paste-${Date.now()}-${i}.${ext}`, { type: file.type || "image/png" }));
  });
  if (out.length) return out;
  return [...(dt.files || [])];
}
async function addFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  for (const file of files) {
    const body = new FormData();
    body.append("file", file, file.name || "paste.png");
    const saved = await api(`/api/agents/${state.agentId}/upload`, { method: "POST", body });
    const comp = composer();
    if (!comp) continue;
    comp.attachments.push({
      filename: saved.filename || file.name,
      workspace_path: saved.workspace_path || saved.path,
      path: saved.path,
      media_type: saved.media_type || file.type,
    });
  }
  renderComposerChips();
}

function hidePlus() {
  $("plusMenu") && $("plusMenu").classList.remove("open");
}

async function pickLinkedThread() {
  const rows = await api(`/api/agents/${state.agentId}/threads`).catch(() => []);
  const others = (rows || []).filter((t) => t.thread_id !== state.threadId && t.has_messages);
  if (!others.length) return;
  const items = others.slice(0, 12).map((t) => ({
    kind: "thread",
    id: t.thread_id,
    label: t.title || "未命名",
    hint: t.channel_type || "",
  }));
  renderSlash(items, 0);
}

async function pickSkillFromPlus() {
  const cat = await ensureSlashCatalog();
  const items = cat.skills.map((s) => {
    const slug = s.slug || s.name || "";
    return { kind: "skill", id: slug, label: `/${slug}`, hint: (s.label && (s.label.zh || s.label)) || s.name || "" };
  }).slice(0, 12);
  if (!items.length) return;
  renderSlash(items, 0);
}

function persistGoals() {
  const rows = Object.values(state.goals || {}).filter((g) => g && g.text && g.threadId).map((g) => {
    if (g.status === "running") {
      g.elapsed = goalElapsed(g);
      g.tickAt = Date.now();
    }
    return { ...g };
  });
  if (!rows.length) localStorage.removeItem("auscode.goals");
  else localStorage.setItem("auscode.goals", JSON.stringify(rows));
}
function restoreGoals() {
  try {
    const raw = localStorage.getItem("auscode.goals") || localStorage.getItem("auscode.goal");
    const parsed = raw ? JSON.parse(raw) : null;
    const rows = Array.isArray(parsed) ? parsed : (parsed && parsed.text ? [parsed] : []);
    state.goals = {};
    rows.forEach((g) => {
      if (!g || !g.threadId || !g.text) return;
      state.goals[g.threadId] = {
        ...g,
        tickAt: Date.now(),
        elapsed: Number(g.elapsed || 0),
      };
    });
    localStorage.removeItem("auscode.goal");
    persistGoals();
  } catch {
    state.goals = state.goals || {};
  }
}
function subscribeThread(id) {
  if (!id || !state.ws || state.ws.readyState !== 1) return;
  state.ws.send(JSON.stringify({ type: "subscribe", thread_id: id }));
}
function subscribeGoalThreads() {
  Object.values(state.goals || {}).forEach((g) => {
    if (g && g.status === "running" && g.threadId) subscribeThread(g.threadId);
  });
}
function scheduleGoalKick() {
  if (state.goalKickTimer) clearTimeout(state.goalKickTimer);
  state.goalKickTimer = setTimeout(() => {
    state.goalKickTimer = null;
    Object.values(state.goals || {}).forEach((g) => {
      if (!g || g.status !== "running" || !g.threadId) return;
      if (isThreadStreaming(g.threadId)) return;
      send(continueGoalPrompt(g), { fromGoal: true, threadId: g.threadId });
    });
  }, 900);
}
function goalElapsed(goal) {
  const g = goal || activeGoal();
  if (!g) return 0;
  const extra = g.status === "running" ? Math.floor((Date.now() - (g.tickAt || Date.now())) / 1000) : 0;
  return (g.elapsed || 0) + extra;
}
function tickGoalClock() {
  const g = activeGoal();
  if (!g) return;
  const el = $("goalTime");
  if (el) el.textContent = secText(goalElapsed(g));
}
function renderGoalBar() {
  const bar = $("goalBar");
  if (!bar) return;
  const goal = activeGoal();
  if (!goal) {
    bar.classList.add("hidden");
    if (state.goalTimer) { clearInterval(state.goalTimer); state.goalTimer = null; }
    return;
  }
  bar.classList.remove("hidden");
  bar.classList.toggle("paused", goal.status === "paused");
  bar.classList.toggle("done", goal.status === "done");
  const labels = { running: "进行中的目标", paused: "已暂停的目标", done: "已完成的目标" };
  $("goalStatus").textContent = labels[goal.status] || "目标";
  $("goalText").textContent = goal.text;
  $("goalText").title = goal.text;
  tickGoalClock();
  $("goalPause").classList.toggle("hidden", goal.status !== "running");
  $("goalResume").classList.toggle("hidden", goal.status !== "paused");
  if (goal.status === "running" && !state.goalTimer) {
    state.goalTimer = setInterval(tickGoalClock, 1000);
  }
  if (goal.status !== "running" && state.goalTimer) {
    clearInterval(state.goalTimer);
    state.goalTimer = null;
  }
}
function lastAssistantText() {
  const bubbles = [...document.querySelectorAll(".bubble-wrap.assistant .bubble")];
  return (bubbles[bubbles.length - 1] && bubbles[bubbles.length - 1].textContent) || "";
}
function goalLooksDone(text) {
  const t = String(text || "");
  if (/AUSCODE_GOAL_DONE/.test(t)) return true;
  if (/目标已完成|目标完成|GOAL_DONE/.test(t) && t.length < 240) return true;
  return false;
}
function continueGoalPrompt(goal) {
  return [
    `你正在执行一个持续目标，在完成前不要停下。只服务当前这条对话，不要引用或改写其他对话。`,
    `目标：${goal.text}`,
    `这是第 ${goal.turns + 1} 轮。请直接继续干活，不要寒暄。`,
    `若目标已完整达成，最后一行只写：AUSCODE_GOAL_DONE`,
    `若还没完成，继续下一步，不要写 AUSCODE_GOAL_DONE。`,
  ].join("\n");
}
function editGoal() {
  const goal = activeGoal();
  if (!goal) return;
  const box = $("prompt");
  if (!box) return;
  const text = String(goal.text || "");
  box.value = text;
  const cur = composer(state.threadId);
  if (cur) {
    cur.text = text;
    cur.polishOriginal = "";
    cur.polishResult = "";
  }
  $("undoPolishBtn") && $("undoPolishBtn").classList.add("hidden");
  box.focus();
  const end = text.length;
  if (typeof box.setSelectionRange === "function") box.setSelectionRange(end, end);
}
function startGoal(text) {
  const value = String(text || "").trim();
  if (!value || !state.threadId) return;
  if (state.goalTimer) { clearInterval(state.goalTimer); state.goalTimer = null; }
  state.goals[state.threadId] = {
    text: value,
    status: "running",
    startedAt: Date.now(),
    tickAt: Date.now(),
    elapsed: 0,
    turns: 0,
    threadId: state.threadId,
  };
  persistGoals();
  renderGoalBar();
  subscribeThread(state.threadId);
  send(value, { fromGoal: false, threadId: state.threadId });
}
function pauseGoal() {
  const goal = activeGoal();
  if (!goal || goal.status !== "running") return;
  goal.elapsed = goalElapsed(goal);
  goal.status = "paused";
  persistGoals();
  renderGoalBar();
}
function resumeGoal() {
  const goal = activeGoal();
  if (!goal || goal.status !== "paused") return;
  goal.status = "running";
  goal.tickAt = Date.now();
  persistGoals();
  renderGoalBar();
  if (!isThreadStreaming(goal.threadId)) send(continueGoalPrompt(goal), { fromGoal: true, threadId: goal.threadId });
}
function clearGoal() {
  if (!state.threadId) return;
  delete state.goals[state.threadId];
  persistGoals();
  renderGoalBar();
}
function onGoalTurnEnd(threadId, endedText) {
  const tid = threadId || state.threadId;
  const goal = state.goals[tid];
  if (!goal || goal.status !== "running") return;
  goal.turns += 1;
  goal.elapsed = goalElapsed(goal);
  goal.tickAt = Date.now();
  const last = endedText || (tid === state.threadId ? lastAssistantText() : "");
  if (goalLooksDone(last) || goal.turns >= 24) {
    goal.status = "done";
    persistGoals();
    if (tid === state.threadId) renderGoalBar();
    return;
  }
  persistGoals();
  if (tid === state.threadId) renderGoalBar();
  setTimeout(() => {
    const g = state.goals[tid];
    if (g && g.status === "running" && !isThreadStreaming(tid)) {
      send(continueGoalPrompt(g), { fromGoal: true, threadId: tid });
    }
  }, 600);
}

function recentContext() {
  return [...document.querySelectorAll(".bubble-wrap")].slice(-6).map((el) => {
    const role = el.dataset.role === "user" ? "用户" : "助手";
    const text = (el.querySelector(".bubble") || {}).textContent || "";
    return `${role}：${text.slice(0, 400)}`;
  }).join("\n");
}

async function polishPrompt() {
  const box = $("prompt");
  const comp = composer();
  const draft = box.value.trim();
  if (!draft || $("polishBtn").classList.contains("loading")) return;
  const current = box.value;
  if (comp) {
    if (!comp.polishOriginal || current !== comp.polishResult) comp.polishOriginal = current;
  }
  $("polishBtn").classList.add("loading");
  try {
    const out = await api(`/api/agents/${state.agentId}/chat/polish`, {
      method: "POST",
      body: JSON.stringify({ text: draft, default_model: $("modelSelect").value || null }),
    });
    if (out && out.text) {
      box.value = out.text;
      if (comp) comp.polishResult = out.text;
      $("undoPolishBtn").classList.remove("hidden");
    }
  } catch (err) {
    box.title = String(err.message || err);
  } finally {
    $("polishBtn").classList.remove("loading");
  }
}

function undoPolish() {
  const comp = composer();
  if (!comp || !comp.polishOriginal) return;
  $("prompt").value = comp.polishOriginal;
  comp.polishResult = "";
  $("undoPolishBtn").classList.add("hidden");
}

function hideSlash() {
  state.slashGen += 1;
  const menu = $("slashMenu");
  if (menu) { menu.classList.add("hidden"); menu.innerHTML = ""; }
  state.slashItems = [];
  state.slashIndex = 0;
}

async function ensureSlashCatalog() {
  const [cmds, skills, plugins] = await Promise.all([
    api("/api/slash/commands?origin=ui").catch(() => ({ commands: [] })),
    api(`/api/agents/${state.agentId}/skills`).catch(() => []),
    api("/api/plugins").catch(() => []),
  ]);
  const skillRows = Array.isArray(skills) ? skills : (skills.items || []);
  const pluginRows = Array.isArray(plugins) ? plugins : (plugins.items || []);
  state.slashCatalog = {
    commands: cmds.commands || [],
    skills: skillRows.filter((s) => s.enabled !== false),
    plugins: pluginRows.filter((p) => p.enabled !== false),
  };
  return state.slashCatalog;
}

function slashQuery() {
  const text = $("prompt").value || "";
  const at = text.lastIndexOf("/");
  if (at < 0) return null;
  if (at > 0) {
    const prev = text.charAt(at - 1);
    if (prev !== " " && prev !== "\n" && prev !== "\t") return null;
  }
  const q = text.slice(at + 1);
  if (q.includes(" ") || q.includes("\n") || q.includes("\t") || q.includes("/")) return null;
  return { at, q };
}

function chatPageOpen() {
  const page = $("page-chat");
  return Boolean(page && page.classList.contains("active"));
}
function placeSlashMenu() {
  const menu = $("slashMenu");
  const box = $("prompt");
  if (!menu || !box || !chatPageOpen()) { hideSlash(); return; }
  const rect = box.getBoundingClientRect();
  menu.style.left = `${Math.max(16, rect.left)}px`;
  menu.style.width = `${Math.max(240, rect.width)}px`;
  menu.style.bottom = `${Math.max(16, window.innerHeight - rect.top + 8)}px`;
  menu.style.top = "auto";
}

function renderSlash(items, index) {
  const menu = $("slashMenu");
  if (!chatPageOpen() || !items.length) { hideSlash(); return; }
  state.slashItems = items;
  state.slashIndex = Math.max(0, Math.min(index, items.length - 1));
  menu.classList.remove("hidden");
  menu.innerHTML = items.map((it, i) =>
    `<button type="button" data-i="${i}" class="${i === state.slashIndex ? "on" : ""}"><b>${it.label}</b><small>${it.hint || ""}</small></button>`
  ).join("");
  placeSlashMenu();
}

async function updateSlash() {
  const seq = ++state.slashGen;
  if (!chatPageOpen()) { hideSlash(); return; }
  const hit = slashQuery();
  if (hit == null) { hideSlash(); return; }
  const cat = await ensureSlashCatalog();
  if (seq !== state.slashGen || !chatPageOpen()) return;
  const still = slashQuery();
  if (!still) { hideSlash(); return; }
  const q = still.q.toLowerCase();
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
  const plugins = (cat.plugins || []).map((p) => {
    const id = p.id || p.name || "";
    const name = p.name || id;
    return {
      kind: "plugin",
      id,
      name,
      label: `/${id}`,
      hint: p.description || name,
      search: `${id} ${name} ${p.description || ""}`.toLowerCase(),
    };
  });
  const commands = cat.commands.map((c) => ({
    kind: "command",
    id: c.name,
    label: c.command || `/${c.name}`,
    hint: c.label_zh || c.description_zh || "",
    action: c.client_action,
  }));
  const items = [...plugins, ...skills, ...commands].filter((it) => {
    if (!q) return true;
    const hay = `${it.search || ""} ${it.label} ${it.hint || ""}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 12);
  renderSlash(items, 0);
}

function applySlash(item) {
  const hit = slashQuery();
  const box = $("prompt");
  const comp = composer();
  const before = hit ? box.value.slice(0, hit.at) : box.value;
  const hints = {
    weather: "城市，例如北京",
    qrcode: "要生成二维码的文本或链接",
    "hot-topics": "可选平台，例如微博",
    "parcel-tracker": "快递单号",
    pomodoro: "专注分钟数，例如 25",
    "market-quotes": "股票或指数代码",
    "server-status": "要检查的地址",
    "mini-games": "想玩的小游戏名",
    tetris: "开始即可",
    "bilibili-anime": "番剧名",
    fortune: "开始即可",
  };
  if (item.kind === "skill") {
    if (comp) comp.pendingSkills = [item.id];
    box.value = `${before}/${item.id} `;
    box.placeholder = item.hint ? `接着写：${item.hint}` : "接着写你要用这个技能做什么";
    renderComposerChips();
  } else if (item.kind === "plugin") {
    if (comp) {
      comp.pendingPlugins = comp.pendingPlugins || [];
      if (!comp.pendingPlugins.some((p) => p.id === item.id)) {
        comp.pendingPlugins.push({ id: item.id, name: item.name || item.id });
      }
    }
    box.value = `${before}/${item.id} `;
    box.placeholder = `接着写：${hints[item.id] || item.hint || "补上具体内容再发送"}`;
    renderComposerChips();
  } else if (item.kind === "thread") {
    if (comp && !comp.linkedThreads.some((x) => x.id === item.id)) {
      comp.linkedThreads.push({ id: item.id, title: item.label });
      renderComposerChips();
    }
    hideSlash();
    box.focus();
    return;
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

function threadTitleText(id, fallback) {
  const row = document.querySelector(`.thread[data-thread="${id}"] b`);
  const listed = row && !row.querySelector("input") ? (row.textContent || "").trim() : "";
  return listed || fallback || "未命名";
}
async function saveThreadTitle(id, next, fallback) {
  const title = String(next || "").trim();
  if (!title) return false;
  if (title === fallback) return true;
  try {
    await api(`/api/agents/${state.agentId}/threads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    if (state.threadId === id) $("pageTitle").textContent = title;
    return true;
  } catch (err) {
    $("pageTitle").title = String(err.message || err);
    return false;
  }
}
function beginThreadRename(titleEl, id, current, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (!titleEl) return;
  if (titleEl.querySelector("input")) return;
  state.renamingThread = id;
  const start = current || titleEl.textContent || "";
  const input = document.createElement("input");
  input.className = "thread-rename";
  input.value = start;
  input.maxLength = 80;
  titleEl.replaceChildren(input);
  input.focus();
  input.select();
  let closed = false;
  const finish = async (ok) => {
    if (closed) return;
    closed = true;
    const next = ok ? input.value.trim() : start;
    const saved = ok ? await saveThreadTitle(id, next, start) : true;
    state.renamingThread = "";
    titleEl.textContent = saved ? (next || start || "未命名") : (start || "未命名");
    if (saved && next && next !== start) await loadThreads();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("pointerdown", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => {
    if (state.rebuildingThreads) return;
    finish(true);
  });
}
async function deleteThread(id, ev) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  if (!id || state.deletingThread === id) return;
  state.deletingThread = id;
  try {
    await api(`/api/agents/${state.agentId}/threads/${id}`, { method: "DELETE" });
    delete state.goals[id];
    delete state.composers[id];
    delete state.liveTurns[id];
    delete state.usageByThread[id];
    delete state.outTokensByThread[id];
    delete state.startedAtByThread[id];
    delete state.todosByThread[id];
    persistGoals();
    if (state.threadId === id) {
      state.threadId = "";
      localStorage.removeItem("auscode.thread");
      $("messages").innerHTML = "";
      $("pageTitle").textContent = "当前会话";
      $("prompt").value = "";
      renderGoalBar();
      updateStreamUI();
    }
    await loadThreads();
    if (!state.threadId) {
      const next = document.querySelector("#threadList .thread");
      if (next && next.dataset.thread) await openThread(next.dataset.thread);
    }
  } catch (err) {
    $("pageTitle").title = String(err.message || err);
  } finally {
    state.deletingThread = "";
  }
}

async function loadOlderMessages(id, cursor, btn, seq) {
  if (!cursor || state.openGen !== seq || state.threadId !== id) return;
  btn.disabled = true;
  btn.textContent = "加载中…";
  try {
    const hist = await api(`/api/agents/${state.agentId}/threads/${id}/history?limit=40&cursor=${encodeURIComponent(cursor)}`);
    if (state.openGen !== seq || state.threadId !== id) return;
    const batch = hist.messages || hist.items || [];
    const box = $("messages");
    const keep = box.scrollHeight;
    const before = btn.nextSibling;
    batch.forEach((m) => {
      const role = m.role || m.type;
      const content = extractText(m.content);
      const atts = m.inbound_attachments || [];
      if (!content && !atts.length) return;
      if (role === "user" || role === "human") {
        const split = splitLinkedContext(content);
        split.blocks.forEach((b) => addContextBlock(b.title, b.body, { threadId: id, before }));
        if (split.text || atts.length) addBubble("user", split.text, { id: m.id, threadId: id, before, attachments: atts });
      } else if (role === "assistant" || role === "ai") addBubble("assistant", content, { id: m.id, threadId: id, before });
    });
    box.scrollTop = box.scrollHeight - keep;
    const next = hist.has_more ? hist.next_cursor : "";
    if (next) {
      btn.disabled = false;
      btn.textContent = "加载更早的消息";
      btn.onclick = () => loadOlderMessages(id, next, btn, seq);
    } else btn.remove();
  } catch {
    btn.disabled = false;
    btn.textContent = "加载更早的消息";
  }
}
async function loadThreads() {
  const rows = await api(`/api/agents/${state.agentId}/threads`);
  const box = $("threadList");
  const keepId = state.renamingThread;
  const keepInput = keepId ? document.querySelector(`.thread[data-thread="${keepId}"] .thread-rename`) : null;
  const keepValue = keepInput ? keepInput.value : "";
  state.rebuildingThreads = true;
  box.innerHTML = "";
  (rows || []).forEach((t) => {
    const el = document.createElement("div");
    el.className = "thread" + (t.thread_id === state.threadId ? " active" : "");
    el.dataset.thread = t.thread_id;
    const title = document.createElement("b");
    title.textContent = t.title || "未命名";
    const small = document.createElement("small");
    small.textContent = t.channel_type || "";
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "rename";
    rename.title = "重命名";
    rename.textContent = "✎";
    rename.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginThreadRename(title, t.thread_id, t.title || "", e);
    }, true);
    rename.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginThreadRename(title, t.thread_id, t.title || "", e);
    }, true);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.title = "删除";
    del.textContent = "×";
    del.addEventListener("pointerdown", (e) => deleteThread(t.thread_id, e), true);
    del.addEventListener("click", (e) => deleteThread(t.thread_id, e), true);
    el.append(title, small, rename, del);
    el.addEventListener("click", (e) => {
      if (e.target.closest(".del") || e.target.closest(".rename") || e.target.closest(".thread-rename")) return;
      openThread(t.thread_id);
    });
    box.appendChild(el);
    if (keepId && t.thread_id === keepId) beginThreadRename(title, t.thread_id, keepValue || t.title || "", null);
  });
  state.rebuildingThreads = false;
}

async function openThread(id) {
  if (state.openingThread === id && state.threadId === id) return;
  if (state.threadId && state.threadId !== id) {
    const cur = composer(state.threadId);
    if (cur) cur.text = $("prompt").value;
    persistGoals();
  }
  const seq = ++state.openGen;
  state.openingThread = id;
  state.threadId = id;
  localStorage.setItem("auscode.thread", id);
  renderGoalBar();
  renderPlanMenu();
  $("messages").innerHTML = "";
  state.assistantEl = null;
  state.assistantThread = "";
  const next = composer();
  $("prompt").value = next ? next.text : "";
  $("undoPolishBtn").classList.toggle("hidden", !(next && next.polishResult));
  renderComposerChips();
  updateStreamUI();
  const msgs = [];
  let hist = await api(`/api/agents/${state.agentId}/threads/${id}/history?limit=40`);
  if (state.openGen !== seq) return;
  for (let i = 0; i < 8 && hist && hist.history_loading; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, hist.history_retry_after_ms || 400));
    if (state.openGen !== seq) return;
    hist = await api(`/api/agents/${state.agentId}/threads/${id}/history?limit=40`);
    if (state.openGen !== seq) return;
  }
  const batch = hist.messages || hist.items || [];
  msgs.push(...batch);
  if (hist.turn_active) {
    const lt = liveTurn(id);
    lt.active = true;
  }
  if (state.openGen !== seq) return;
  const olderCursor = hist.has_more ? hist.next_cursor : "";
  msgs.forEach((m) => {
    const role = m.role || m.type;
    const content = extractText(m.content);
    const atts = m.inbound_attachments || [];
    const blocks = Array.isArray(m.content) ? m.content : [];
    const thinking = blocks.filter((b) => b && b.type === "thinking").map((b) => b.thinking || b.text || "").join("");
    if (thinking) {
      const el = startThinkStatus();
      el.querySelector(".think-body").textContent = thinking;
      finishThinkStatus();
    }
    ingestTodosFromBlocks(blocks, id);
    blocks.forEach((b) => {
      if (!b || typeof b !== "object") return;
      if (b.type === "tool_use") handleToolFrame({ type: "tool_use", name: b.name, id: b.id, args: b.input, thread_id: id });
      if (b.type === "tool_result") handleToolFrame({ type: "tool_result", id: b.id, name: b.name, output: b.output || b.content, thread_id: id });
    });
    if (role === "tool") {
      handleToolFrame({ type: "tool_result", name: m.name, id: m.tool_call_id || m.id, output: m.content });
      return;
    }
    if (!content && !atts.length) return;
    if (role === "user" || role === "human") {
      const split = splitLinkedContext(content);
      split.blocks.forEach((b) => addContextBlock(b.title, b.body, { threadId: id }));
      if (split.text || atts.length) addBubble("user", split.text, { id: m.id, threadId: id, attachments: atts });
    } else if (role === "assistant" || role === "ai") addBubble("assistant", content, { id: m.id, threadId: id });
  });
  const live = state.liveTurns[id];
  if (live && (live.text || live.thinking || (live.tools && live.tools.length))) {
    if (live.thinking) {
      const el = startThinkStatus();
      el.querySelector(".think-body").textContent = live.thinking;
      if (!live.active) finishThinkStatus();
    }
    (live.tools || []).forEach((f) => handleToolFrame(f));
    if (live.text) {
      const el = addBubble("assistant", live.text, { threadId: id });
      if (el && !live.active) setBubbleContent(el, live.text, { markdown: true });
    }
  } else if (live && (live.user || (live.context && live.context.length))) {
    const lastUser = [...msgs].reverse().find((m) => {
      const role = m.role || m.type;
      return role === "user" || role === "human";
    });
    if (!lastUser || extractText(lastUser.content) !== live.user) {
      (live.context || []).forEach((b) => addContextBlock(b.title, b.body, { threadId: id }));
      if (live.user) addBubble("user", live.user, { threadId: id });
    }
  }
  if (state.openGen !== seq) return;
  if (olderCursor) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "ghost";
    more.textContent = "加载更早的消息";
    more.style.alignSelf = "center";
    more.onclick = () => loadOlderMessages(id, olderCursor, more, seq);
    $("messages").prepend(more);
  }
  updateStreamUI();
  const first = extractText(msgs[0] && msgs[0].content);
  $("pageTitle").textContent = threadTitleText(id, (first || "当前会话").slice(0, 24));
  await loadThreads();
  if (state.openGen !== seq) return;
  await refreshContext();
  if (state.openGen !== seq) return;
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: "subscribe", thread_id: id }));
  }
  if (state.openingThread === id) state.openingThread = "";
}

const CTX_META = {
  conversation: { label: "消息", color: "#6aa8d6" },
  mcp: { label: "MCP 工具", color: "#7aa7e0" },
  tool_definitions: { label: "系统工具", color: "#8bb8e8" },
  system_prompt: { label: "系统提示词", color: "#9ec4d4" },
  skills: { label: "技能", color: "#b7aec8" },
  subagent_definitions: { label: "子智能体", color: "#c4b7d6" },
  rules: { label: "规则", color: "#d9b8c8" },
};
function fillMeterMenu(el, title, totalLabel, segs, used, max, opts) {
  if (!el) return;
  const cap = Math.max(max || 1, 1);
  const known = segs.reduce((n, s) => n + s.tokens, 0);
  const pct = Math.round(used * 1000 / cap) / 10;
  el.replaceChildren();
  const head = document.createElement("div");
  head.className = opts && opts.stacked ? "ctx-head stacked" : "ctx-head";
  const left = document.createElement("span");
  left.textContent = title;
  const lines = Array.isArray(totalLabel) ? totalLabel : null;
  if (lines) {
    const block = document.createElement("div");
    block.className = "ctx-head-lines";
    lines.forEach((text) => {
      const row = document.createElement("b");
      row.textContent = text;
      block.appendChild(row);
    });
    head.append(left, block);
  } else {
    const right = document.createElement("b");
    right.textContent = totalLabel || `${tok(used)} / ${tok(cap)}（${pct}%）`;
    head.append(left, right);
  }
  el.appendChild(head);
  const meter = document.createElement("div");
  meter.className = "ctx-meter";
  (segs.length ? segs : [{ tokens: 0, color: "#e8eef3" }]).forEach((s) => {
    const i = document.createElement("i");
    i.style.width = `${Math.max(s.tokens ? 2 : 0, s.tokens * 100 / cap)}%`;
    i.style.background = s.color || "#c5d0d6";
    meter.appendChild(i);
  });
  el.appendChild(meter);
  if (!segs.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "暂无分段";
    el.appendChild(empty);
    return;
  }
  segs.forEach((s) => {
    const row = document.createElement("div");
    row.className = "ctx-row";
    const dot = document.createElement("i");
    dot.className = "dot";
    dot.style.background = s.color || "#c5d0d6";
    const name = document.createElement("span");
    name.textContent = s.label || s.key || "";
    const val = document.createElement("b");
    val.textContent = s.detail || `${((s.tokens * 100) / Math.max(used || known || 1, 1)).toFixed(1)}% · ${tok(s.tokens)}`;
    row.append(dot, name, val);
    el.appendChild(row);
  });
}

function renderSpeedMenu() {
  const menu = $("speedMenu");
  if (!menu) return;
  const u = usageFor(state.threadId);
  const input = Number(u.input || 0);
  const streamedOut = Number(state.outTokensByThread[state.threadId] || 0);
  const output = Number(u.output || 0) || streamedOut;
  const cacheRead = Number(u.cacheRead || 0);
  const cacheWrite = Number(u.cacheWrite || 0);
  const uncached = Number(u.uncached || Math.max(0, input - cacheRead));
  const hit = u.hit;
  const live = isThreadStreaming(state.threadId) && !u.output;
  const segs = [
    { label: "未缓存输入", tokens: uncached, color: "#9ec4d4" },
    { label: "缓存命中", tokens: cacheRead, color: "#b7c7e0", extra: hit == null ? "" : ` · ${hit}%` },
    { label: live ? "输出（流式中）" : "输出", tokens: output, color: "#e3b6b6" },
  ].filter((s) => s.tokens > 0);
  const total = segs.reduce((n, s) => n + s.tokens, 0) || 1;
  fillMeterMenu(
    menu,
    live ? "本轮用量（生成中）" : "本轮用量",
    [speedText(u.speed || 0), tokPair(input || 0, output)],
    segs.map((s) => ({ ...s, detail: `${tok(s.tokens)}${s.extra || ""}` })),
    total,
    total,
    { stacked: true },
  );
  if (!segs.length) {
    menu.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = live
      ? `正在生成，当前 ${speedText(u.speed || 0)}。入/出和缓存要等这一轮账单到了才准。`
      : "这一轮还没有用量。发一条之后再看。";
    menu.appendChild(empty);
    return;
  }
  if (cacheWrite) {
    const row = document.createElement("div");
    row.className = "ctx-row";
    const dot = document.createElement("i");
    dot.className = "dot";
    dot.style.background = "#c4b7d6";
    const name = document.createElement("span");
    name.textContent = "缓存写入";
    const val = document.createElement("b");
    val.textContent = tok(cacheWrite);
    row.append(dot, name, val);
    menu.appendChild(row);
  }
}

function bindFloatMenu(anchor, menu, place) {
  if (!anchor || !menu) return;
  const show = () => {
    menu.classList.remove("hidden");
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth || 320;
    const h = menu.offsetHeight || 120;
    let left = place === "right" ? r.right + 10 : r.left;
    let top = place === "right" ? r.top : r.bottom + 8;
    if (place === "above") top = r.top - h - 8;
    left = Math.min(Math.max(12, left), window.innerWidth - w - 12);
    top = Math.min(Math.max(12, top), window.innerHeight - h - 12);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };
  const hide = () => menu.classList.add("hidden");
  anchor.addEventListener("mouseenter", show);
  anchor.addEventListener("mouseleave", () => setTimeout(() => {
    if (!menu.matches(":hover") && !anchor.matches(":hover")) hide();
  }, 120));
  menu.addEventListener("mouseenter", show);
  menu.addEventListener("mouseleave", hide);
}

async function refreshContext() {
  const menu = $("ctxMenu");
  if (!state.threadId) {
    if ($("ctxPct")) $("ctxPct").textContent = "—";
    if (menu) {
      menu.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "先打开一条对话";
      menu.appendChild(empty);
    }
    return;
  }
  try {
    const select = $("modelSelect");
    const current = state.models.find((m) => modelRefOf(m) === (select && select.value)) || {};
    const hinted = Number(current.context_window || current.max_input_tokens || 0) || 0;
    const ctx = await api(`/api/agents/${state.agentId}/threads/${state.threadId}/context-usage?max_tokens=${hinted || 128000}`);
    const used = Number(ctx.used_tokens || 0);
    const max = hinted || Number(ctx.max_tokens || 128000);
    const pct = Math.round(used * 1000 / Math.max(max, 1)) / 10;
    if ($("ctxPct")) $("ctxPct").textContent = `${pct}% · ${tok(used)} / ${tok(max)}`;
    const segs = (ctx.segments || []).map((s) => ({
      key: s.key,
      tokens: Number(s.tokens || 0),
      ...(CTX_META[s.key] || { label: s.key, color: "#c9b6a4" }),
    })).filter((s) => s.tokens > 0);
    const known = segs.reduce((n, s) => n + s.tokens, 0);
    if (used > known) segs.push({ key: "other", tokens: used - known, label: "其他", color: "#c5d0d6" });
    fillMeterMenu(menu, "上下文容量", `${tok(used)} / ${tok(max)}（${pct}%）`, segs, used, max);
  } catch (err) {
    if ($("ctxPct")) $("ctxPct").textContent = "读取失败";
    if (menu) {
      menu.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = String(err.message || err);
      menu.appendChild(empty);
    }
  }
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

function renderUsageMini(u5, today, models5h) {
  const total = Number(u5.total_tokens || 0);
  const hit = Number(u5.cache_hit_percent || 0);
  const input = Number(u5.uncached_input_tokens ?? u5.input_tokens ?? 0);
  const cache = Number(u5.cache_read_tokens || 0);
  const output = Number(u5.output_tokens || 0);
  if ($("usage5h")) $("usage5h").textContent = tok(total);
  if ($("usageIo")) $("usageIo").textContent = tokPair(u5.input_tokens, output);
  if ($("usageHit")) $("usageHit").textContent = `缓存命中 ${hit}%`;
  if ($("usageToday")) $("usageToday").textContent = `今日 ${tokPair(today.input_tokens, today.output_tokens)}`;
  const modelRows = (models5h.buckets || []).map((b, i) => ({
    name: b.label || b.key || "未知",
    tokens: Number(b.total_tokens || 0),
    input: Number(b.uncached_input_tokens ?? b.input_tokens ?? 0),
    cache: Number(b.cache_read_tokens || 0),
    output: Number(b.output_tokens || 0),
    color: MODEL_COLORS[i % MODEL_COLORS.length],
  })).filter((r) => r.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const modelTotal = modelRows.reduce((s, r) => s + r.tokens, 0) || Math.max(total, 1);
  const segs = modelRows.map((r) => ({
    ...r,
    label: r.name,
    detail: `${((r.tokens * 100) / modelTotal).toFixed(1)}% · ${tok(r.tokens)}`,
  }));
  const menu = $("usageMenu");
  fillMeterMenu(menu, "近 5 小时用量", `${tok(total)} · 命中 ${hit}%`, segs, total, modelTotal);
  if (!menu) return;
  const sub = document.createElement("div");
  sub.className = "usage-sub";
  sub.textContent = "输入 / 缓存命中 / 输出";
  menu.appendChild(sub);
  const ioMeter = document.createElement("div");
  ioMeter.className = "ctx-meter";
  const ioTotal = Math.max(input + cache + output, 1);
  [
    { tokens: input, color: "#9ec4d4" },
    { tokens: cache, color: "#b7c7e0" },
    { tokens: output, color: "#e3b6b6" },
  ].forEach((s) => {
    const i = document.createElement("i");
    i.style.width = `${Math.max(s.tokens ? 2 : 0, s.tokens * 100 / ioTotal)}%`;
    i.style.background = s.color;
    ioMeter.appendChild(i);
  });
  menu.appendChild(ioMeter);
  [
    { label: "未缓存输入", tokens: input, color: "#9ec4d4" },
    { label: "缓存命中", tokens: cache, color: "#b7c7e0", extra: ` · ${hit}%` },
    { label: "输出", tokens: output, color: "#e3b6b6" },
  ].forEach((s) => {
    const row = document.createElement("div");
    row.className = "ctx-row";
    const dot = document.createElement("i");
    dot.className = "dot";
    dot.style.background = s.color;
    const name = document.createElement("span");
    name.textContent = s.label;
    const val = document.createElement("b");
    val.textContent = `${tok(s.tokens)}${s.extra || ""}`;
    row.append(dot, name, val);
    menu.appendChild(row);
  });
}

async function refreshUsage() {
  const [u5, today, models5h] = await Promise.all([
    api("/api/usage/summary?window=last_5h&granularity=total"),
    api("/api/usage/summary?window=today&granularity=total"),
    api("/api/usage/summary?window=last_5h&granularity=by_model"),
  ]);
  renderUsageMini(u5, today, models5h);
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
    <div class="page-head"><h3>使用统计</h3><p class="lead">看各模型花了多少 token，单价按每百万 token 自己填，只存在本机。</p></div>
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
  if (name !== "chat") hideSlash();
  $("crumb").textContent = titles[name] || name;
  if (name === "chat") {
    const title = document.querySelector(".thread.active b");
    $("pageTitle").textContent = title ? title.textContent : "当前会话";
  } else {
    $("pageTitle").textContent = titles[name] || name;
  }
  const loaders = {
    cron: loadCron, usage: refreshUsage, memory: loadMemory,
    models: loadModelPage, skills: loadSkills, plugins: loadPlugins, security: loadSecurity,
    settings: loadWorkspaceSettings,
  };
  if (loaders[name]) loaders[name]();
}

async function loadCron() {
  const rows = await api(`/api/agents/${state.agentId}/cron`);
  $("cronBox").innerHTML = `
    <div class="page-head"><h3>自动化</h3><p class="lead">用 cron 或 @every 表达式定时让助手跑一句提示词。</p></div>
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
    <div class="page-head"><h3>记忆</h3><p class="lead">只显示结论，可手动补充或改掉过时内容。删除会把这条标为废弃。</p></div>
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
  const agent = agents[0] || {};
  const defaultRef = agent.default_model || (active.provider_name && active.model ? `${active.provider_name}/${active.model}` : "");
  const defaultEffort = agent.reasoning_effort || state.defaultEffort || "medium";
  applyEffortSelect(defaultEffort);
  $("modelsBox").innerHTML = `
    <div class="page-head"><h3>模型</h3><p class="lead">新增、修改、删除供应商，并指定默认模型和思考强度。密钥只发给本机 AusCode。</p></div>
    <div class="row" style="align-items:center;gap:10px">
      <label class="muted">默认思考强度</label>
      <select id="defaultEffort">${EFFORT_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === defaultEffort ? "selected" : ""}>${o.label}</option>`).join("")}</select>
    </div>
    <div id="effortMsg" class="muted"></div>
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
        <div class="chips">${(p.models || []).map((m) => {
          const win = m.context_window || m.max_input_tokens;
          const mid = m.id || m.name || "";
          return `<em>${mid}${win ? ` · ${fmt(win)}` : ""} <button type="button" class="ghost" data-ttft="${p.id}" data-mid="${mid}">测速</button></em>`;
        }).join("") || "<em>还没拉模型</em>"}</div>
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
  $("defaultEffort").onchange = async () => {
    const effort = $("defaultEffort").value;
    try {
      await api(`/api/agents/${state.agentId}`, {
        method: "PATCH",
        body: JSON.stringify({ reasoning_effort: effort, reasoning_mode: effortMode(effort) }),
      });
      applyEffortSelect(effort);
      $("effortMsg").textContent = "默认思考强度已保存";
    } catch (err) {
      $("effortMsg").textContent = String(err.message || err);
    }
  };
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
      if (!(state.fetchedModels && state.fetchedModels.length)) {
        state.fetchedModels = (row.models || []).map((m) => ({
          id: m.id || m.name,
          name: m.name || m.id,
          context_window: Number(m.context_window || m.max_input_tokens || 0) || null,
          enabled: m.enabled !== false,
        }));
        renderFetchedModels();
      }
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
      if (btn.dataset.ttft) {
        $("modelMsg").textContent = `正在测 ${btn.dataset.mid} 的首字…`;
        const out = await api("/api/admin/providers/ttft", {
          method: "POST",
          body: JSON.stringify({ provider_id: Number(btn.dataset.ttft), model_id: btn.dataset.mid }),
        });
        $("modelMsg").textContent = out.ok
          ? `${btn.dataset.mid} 首字 ${out.ttft_ms} 毫秒${out.preview ? ` · ${out.preview}` : ""}`
          : (out.error || "测速失败");
        return;
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
    <div class="page-head"><h3>技能</h3><p class="lead">扫描本机 ~/.agents/skills。点导入后，对话里就能用这些 SKILL.md。</p></div>
    <div class="row"><button class="primary" id="skillScan">重新扫描并导入本地技能</button></div>
    <div id="skillMsg" class="muted"></div>
    <h4>已加载</h4>
    ${rows.map((s) => `
      <div class="list-item">
        <b>${s.label?.zh || s.name || s.slug}</b>
        <div class="muted">${s.description || s.summary?.zh || ""}</div>
        <button class="ghost" data-skill="${s.slug || s.name}" data-on="${s.enabled ? "0" : "1"}">${s.enabled ? "停用" : "启用"}</button>
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
    const btn = e.target.closest("[data-skill]");
    if (!btn) return;
    const name = btn.dataset.skill;
    if (!name) return;
    const on = btn.dataset.on === "1";
    btn.disabled = true;
    try {
      await api(`/api/agents/${state.agentId}/skills/${encodeURIComponent(name)}/${on ? "enable" : "disable"}`, { method: "POST" });
      state.slashCatalog = null;
      await loadSkills();
    } catch (err) {
      $("skillMsg").textContent = String(err.message || err);
      btn.disabled = false;
    }
  };
}
async function loadPlugins() {
  const rows = await api("/api/plugins").catch(() => []);
  $("pluginsBox").innerHTML = `
    <div class="page-head"><h3>插件</h3><p class="lead">天气、二维码、热点这些小工具。对话里打 / 就能像技能一样召唤。关掉后菜单里不会再出现。</p></div>
    <div id="pluginMsg" class="muted"></div>
    ${(rows || []).map((p) => `
      <div class="list-item">
        <b>${p.name || p.id}</b>
        <div class="muted">${p.description || p.kind || p.id}</div>
        <button class="ghost" data-plugin="${p.id}" data-on="${p.enabled ? "0" : "1"}">${p.enabled ? "停用" : "启用"}</button>
      </div>`).join("") || "<p>还没有插件</p>"}
  `;
  $("pluginsBox").onclick = async (e) => {
    const btn = e.target.closest("[data-plugin]");
    if (!btn) return;
    const id = btn.dataset.plugin;
    const on = btn.dataset.on === "1";
    btn.disabled = true;
    try {
      await api(`/api/plugins/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: on }),
      });
      $("pluginMsg").textContent = on ? `已启用 ${id}，新对话生效` : `已停用 ${id}`;
      state.slashCatalog = null;
      await loadPlugins();
    } catch (err) {
      $("pluginMsg").textContent = String(err.message || err);
      btn.disabled = false;
    }
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
    <div class="page-head"><h3>权限与沙箱</h3><p class="lead">这些开关会立刻生效，和输入栏的权限档位是同一套设置。</p></div>
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
  const fetched = data.models || [];
  const prev = {};
  (state.fetchedModels || []).forEach((m) => { prev[m.id] = m; });
  if (state.editingProviderId && !Object.keys(prev).length) {
    const providers = await api("/api/providers");
    const row = (providers || []).find((p) => String(p.id) === String(state.editingProviderId));
    (row && row.models || []).forEach((m) => {
      const id = m.id || m.name;
      prev[id] = {
        id,
        name: m.name || m.id,
        context_window: Number(m.context_window || m.max_input_tokens || 0) || null,
        enabled: m.enabled !== false,
      };
    });
  }
  state.fetchedModels = fetched.map((m) => {
    const old = prev[m.id] || {};
    const sniffed = Number(m.context_window || m.max_input_tokens || 0) || null;
    return {
      id: m.id,
      name: m.name || m.id,
      context_window: old.context_window || sniffed,
      enabled: old.id ? old.enabled !== false : true,
    };
  });
  renderFetchedModels();
  $("providerMsg").textContent = `拉到 ${fetched.length} 个模型，可勾选后再保存`;
}

function renderFetchedModels() {
  const rows = state.fetchedModels || [];
  const box = $("fetchedModels");
  box.replaceChildren();
  if (!rows.length) {
    box.textContent = "没有返回模型";
    return;
  }
  rows.forEach((m) => {
    const row = document.createElement("div");
    row.className = "list-item model-edit";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = m.enabled !== false;
    check.dataset.mid = m.id;
    const name = document.createElement("span");
    name.textContent = m.name || m.id;
    const win = document.createElement("input");
    win.type = "number";
    win.min = "0";
    win.step = "1000";
    win.placeholder = "上下文窗口";
    win.value = m.context_window || "";
    win.dataset.win = m.id;
    const hint = document.createElement("small");
    hint.className = "muted";
    hint.textContent = m.context_window ? "可改" : "接口没给，请手填";
    row.append(check, name, win, hint);
    box.appendChild(row);
  });
  box.onchange = (e) => {
    const el = e.target;
    const row = (state.fetchedModels || []).find((m) => m.id === (el.dataset.mid || el.dataset.win));
    if (!row) return;
    if (el.dataset.mid) row.enabled = el.checked;
    if (el.dataset.win) row.context_window = Number(el.value || 0) || null;
  };
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
  const fetched = state.fetchedModels || [];
  const boxes = [...document.querySelectorAll("#fetchedModels input:checked")];
  const chosen = boxes.map((b) => b.dataset.mid);
  const models = (chosen.length ? fetched.filter((m) => chosen.includes(m.id)) : fetched.filter((m) => m.enabled !== false)).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    enabled: true,
    context_window: m.context_window || undefined,
    max_input_tokens: m.context_window || undefined,
  }));
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

async function openWorkspaceFolder() {
  const btn = $("openWorkspaceBtn");
  try {
    const out = await api("/api/filesystem/open-workspace", { method: "POST" });
    if (btn) btn.title = out.path || "工作区";
  } catch (err) {
    showPage("settings");
    if ($("wsMsg")) $("wsMsg").textContent = String(err.message || err);
  }
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
  if (state.threadId) {
    const cur = composer(state.threadId);
    if (cur) cur.text = $("prompt").value;
    persistGoals();
  }
  const t = await api(`/api/agents/${state.agentId}/threads`, { method: "POST" });
  composer(t.thread_id);
  await openThread(t.thread_id);
  $("pageTitle").textContent = "新对话";
}

async function boot() {
  const sess = await fetch("/api/ui/session").then((r) => r.json());
  if (!sess.ok) throw new Error(sess.error || "无法读取本机 Token");
  state.token = sess.token;
  state.agentId = sess.agent_id || state.agentId;
  state.homeDir = sess.home_dir || "";
  state.projectDir = sess.project_dir || "D:/AusCode";
  setPermLabel();
  restoreGoals();
  await Promise.all([loadModels(), loadThreads(), refreshUsage(), ensureSlashCatalog().catch(() => {})]);
  try {
    const agents = await api("/api/agents");
    if (agents[0] && agents[0].reasoning_effort) applyEffortSelect(agents[0].reasoning_effort);
    else applyEffortSelect(state.defaultEffort);
  } catch { applyEffortSelect(state.defaultEffort); }
  const threads = await api(`/api/agents/${state.agentId}/threads`).catch(() => []);
  const saved = localStorage.getItem("auscode.thread");
  const withMsgs = (threads || []).filter((t) => t.has_messages);
  const pick = withMsgs.find((t) => t.thread_id === saved)
    || (threads || []).find((t) => t.thread_id === saved && t.has_messages)
    || withMsgs[0]
    || (threads || [])[0];
  if (pick && pick.thread_id) {
    try { await openThread(pick.thread_id); }
    catch { localStorage.removeItem("auscode.thread"); }
  }
  connectWs();
  bindFloatMenu($("usageMini"), $("usageMenu"), "right");
  bindFloatMenu($("ctxPop"), $("ctxMenu"), "below");
  bindFloatMenu($("speedPop"), $("speedMenu"), "below");
  bindFloatMenu($("planPop"), $("planMenu"), "below");
  renderSpeedMenu();
  renderPlanMenu();
  renderGoalBar();
}
window.addEventListener("pagehide", persistGoals);
window.addEventListener("beforeunload", persistGoals);

function applyRailCollapsed(on) {
  document.querySelector(".app")?.classList.toggle("rail-collapsed", !!on);
  const btn = $("railToggle");
  if (btn) btn.title = on ? "展开侧栏" : "收起侧栏";
  localStorage.setItem("auscode.rail", on ? "1" : "0");
}
applyRailCollapsed(localStorage.getItem("auscode.rail") === "1");
$("railToggle") && ($("railToggle").onclick = () => {
  applyRailCollapsed(!document.querySelector(".app")?.classList.contains("rail-collapsed"));
});
$("nav").onclick = (e) => {
  const btn = e.target.closest("button");
  if (btn) showPage(btn.dataset.page);
};
$("sendBtn").onclick = () => send();
$("stopBtn").onclick = () => stopTurn();
$("plusBtn").onclick = (e) => {
  e.stopPropagation();
  $("plusMenu").classList.toggle("open");
};
$("plusMenu").onclick = (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  hidePlus();
  if (btn.dataset.plus === "file") $("filePick").click();
  if (btn.dataset.plus === "thread") pickLinkedThread().catch(() => {});
  if (btn.dataset.plus === "skill") pickSkillFromPlus().catch(() => {});
};
$("filePick").onchange = (e) => {
  addFiles(e.target.files).catch((err) => { $("pageTitle").title = String(err.message || err); });
  e.target.value = "";
};
const wrap = document.querySelector(".slash-wrap");
if (wrap) {
  wrap.addEventListener("dragover", (e) => { e.preventDefault(); wrap.classList.add("drop"); });
  wrap.addEventListener("dragleave", () => wrap.classList.remove("drop"));
  wrap.addEventListener("drop", (e) => {
    e.preventDefault();
    wrap.classList.remove("drop");
    addFiles(e.dataTransfer && e.dataTransfer.files).catch((err) => { $("pageTitle").title = String(err.message || err); });
  });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".plus-wrap")) hidePlus();
});
$("goalBtn").onclick = () => {
  const draft = $("prompt").value.trim();
  if (!draft) { $("prompt").placeholder = "先写下目标，再点 🎯"; $("prompt").focus(); return; }
  startGoal(draft);
  $("prompt").value = "";
};
$("goalEdit").onclick = editGoal;
$("goalPause").onclick = pauseGoal;
$("goalResume").onclick = resumeGoal;
$("goalClear").onclick = clearGoal;
$("polishBtn").onclick = () => polishPrompt();
$("undoPolishBtn").onclick = undoPolish;
$("prompt").addEventListener("paste", (e) => {
  const files = filesFromClipboard(e);
  if (!files.length) return;
  e.preventDefault();
  addFiles(files).catch((err) => { $("pageTitle").title = String(err.message || err); });
});
$("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Backspace" || e.key === "Delete") {
    queueMicrotask(() => {
      if (!slashQuery()) hideSlash();
    });
  }
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
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$("prompt").addEventListener("input", () => {
  const comp = composer();
  if (comp) {
    comp.text = $("prompt").value;
    if (comp.polishResult && $("prompt").value !== comp.polishResult) {
      $("undoPolishBtn").classList.add("hidden");
    }
  }
  updateSlash().catch(() => {});
});
$("slashMenu").onclick = (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  applySlash(state.slashItems[Number(btn.dataset.i)]);
};
function applyThreadWidth(px) {
  const min = 180;
  const max = 360;
  const w = Math.min(max, Math.max(min, Math.round(Number(px) || 250)));
  const page = $("page-chat");
  if (page) page.style.setProperty("--thread-w", `${w}px`);
  localStorage.setItem("auscode.threadW", String(w));
  return w;
}
applyThreadWidth(localStorage.getItem("auscode.threadW") || 250);
(function bindThreadSplit() {
  const handle = $("threadSplit");
  const page = $("page-chat");
  if (!handle || !page) return;
  let startX = 0;
  let startW = 250;
  const onMove = (e) => {
    applyThreadWidth(startW + (e.clientX - startX));
  };
  const onUp = () => {
    handle.classList.remove("dragging");
    document.body.classList.remove("resizing-split");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = parseFloat(getComputedStyle(page).getPropertyValue("--thread-w")) || 250;
    handle.classList.add("dragging");
    document.body.classList.add("resizing-split");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
})();
$("btnNew").onclick = newThread;
$("btnDocs").onclick = () => window.open("/api/docs", "_blank");
$("permBtn").onclick = () => $("permMenu").classList.toggle("open");
$("permMenu").onclick = (e) => {
  const btn = e.target.closest("button");
  if (btn) applyPerm(btn.dataset.mode);
};
$("effortSelect").onchange = async () => {
  const effort = $("effortSelect").value;
  applyEffortSelect(effort);
  try {
    await api(`/api/agents/${state.agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ reasoning_effort: effort, reasoning_mode: effortMode(effort) }),
    });
  } catch {}
};
$("modelSelect").onchange = async () => {
  const ref = $("modelSelect").value;
  const slash = ref.indexOf("/");
  if (slash < 0) return;
  const provider_name = ref.slice(0, slash);
  const model = ref.slice(slash + 1);
  try {
    await api("/api/providers/active-model", { method: "PUT", body: JSON.stringify({ provider_name, model }) });
    await api(`/api/agents/${state.agentId}`, { method: "PATCH", body: JSON.stringify({ default_model: ref }) });
  } catch (err) {
    $("pageTitle").title = String(err.message || err);
  }
  refreshContext().catch(() => {});
};
$("wsHome").onclick = () => applyWorkspace(state.homeDir).catch((err) => { $("wsMsg").textContent = String(err.message || err); });
$("wsProject").onclick = () => applyWorkspace(state.projectDir).catch((err) => { $("wsMsg").textContent = String(err.message || err); });
$("openWorkspaceBtn") && ($("openWorkspaceBtn").onclick = () => openWorkspaceFolder());
$("wsApply").onclick = () => applyWorkspace($("wsCustom").value).catch((err) => { $("wsMsg").textContent = String(err.message || err); });

boot().catch((err) => {
  const box = $("messages");
  if (box) box.innerHTML = `<div class="muted">启动失败：${err.message || err}</div>`;
});
