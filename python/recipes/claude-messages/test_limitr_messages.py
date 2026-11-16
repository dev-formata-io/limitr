"""Tests for the recipe (limitr_messages.py), against the real engine and a fake Anthropic client. Run: pytest"""
from types import SimpleNamespace

import pytest
from limitr import Limitr

from limitr_messages import TOKENS, decide_tool_use, governed_create

POLICY = '''
policy: {
    credits: {
        call: { label: 'Tool call' }
        ai_token: { label: 'AI token' }
    }
    plans: {
        starter: {
            default: true
            entitlements: {
                weather: { limit: { credit: 'call', mode: 'hard', value: 1 } }
                ai_tokens: { limit: { credit: 'ai_token', mode: 'hard', value: 1000 } }
            }
        }
        pro: {
            entitlements: {
                weather: { limit: { credit: 'call', mode: 'hard', value: 100 } }
                refunds: {}
                ai_tokens: { limit: { credit: 'ai_token', mode: 'soft', value: 1000 } }
            }
        }
    }
}
'''


class FakeMessages:
    """client.messages: counts every request at 100 input tokens and answers with 50 output tokens."""

    def __init__(self, fail=False):
        self.fail, self.created = fail, []

    def count_tokens(self, **request):
        return SimpleNamespace(input_tokens=100)

    def create(self, **request):
        self.created.append(request)
        if self.fail:
            raise RuntimeError('overloaded')
        usage = SimpleNamespace(input_tokens=100, output_tokens=50, cache_creation_input_tokens=None, cache_read_input_tokens=None)
        return SimpleNamespace(model=request['model'], content=[], usage=usage)


def setup(plan='starter', fail=False):
    policy = Limitr(POLICY)
    policy.ensure_customer('ada', plan)
    messages = FakeMessages(fail)
    return policy, SimpleNamespace(messages=messages), messages


TOOLS = [{'name': 'get_weather'}, {'name': 'issue_refund'}, {'name': 'search'}]


def test_offers_only_the_tools_the_plan_has():
    policy, client, messages = setup()
    governed_create(policy, client, 'ada', model='m', max_tokens=4096, messages=[], tools=TOOLS)
    assert [t['name'] for t in messages.created[0]['tools']] == ['get_weather', 'search']


def test_caps_max_tokens_holds_and_records():
    policy, client, messages = setup()
    res = governed_create(policy, client, 'ada', model='m', max_tokens=4096, messages=[])
    assert 'message' in res
    assert messages.created[0]['max_tokens'] == 900   # 1,000 left, less the 100 input tokens
    assert policy.value('ada', TOKENS) == 150 and policy.held('ada', TOKENS) == 0


def test_soft_limits_never_cap():
    policy, client, messages = setup('pro')
    governed_create(policy, client, 'ada', model='m', max_tokens=4096, messages=[])
    assert messages.created[0]['max_tokens'] == 4096


def test_refuses_with_the_reason():
    policy, client, messages = setup()
    policy.allow('ada', TOKENS, 950)
    res = governed_create(policy, client, 'ada', model='m', max_tokens=10, messages=[])
    assert res['refused'].startswith('ai_tokens limit reached') and messages.created == []


def test_an_api_error_releases_the_hold():
    policy, client, _ = setup(fail=True)
    with pytest.raises(RuntimeError):
        governed_create(policy, client, 'ada', model='m', max_tokens=10, messages=[])
    assert policy.held('ada', TOKENS) == 0 and policy.value('ada', TOKENS) == 0


def test_decides_tool_uses():
    policy, _, _ = setup()
    use = SimpleNamespace(type='tool_use', name='get_weather', id='toolu_1', input={})
    assert decide_tool_use(policy, 'ada', use) is None
    refused = decide_tool_use(policy, 'ada', use)
    assert refused['type'] == 'tool_result' and refused['tool_use_id'] == 'toolu_1' and refused['is_error'] is True
    assert refused['content'].startswith('weather limit reached')
    assert decide_tool_use(policy, 'ada', SimpleNamespace(name='search', id='toolu_2')) is None
