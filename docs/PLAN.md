# AusCode 项目启动文档

> 基于 Octop（MIT）套皮的独立后端 AI 助手服务 · 准备阶段文档 · 2026-09-15
>
> 状态：**一期已完成（2026-09-15 执行完毕，见文末执行记录）**。本文档是开工的完整依据，需求、现状、方案、计划、风险、验收标准均已固化；第 11 节六个问题已于 2026-09-15 全部拍板。

---

## 1. 项目定位

**AusCode** 是把本机已安装的开源项目 Octop（v1.0.0，MIT 协议）作为基底，抽取其内核与壳层，做成的**纯后端 API 形态、单用户、品牌独立**的自托管 AI 助手服务。

一句话：**内核不动（harness-agent），壳层换皮（octop → auscode），砍掉前端与多余入口，只留 HTTP/WebSocket API。**

---

## 2. 许可证合规基础（已核查）

| 项目 | 协议 | 结论 |
|---|---|---|
| octop 1.0.0（壳层） | MIT（版权方 "Octop contributors"） | 可修改、可改名、可闭源、可商用 |
| orcakit-harness-agent 1.0.9（内核） | MIT（github.com/TencentCloud/harness-agent） | 同上 |
| harness-gateway 0.9.7 / harness-browser 0.7.8 / harness-memory 0.9.10 | MIT | 同上 |
| 依赖扫描 | 绝大多数 MIT/Apache/BSD；仅 psycopg、pynput、python-telegram-bot 为 LGPL | 以 pip 依赖方式使用不传染；不得改动这三个库本身再分发 |

**合规义务（唯一的硬性要求）**：分发的副本中必须保留原作者版权声明与 MIT 许可证文本。
**执行方式**：AusCode 项目根目录放 `THIRD-PARTY-NOTICES` 文件，收录 octop 与各 harness 包的 LICENSE 原文（来源：`D:\Octop\venv\Lib\site-packages\octop-1.0.0.dist-info\licenses\LICENSE` 及各 dist-info）。

**商标注意**：MIT 只授予版权权利，不授予商标。"Octop" 名称、吉祥物图片（mascot 系列 webp/png/webm）不属于可自由复用范围，AusCode 换皮时全部替换/移除，且不得暗示与原项目官方有关。

---

## 3. 需求基线（已与需求方确认）

| # | 决策项 | 结论 |
|---|---|---|
| 1 | 品牌名 | **AusCode**（包名 `auscode`，目录 `D:\AusCode`） |
| 2 | 产品形态 | **仅后端 API**（HTTP/WebSocket），不搭任何前端界面，dashboard 整体停用 |
| 3 | 用户体系 | **单用户免登录**——无注册/邀请码/多用户隔离（具体鉴权方案见 8.2，有推荐待拍板） |
| 4 | 必留功能 | 核心 AI 对话、知识库 RAG、插件系统、浏览器自动化 |
| 5 | 默认保留 | 长期记忆（harness-memory）、定时任务 cron（体积小、价值高） |
| 6 | 明确砍掉（**物理删除代码**） | Web dashboard、IM 渠道（飞书/钉钉/元宝）、手机遥控（mobile/adb）、桌面控制（desktop）、语音 TTS、邀请码/OIDC 登录等多用户入口 |

---

## 4. 现状盘点（源材料事实）

### 4.1 版本与环境

| 项 | 值 |
|---|---|
| 壳层 | octop 1.0.0（wheel 安装，dist-info 完整，含 METADATA/RECORD） |
| 内核 | orcakit-harness-agent 1.0.9 + harness-gateway 0.9.7 + harness-browser 0.7.8 + harness-memory 0.9.10 |
| Python | CPython 3.12（uv 管理：`C:\Users\26315\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none`，uv 0.12.6 创建的 venv） |
| 代码规模 | `octop` 包 567 个 .py 文件，49 MB（含 dashboard 静态资源）；395 个文件含 `octop` 字样 |
| CLI 入口 | `octop = octop.cli.main:cli`（唯一 console_script，`octop run` 启动服务） |

### 4.2 运行现状（重要约束）

- **Octop 服务此刻正在运行**：`127.0.0.1:8088`（PID 52980），数据目录即安装目录 `D:\Octop`（由 `octop-start.vbs` 设置 `OCTOP_HOME=D:\Octop`）。
- `D:\Octop` 内有活跃数据：`octop.db`（SQLite，含 -wal/-shm）、`config.json`、`credential.txt`、`plugins/`（11 个内置插件）、`logs/`、`embedding_models/`（RAG 本地向量模型）。
- **约束：施工期间不得破坏现有 Octop 的运行与数据。** AusCode 用独立目录、独立端口（建议 **8089**）、全新数据，不对 `D:\Octop` 做任何写操作（只读拷贝）。

