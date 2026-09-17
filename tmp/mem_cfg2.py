import json, sqlite3
con = sqlite3.connect('data/auscode.db')
con.row_factory = sqlite3.Row
r = con.execute("SELECT config_json FROM agents WHERE agent_id='TV3AHW'").fetchone()
cfg = json.loads(r['config_json'])
print('=== full config keys ===')
for k, v in cfg.items():
    s = json.dumps(v, ensure_ascii=False)
    print(f'{k}: {s[:120]}')
print()
print('=== providers ===')
for r in con.execute("SELECT id, name, models_json FROM providers"):
    print(r['id'], r['name'], r['models_json'][:200])
