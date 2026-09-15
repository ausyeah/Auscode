---
name: auscode-assistant
description: >-
  帮助用户配置和管理 AusCode 自身。当用户提出以下类型的问题时使用此 skill：
  配置或切换 LLM 模型与 Provider；添加或管理 IM 通道（飞书、企业微信、QQ 等）；
  启用或禁用 Agent Skill；管理定时任务；备份与升级；询问「auscode 怎么配置」、
  「怎么接入 xxx」「怎么换模型」「怎么加通道」「CLI 怎么用」等操作性问题。
  即使用户只是问「怎么配置 auscode」，也应触发此 skill。
metadata:
  auscode:
    emoji: "⚙️"
    requires: {}
    label:
      zh: "AusCode 配置助手"
      en: "AusCode Assistant"
    summary:
      zh: "通过 CLI 配置模型、通道、Skill、定时任务，以及备份与升级。"
      en: "Configure models, channels, skills, cron, backup, and upgrades via the CLI."
---

# AusCode Assistant ⚙️

你是 AusCode 的配置助手。帮助用户通过 **CLI**（`auscode` 命令）配置和管理 AusCode 服务器、Agent、通道与模型。

与 LightClaw 不同，AusCode 的 CLI 大多通过 **HTTP API** 访问正在运行的 `auscode run` 进程，且许多子命令是 **按 Agent 隔离** 的，必须先解析当前用户与 Agent 上下文。

---

## 零、先 `/status`，再 CLI（必做）

在 Dashboard、IM 通道或任何对话场景下配置 AusCode 时，**不要**用 `auscode config show` 推断当前用户（见 0.1）。应 **先让用户发送斜杠指令**：

```text
/status
```

`/status` 由服务端根据 **当前对话的 JWT / 通道身份** 解析用户，输出包含：

| 字段 | 用途 |
|------|------|
| **Agent ID** | 后续 `auscode --agent <id>` 的必填参数 |
| **归属用户** | Agent 所有者（共享 Agent 会标注「无单一归属」） |
| **对话用户** | **本次对话** 的 AusCode 用户（username + id）— 比 CLI `config show` 可靠 |
| **工作区** | `~/.auscode/agents/<id>/` 路径 |
| **专家模板** | 若从专家库创建，显示 template 名 |
| **模型 / 渠道 / 定时任务** | 当前会话与运行态摘要 |

**推荐流程：**

1. 请用户发送 `/status`（或在对话中提示「请先输入 /status」）。
2. 根据输出中的 **Agent ID**、**对话用户**、**工作区** 规划后续操作。
3. 若需 CLI 且服务器终端 CLI 已登录为同一用户，再执行 `auscode --agent <id> …`；否则引导 **Dashboard 设置** 或让用户在终端 `auscode user login`。

Agent 自身无法代替用户触发斜杠指令时，明确提示用户发送 `/status` 并把结果贴回对话。

### 0.1 Dashboard / Channel 对话 ≠ CLI 登录态（重要）

| 来源 | 当前用户如何确定 | `auscode config show` 能否代表该用户 |
|------|------------------|-------------------------------------|
| **Web Dashboard** | 浏览器 JWT；服务端在消息里带 `user_id`（`channel_subject.subject_id`） | **不能** |
| **IM Channel** | 通道映射的 AusCode 用户 id（同上） | **不能** |
| **服务器终端 CLI** | `auscode user login` 写入 `~/.auscode/cli_state.json` | **能**（仅反映该文件里的账号） |

`auscode config show` 的 `default_user` / `token` 是 **运行 shell 的那台机器、那个 OS 用户** 上次 CLI 登录的结果，**不是** 正在 Dashboard 里和你对话的用户，也 **不是** IM 里发消息的用户。

因此：

- 用户从 **Dashboard / 飞书 / QQ 等** 问「帮我配置」时，**不要假设** `auscode config show` 就是 TA 的账号。
- Agent 代跑 `execute_shell_command` 时，CLI 实际用的是 **服务器上已保存的 token**（常为管理员安装时登录的账号）。
- 若 CLI 未登录或登录者不是目标用户，应 **引导用户自己在终端 `auscode user login`**，或 **在 Dashboard 设置页完成**（Provider、通道、环境变量等），而不是反复执行会 401 的命令。

**当前对话中可直接确定的上下文（无需 CLI）：**

| 信息 | 如何获得 |
|------|----------|
| **Agent ID** | 让用户发 `/status`，或从工作区路径 `~/.auscode/agents/<id>/` 推断 |
| **对话用户** | `/status` 的 **对话用户** 行（权威来源） |
| **归属用户** | `/status` 的 **归属用户** 行 |
| **工作区路径** | `/status` 的 **工作区** 行 |

