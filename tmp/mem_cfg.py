import json, sqlite3
con = sqlite3.connect('data/auscode.db')
con.row_factory = sqlite3.Row
r = con.execute("SELECT config_json FROM agents WHERE agent_id='TV3AHW'").fetchone()
cfg = json.loads(r['config_json'])
print(json.dumps(cfg.get('memory'), ensure_ascii=False, indent=2))
print('default_model:', cfg.get('default_model'))
