import json, sqlite3, urllib.request

token = [l.strip() for l in open('data/credential.txt', encoding='utf-8').read().splitlines() if l.strip().startswith('eyJ')][0]

def call(path, method='GET', body=None):
    req = urllib.request.Request('http://127.0.0.1:8089' + path, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    if body is not None:
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(body).encode()
    else:
        data = None
    try:
        with urllib.request.urlopen(req, data=data, timeout=20) as r:
            return r.status, r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')
    except Exception as e:
        return 'ERR', str(e)

con = sqlite3.connect('data/auscode.db')
tid = con.execute("SELECT thread_id FROM threads ORDER BY created_at DESC LIMIT 1").fetchone()[0]
s, b = call(f'/api/agents/TV3AHW/threads/{tid}/trajectory')
data = json.loads(b)
print(f'trajectory for {tid} -> {s}, events={len(data.get("events", []))}')

# count before/after via DB (service was restarted; CLI turn should NOT have written)
n = con.execute('SELECT COUNT(*) FROM trajectory_events').fetchone()[0]
print('trajectory_events total:', n)
