<div align="center">

# AusCode

### 自托管的单用户 AI 助手：内核不动，壳层换皮，砍到只剩你要的。

把 MIT 协议的开源项目 **Octop**（壳层）与 **TencentCloud harness-agent**（内核）深度定制换皮而来的
自托管本地 AI 助手服务。**单用户、纯后端、品牌独立**，配一套自己的 Web 界面使用。

[做了什么](#做了什么) · [怎么跑](#快速开始) · [接口](#接口) · [保留与移除](#保留--已移除) · [合规](#许可证合规)

</div>

---

## 做了什么

一句话：**内核不动（harness-agent），壳层换皮（octop → auscode），砍掉前端与多余入口，只留 HTTP/WebSocket API。**

这不是"从零写一个 AI 助手"，而是一次有明确验收标准的**工程化裁剪与品牌化**：

| 维度 | 做法 |
|---|---|
| **改名** | 477 个文件、3975 处替换（`OCTOP_` / `Octop` / `octop` 三种形态），残留 0。工具：`tools/rename_octop_to_auscode.py` |
| **裁剪** | **物理删除**代码而非隐藏开关：dashboard 静态资源、`infra/{voice,mobile,desktop}`、IM 渠道路由、`update` 自更新命令等 |
| **鉴权** | 单用户免登录，但**签发 10 年期 API Token**：首启自动生成写入 `credential.txt`，调用方持 Token 访问 |
| **界面** | 弃用上游编译版 dashboard，**自建轻量 Web 界面**（约 8000 行 JS/CSS/HTML），纸感浅色风格 |
| **数据隔离** | 代码目录与运行数据目录分离（`AUSCODE_HOME`），因为 `init --force` 会清空 home，绝不能指向项目根 |

### 为什么删掉自更新

上游 Octop 自带的 `update` 命令会**整体覆盖本地代码**——对一套深度定制过的皮来说等于自毁。
该命令与路由已物理删除，`auscode update` 不复存在。内核升级走 pip 依赖比对上游
[TencentCloud/harness-agent](https://github.com/TencentCloud/harness-agent)。

## 界面

自建 Web 界面（`ui/`）：

- **左侧功能栏**：对话 / 自动化 / Token 统计 / 记忆 / 模型 / 技能 / 插件 / 权限 / 设置
- **中间聊天**：整页不滚动，只有对话区自己滑；历史对话悬停显示删除
- **输入栏**：切换模型、思考强度，以及权限档位（变更前确认 / 自动编辑 / 计划模式 / 完全访问）
- **Markdown + LaTeX**：渲染标题 / 列表 / 表格 / 代码，内置 KaTeX
  （行内 `$E=mc^2$`、块级 `$$...$$`，公式资源本地打包在 `ui/vendor/katex/`，**离线可用**）

## 快速开始

```
打开图形界面：双击 auscode-desktop.bat    （浅色图形界面，日常用法）
启动服务：    双击 auscode-start.bat
命令行对话：  双击 auscode-chat.bat
停止服务：    双击 auscode-stop.bat
一键验收：    双击 run-acceptance.bat
```

> 不要双击 `auscode-start.vbs`（旧脚本，留着仅作参考）。

### 命令行用法

```bash
# 启动服务后，另开一个终端
cd /d D:\AusCode
set AUSCODE_HOME=D:\AusCode\data

# 持续对话
venv\Scripts\python.exe -m auscode chats send --agent TV3AHW "你好，介绍一下你能做什么"

# 换备用模型
venv\Scripts\python.exe -m auscode chats send --agent TV3AHW --model glm-5.3-flash "你好"

# 退出：Ctrl+C
```

## 接口

服务启动后自动打开图形界面。各入口：

| 入口 | 地址 / 文件 |
|---|---|
| 图形界面 | http://127.0.0.1:8089/ |
| 接口说明书（Scalar） | http://127.0.0.1:8089/api/docs |
| OpenAPI 规范 | http://127.0.0.1:8089/api/openapi.json |
| 健康检查 | http://127.0.0.1:8089/api/health |
| API 凭据（Token） | `data\credential.txt` |
| 运行数据目录 | `D:\AusCode\data\`（config.json / auscode.db / logs / plugins） |

### 鉴权

首启自动创建管理员 `admin` 并签发 **10 年期 API Token**（存于 `data\credential.txt`）。
所有业务接口需带：

```
Authorization: Bearer <credential.txt 中的 Token>
```

重新签发：`set AUSCODE_HOME=D:\AusCode\data && venv\Scripts\python.exe tools\bootstrap_token.py`

### 接入大模型

**默认未预配任何模型 provider。** 配置任一 OpenAI 兼容 / Anthropic / Ollama 服务后 agent 即可对话：

1. `GET /api/setup/presets` —— 查看支持哪些厂商
2. `POST /api/providers` —— 填入 API Key 和模型
3. 再调对话接口发一句「你好」

未配置时 agent 报 `no_models_configured`，**这是预期行为，不是故障**。
命令行亦可：`venv\Scripts\python.exe -m auscode provider --help`

## 验收

双击 `run-acceptance.bat` 会自动检查健康、鉴权、已删功能 404，以及插件 / 知识库 / 浏览器 / cron / 记忆接口。

手工验收走 `/api/docs`：页面顶部 **Auth** 选 Bearer，贴入 `credential.txt` 里以 `eyJ` 开头的 Token，
之后每个接口右侧的 **Try it** 都会自动带上。建议顺序：

1. `GET /api/health` —— 不需要 Token，应 200
2. `GET /api/agents` —— 应看到 agent `TV3AHW`（name=`main`）
3. `GET /api/plugins`、`/api/knowledge-bases`、`/api/browser/env-status`
4. 随便点一个已删接口（如 `GET /api/channels` 或 `/api/voice/providers`）—— 应 **404**

## 保留 / 已移除

**保留**：对话（REST + WS 流式）、知识库 RAG、插件系统、浏览器自动化、长期记忆、cron 定时任务、
MCP 连接器（connectors）、专家 / 子代理、文件系统与终端工具、自建 Web 界面。

**物理移除**：上游编译版 dashboard、IM 渠道（飞书 / 钉钉 / 元宝）、手机遥控、桌面控制、
语音 TTS、邀请码 / OIDC 登录、`update` 自更新命令与路由。相关接口返回 404（openapi 共 293 条路由，0 残留）。

**一期停用**（代码仍在，二期评估）：TLS/ACME、backup、proactive 主动关怀。

## 目录结构

```
D:\AusCode\
├── auscode-start.bat / auscode-stop.bat   启停脚本
├── src\auscode\               源码（Python 包，git 管理）
│   ├── api\routers\           62 个路由模块
│   ├── cli\                   CLI 命令与 REPL
│   └── infra\                 agent 运行时 / 中间件 / 插件
├── ui\                        自建 Web 界面（vendor\katex 本地公式库）
├── venv\                      Python 3.12 运行环境
├── data\                      运行数据（AUSCODE_HOME，已 gitignore）
├── tools\                     bootstrap_token.py / desktop.py / acceptance.py
│                               rename_octop_to_auscode.py（换皮脚本）
├── THIRD-PARTY-NOTICES        第三方许可声明（MIT 合规，勿删）
└── docs\PLAN.md               项目方案、决策记录与执行记录
```

## 许可证合规

| 上游 | 协议 | 结论 |
|---|---|---|
| octop 1.0.0（壳层） | MIT | 可修改、可改名 |
| orcakit-harness-agent 1.0.9（内核） | MIT | 同上 |
| harness-gateway / browser / memory | MIT | 同上 |

依赖扫描：绝大多数 MIT/Apache/BSD；仅 `psycopg`、`pynput`、`python-telegram-bot` 为 LGPL——
以 pip 依赖方式使用不传染，但**不得改动这三个库本身再分发**。

**合规义务**：分发的副本中必须保留原作者版权声明与 MIT 许可证文本，
已收录于项目根目录的 `THIRD-PARTY-NOTICES`。

> **商标注意**：MIT 只授予版权权利，不授予商标。"Octop" 名称与吉祥物素材不属于可自由复用范围，
> 换皮时已全部替换 / 移除。

## 维护注意

- **不要运行上游 Octop 的自更新**（该命令已删除，正是为了防止覆盖这套皮）。
- 内核（harness-agent 系列）以 pip 依赖保留在 venv，可对照上游
  <https://github.com/TencentCloud/harness-agent> 升级。
- venv 为本机复制的环境；如需重建，装好 Python 3.12 后按 `docs/PLAN.md` 第 5 节重做。
- RAG 本地向量模型目录（`embedding_models`）原安装即为空，首次使用需按其配置拉取 embedding 服务 / 模型。
