"""
A live check against Limitr Cloud (not part of the test suite): python tests/live_cloud.py

Needs LIMITR_TOKEN (a Limitr Cloud API token, best a test-mode key) and a published policy with an entitlement to
meter. Optional: LIMITR_ENTITLEMENT (default 'api'), LIMITR_CUSTOMER (default 'limitr-py-live-check').
"""

import os
import sys
import time

from limitr import Limitr

token = os.environ.get('LIMITR_TOKEN')
if not token:
    sys.exit('set LIMITR_TOKEN to a Limitr Cloud API token')
entitlement = os.environ.get('LIMITR_ENTITLEMENT', 'api')
customer = os.environ.get('LIMITR_CUSTOMER', 'limitr-py-live-check')

start = time.time()
policy = Limitr.cloud(token)
if policy is None:
    sys.exit('Limitr Cloud refused the token')
print(f'connected in {time.time() - start:.2f}s, policy version {policy.version()}')

events = []
policy.add_handler('live', lambda name, value: events.append(name))
created = policy.ensure_customer(customer)
print(f'customer {customer}:', 'created here' if created else 'loaded from Cloud')
before = policy.value(customer, entitlement)
d = policy.allow(customer, entitlement, 1, detail=True)
print('allow 1 ->', d.get('allowed'), d.get('reason'), f"used {before} -> {d.get('used')}, remaining {d.get('remaining')}")
policy.flush_cloud_batch()
time.sleep(1)
print('events:', sorted(set(events)))
policy.close()
print('closed: check the customer in Limitr Cloud, and run this again to see its usage come back from Cloud')
