const state = {
  token: "",
  agentId: "TV3AHW",
  threadId: "",
  models: [],
  ws: null,
  streaming: false,
  startedAt: 0,
  outTokens: 0,
  perm: localStorage.getItem("auscode.perm") || "full",
  selectedModels: [],
};

const PERM = {
  confirm: { label: "变更前确认", hitl: { enabled: true, tools: "default" } },
  auto: { label: "自动编辑", hitl: { enabled: true, tools: ["bash", "execute"] } },
  plan: { label: "计划模式", hitl: { enabled: true, tools: "default" } },
  full: { label: "完全访问", hitl: { enabled: false, tools: "default" } },
};

const $ = (id) => document.getElementById(id);
const titles = {
  chat: "当前会话", experts: "专家", cron: "自动化", usage: "Token 统计",
  workspace: "工作台", knowledge: "知识库", memory: "记忆", models: "模型",
  plugins: "插件", security: "权限", settings: "设置",
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

function addBubble(role, text) {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  el.textContent = text;
  $("messages").appendChild(el);
  $("messages").scrollTop = $("messages").scrollHeight;
  return el;
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
  let thinkEl = null;
  ws.onmessage = (ev) => {
    let frame;
    try { frame = JSON.parse(ev.data); } catch { return; }
    const t = frame.type;
    if (t === "reasoning") {
      if (!thinkEl) thinkEl = addBubble("think", "");
      thinkEl.textContent += frame.content || "";
      return;
    }
    if (t === "token" || t === "text" || t === "delta") {
      const piece = frame.content || frame.text || frame.delta || "";
      if (!piece) return;
      if (!assistantEl) assistantEl = addBubble("assistant", "");
      assistantEl.textContent += piece;
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
      state.streaming = false;
      assistantEl = null;
      thinkEl = null;
      if (frame.thread_id) state.threadId = frame.thread_id;
      refreshContext();
      refreshUsage();
    }
    if (t === "error" || t === "turn_error") addBubble("think", frame.message || JSON.stringify(frame));
    if (t === "state_snapshot") {
      const msgs = (frame.data && frame.data.messages) || [];
      const last = msgs[msgs.length - 1];
      if (last && last.type === "ai" && last.content) {
        if (!assistantEl) assistantEl = addBubble("assistant", "");
        assistantEl.textContent = String(last.content);
      }
    }
    if (t === "hitl_required") addBubble("think", "需要确认后才能继续。请在权限档位中选择，或回复批准。");
  };
}

async function send() {
  const text = $("prompt").value.trim();
  if (!text || state.streaming) return;
  $("prompt").value = "";
  addBubble("user", text);
  state.streaming = true;
  state.startedAt = Date.now();
  state.outTokens = 0;
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
  state.ws.send(JSON.stringify(payload));
}

async function loadThreads() {
  const rows = await api(`/api/agents/${state.agentId}/threads`);
  const box = $("threadList");
  box.innerHTML = "";
  (rows || []).forEach((t) => {
    const el = document.createElement("div");
    el.className = "thread" + (t.thread_id === state.threadId ? " active" : "");
    el.innerHTML = `<b>${t.title || "未命名"}</b><small>${t.channel_type || ""}</small>`;
    el.onclick = () => openThread(t.thread_id);
    box.appendChild(el);
  });
}

async function openThread(id) {
  state.threadId = id;
  const hist = await api(`/api/agents/${state.agentId}/threads/${id}/history`);
  $("messages").innerHTML = "";
  const msgs = hist.messages || hist.items || [];
  msgs.forEach((m) => {
    const role = m.role || m.type;
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
    if (role === "user" || role === "human") addBubble("user", content);
    else if (role === "assistant" || role === "ai") addBubble("assistant", content);
  });
  $("pageTitle").textContent = (msgs[0] && (msgs[0].content || "").slice(0, 24)) || "当前会话";
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
  } catch {}
}

