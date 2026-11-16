"""Tests for the Limitr Python SDK, against the real engine. Run: python -m pytest"""

import json
import threading
from datetime import datetime, timedelta, timezone

import pytest

import limitr
from limitr import Limitr

POLICY = """
policy: {
    credits: {
        req: { label: 'Request' }
        ai_token: { label: 'AI token', price: { amount: 0.00002 } }
        tok: { label: 'Token', price: { amount: 1 } }
        mb: { label: 'Megabyte', stof_units: 'MB' }
    }
    plans: {
        free: {
            default: true
            entitlements: {
                api: { limit: { credit: 'req', mode: 'hard', value: 10, resets: true, reset_sch: 'monthly:1' } }
                chat: { estimate_basis: 'input', limit: { credit: 'ai_token', mode: 'soft', value: 1000 } }
                spend: { limit: { credit: 'tok', mode: 'soft', value: 0 } }
                storage: { limit: { credit: 'mb', mode: 'hard', value: '1000MB' } }
                burst: { limit: { credit: 'req', mode: 'hard', value: 1000, governor_enabled: true, governor_capacity: 2, governor_refill_rate: 0.000001 } }
                killed: { enabled: false }
                pool: { scope: 'org', limit: { credit: 'req', mode: 'hard', value: 100 } }
            }
        }
        pro: {
            entitlements: {
                api: { limit: { credit: 'req', mode: 'hard', value: 1000 } }
                sso: {}
            }
        }
    }
}
"""


@pytest.fixture
def policy():
    return Limitr(POLICY)


# -- loading -------------------------------------------------------------------------------------------------------

def test_loads_and_validates(policy):
    assert policy.valid() == (True, '')
    assert policy.version() == limitr.__version__   # the compiled engine matches the package


def test_invalid_policy_raises():
    with pytest.raises(ValueError):
        Limitr("policy: { plans: { p: { entitlements: { a: { limit: { credit: 'nope', value: 1 } } } } } }")


def test_loads_yaml_and_dicts():
    yaml = Limitr("""
policy:
  credits:
    req: { label: Request }
  plans:
    free:
      default: true
      entitlements:
        api: { limit: { credit: req, value: 2 } }
""", 'yaml')
    yaml.ensure_customer('y')
    assert yaml.allow('y', 'api', 2) and not yaml.allow('y', 'api', 1)

    from_dict = Limitr({'policy': {'credits': {'req': {}}, 'plans': {'free': {'default': True, 'entitlements': {'api': {'limit': {'credit': 'req', 'value': 1}}}}}}})
    from_dict.ensure_customer('d')
    assert from_dict.allow('d', 'api', 1) and not from_dict.allow('d', 'api', 1)


# -- customers -----------------------------------------------------------------------------------------------------

def test_customers(policy):
    assert policy.ensure_customer('ada', metadata={'email': 'ada at example'})
    assert not policy.ensure_customer('ada')
    assert not policy.ensure_customer('bad.id')                 # IDs can't contain a period
    ada = policy.customer('ada')
    assert ada['id'] == 'ada' and ada['plan'] == 'free'
    assert policy.customer_metadata('ada') == {'email': 'ada at example'}
    assert policy.set_customer_plan('ada', 'pro')
    assert policy.limit('ada', 'api') == 1000
    assert policy.add_alt_id('ada', 'cus_123')
    assert policy.allow('cus_123', 'api', 1)
    assert policy.value('ada', 'api') == 1
    assert 'ada' in policy.customers()
    assert policy.remove_customer('ada') and policy.customer('ada') is None


def test_state_round_trips(policy):
    policy.ensure_customer('ada')
    policy.allow('ada', 'api', 4)
    saved = json.loads(json.dumps(policy.customers()))           # what an app would store
    restored = Limitr(POLICY)
    restored.load_customers(saved)
    assert restored.value('ada', 'api') == 4
    assert restored.allow('ada', 'api', 6) and not restored.allow('ada', 'api', 1)


# -- metering and decisions ----------------------------------------------------------------------------------------

def test_allow_and_check(policy):
    policy.ensure_customer('ada')
    assert policy.check('ada', 'api', 10)
    assert policy.value('ada', 'api') == 0                       # check changes nothing
    assert policy.allow('ada', 'api', 8)
    assert not policy.allow('ada', 'api', 5)
    assert policy.remaining('ada', 'api') == 2
    assert policy.allowance('ada', 'api') == 2
    assert policy.resets('ada', 'api') is not None
    assert policy.allow('ada', 'storage', '500MB') and policy.value('ada', 'storage') == 500


