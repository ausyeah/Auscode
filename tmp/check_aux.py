import json, sqlite3
con = sqlite3.connect('data/auscode.db')
r = con.execute("SELECT config_json FROM agents WHERE agent_id='TV3AHW'").fetchone()
cfg = json.loads(r[0])
mem = cfg.get('memory') or {}
print('memory.aux_model in DB:', mem.get('aux_model'))