### 4.3 源码形态（风险点）

- octop 的上游源码仓库未知（METADATA 无 Project-URL）；**`site-packages` 里的 .py 就是唯一可用源码**，非 git 仓库、无历史。
- 内核 harness-agent 有公开仓库（github.com/TencentCloud/harness-agent），可独立升级。
- dashboard 是编译后的 SPA（Vite 哈希文件名），不可维护——但本方案弃用前端，无关紧要。

### 4.4 已确认的关键装配机制（决定改造成本低）

| 机制 | 事实 | 对套皮的意义 |
|---|---|---|
| dashboard 开关 | `OctopConfig.enable_dashboard`（config.json 或环境变量 `OCTOP_ENABLE_DASHBOARD`），app.py 据此条件挂载 SPA | **纯后端形态 = 一行配置，无需删代码** |
| API 文档开关 | `enable_api_docs`（默认 false），开启后提供 Scalar API 文档页 | 后端-only 形态建议**开启**，作为唯一"界面" |
| 移动端开关 | `capabilities.mobile.enabled` + `OCTOP_ENABLE_MOBILE` | 配置关闭即可 |
| JWT 鉴权 | 中间件拦截全部 `/api/*`，白名单路径豁免（`is_jwt_exempt_request`）；token 经 `X-Octop-Access-Token` 滑动续期 | 单用户方案在鉴权层做，见 8.2 |
| 配置体系 | config.json + `OCTOP_*` 环境变量覆盖，`OctopConfig` dataclass | 换皮后改为 `AUSCODE_*` |
| 组合根 | `launch.run_foreground`: OctopServer → build_app → uvicorn（支持 TLS 双端口规划） | 启动链路无需改动 |

---

## 5. 总体技术方案

**策略：内核不动、壳层 vendor 换皮。**

```
D:\AusCode\
├── THIRD-PARTY-NOTICES          # MIT/LGPL 合规声明（硬性）
├── LICENSE-AusCode              # AusCode 自己的许可（可自定，但底层 MIT 声明保留）
├── auscode-start.vbs / .bat     # 启动/停止脚本（仿 octop-start.vbs，端口 8089）
├── config.json                  # 首次启动生成/预填（enable_dashboard=false, enable_api_docs=true）
├── credential.txt               # 首次启动生成的 API Token（见 8.2）
├── logs/  plugins/  octop数据…  # 运行期生成
└── venv\                        # 由 D:\Octop\venv 整体复制（离线可行）
     └── Lib\site-packages\
          ├── auscode\            # octop 包复制 + 全局改名（方案 A，见 8.1）
          ├── dashboard\ 已删除   # 前端资源约 40+MB，直接移除
          └── harness_* 等        # 内核与依赖原样保留（pip 依赖身份不变）
```

要点：

1. **venv 整体复制**而非重装：uv 基础解释器路径不变，复制后用 `venv\Scripts\python.exe -m auscode run` 启动（绕开 .exe shim 里的旧绝对路径）。离线即可完成，不依赖网络与 pip 源。
2. **内核以 pip 依赖身份保留**（不 vendor、不改名）：harness-agent 系列保持原名原版本，将来可对照上游仓库升级。套皮动作只发生在壳层。
3. **全新数据，不做迁移**：AusCode 首次启动走自己的初始化（自动建管理员 + 生成 Token），不导入 `octop.db` 旧数据（如需导入另立二期工具）。
4. **先做源码快照**（Phase 0）：把 `site-packages` 里的 octop 与 harness 包各打一个 zip 存档——这是当前唯一的源码形态，动手前先固化基线。

---

## 6. 范围界定

### 保留并可用（一期验收范围）
- 核心 Agent 对话（REST + WebSocket 流式）、子代理、专家（experts）
- 知识库 RAG（`embedding_models/` 本地模型一并复制，离线可用）
- 插件系统 + 11 个内置插件（auscode 包内自带，默认随 config 开关）
- 浏览器自动化（playwright / harness-browser）
- 长期记忆、cron 定时任务、文件上传、filesystem/workspace API、providers/模型配置 API、usage 统计、健康检查
- Scalar API 文档页（`/api/docs`，作为唯一"界面"）

### 一期物理删除（已拍板：删代码，不做"停用凑合"）

