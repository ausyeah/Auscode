import sqlite3
con = sqlite3.connect('data/auscode.db')
print('threads now:')
for r in con.execute('SELECT thread_id FROM threads'):
    print(' ', r[0])
print('trajectory thread_ids:')
for r in con.execute('SELECT DISTINCT thread_id FROM trajectory_events'):
    print(' ', r[0])
