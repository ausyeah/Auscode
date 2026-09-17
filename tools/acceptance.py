"""AusCode 一键验收脚本 — 按 docs/PLAN.md 第 10 节自动执行可机检项。

用法（任选其一）：
    双击 D:\\AusCode\\run-acceptance.bat
    或: AUSCODE_HOME=D:/AusCode/data venv/Scripts/python.exe tools/acceptance.py

输出逐项 ✅/❌ 与汇总；退出码 0=全过，1=有失败。需服务已在 8089 运行。

安全说明：本脚本是固定目标的本机验收工具，只允许请求下方 ALLOWED_BASE 这个
写死的 127.0.0.1 地址；路径必须以 / 开头，且禁止跟随任何重定向。
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

# 中文 Windows 控制台默认 GBK，打印 ✅/❌ 会 UnicodeEncodeError；强制 UTF-8 输出。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HOME = Path(__file__).resolve().parent.parent
ALLOWED_BASE = "http://127.0.0.1:8089"  # 唯一允许的目标（本机验收）
ALLOWED_HOST = "127.0.0.1"
ALLOWED_PORT = 8089
TOKEN_FILE = HOME / "data" / "credential.txt"

results: list[tuple[bool, str, str]] = []  # (pass, name, detail)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def load_token() -> str:
    for line in TOKEN_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("eyJ"):
            return line
    raise SystemExit(f"错误：{TOKEN_FILE} 中未找到 Token（形如 eyJ...）")


def call(path: str, *, token: str | None = None, method: str = "GET", body: dict | None = None):
    # SSRF 防护：路径白名单校验 + 固定 host/port，禁止重定向离开目标。
    if not path.startswith("/") or "\\" in path or ".." in path:
        raise ValueError(f"非法验收路径: {path!r}")
    url = ALLOWED_BASE + path
    host = urllib.request.urlparse(url).hostname
    port = urllib.request.urlparse(url).port
    if urllib.request.urlparse(url).scheme != "http" or host != ALLOWED_HOST or port != ALLOWED_PORT:
        raise ValueError(f"目标越界: {url!r}")

    req = urllib.request.Request(url, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with _OPENER.open(req, data=data, timeout=10) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def check(name: str, expected: str, actual: int | str, ok: bool, detail: str = "") -> None:
    mark = "✅" if ok else "❌"
    results.append((ok, name, detail))
    line = f"{mark} {name}  （期望 {expected}，实际 {actual}）"
    if detail and not ok:
        line += f"\n    └─ {detail}"
    print(line)


def main() -> None:
    token = load_token()
    print(f"目标: {ALLOWED_BASE}    Token: ...{token[-12:]}\n")

    status, _ = call("/api/health")
    check("1. 健康检查", "200", status, status == 200)

    status, _ = call("/api/docs")
    check("2. 接口说明书页(Scalar)", "200", status, status == 200)
    status, raw = call("/api/openapi.json")
    routes = 0
    if status == 200:
        try:
            routes = len(json.loads(raw)["paths"])
        except Exception:
            pass
    check("2b. OpenAPI 规范", "200 且路由数>0", f"{status}/{routes}条", status == 200 and routes > 0)

    status, _ = call("/api/users")
    check("3a. 无 Token 被拒", "401", status, status == 401)

    status, _ = call("/api/users", token=token)
    check("3b. 带 Token 通过", "200", status, status == 200)

    status, raw = call("/api/agents", token=token)
    agent_id = ""
    ok = status == 200
    detail = ""
    if ok:
        agents = json.loads(raw)
        if not agents:
            ok = False
            detail = "没有任何 agent，请先创建（POST /api/agents）"
        else:
            agent_id = agents[0].get("agent_id", "")
            detail = f"agent={agent_id}"
    check("5. Agent 列表可用", "200 且≥1个agent", status, ok, detail)

    for name, path in [
        ("6a. 语音功能已删", "/api/voice/providers"),
        ("6b. IM渠道已删", "/api/channels"),
        ("6c. 桌面控制已删", "/api/desktop/status"),
        ("6d. 邀请码已删", "/api/auth/invite/validate"),
        ("6e. 手机遥控已删", "/api/mobile/status"),
    ]:
        status, _ = call(path, token=token)
        check(name, "404", status, status == 404)

    status, _ = call("/api/plugins", token=token)
    check("7. 插件系统", "200", status, status == 200)

    status, _ = call("/api/knowledge-bases", token=token)
    check("8. 知识库 RAG 接口", "200", status, status == 200)

    status, _ = call("/api/browser/env-status", token=token)
    check("9. 浏览器自动化接口", "200", status, status == 200)

    if agent_id:
        status, _ = call(f"/api/agents/{agent_id}/cron", token=token)
        check("10. 定时任务接口", "200", status, status == 200)
        status, _ = call(
            f"/api/agents/{agent_id}/memory/atoms/list", token=token, method="POST", body={}
        )
        check("11. 长期记忆接口", "200", status, status == 200)

    status, raw = call("/api/providers", token=token)
    provider_hint = ""
    if status == 200:
        try:
            providers = json.loads(raw)
            if isinstance(providers, dict):
                providers = providers.get("providers", providers.get("items", []))
            provider_hint = (
                f"共 {len(providers)} 个 provider 配置" if providers else "尚未配置任何模型 provider"
            )
        except Exception:
            pass
    check("12. 模型配置接口", "200", status, status == 200, provider_hint)
    if provider_hint and "尚未" in provider_hint:
        print("\n⚠️  尚未配置模型：请在 /api/docs 中调 POST /api/providers 配置后，")
        print("    才能做「真实对话」和「浏览器自动化」这两项人工验收。")

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n汇总: {passed}/{len(results)} 项通过")
    if passed == len(results):
        print("全部机检项通过。剩余人工项见 README「验收」或 PLAN.md 第 10 节。")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