按"依赖耦合从浅到深"分批删，每批删除后 git commit + 启动冒烟，删崩可回退：

| 批次 | 删除对象（infra 侧） | 同步摘除的路由/挂载（api 侧） |
|---|---|---|
| 1 | `dashboard/` 静态资源目录（约 40 MB，含 Octop 吉祥物/商标素材，必删） | app.py 中 dashboard 挂载块（`enable_dashboard` 分支） |
| 2 | `infra/voice/` | `api/routers/voice.py`（含 admin_voice_router 挂载） |
| 3 | `infra/mobile/` | `api/routers/mobile/` 及 mobile 能力探测 |
| 4 | `infra/desktop/` | `api/routers/desktop/` |
| 5 | `infra/gateway/` 的 IM 渠道部分（bot_creators/channels：飞书、钉钉、元宝） | `api/routers/channels.py` |
| 6 | 多用户入口：邀请码、OIDC 登录 | `api/routers/invites.py`、`api/routers/auth_oidc.py` |

**保留判定（看似可删但一期不动）**：`users`/`auth` 核心（JWT 中间件与数据归属都依赖它）、`admin`（无 UI 时配置 provider/存储的唯一通道）、`connectors`（自定义 MCP 接入，属 agent 扩展能力而非 IM 渠道）、experts/subagents（agent 能力）。

### 一期停用、二期评估再删（横切组件，与启动链路耦合深）

- TLS/ACME 证书（本机 127.0.0.1 用不上）、backup、update 自更新、proactive 主动关怀——一期配置停用即可从暴露面消失；是否物理删除二期单独评估。

另：Octop 品牌字符串、`X-Octop-Access-Token` 响应头（改为 `X-AusCode-Access-Token`）随 Phase 2 全局改名一并清除。

---

## 7. 关键设计决策（含推荐，待拍板项见第 11 节）

### 8.1 改名方案：A 完整重命名 vs B 外部换皮

| | 方案 A：完整重命名（推荐） | 方案 B：外部换皮 |
|---|---|---|
| 做法 | 包目录 `octop`→`auscode`，全部源码机械替换 `octop`→`auscode` / `Octop`→`AusCode` / `OCTOP_`→`AUSCODE_` | 包名保留 `octop`，只改入口脚本名、API title、i18n 可见文案 |
| 改动面 | 395 个文件的字符串替换（脚本化一次完成） | ~10 个文件 |
| 风险 | import 错误会在启动瞬间全部暴露，冒烟即可验证；`octop.db` 等文件名字符串同步替换，全新数据无迁移负担 | 几乎零风险，但内部仍是 octop，"皮"不彻底，后续维护易混淆 |
| 推荐 | **采用 A**：套皮诉求就是品牌独立，且验证成本低（能启动 = import 链完整） | 备选：若 A 的冒烟暴露深层问题再降级到 B |

替换注意点：`octop` 作为普通英文词出现的注释一并替换无害；需单独核对 `config.json` 键名、db 文件名、日志路径、插件命名空间、`X-Octop-*` 头、`app.state.octop_server` 属性名等**跨文件契约**，由全局替换天然覆盖，替换后跑冒烟确认。

### 8.2 单用户免登录的鉴权方案（推荐：保留 Token，自动装配）

"免登录"定义为**免除人工注册/登录流程**，不是裸奔——agent 具备文件系统/终端/浏览器等高危工具，API 完全无鉴权在本机也危险。

推荐做法：首次启动自动创建唯一管理员用户 → 生成一个**长期 API Token** 写入 `credential.txt` → 调用方固定带此 Token（`Authorization: Bearer`）。保留现有 JWT 中间件与豁免白名单机制，代码改动极小；滑动续期头照常工作。
备选：绑定 127.0.0.1 且完全去掉鉴权中间件——更简单，但任何本机进程都能驱动 agent，不推荐。

### 8.3 其余既定决策

| 项 | 决策 |
|---|---|
| 端口 | **8089**（8088 被 Octop 占用且保持运行） |
| 项目位置 | `D:\AusCode` |
| 数据策略 | 全新初始化，不做 octop.db 迁移 |
| venv | 整体复制 + `python -m auscode` 启动 |
| API 文档 | 开启（`enable_api_docs=true`，`/api/docs` Scalar 页） |
| 瘦身方式 | 一期物理删除（分批 + git 回退，见第 6 节批次表）；TLS/backup/update 等横切组件二期再评 |

---

## 8. 实施计划（确认后执行）

