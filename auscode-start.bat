@echo off
cd /d D:\AusCode
set "AUSCODE_HOME=D:\AusCode\data"
start "AusCode" /MIN venv\Scripts\python.exe -m auscode run --host 127.0.0.1 --port 8089
timeout /t 3 /nobreak >nul
start http://127.0.0.1:8089/api/docs
echo AusCode started: http://127.0.0.1:8089/api/docs
echo Stop with auscode-stop.bat
pause