async function refreshUsage() {
  const u = await api("/api/usage/summary");
  $("usageTotal").textContent = fmt(u.total_tokens);
  $("usageHit").textContent = `缓存命中 ${u.cache_hit_percent ?? 0}%`;
  $("usageIo").textContent = `输入 ${fmt(u.input_tokens)} / 输出 ${fmt(u.output_tokens)}`;
  $("usageBox").innerHTML = `
    <h3>用量</h3>
    <div class="kv"><span>总 token</span><b>${fmt(u.total_tokens)}</b></div>
    <div class="kv"><span>输入 / 未缓存</span><b>${fmt(u.input_tokens)} / ${fmt(u.uncached_input_tokens)}</b></div>
    <div class="kv"><span>缓存读取</span><b>${fmt(u.cache_read_tokens)}（${u.cache_hit_percent}%）</b></div>
    <div class="kv"><span>输出 / 思考</span><b>${fmt(u.output_tokens)} / ${fmt(u.reasoning_tokens)}</b></div>
    <div class="kv"><span>调用 / 轮次</span><b>${u.model_calls} / ${u.turns}</b></div>
    ${(u.buckets || []).map((b) => `<div class="list-item">${b.label} · ${fmt(b.total_tokens)}</div>`).join("")}
  `;
}

async function loadModels() {
  const rows = await api("/api/providers/resolved");
  state.models = rows || [];
  $("modelSelect").innerHTML = state.models.map((m) =>
    `<option value="${m.model}">${m.provider_name} / ${m.name}</option>`
  ).join("");
  try {
    const active = await api("/api/providers/active-model");
    if (active.model) $("modelSelect").value = active.model;
  } catch {}
  $("modelsBox").innerHTML = "<h3>已接入模型</h3>" + state.models.map((m) =>
    `<div class="list-item"><b>${m.provider_name}</b> · ${m.model}</div>`
  ).join("");
}

function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
  const page = $("page-" + name);
  page.classList.add("active");
  if (name !== "chat") page.style.display = "block";
  else page.style.display = "grid";
  $("crumb").textContent = titles[name] || name;
  $("pageTitle").textContent = titles[name] || name;
  const loaders = {
    experts: loadExperts, cron: loadCron, usage: refreshUsage, workspace: loadWorkspace,
    knowledge: loadKnowledge, memory: loadMemory, models: loadModels, plugins: loadPlugins, security: loadSecurity,
  };
  if (loaders[name]) loaders[name]();
}

async function loadExperts() {
  const rows = await api("/api/experts");
  $("expertsBox").innerHTML = "<h3>专家</h3>" + (rows || []).map((e) =>
    `<div class="list-item"><b>${e.name || e.id}</b><div style="color:var(--muted)">${e.description || ""}</div></div>`
  ).join("") || "<p>暂无专家</p>";
}
async function loadCron() {
  const rows = await api(`/api/agents/${state.agentId}/cron`);
  $("cronBox").innerHTML = "<h3>定时任务</h3>" + (rows || []).map((c) =>
    `<div class="list-item"><b>${c.name || c.cron_id}</b> · ${c.schedule || c.expr || ""}</div>`
  ).join("") || "<p>还没有定时任务</p>";
}
async function loadWorkspace() {
  const tree = await api(`/api/agents/${state.agentId}/workspace/tree`);
  $("workspaceBox").innerHTML = "<h3>工作区</h3><pre>" + JSON.stringify(tree, null, 2).slice(0, 4000) + "</pre>";
}
async function loadKnowledge() {
  const rows = await api("/api/knowledge-bases");
  $("knowledgeBox").innerHTML = "<h3>知识库</h3>" + (rows || []).map((k) =>
    `<div class="list-item"><b>${k.name || k.id}</b></div>`
  ).join("") || "<p>还没有知识库</p>";
}
async function loadMemory() {
  const stats = await api(`/api/agents/${state.agentId}/memory/stats/counts`);
  $("memoryBox").innerHTML = "<h3>记忆</h3><pre>" + JSON.stringify(stats, null, 2) + "</pre>";
}
async function loadPlugins() {
  const rows = await api("/api/plugins");
  $("pluginsBox").innerHTML = "<h3>插件</h3>" + (rows || []).map((p) =>
    `<div class="list-item"><b>${p.name || p.id}</b> · ${p.enabled ? "启用" : "停用"}</div>`
  ).join("");
}
async function loadSecurity() {
  const pol = await api("/api/admin/security");
  const tools = await api(`/api/agents/${state.agentId}/tool-settings`);
  $("securityBox").innerHTML = `
    <h3>权限与沙箱</h3>
    <div class="kv"><span>HITL</span><b>${pol.hitl.enabled ? "开启确认" : "关闭"}</b></div>
    <div class="kv"><span>文件系统</span><b>${pol.filesystem.enabled ? "限制中" : "未限制"}</b></div>
    <div class="kv"><span>命令护栏</span><b>${pol.tool_guard.mode}</b></div>
    <h4>工具开关</h4>
    ${(tools.tools || []).map((t) => `<div class="kv"><span>${t.label}</span><b>${t.enabled ? "开" : "关"}</b></div>`).join("")}
  `;
}

