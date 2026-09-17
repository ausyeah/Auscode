import json, sqlite3, urllib.request

token = [l.strip() for l in open('data/credential.txt', encoding='utf-8').read().splitlines() if l.strip().startswith('eyJ')][0]
req = urllib.request.Request('http://127.0.0.1:8089/api/agents/TV3AHW/skills')
req.add_header('Authorization', 'Bearer ' + token)
data = json.loads(urllib.request.urlopen(req, timeout=15).read().decode())

con = sqlite3.connect('data/auscode.db')
cfg = json.loads(con.execute("SELECT config_json FROM agents WHERE agent_id='TV3AHW'").fetchone()[0])
disabled = set(cfg.get('skills_disabled') or [])
print('DB disabled set:', disabled)
print()
print('API reported enabled state vs DB disabled set:')
for sk in data:
    name = sk.get('name') or sk.get('slug')
    en = sk.get('enabled')
    if not en or name in disabled:
        print(f'  name={name!r} enabled={en} in_disabled={name in disabled}')
