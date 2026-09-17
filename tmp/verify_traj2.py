import json, urllib.request

token = [l.strip() for l in open('data/credential.txt', encoding='utf-8').read().splitlines() if l.strip().startswith('eyJ')][0]

def call(path):
    req = urllib.request.Request('http://127.0.0.1:8089' + path, method='GET')
    req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode('utf-8')
    except Exception as e:
        return 'ERR', str(e)

# The real dashboard thread (has history)
for tid in ['thr_01M2NAM6VWKDD77CJZCFJJKDQG', 'thr_01M2PXFFJG4E0Y6PRY5W9E2X23']:
    s, b = call(f'/api/agents/TV3AHW/threads/{tid}/trajectory')
    try:
        data = json.loads(b)
        evs = data.get('events', [])
        kinds = [e['kind'] for e in evs]
        print(f'{tid} -> {s}, events={len(evs)}, kinds={kinds[:8]}')
    except Exception as e:
        print(f'{tid} -> {s}, parse err: {b[:200]}')
