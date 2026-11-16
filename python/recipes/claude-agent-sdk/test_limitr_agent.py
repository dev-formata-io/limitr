"""Tests for the recipe (limitr_agent.py), against the real engine and the hooks' real input shapes. Run: pytest"""
import asyncio

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, HookMatcher, TextBlock
from limitr import Limitr

from limitr_agent import TOKENS, governed, metered, why

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
                shell: { limit: { credit: 'call', mode: 'hard', value: 2 } }
                agent_tokens: { limit: { credit: 'ai_token', mode: 'hard', value: 1000 } }
            }
        }
        pro: {
            entitlements: {
                shell: { limit: { credit: 'call', mode: 'hard', value: 100 } }
                web_search: { limit: { credit: 'call', mode: 'hard', value: 100 } }
                refunds: {}
                agent_tokens: { limit: { credit: 'ai_token', mode: 'hard', value: 1000000 } }
            }
        }
    }
}
'''

BASE = {'session_id': 's', 'transcript_path': '/tmp/t.jsonl', 'cwd': '/tmp'}


def pre(tool):
    return {**BASE, 'hook_event_name': 'PreToolUse', 'tool_name': tool, 'tool_input': {}, 'tool_use_id': f'tu_{tool}'}


BATCH = {**BASE, 'hook_event_name': 'PostToolBatch', 'tool_calls': []}


def hook(options, event):
    return options.hooks[event][-1].hooks[0]


def run(coro):
    return asyncio.run(coro)


def engine(plan='starter'):
    policy = Limitr(POLICY)
    policy.ensure_customer('ada', plan)
    return policy


def assistant(id, usage):
    return AssistantMessage(content=[TextBlock('ok')], model='claude-sonnet-5-5', usage=usage, message_id=id)


async def collect(policy, messages):
    async def stream():
        for m in messages:
            yield m
    return [m async for m in metered(policy, 'ada', stream())]


def test_hides_tools_the_plan_lacks():
    assert set(governed(engine(), 'ada').disallowed_tools) == {'WebSearch', 'mcp__billing__refund'}
    assert governed(engine('pro'), 'ada').disallowed_tools == []


def test_keeps_your_options_and_hooks():
    async def mine(input, tool_use_id, context):
        return {}
    options = ClaudeAgentOptions(model='claude-sonnet-5-5', disallowed_tools=['Write'],
                                 hooks={'PreToolUse': [HookMatcher(hooks=[mine])]})
    out = governed(engine(), 'ada', options)
    assert out.model == 'claude-sonnet-5-5'
    assert out.disallowed_tools[0] == 'Write' and 'WebSearch' in out.disallowed_tools
    assert out.hooks['PreToolUse'][0].hooks[0] is mine and len(out.hooks['PreToolUse']) == 2
    assert options.hooks['PreToolUse'] == [options.hooks['PreToolUse'][0]]   # the caller's options are unchanged


def test_decides_and_counts_tool_calls():
    policy = engine()
    pre_tool_use = hook(governed(policy, 'ada'), 'PreToolUse')
    assert run(pre_tool_use(pre('Bash'), 'tu_Bash', None)) == {}
    assert run(pre_tool_use(pre('Bash'), 'tu_Bash', None)) == {}
    denied = run(pre_tool_use(pre('Bash'), 'tu_Bash', None))['hookSpecificOutput']
    assert denied['hookEventName'] == 'PreToolUse' and denied['permissionDecision'] == 'deny'
    assert denied['permissionDecisionReason'].startswith('shell limit reached')
    assert policy.value('ada', 'shell') == 2
    assert run(pre_tool_use(pre('Read'), 'tu_Read', None)) == {}   # not governed


def test_meters_each_response_once_and_stops_the_run():
    policy = engine()
    post_tool_batch = hook(governed(policy, 'ada'), 'PostToolBatch')
    assert run(post_tool_batch(BATCH, None, None)) == {}
    usage = {'input_tokens': 500, 'cache_creation_input_tokens': 100, 'cache_read_input_tokens': None, 'output_tokens': 300}
    out = run(collect(policy, [assistant('msg_1', usage), assistant('msg_1', usage), assistant('msg_2', usage)]))
    assert len(out) == 3
    assert policy.value('ada', TOKENS) == 1800   # two responses, past the hard limit: they already happened
    stop = run(post_tool_batch(BATCH, None, None))
    assert stop['continue_'] is False and stop['stopReason'].startswith('agent_tokens limit reached')


def test_why_names_the_reason():
    assert why({'entitlement': 'shell', 'reason': 'governor'}) == 'shell is rate limited, try again shortly'
    assert why({'entitlement': 'x', 'reason': 'cap', 'cap': 'budget'}) == 'spend cap reached (budget)'
    assert why({'entitlement': 'sso', 'reason': 'entitlement'}) == 'sso not available (entitlement)'
