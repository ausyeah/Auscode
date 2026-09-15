# AusCode

自托管单用户 AI 助手 **纯后端 API 服务**。基于 MIT 协议的开源项目 Octop（壳层）与
TencentCloud harness-agent（内核）深度定制换皮而来，详见 `THIRD-PARTY-NOTICES` 与
`docs/PLAN.md`。

## 快速开始

```
打开桌面：双击 auscode-desktop.bat    （浅色图形界面，日常用法）
启动服务：双击 auscode-start.bat
命令行对话：双击 auscode-chat.bat
停止服务：双击 auscode-stop.bat
验收：双击 run-acceptance.bat
```

图形界面是纸感浅色：左侧功能栏（对话 / 专家 / 自动化 / Token 统计 / 工作台 / 知识库 / 记忆 / 模型 / 插件 / 权限 / 设置），中间聊天。输入栏可切换模型、思考强度，以及权限档位（变更前确认 / 自动编辑 / 计划模式 / 完全访问）。设置页可额外接入 API Key。

不要双击 `auscode-start.vbs`（旧脚本，中文编码会报错）。首页 `http://127.0.0.1:8089/` 会自动跳到说明书。

| 入口 | 地址 / 文件 |
|---|---|
| 接口说明书（Scalar） | http://127.0.0.1:8089/api/docs |
| OpenAPI 规范 | http://127.0.0.1:8089/api/openapi.json |
| 健康检查 | http://127.0.0.1:8089/api/health |
| API 凭据（Token） | `data\credential.txt` |
| 运行数据目录 | `D:\AusCode\data\`（config.json / auscode.db / logs / plugins） |

## 鉴权

首启已自动创建管理员 `admin` 并签发 **10 年期 API Token**（存于 `data\credential.txt`）。
所有业务接口需带：

```
Authorization: Bearer <credential.txt 中的 Token>
```

重新签发 Token：`set AUSCODE_HOME=D:\AusCode\data && venv\Scripts\python.exe tools\bootstrap_token.py`

## 怎么跟 AI 对话

日常请双击 `auscode-desktop.bat`，打开图形窗口。文档页（`/api/docs`）只是接口说明书。

也可以继续用命令行：

1. 先双击 `auscode-start.bat` 把服务拉起来（已经在跑就跳过）
2. 再双击 `auscode-chat.bat`
3. 出现提示后直接打字，回车发送。例如：`帮我看看 D:\AusCode\README.md 里怎么启动`
4. 退出：`Ctrl+C`

也可以只发一句、不进持续聊天：

```
cd /d D:\AusCode
set AUSCODE_HOME=D:\AusCode\data
venv\Scripts\python.exe -m auscode chats send --agent TV3AHW "你好，介绍一下你能做什么"
```

换备用模型（glm-5.3-flash）：

```
venv\Scripts\python.exe -m auscode chats send --agent TV3AHW --model glm-5.3-flash "你好"
```

没有网页聊天界面是当时按「只要后端 API」裁掉的。如果后面要网页对话框，可以再加一层套皮前端。

## 怎么验收

先保证服务在跑：双击 `auscode-start.bat`，等几秒（会自动打开说明书网页）。然后分两层：

### 1. 一键机检（推荐先跑这个）

双击 `D:\AusCode\run-acceptance.bat`。会自动检查健康、鉴权、已删功能 404、插件/知识库/浏览器/cron/记忆接口。刚才实测 **17/17 通过**。

### 2. 在接口说明书里手动试（你现在打开的页面）

打开 [http://127.0.0.1:8089/api/docs](http://127.0.0.1:8089/api/docs)。页面顶部找到 **Auth**（或锁形图标），选 Bearer，把 `data\credential.txt` 里那串以 `eyJ` 开头的 Token 贴进去。之后每个接口右侧的 **Try it** 都会自动带上 Token。

建议按这个顺序点：

1. `GET /api/health` —— 不需要 Token，应返回 200
2. `GET /api/agents` —— 应看到 agent `TV3AHW`（name=`main`）
3. `GET /api/plugins`、`GET /api/knowledge-bases`、`GET /api/browser/env-status`
4. 随便点一个已删接口（例如 `GET /api/channels` 或 `GET /api/voice/providers`）—— 应 404

### 3. 还差的两步人工项（必须先配模型）

机检不会替你发真实对话。在 `/api/docs` 里：

1. `GET /api/setup/presets` 看支持哪些厂商
2. `POST /api/providers` 填入 API Key 和模型
3. 再调对话接口（通常是 agent 下的 chat / 流式接口）发一句「你好」
4. 浏览器自动化同理：配好模型后让 agent 打开一个网页

没配模型时 agent 会报 `no_models_configured`，这是预期，不是故障。

## 接入大模型（首次使用前必做）

默认未预配任何模型 provider。用 Token 调 `POST /api/providers`（或 `GET /api/setup/presets`
查看预设）配置任一 OpenAI 兼容 / Anthropic / Ollama 服务后，agent 即可启动对话。
在模型配置完成前，agent 运行时会报 `no_models_configured`，属预期行为。

命令行方式：`venv\Scripts\python.exe -m auscode provider --help`

## 目录结构

```
D:\AusCode\
├── auscode-start.vbs / auscode-stop.bat   启停脚本
├── src\auscode\               源码（Python 包，git 管理）
├── venv\                      Python 3.12 运行环境（本机复制，勿移动）
├── data\                      运行数据（AUSCODE_HOME，已 gitignore）
├── tools\                     bootstrap_token.py / 改名脚本（历史工具）
├── snapshots\                 改造前源码快照 zip（gitignore）
├── THIRD-PARTY-NOTICES        第三方许可声明（MIT 合规，勿删）
└── docs\PLAN.md               项目方案与决策记录
```

## 保留 / 已移除

保留：对话（REST+WS 流式）、知识库 RAG、插件系统、浏览器自动化、长期记忆、cron 定时任务、
MCP 连接器（connectors）、专家/子代理、文件系统与终端工具。

物理移除：Web dashboard、IM 渠道（飞书/钉钉/元宝）、手机遥控、桌面控制、语音 TTS、
邀请码/OIDC 登录、`update` 自更新命令与路由。相关接口返回 404。

一期停用（代码仍在，二期评估）：TLS/ACME、backup、proactive 主动关怀。

## 维护注意

- **不要运行上游 Octop 的自更新**；`auscode update` 命令已删除，防止覆盖本套皮。
- 内核（harness-agent 系列）以 pip 依赖保留在 venv，可对照上游
  https://github.com/TencentCloud/harness-agent 升级。
- venv 为本机复制的环境；如需重建，在装好 Python 3.12 后按 `docs/PLAN.md` 第 5 节重做。
