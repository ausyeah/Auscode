' AusCode 手动启动：后台静默启动 API 服务（监听 127.0.0.1:8089）
' 服务已在运行时本脚本报端口占用但不影响
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "D:\AusCode"
shell.Environment("PROCESS")("AUSCODE_HOME") = "D:\AusCode\data"
shell.Run "cmd /c ""D:\AusCode\venv\Scripts\python.exe"" -m auscode run --host 127.0.0.1 --port 8089", 0, False