def test_detail_reasons(policy):
    policy.ensure_customer('ada')
    policy.allow('ada', 'api', 8)
    d = policy.check('ada', 'api', 5, detail=True)
    assert d['allowed'] is False and d['reason'] == 'limit'
    assert d['remaining'] == 2 and d['limit'] == 10 and d['access'] == 'plan'
    ok = policy.allow('ada', 'api', 1, detail=True)
    assert ok['allowed'] and ok['reason'] is None and ok['used'] == 9
    assert policy.check('nobody', 'api', 1, detail=True)['reason'] == 'no_customer'
    assert policy.check('ada', 'teleport', detail=True)['reason'] == 'not_entitled'
    assert policy.check('ada', 'killed', detail=True)['reason'] == 'disabled'
    assert policy.check('ada', 'pool', 1, detail=True)['reason'] == 'no_scope'
    policy.take_entitlement('ada', 'api')
    assert policy.check('ada', 'api', 1, detail=True)['reason'] == 'taken'


def test_caps_and_governor(policy):
    policy.ensure_customer('ada')
    assert policy.add_customer_cap('ada', 5, cap_id='budget', send_events=False)['id'] == 'budget'
    d = policy.allow('ada', 'spend', 6, False, detail=True)
    assert d['reason'] == 'cap' and d['cap'] == 'budget'
    assert policy.allow('ada', 'spend', 5, False)
    assert policy.customer_cap('ada', 'budget')['meter_value'] == 5

    assert policy.allow('ada', 'burst', 2, False)
    g = policy.check('ada', 'burst', 1, detail=True)
    assert g['reason'] == 'governor' and g['available'] < 1


def test_give_take_and_features(policy):
    policy.ensure_customer('ada')
    assert 'sso' not in policy.features('ada')
    assert policy.give_entitlement('ada', 'sso')
    assert policy.check('ada', 'sso')
    assert policy.entitlement_source('ada', 'sso')['access'] == 'given'
    assert policy.restore_entitlement('ada', 'sso') and not policy.check('ada', 'sso')
    assert policy.features('nobody') is None


def test_expiry_and_periods(policy):
    policy.ensure_customer('ada')
    assert policy.set_customer_expires('ada', datetime.now(timezone.utc) - timedelta(seconds=1))
    assert policy.check('ada', 'api', 1, detail=True)['reason'] == 'expired'
    assert policy.set_customer_expires('ada', None)
    start = datetime.now(timezone.utc)
    assert policy.set_customer_period('ada', start, start + timedelta(days=30))


# -- reservations and estimates ------------------------------------------------------------------------------------

def test_reserve_settle_release(policy):
    policy.ensure_customer('ada')
    hold = policy.reserve('ada', 'api', 7)
    assert hold and policy.held('ada', 'api') == 7
    assert policy.check('ada', 'api', 5, detail=True)['reason'] == 'held'
    assert policy.settle('ada', 'api', hold, 6, False)
    assert policy.value('ada', 'api') == 6 and policy.held('ada', 'api') == 0
    second = policy.reserve('ada', 'api', 4)
    assert policy.release('ada', 'api', second) and policy.value('ada', 'api') == 6


def test_holds_spend_the_governor(policy):
    policy.ensure_customer('ada')
    assert policy.reserve('ada', 'burst', 1) and policy.reserve('ada', 'burst', 1)
    assert policy.reserve('ada', 'burst', 1) is None
    assert not policy.allow('ada', 'burst', 1)


def test_estimates_learn(policy):
    policy.ensure_customer('ada')
    assert policy.estimate('ada', 'chat', {'input': 100}) is None
    for size in (100, 200, 300, 400, 500, 600):
        policy.observe('ada', 'chat', size * 2, {'input': size})
    est = policy.estimate('ada', 'chat', {'input': 1000}, quantile=0.5)
    assert est is not None and est['samples'] >= 6 and est['value'] > 1000


# -- events --------------------------------------------------------------------------------------------------------

