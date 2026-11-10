"""Check a separate demo through confirmed completion; no live inference or public chain calls."""
import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3301'
assert base.startswith('http://127.0.0.1:'), 'Use a disposable local API.'

def get(path):
    with urllib.request.urlopen(base + path, timeout=15) as response:
        return json.load(response)

before = get('/api/state')
payload = json.dumps({'request_id': str(uuid.uuid4())}).encode()
request = urllib.request.Request(base + '/api/demo', data=payload, headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=15) as response:
    assert json.load(response)['status'] == 'running'
started = time.monotonic()
while True:
    result = get('/api/demo')
    if result['status'] != 'running':
        break
    assert time.monotonic() - started < 120, 'Demo did not finish in the check window.'
    time.sleep(1)
after = get('/api/state')
assert before == after, 'Ordinary world changed during demo.'
assert result['status'] == 'completed', result.get('error')
assert result['ticks'] == 70 and result['final_state']['world']['day'] == 7
assert result['world_id'] != before['environment']['world_id']
assert result['copper_supply'] == '5000'
rows = result['rows']
assert rows[0]['merchants'][0]['account']['balances']['copper'] == '6'
assert rows[1]['merchants'][0]['open'] is False
assert rows[2]['merchants'][0]['open'] is True
assert int(rows[0]['merchants'][0]['quotes'][0]['merchant_buys_at']) > int(rows[1]['merchants'][0]['quotes'][0]['merchant_buys_at'])
Path('.local/demo-confirmed.json').write_text(json.dumps(result, indent=2))
print(json.dumps({'status': result['status'], 'turns': result['ticks'], 'elapsed_ms': result['elapsed_ms'], 'within_target': result['within_target'], 'ordinary_world_unchanged': True, 'copper_supply': result['copper_supply']}), flush=True)
assert result['within_target'], 'Confirmed demo exceeded60 seconds (including initialization).'
