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
  chat: "当前会话", cron: "自动化", usage: "Token 统计", memory: "记忆",
  models: "模型", plugins: "插件", security: "权限", settings: "设置",
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

function addBubble(role, text) {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  el.textContent = extractText(text) || (typeof text === "string" ? text : "");
  $("messages").appendChild(el);
  $("messages").scrollTop = $("messages").scrollHeight;
  return el;
}

let thinkTimer = null;
let thinkStartedAt = 0;
function formatThink(sec, done) {
  const prefix = done ? "已思考" : "思考中";
  if (sec < 60) return `${prefix} ${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${prefix} ${m}分${String(s).padStart(2, "0")}秒`;
}
function tickThink() {
  const el = document.querySelector(".bubble.think.live");
  if (!el) return;
  const label = el.querySelector(".think-label");
  if (label) label.textContent = formatThink(Math.max(0, Math.floor((Date.now() - thinkStartedAt) / 1000)), false);
}
function startThinkStatus() {
  let el = document.querySelector(".bubble.think.live");
  if (!el) {
    el = document.createElement("div");
    el.className = "bubble think live";
    el.innerHTML = `<span class="think-dot"></span><span class="think-label">${formatThink(0, false)}</span>`;
    $("messages").appendChild(el);
    thinkStartedAt = Date.now();
  }
  if (!thinkTimer) thinkTimer = setInterval(tickThink, 250);
  tickThink();
  $("messages").scrollTop = $("messages").scrollHeight;
  return el;
}
function finishThinkStatus() {
  const el = document.querySelector(".bubble.think.live");
  if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
  if (!el) return;
  const sec = Math.max(0, Math.floor((Date.now() - thinkStartedAt) / 1000));
  el.classList.remove("live");
  el.innerHTML = formatThink(sec, true);
}

