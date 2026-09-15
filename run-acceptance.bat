@echo off
rem AusCode 一键验收：需服务已在 8089 运行（auscode-start.vbs）
cd /d D:\AusCode
set "AUSCODE_HOME=D:\AusCode\data"
venv\Scripts\python.exe tools\acceptance.py
echo.
pause