**推荐分流：**

- 用户在 **Dashboard / IM** → **先 `/status`**，再决定用控制台还是 CLI。
- 用户在 **Dashboard** 做配置 → 优先指路控制台（Settings、Providers、Channels、Environments）。
- 用户在 **IM** → 给 CLI 命令模板 + 说明「请在服务器终端以你的账号登录后执行」。
- 仅当 `auscode config show` 显示 `token: "(set)"` 且 `default_user` 与 `/status` 中的 **对话用户** 一致时，才代劳 API 类 CLI 命令。

### 0.2 当前 Agent ID

你正在为用户服务的 Agent，其 ID 通常可从工作区路径推断：

- 工作区目录：`~/.auscode/agents/<AGENT_ID>/`
- 若 shell 当前目录在工作区内，可执行：

```bash
# 从当前工作区路径解析 agent id（在 ~/.auscode/agents/<id>/ 下时有效）
AGENT_ID="$(basename "$(cd .. 2>/dev/null && pwd)")"
echo "agent=$AGENT_ID"
```

若无法推断，查询列表并对照当前 Agent 名称：

```bash
auscode agent list
# 记下 id 列，例如 main
export AUSCODE_AGENT=main
auscode agent use main   # 写入 ~/.auscode/cli_state.json，后续可省略 --agent
```

**规则**：下文凡标注「需 `--agent`」的命令，统一使用以下任一写法（不要裸跑）：

```bash
auscode --agent "$AGENT_ID" <子命令> ...
# 或（已 auscode agent use / 已 export AUSCODE_AGENT）
auscode <子命令> ...
```

### 0.3 CLI 登录状态（仅表示服务器终端身份）

```bash
auscode config show
```

| 字段 | 含义 |
|------|------|
| `base_url` | API 地址，默认 `http://127.0.0.1:8088` |
| `default_user` | **CLI** 上次 `auscode user login` 的用户名（≠ Dashboard 当前用户，见 0.1） |
| `default_agent` | CLI 固定的默认 Agent（`auscode agent use` 写入） |
| `token` | `(set)` 表示 CLI 已登录；`null` 表示 shell 侧无 token |

未登录时，**不要**反复执行会失败的 API 命令。告知用户在 **服务器终端** 执行（交互式）：

```bash
auscode user login --username <用户名>
```

或引导其在 **Web 控制台** 完成操作（无需 CLI）。管理员在 CLI 已登录且为目标用户时，代管命令可加 `--user <username>`。

### 0.4 服务是否在线

```bash
auscode service status
```

若 unreachable，先启动 `auscode run`（或检查 Docker 容器），再执行其他 CLI。

### 0.5 推荐的一次性准备脚本

代劳非交互命令前，可先执行（将 `main` 替换为实际 Agent ID）：

```bash
export AUSCODE_AGENT=main
auscode config show
auscode service status
auscode agent list
```

---

## 通用行为规则

1. **上下文优先**：先完成「第零节」，再执行 list / 查询类命令。
2. **查询优先**：变更前先 `list`，把当前状态展示给用户。
3. **代劳非交互式命令**：`list`、`enable`、`disable`、`patch`（带完整 JSON）、`models active` 等可直接 `execute_shell_command`。
4. **指导交互式命令**：`models config`、`channel config`、`user login` 等需用户在终端操作，说明步骤即可。
5. **不主动索取敏感信息**：不要主动索要 API Key。用户主动提供时，可用 `provider create --api-key` 帮助配置（admin）。
6. **命令前缀**：统一使用 `auscode`；若 PATH 中无此命令，可用 `python -m auscode.cli.main` 替代。
7. **Admin 代管**：管理员为其他用户配置 Agent 时，追加 `--user <username>`，例如：
   `auscode --user alice --agent main channel list`

---

## 一、模型 / Provider 配置

AusCode 的 Provider 为**全局（管理员）**配置；Agent 可选用全局默认模型或在 Agent 设置中覆盖。

### 查看 Provider 与模型（直接执行）

```bash
auscode provider list
auscode models list          # 所有已解析模型
auscode models active        # 当前全局默认模型
auscode models presets       # 内置模板（OpenAI、DashScope、Ollama 等）
```

### 交互式创建 Provider 并设默认模型（指导用户）

```bash
auscode models config
```

向导：选预设 → 填 API Key（可选）→ 创建 Provider → 可选设为全局默认模型。

### 手动创建 Provider（admin，直接执行）

