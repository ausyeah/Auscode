"""Open the local AusCode UI. Target is hardcoded to 127.0.0.1:8089."""

from __future__ import annotations

import ctypes
import sys
import time
import urllib.error
import urllib.request
import webbrowser

LOCAL_UI = "http://127.0.0.1:8089/"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


def wait_ready() -> None:
    opener = urllib.request.build_opener(_NoRedirect)
    for _ in range(40):
        try:
            with opener.open(LOCAL_UI, timeout=1.5) as resp:
                if resp.status in (200, 307):
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(0.4)
    raise SystemExit("AusCode 服务未启动，请先运行 auscode-start.bat")


def main() -> None:
    wait_ready()
    if sys.platform == "win32":
        ctypes.windll.user32.ShowWindow(ctypes.windll.kernel32.GetConsoleWindow(), 0)
    webbrowser.open(LOCAL_UI)


if __name__ == "__main__":
    main()
