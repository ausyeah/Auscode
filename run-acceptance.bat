@echo off
rem AusCode 一键验收：需服务已在 8089 运行（auscode-start.bat）
cd /d D:\AusCode
set "AUSCODE_HOME=D:\AusCode\data"
rem 中文控制台默认 GBK，验收脚本输出 ✅/❌ 需要 UTF-8
set "PYTHONIOENCODING=utf-8"
venv\Scripts\python.exe tools\acceptance.py
echo.
pause