async function fetchRemoteModels() {
  const body = { kind: $("pKind").value, base_url: $("pUrl").value.trim(), api_key: $("pKey").value };
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
  if (!name || !base_url || !api_key) {
    $("providerMsg").textContent = "名称、地址、Key 都要填";
    return;
  }
  if (!/^https?:\/\//i.test(base_url)) {
    $("providerMsg").textContent = "Base URL 需要 http 或 https";
    return;
  }
  const boxes = [...document.querySelectorAll("#fetchedModels input:checked")];
  const models = (boxes.length ? boxes.map((b) => b.dataset.mid) : state.selectedModels).map((id) => ({ id, name: id, enabled: true }));
  if (!models.length) {
    $("providerMsg").textContent = "先拉取模型，再保存";
    return;
  }
  $("providerMsg").textContent = "保存中…";
  const created = await api("/api/admin/providers", {
    method: "POST",
    body: JSON.stringify({ name, kind: $("pKind").value, base_url, api_key, models }),
  });
  const test = await api(`/api/admin/providers/${created.id}/test`, {
    method: "POST",
    body: JSON.stringify({ model_id: models[0].id }),
  });
  $("providerMsg").textContent = test.ok ? `已保存并测通（${test.latency_ms} ms）` : "已保存，但测通失败";
  $("pKey").value = "";
  await loadModels();
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
  setPermLabel();
  await Promise.all([loadModels(), loadThreads(), refreshUsage()]);
  connectWs();
}

$("nav").onclick = (e) => {
  const btn = e.target.closest("button");
  if (btn) showPage(btn.dataset.page);
};
$("sendBtn").onclick = send;
$("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
$("btnNew").onclick = newThread;
$("btnDocs").onclick = () => window.open("/api/docs", "_blank");
$("permBtn").onclick = () => $("permMenu").classList.toggle("open");
$("permMenu").onclick = (e) => {
  const btn = e.target.closest("button");
  if (btn) applyPerm(btn.dataset.mode);
};
$("modelSelect").onchange = async () => {
  const model = $("modelSelect").value;
  const row = state.models.find((m) => m.model === model);
  if (row) await api("/api/providers/active-model", { method: "PUT", body: JSON.stringify({ provider_name: row.provider_name, model }) });
};
$("btnFetchModels").onclick = () => fetchRemoteModels().catch((err) => { $("providerMsg").textContent = String(err.message || err); });
$("btnSaveProvider").onclick = () => saveProvider().catch((err) => { $("providerMsg").textContent = String(err.message || err); });

boot().catch((err) => addBubble("think", "启动失败：" + err.message));
