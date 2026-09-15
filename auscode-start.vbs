' ASCII-only: WSH cannot parse UTF-8 Chinese comments.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "D:\AusCode"
shell.Environment("PROCESS")("AUSCODE_HOME") = "D:\AusCode\data"
shell.Run "cmd /c ""D:\AusCode\venv\Scripts\python.exe"" -m auscode run --host 127.0.0.1 --port 8089", 0, False
WScript.Sleep 3000
shell.Run "cmd /c ""D:\AusCode\venv\Scripts\python.exe"" ""D:\AusCode\tools\desktop.py""", 0, False
