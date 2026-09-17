import json, sqlite3
con = sqlite3.connect('data/auscode.db')
con.row_factory = sqlite3.Row
r = con.execute("SELECT config_json FROM agents WHERE agent_id='TV3AHW'").fetchone()
cfg = json.loads(r['config_json'])
disabled = cfg.get('skills_disabled') or []
print('skills_disabled (DB raw):', json.dumps(disabled, ensure_ascii=False))
skills_listed = ['备忘录', '提醒事项', '架构图', 'ASCII 艺术', 'ASCII 视频']
for s in skills_listed:
    print(f'  {s!r} in disabled? {s in disabled}')
# repr each to spot invisible chars
print('repr:')
for s in disabled:
    print('  ', repr(s))
