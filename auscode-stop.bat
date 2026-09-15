@echo off
rem AusCode 停止：结束占用 8089 端口的服务进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8089 ^| findstr LISTENING') do taskkill /PID %%a /F /T >nul 2>&1
echo AusCode 已停止
pause