| 阶段 | 内容 | 产出物 |
|---|---|---|
| **Phase 0 基线快照** | ① zip 存档 `site-packages/octop` 与 4 个 harness 包；② 复制 `D:\Octop\venv` → `D:\AusCode\venv`；③ `git init D:\AusCode` 并提交初始状态；④ 整理 THIRD-PARTY-NOTICES | 快照 zip、可用 venv、git 仓库、合规文件 |
| **Phase 1 生成包并物理裁剪** | 复制 `octop`→`auscode` 包；按第 6 节批次表删除模块与路由挂载（每批 commit + 启动冒烟）；修正 entry_points（`auscode = auscode.cli.main:cli`） | 无多余模块的 auscode 包 |
| **Phase 2 全局改名与换皮** | 三种大小写形态全局替换（`octop`/`Octop`/`OCTOP_`）；API title/description；i18n（zh/en）；`X-AusCode-Access-Token`；环境变量前缀 `AUSCODE_*`；默认 home 解析（`AUSCODE_HOME`） | 品牌独立的 API 服务代码 |
| **Phase 3 单用户与首启** | 自动装配唯一管理员 + 长期 Token 写 `credential.txt`；预填 `config.json`（dashboard=false、api_docs=true、mobile=false、port=8089） | 免登录可用、首启即就绪 |
| **Phase 4 冒烟验证** | 启动 `python -m auscode run` → 按第 10 节逐项验证（对话/流式、RAG、插件、浏览器自动化、记忆、cron、404 确认） | 验证记录 |
| **Phase 5 收尾** | 启动/停止脚本、README（API 速览 + Token 用法 + 端口）、最终合规检查（NOTICES 齐全、`grep -ri octop` 无业务残留、无 Octop 商标素材） | 可交付的 D:\AusCode |

预估总量：一次连续工作session 可完成 Phase 0–4，Phase 5 视冒烟结果顺延。

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| octop 无上游源码仓库，site-packages 是唯一源 | 后续无法拉上游更新 | Phase 0 快照基线；内核（harness 系列）有公开仓库可独立升级；AusCode 建议初始化 git |
| 全局改名破坏隐蔽契约（文件名、配置键、响应头、插件命名空间） | 启动失败或运行期怪象 | 三种大小写形态统一脚本替换；冒烟清单覆盖每个保留功能；Octop 保持原样运行可随时对照 |
| 物理删除误伤被核心引用的模块 | 启动失败或功能静默损坏 | 按第 6 节批次表分批删（每批一个功能域）→ git commit → 启动冒烟，删崩即回退；耦合不明先 grep 全部引用再动手 |
| 复制 venv 后 .exe shim 失效 | 命令行入口不可用 | 一律 `python -m` 方式启动；不依赖任何 .exe |
| 备用端口冲突 / 防火墙 | 服务起不来 | 8089 预检；绑定 127.0.0.1 不引入防火墙问题 |
| 施工误伤运行中的 Octop | 现有服务中断 | 全程只读 D:\Octop；新目录独立；不 kill PID 52980 |
| LGPL 三件套被修改后再分发 | 许可违约 | 约束： AusCode 不改动 psycopg/pynput/python-telegram-bot 源码 |
| 商标素材残留（mascot 图片、i18n 文案） | 侵权风险 | dashboard 目录整体删除 + i18n/静态文案清查作为验收项 |

---

## 10. 验收标准（Phase 4 逐项打勾）

1. `D:\AusCode` 内 `python -m auscode run` 一次启动成功，监听 `127.0.0.1:8089`
2. `/api/health` 200；`/api/docs`（Scalar）可打开——唯一"界面"
3. 无 Token 访问业务 API 被 401；带 `credential.txt` 中 Token 全部通过
4. 对话 API（REST + WS 流式）正常返回，模型来源为用户配置的 provider
5. 知识库：建库 → 上传文档 → 检索问答命中
6. 插件：列表可见、可启停、调用正常
7. 浏览器自动化：agent 可驱动 playwright 完成一次网页操作
8. 记忆与 cron：写入记忆可召回；建一个定时任务能触发
9. 重启服务后配置、记忆、知识库、Token 均持久
10. 已物理删除的功能路由（`/api/voice/*`、`/api/channels`、`/api/invites` 等）返回 404
11. 全局搜索 `octop`（不区分大小写）在 auscode 包与启动脚本中无业务残留（THIRD-PARTY-NOTICES 内的许可原文除外）
12. `D:\Octop` 现有服务（8088）全程未受影响

---