function toolNameFrom(frame) {
  return frame.name || frame.tool || frame.tool_name || (frame.data && (frame.data.name || frame.data.tool)) || "工具";
}
function upsertToolCard(id, name, status, detail) {
  const key = String(id || name);
  let el = [...document.querySelectorAll(".tool-card")].find((n) => n.dataset.tool === key);
  if (!el) {
    el = document.createElement("div");
    el.className = "tool-card";
    el.dataset.tool = key;
    $("messages").appendChild(el);
  }
  el.innerHTML = `<b>${name}</b><span class="tool-status">${status}</span>${detail ? `<pre>${detail}</pre>` : ""}`;
  $("messages").scrollTop = $("messages").scrollHeight;
}
function handleToolFrame(frame) {
  const t = frame.type || "";
  const name = toolNameFrom(frame);
  const id = frame.id || frame.tool_call_id || (frame.data && frame.data.id) || name;
  if (t === "tool_start" || t === "tool_call" || t === "tool_use") {
    const args = frame.args || frame.input || (frame.data && (frame.data.args || frame.data.input));
    const detail = args ? JSON.stringify(args, null, 0).slice(0, 240) : "";
    upsertToolCard(id, name, "调用中", detail);
    return true;
  }
  if (t === "tool_result" || t === "tool_end" || t === "tool") {
    const out = frame.output || frame.result || frame.content || (frame.data && (frame.data.output || frame.data.content));
    const text = typeof out === "string" ? out : extractText(out);
    upsertToolCard(id, name, "完成", (text || "").slice(0, 400));
    return true;
  }
  if (t === "hitl_required") {
    upsertToolCard(id, name, "等待确认", "需要你批准后才能继续");
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
      startThinkStatus();
      return;
    }
    if (t === "token" || t === "text" || t === "delta") {
      const piece = frame.content || frame.text || frame.delta || "";
      if (!piece) return;
            finishThinkStatus();
            if (!assistantEl) assistantEl = addBubble("assistant", "");
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
      state.streaming = false;
      assistantEl = null;
      if (frame.thread_id) state.threadId = frame.thread_id;
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

async function send() {
  const text = $("prompt").value.trim();
  if (!text || state.streaming) return;
  $("prompt").value = "";
  addBubble("user", text);
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
  state.ws.send(JSON.stringify(payload));
}

async function loadThreads() {
  const rows = await api(`/api/agents/${state.agentId}/threads`);
  const box = $("threadList");
  box.innerHTML = "";
  (rows || []).forEach((t) => {
    const el = document.createElement("div");
    el.className = "thread" + (t.thread_id === state.threadId ? " active" : "");
    el.innerHTML = `<b>${t.title || "未命名"}</b><small>${t.channel_type || ""}</small><button class="del" title="删除" data-del="${t.thread_id}">×</button>`;
    el.onclick = (e) => {
      if (e.target.dataset.del) return;
      openThread(t.thread_id);
    };
    box.appendChild(el);
  });
  box.onclick = async (e) => {
    const id = e.target.dataset.del;
    if (!id) return;
    e.stopPropagation();
    await api(`/api/agents/${state.agentId}/threads/${id}`, { method: "DELETE" });
    if (state.threadId === id) {
      state.threadId = "";
      $("messages").innerHTML = "";
      $("pageTitle").textContent = "当前会话";
    }
    loadThreads();
  };
}

async function openThread(id) {
  state.threadId = id;
  const hist = await api(`/api/agents/${state.agentId}/threads/${id}/history`);
  $("messages").innerHTML = "";
  const msgs = hist.messages || hist.items || [];
  msgs.forEach((m) => {
    const role = m.role || m.type;
    const content = extractText(m.content);
    if (!content) return;
    const blocks = Array.isArray(m.content) ? m.content : [];
    blocks.forEach((b) => {
      if (!b || typeof b !== "object") return;
      if (b.type === "tool_use") handleToolFrame({ type: "tool_use", name: b.name, id: b.id, args: b.input });
      if (b.type === "tool_result") handleToolFrame({ type: "tool_result", id: b.id, name: b.name, output: b.output || b.content });
    });
    if (role === "tool") {
      handleToolFrame({ type: "tool_result", name: m.name, id: m.tool_call_id || m.id, output: m.content });
      return;
    }
    if (role === "user" || role === "human") addBubble("user", content);
    else if (role === "assistant" || role === "ai") addBubble("assistant", content);
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

async function refreshUsage() {
  const u = await api("/api/usage/summary");
  $("usageTotal").textContent = fmt(u.total_tokens);
  $("usageHit").textContent = `缓存命中 ${u.cache_hit_percent ?? 0}%`;
  $("usageIo").textContent = `输入 ${fmt(u.input_tokens)} / 输出 ${fmt(u.output_tokens)}`;
  $("usageBox").innerHTML = `
    <h3>Token 统计</h3>
    <p style="color:var(--muted);margin:0 0 8px">来自 AusCode 用量接口，按日汇总。</p>
    <div class="kv"><span>总 token</span><b>${fmt(u.total_tokens)}</b></div>
    <div class="kv"><span>输入 / 未缓存</span><b>${fmt(u.input_tokens)} / ${fmt(u.uncached_input_tokens)}</b></div>
    <div class="kv"><span>缓存读取</span><b>${fmt(u.cache_read_tokens)}（命中 ${u.cache_hit_percent}%）</b></div>
    <div class="kv"><span>输出 / 思考</span><b>${fmt(u.output_tokens)} / ${fmt(u.reasoning_tokens)}</b></div>
    <div class="kv"><span>调用 / 轮次</span><b>${u.model_calls} / ${u.turns}</b></div>
    <div class="kv"><span>平均每轮</span><b>${fmt(u.avg_per_turn)}</b></div>
    <h4>按日</h4>
    ${(u.buckets || []).map((b) => `
      <div class="list-item">
        <b>${b.label}</b>
        <div style="color:var(--muted)">入 ${fmt(b.input_tokens)} · 缓存 ${fmt(b.cache_read_tokens)} · 出 ${fmt(b.output_tokens)} · 合计 ${fmt(b.total_tokens)}</div>
      </div>`).join("") || "<p>还没有用量</p>"}
    <p><button class="ghost" id="usageExport">导出 Excel</button></p>
  `;
  const exp = $("usageExport");
  if (exp) exp.onclick = async () => {
    const res = await fetch("/api/usage/export.xlsx", { headers: { Authorization: `Bearer ${state.token}` } });
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
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
  const page = $("page-" + name);
  page.classList.add("active");
  if (name !== "chat") page.style.display = "block";
  else page.style.display = "grid";
  $("crumb").textContent = titles[name] || name;
  $("pageTitle").textContent = titles[name] || name;
  const loaders = {
    cron: loadCron, usage: refreshUsage, memory: loadMemory,
    models: loadModelPage, plugins: loadPlugins, security: loadSecurity,
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

async function loadMemory() {
  const [counts, about, focus, told] = await Promise.all([
    api(`/api/agents/${state.agentId}/memory/stats/counts`),
    api(`/api/agents/${state.agentId}/memory/terminal/about_me`).catch(() => ({ items: [] })),
    api(`/api/agents/${state.agentId}/memory/terminal/current_focus`).catch(() => ({ items: [] })),
    api(`/api/agents/${state.agentId}/memory/terminal/things_you_told_me`).catch(() => ({ items: [] })),
  ]);
  const lines = (block) => (block.items || block.entries || []).map((it) =>
    `<div class="list-item">${typeof it === "string" ? it : (it.text || it.content || JSON.stringify(it))}</div>`
  ).join("") || "<p style='color:var(--muted)'>暂无</p>";
  $("memoryBox").innerHTML = `
    <h3>记忆</h3>
    <p style="color:var(--muted);margin:0">项目级长期记忆。对话里重要结论会沉淀到这里，也可在工作区 MEMORY.md 里改。</p>
    <div class="kv"><span>原子记忆</span><b>${counts.atoms || 0}</b></div>
    <div class="kv"><span>实体</span><b>${counts.entities || 0}</b></div>
    <div class="kv"><span>事件</span><b>${counts.raw_events || 0}</b></div>
    <h4>关于我</h4>${lines(about)}
    <h4>当前焦点</h4>${lines(focus)}
    <h4>你告诉过我的</h4>${lines(told)}
  `;
}

async function loadModelPage() {
  await loadModels();
  const providers = await api("/api/providers");
  $("modelsBox").innerHTML = `
    <h3>模型</h3>
    <p style="color:var(--muted);margin:0">这里管理已接入的供应商。新增 Key 请到「设置」。</p>
    ${(providers || []).map((p) => `
      <div class="list-item">
        <b>${p.name}</b> · ${p.kind} · ${p.enabled ? "启用" : "停用"}
        <div style="color:var(--muted)">${p.base_url || ""}</div>
        <div>${(p.models || []).map((m) => m.id || m.name).join("、") || "还没拉模型"}</div>
        <button class="ghost" data-toggle="${p.id}">${p.enabled ? "停用" : "启用"}</button>
        <button class="ghost" data-test="${p.id}" data-mid="${(p.models && p.models[0] && p.models[0].id) || ""}">测通</button>
      </div>`).join("")}
    <div id="modelMsg" style="color:var(--muted)"></div>
  `;
  $("modelsBox").onclick = async (e) => {
    const toggle = e.target.dataset.toggle;
    const test = e.target.dataset.test;
    try {
      if (toggle) {
        const row = (providers || []).find((p) => String(p.id) === String(toggle));
        await api(`/api/admin/providers/${toggle}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !row.enabled }),
        });
        loadModelPage();
      }
      if (test) {
        const mid = e.target.dataset.mid;
        const r = await api(`/api/admin/providers/${test}/test`, {
          method: "POST",
          body: JSON.stringify({ model_id: mid }),
        });
        $("modelMsg").textContent = r.ok ? `测通 ${r.latency_ms} ms` : "测通失败";
      }
    } catch (err) { $("modelMsg").textContent = String(err.message || err); }
  };
}

async function loadPlugins() {
  const rows = await api("/api/plugins");
  $("pluginsBox").innerHTML = "<h3>插件</h3>" + (rows || []).map((p) =>
    `<div class="list-item">
      <b>${p.name || p.id}</b>
      <div style="color:var(--muted)">${p.description || ""}</div>
      <button class="ghost" data-plugin="${p.id}" data-on="${p.enabled ? "0" : "1"}">${p.enabled ? "停用" : "启用"}</button>
    </div>`
  ).join("") || "<p>没有插件</p>";
  $("pluginsBox").onclick = async (e) => {
    const id = e.target.dataset.plugin;
    if (!id) return;
    await api(`/api/plugins/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: e.target.dataset.on === "1" }),
    });
    loadPlugins();
  };
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
  const ref = $("modelSelect").value;
  const slash = ref.indexOf("/");
  if (slash < 0) return;
  const provider_name = ref.slice(0, slash);
  const model = ref.slice(slash + 1);
  await api("/api/providers/active-model", { method: "PUT", body: JSON.stringify({ provider_name, model }) });
};
$("btnFetchModels").onclick = () => fetchRemoteModels().catch((err) => { $("providerMsg").textContent = String(err.message || err); });
$("btnSaveProvider").onclick = () => saveProvider().catch((err) => { $("providerMsg").textContent = String(err.message || err); });

boot().catch((err) => addBubble("think", "启动失败：" + err.message));
