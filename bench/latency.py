# How long one allow() and one check() take, in process (Python).
#
#   pip install limitr && python latency.py
import time
from limitr import Limitr
P = """policy: { credits: { ai_token: {} } plans: { team: { default: true entitlements: { api: { limit: { credit: 'ai_token', mode: 'soft', value: 1000000000 } } } } } }"""
l = Limitr(P); l.ensure_customer('acme')
for _ in range(2000): l.allow('acme', 'api', 10)
for fn in ('allow', 'check'):
    t = []
    for _ in range(20000):
        s = time.perf_counter(); getattr(l, fn)('acme', 'api', 10); t.append((time.perf_counter() - s) * 1000)
    t.sort(); print(f"{fn}: p50 {t[len(t)//2]:.3f} ms, p99 {t[int(len(t)*.99)]:.3f} ms (Python)")