## 11. 决策记录（2026-09-15 已全部拍板）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 首启预配哪个模型 provider | 不预配，首启后经配置 API 自行接入（OpenAI 兼容 / Anthropic / Ollama 均支持） |
| 2 | 改名方案 | **A 完整重命名**（octop → auscode，三种大小写形态全局替换） |
| 3 | 鉴权 | **加密码**：首启自动生成长期 API Token 存 `credential.txt`，调用方持 Token 访问；无注册、无登录界面 |
| 4 | 接口说明书 | **开启**：`/api/docs`（Scalar），纯后端形态下唯一的可视化入口 |
| 5 | 瘦身方式 | **物理删除**：按第 6 节批次表删代码，git 分批提交可回退；TLS/backup/update 等横切组件一期停用、二期评估 |
| 6 | 项目目录 | `D:\AusCode` |

---

## 12. 附录

**关键路径**
- 壳层源码：`D:\Octop\venv\Lib\site-packages\octop\`（api/ cli/ dashboard/ i18n/ infra/）
- 装配根：`octop/launch.py`（OctopServer → build_app → uvicorn）；路由挂载：`octop/api/app.py`
- 配置：`octop/config.py`（`OctopConfig`，`OCTOP_*` 环境变量覆盖）
- 鉴权：`octop/api/middleware/jwt_auth.py` + `octop/api/deps.py`（豁免白名单 `is_jwt_exempt_request`）
- 内核：`orcakit_harness_agent` / `harness_gateway` / `harness_browser` / `harness_memory`（上游：github.com/TencentCloud/harness-agent）
- 参考启动脚本：`D:\Octop\octop-start.vbs`、`octop-stop.bat`

**术语**
- 内核 = harness-agent 系列包（agent 循环/工具/子代理/记忆/浏览器/网关）；壳层 = octop（API 服务 + 插件 + 知识库 + 用户体系）
- 套皮 = vendor 壳层代码并整体品牌化；vendor = 把依赖代码复制进自己仓库接管维护

---

## 13. 执行记录（2026-09-15 实际完成情况）

与计划的差异与补充事实（以本节为准）：

1. **布局调整**：源码不在 venv 内，放 `D:\AusCode\src\auscode`，venv site-packages 通过 `auscode.pth` 指向它（可 git 管理、可编辑安装）。**运行数据放 `D:\AusCode\data\`**（AUSCODE_HOME 指向它），与代码目录分离——因为 `auscode init --force` 会清空 home，绝不能指向项目根。
2. **改名先于裁剪执行**（原计划 Phase 1 裁剪、Phase 2 改名）：477 文件、3975 处替换（OCTOP_/Octop/octop 三形态），残留 0。工具：`tools/rename_octop_to_auscode.py`。
3. **物理裁剪实际范围**（git 历史可查）：dashboard 资源、`infra/{voice,mobile,desktop}`、`infra/gateway/{bot_creators,channels}`、路由 voice/channels/desktop/mobile/invites/auth_oidc/update、CLI `channel`/`update` 命令、`cli/support/feishu_creator.py`；同步摘除 `infra/server.py` 移动端探测、`infra/agents/manager.py` mobile 工具装配、`infra/browser/setup.py` 虚拟桌面注入。**保留**：`infra/db/repos/channels.py`（DB 层，与 migrations 纠缠）与内核 harness_gateway 的通用 ChannelManager（无注册入口后永久为空）；`infra/users/invites.py`+`db/repos/invites.py`（同上，API 面已删）。connectors 的 feishu-cli 是 MCP 工具连接器（非 IM 机器人），按决策保留。
4. **单用户落地**：`AUSCODE_HOME=D:\AusCode\data auscode init --yes`（环境变量传管理员账号）+ `tools/bootstrap_token.py` 用 DB 内 jwt 密钥签 10 年期 Token 写 `data/credential.txt`。`X-AusCode-Access-Token` 滑动续期保留。
5. **验收结果**（详见会话记录）：health/docs 200；无 Token 401、带 Token 200；voice/channels/desktop/invites 路由 404（openapi 确认 0 残留，共 293 条路由）；plugins/knowledge-bases/browser/cron/providers/connectors catalog/memory 全 200；CLI `auscode version`/`--help` 正常；重启后 Token、agent、配置全部持久。src 内 `octop` 字样 0 残留。
6. **已知事实**：RAG 本地向量模型目录（embedding_models）原安装即为空，RAG 首次使用时需按其配置拉取 embedding 服务/模型；默认未配 provider 时 agent 启动报 `no_models_configured`（预期），配置 provider 后即恢复；`src/auscode` 已随本项目 git 管理（首个 commit 为改名后基线）。
