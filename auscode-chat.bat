@echo off
cd /d D:\AusCode
set "AUSCODE_HOME=D:\AusCode\data"
echo AusCode chat. Type your message, Enter to send. Ctrl+C to quit.
echo Default agent: main  Default model: grok-4.6
echo.
venv\Scripts\python.exe -m auscode chats repl --agent TV3AHW
pause