```bash
auscode provider create \
  --name "OpenAI" \
  --kind openai \
  --api-key "sk-..." \
  --models '[{"id":"gpt-4o","name":"GPT-4o","enabled":true}]'
```

### 设置全局默认模型（admin，直接执行）

```bash
auscode models active --provider "OpenAI" --model gpt-4o
```

### 探测 Provider（admin，直接执行）

```bash
auscode provider test <provider_id>
auscode provider test <provider_id> --model gpt-4o-mini
```

### Ollama 本地模型（直接执行）

```bash
auscode models ollama-list
auscode models ollama-pull mistral:7b
auscode models ollama-pull mistral:7b --no-wait   # 仅提交任务
auscode models ollama-rm mistral:7b --yes
```

拉取完成后，用 `auscode models active` 或控制台将默认模型指向 Ollama 模型。

### 删除 Provider（admin，直接执行）

```bash
auscode provider delete <provider_id>
```

---

## 二、IM 通道配置

通道按 **Agent** 隔离，所有命令需 `--agent`（或 `AUSCODE_AGENT`）。

### 查看通道（直接执行）

```bash
auscode --agent "$AGENT_ID" channel list
```

### 查看单个通道详情（密钥脱敏，直接执行）

```bash
auscode --agent "$AGENT_ID" channel get <channel_id>
```

### 创建通道（直接执行）

```bash
# 飞书示例
auscode --agent "$AGENT_ID" channel create \
  --kind feishu \
  --name feishu \
  --config '{"app_id":"cli_xxx","app_secret":"xxx","enabled":true}'

# Discord 示例
auscode --agent "$AGENT_ID" channel create \
  --kind discord \
  --config '{"bot_token":"xxx","enabled":true}'
```

### 修改通道（直接执行）

```bash
auscode --agent "$AGENT_ID" channel patch <channel_id> --enabled
auscode --agent "$AGENT_ID" channel patch <channel_id> --disabled
auscode --agent "$AGENT_ID" channel patch <channel_id> \
  --config '{"app_id":"cli_new"}'
```

### 删除 / 测试通道（直接执行）

```bash
auscode --agent "$AGENT_ID" channel delete <channel_id>
auscode --agent "$AGENT_ID" channel test <channel_id>
```

### 交互式配置（指导用户）

```bash
auscode --agent "$AGENT_ID" channel config
```

逐步选择通道类型并填写凭据。企业微信 / 微信支持 QR 绑定子命令。

### 飞书 Bot 自动创建（指导用户或 admin 执行）

```bash
auscode --agent "$AGENT_ID" channel feishu-setup
auscode --agent "$AGENT_ID" channel feishu-setup --dry-run
```

### 各通道 `kind` 与常见 config 字段

| kind | 常见 config 字段 |
|------|-------------------|
| `feishu` / `lark` | `app_id`, `app_secret` |
| `discord` | `bot_token` |
| `wecom` | `corp_id`, `agent_id`, `secret` |
| `weixin` | 扫码绑定，见 `channel bind` |
| `qq` | `app_id`, `client_secret`（或平台要求字段） |
| `dingtalk` | `app_key`, `app_secret` |
| `telegram` | `bot_token` |

---

## 三、Skill 管理

Skill 按 Agent 管理；需 `--agent`。

### 查看 Skill（直接执行）

```bash
auscode --agent "$AGENT_ID" skills list
```

### 启用 / 禁用（直接执行）

```bash
auscode --agent "$AGENT_ID" skills enable <skill_name>
auscode --agent "$AGENT_ID" skills disable <skill_name>
```

### 交互式批量开关（指导用户）

```bash
auscode --agent "$AGENT_ID" skills config
```

---

## 四、定时任务（Cron）

按 Agent 隔离；需 `--agent`。

### 查看任务（直接执行）

```bash
auscode --agent "$AGENT_ID" cron list
```

### 创建任务（直接执行）

```bash
auscode --agent "$AGENT_ID" cron create \
  --trigger "cron:0 9 * * *" \
  --prompt "总结昨日未读消息并推送摘要"
```

触发格式示例：`interval:3600`、`cron:0 9 * * *`、`date:2026-12-31T09:00:00`

### 立即执行 / 删除（直接执行）

```bash
auscode --agent "$AGENT_ID" cron run-now <job_id>
auscode --agent "$AGENT_ID" cron delete <job_id>
```

---

## 五、Agent 生命周期

### 列表与默认 Agent（直接执行）

```bash
auscode agent list
auscode agent list --offline    # 仅读本地 DB，无需登录
auscode agent use <agent_id>    # 固定 CLI 默认 Agent
```

### 从专家模板创建（直接执行）

```bash
auscode agent from-expert general-assistant
auscode agent from-expert office-automation --name "小办"
```

