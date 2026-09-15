# AusCode

自托管单用户 AI 助手 **纯后端 API 服务**。基于 MIT 协议的开源项目 Octop（壳层）与
TencentCloud harness-agent（内核）深度定制换皮而来，详见 `THIRD-PARTY-NOTICES` 与
`docs/PLAN.md`。

## 快速开始

```
启动：双击 auscode-start.vbs          （后台静默启动，监听 127.0.0.1:8089）
停止：双击 auscode-stop.bat           （按端口结束进程）
```

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
