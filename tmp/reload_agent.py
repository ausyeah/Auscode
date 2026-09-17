import json, urllib.request

token = [l.strip() for l in open('data/credential.txt', encoding='utf-8').read().splitlines() if l.strip().startswith('eyJ')][0]

def call(path, method='POST', body=None):
    req = urllib.request.Request('http://127.0.0.1:8089' + path, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    if body is not None:
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(body, ensure_ascii=False).encode()
    else:
        data = b'{}'
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return r.status, r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')
    except Exception as e:
        return 'ERR', str(e)

s, b = call('/api/agents/TV3AHW/reload')
print('reload agent ->', s, b[:300])

# Confirm config in DB picked up memory section
import sqlite3
con = sqlite3.connect('data/auscode.db')
cfg = json.loads(con.execute("SELECT config_json FROM agents WHERE agent_id='TV3AHW'").fetchone()[0])
print('memory section now:', json.dumps(cfg.get('memory'), ensure_ascii=False))