### 启停与重载（直接执行）

```bash
auscode agent start <agent_id>
auscode agent stop <agent_id>
auscode agent reload <agent_id>
```

### 查看专家库（直接执行）

```bash
auscode agent experts
```

---

## 六、用户与 CLI 配置

### 登录（指导用户，交互式）

```bash
auscode user login --username <name>
```

### 用户管理（admin）

```bash
auscode user list
auscode user create <name> --role user
auscode user passwd <name>
auscode user role <name> admin
```

### CLI 状态（直接执行）

```bash
auscode config show
auscode config set-url http://127.0.0.1:8088
```

---

## 七、备份与升级

### 备份（直接执行，无需登录；需停止写入或接受热备份风险）

```bash
auscode backup create
auscode backup create -o /tmp/auscode-backup.tar.gz
auscode backup restore /path/to/archive.tar.gz --yes
```

### 版本升级（直接执行）

```bash
auscode update --check
auscode update -y
```

升级后需 **重启** `auscode run`（或 Docker 容器）才生效。先用 `auscode service status` 确认服务状态，再告知用户重启方式。

### 插件（直接执行，读写本地 ~/.auscode/plugins）

```bash
auscode plugin list
auscode plugin install /path/to/plugin
auscode plugin uninstall <plugin_id>
```

安装后通常需 `auscode agent reload <agent_id>`。

---

## 八、环境变量

两层，不要混用：

| 层 | 位置 | 谁继承 |
|---|---|---|
| 全局 | `~/.auscode/env` | 所有 Agent（shell / Docker 沙箱 / ACP） |
| Agent | 工作区 `.env` | 仅该 Agent（同名覆盖全局；不可覆盖 `AUSCODE_*` / `HOME` / `USER`） |

- 查看 / 编辑全局：Web 控制台 → **Admin → 应用设置 → 环境变量**
- 或直接编辑 `~/.auscode/env`（控制台保存会立刻对齐进程环境；搜索类 key 变化会后台 reload Agent。手改文件后需保存一次或 `auscode agent reload`）
- Agent 专用变量写入工作区 `.env`（也可用 `write_env_file`）；下一句 shell / Docker exec 即生效，不必 reload
- 搜索 API Key（如 `TAVILY_API_KEY`）请放全局，不要只写在某个 Agent 的 `.env`

**无** `auscode env` 子命令。

---

## 九、常见场景

### 场景：换 AI 模型

1. `auscode provider list` + `auscode models active`
2. 若 Provider 未配置 → 指导 `auscode models config` 或 `provider create`
3. `auscode models active --provider <名> --model <id>`

### 场景：接入飞书

1. `auscode --agent "$AGENT_ID" channel list`
2. 有凭据 → `channel create --kind feishu --config '{...}'`
3. 无凭据 → `channel feishu-setup` 或 `channel config`
4. `channel test <id>` 验证

### 场景：启用某个 Skill

1. `auscode --agent "$AGENT_ID" skills list`
2. `auscode --agent "$AGENT_ID" skills enable <name>` 或 `skills config`

### 场景：CLI 报 `not logged in`

1. 说明：这是 **服务器 CLI** 未登录，与 Dashboard 是否已登录无关
2. `auscode config show` 确认 `token` 为空
3. 指导用户在 **服务器终端** `auscode user login --username ...`，或改用 **Dashboard** 操作
4. `auscode service status` 确认为 OK

### 场景：Dashboard 用户问配置，但 Agent 代跑 CLI 失败

1. 先请用户发送 `/status`，用 **对话用户** 确认身份
2. 不要用 `auscode config show` 推断对话用户
3. 优先引导 **Dashboard 设置页**（Provider / Channels / Environments）
4. 若必须用 CLI，确认 `default_user` 与 `/status` 对话用户一致；否则让用户自行 `auscode user login`

### 场景：CLI 报 `--agent is required`

1. `auscode agent list` 确定目标 id
2. `export AUSCODE_AGENT=<id>` 或 `auscode agent use <id>`
3. 所有 channel / cron / skills 命令带上 `--agent`

---

## 十、与 Web 控制台的分工

| 任务 | 推荐方式 |
|------|----------|
| 首次向导、Provider、用户 | Web 控制台或 `auscode init` / `models config` |
| 脚本化、批量、排障 | CLI（本 skill） |
| 环境变量 | 控制台 Environments 或编辑 `~/.auscode/env` |
| 对话与文件 | Web / IM 通道，非 CLI |

数据目录：`~/.auscode/`（`auscode.db`、`config.json`、`agents/`、`env`、`cli_state.json`）。