def test_events_arrive_as_dicts(policy):
    seen = []
    policy.add_handler('test', lambda name, value: seen.append((name, value)))
    policy.ensure_customer('ada')
    policy.allow('ada', 'api', 3, {'route': '/v1/chat'})
    changed = [v for n, v in seen if n == 'meter-changed']
    assert changed and changed[-1]['entitlement'] == 'api' and changed[-1]['event_data'] == {'route': '/v1/chat'}
    assert changed[-1]['meter']['value'] == 3


def test_a_failing_handler_never_breaks_the_call(policy, caplog):
    def broken(name, value):
        raise RuntimeError('boom')
    policy.add_handler('broken', broken)
    policy.ensure_customer('ada')
    assert policy.allow('ada', 'api', 1)
    assert policy.value('ada', 'api') == 1
    assert 'boom' in caplog.text or 'broken' in caplog.text
    assert policy.remove_handler('broken')


# -- the rest ------------------------------------------------------------------------------------------------------

def test_exchange_and_credits(policy):
    assert policy.set_exchange_pair('euro', 1.16, 'usd')
    assert policy.exchange_pair('euro') == {'value': 1.16, 'currency': 'usd'}
    assert policy.credit('req')['label'] == 'Request'
    assert policy.credit_exchange('tok', 'rune', 2) == 2
    assert policy.remove_exchange_pair('euro') and policy.exchange_pair('euro') is None


def test_plans(policy):
    assert policy.plan('pro')['name'] == 'pro'
    assert policy.default_plan()['name'] == 'free'
    assert policy.set_plan('team', "entitlements: { api: { limit: { credit: 'req', value: 50 } } }")
    assert policy.limit('team', 'api') == 50
    assert policy.delete_plan('team') and policy.plan('team', False) is None


def test_threads_never_overspend(policy):
    policy.ensure_customer('ada')
    results = []

    def worker():
        for _ in range(10):
            results.append(policy.allow('ada', 'api', 1))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(True) == 10 and policy.value('ada', 'api') == 10


def test_stacking_recipe(policy):
    """Tutorial chapter 8's order: hold what you'll know afterwards, count what you know now, release on refusal."""
    p = Limitr("""
policy: {
    credits: { report: { label: 'Report' } ai_token: { label: 'AI token', price: { amount: 0.00002 } } }
    plans: { starter: { default: true, entitlements: {
        reports: { limit: { credit: 'report', value: 3, resets: true, reset_sch: 'monthly:1' } }
        report_tokens: { limit: { credit: 'ai_token', mode: 'soft', value: 20_000, resets: true } }
    } } }
}""")
    p.ensure_customer('ada')

    def generate_report(customer):
        hold = p.reserve(customer, 'report_tokens', 10_000)
        if not hold:
            return 'out of tokens'
        if not p.allow(customer, 'reports', 1):
            p.release(customer, 'report_tokens', hold)
            return 'out of reports'
        p.settle(customer, 'report_tokens', hold, 8_000)
        return 'ok'

    assert [generate_report('ada') for _ in range(4)] == ['ok', 'ok', 'ok', 'out of reports']
    assert p.value('ada', 'reports') == 3 and p.value('ada', 'report_tokens') == 24_000 and p.held('ada', 'report_tokens') == 0


def test_events_reach_the_right_instance():
    """Two policies in one thread each get only their own events, from any thread."""
    a, b = Limitr(POLICY), Limitr(POLICY)
    seen_a, seen_b = [], []
    a.add_handler('a', lambda n, v: seen_a.append(v) if n == 'meter-changed' else None)
    b.add_handler('b', lambda n, v: seen_b.append(v) if n == 'meter-changed' else None)
    a.ensure_customer('ada')
    b.ensure_customer('bo')
    a.allow('ada', 'api', 1)
    b.allow('bo', 'api', 2)
    a.allow('ada', 'api', 3)
    worker = threading.Thread(target=lambda: b.allow('bo', 'api', 4))
    worker.start()
    worker.join()
    assert [e['customer']['id'] for e in seen_a] == ['ada', 'ada']
    assert [e['customer']['id'] for e in seen_b] == ['bo', 'bo']

def test_a_dropped_policy_is_freed():
    """The engine's event handler holds its policy weakly, so a policy nothing else holds is freed."""
    import gc
    import weakref
    policy = Limitr(POLICY)
    policy.add_handler('h', lambda n, v: None)
    policy.ensure_customer('ada')
    policy.allow('ada', 'api', 1)
    ref = weakref.ref(policy)
    del policy
    gc.collect()
    assert ref() is None
