"""
Limitr + the Claude Agent SDK: decide every tool call and meter every model response with your policy.

Copy this file into your app and change TOOLS and TOKENS to your policy's entitlements. It uses only the Agent
SDK's own options, hooks, and messages, so `query()` stays exactly as you use it today.
"""
import dataclasses
from datetime import datetime, timezone
from typing import Any, AsyncIterable, AsyncIterator, Dict, Optional

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, HookMatcher, Message
from limitr import Decision, Limitr

# The entitlement that decides each tool. Tools not listed here run as the SDK decides.
TOOLS: Dict[str, str] = {
    'Bash': 'shell',
    'WebSearch': 'web_search',
    'mcp__billing__refund': 'refunds',
}

# The entitlement that meters the model's tokens (Ex. a hard monthly allowance, or soft and billed).
TOKENS = 'agent_tokens'


def why(d: Decision) -> str:
    """Why a call was refused, in words the model (and your user) can act on."""
    entitlement, reason = d['entitlement'], d['reason']
    if reason == 'limit':
        if d.get('resets'):
            resets = datetime.fromtimestamp(d['resets'] / 1000, timezone.utc).isoformat(timespec='seconds')
            return f'{entitlement} limit reached, resets {resets}'
        return f'{entitlement} limit reached'
    if reason == 'governor':
        return f'{entitlement} is rate limited, try again shortly'
    if reason == 'cap':
        return f"spend cap reached ({d.get('cap')})"
    if reason == 'held':
        return f'{entitlement} is in use by other calls, try again shortly'
    return f'{entitlement} not available ({reason})'


def governed(policy: Limitr, customer: str, options: Optional[ClaudeAgentOptions] = None) -> ClaudeAgentOptions:
    """
    Options for one governed run. Tools the customer can't use are hidden from the model, every listed tool call
    is decided by the policy (and counted when allowed), and the run stops before the next model request once the
    customer has no tokens left. Your own options and hooks are kept.
    """
    options = options or ClaudeAgentOptions()
    features = policy.features(customer) or []
    hidden = [tool for tool, entitlement in TOOLS.items() if entitlement not in features]

    # Before each tool call: count it against its entitlement, or deny it with the reason.
    async def pre_tool_use(input: Any, tool_use_id: Optional[str], context: Any) -> Dict[str, Any]:
        entitlement = TOOLS.get(input['tool_name'])
        if not entitlement:
            return {}
        event = {'tool': input['tool_name'], 'agent': input.get('agent_id')}
        d = policy.allow(customer, entitlement, 1, event, detail=True)
        if d['allowed']:
            return {}
        return {'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'permissionDecision': 'deny',
            'permissionDecisionReason': why(d),
        }}

    # After each batch of tool calls, before the next model request: stop the run if no tokens are left.
    async def post_tool_batch(input: Any, tool_use_id: Optional[str], context: Any) -> Dict[str, Any]:
        d = policy.check(customer, TOKENS, 1, detail=True)
        return {} if d['allowed'] else {'continue_': False, 'stopReason': why(d)}

    hooks: Dict[Any, Any] = dict(options.hooks or {})
    hooks['PreToolUse'] = [*hooks.get('PreToolUse', []), HookMatcher(hooks=[pre_tool_use])]
    hooks['PostToolBatch'] = [*hooks.get('PostToolBatch', []), HookMatcher(hooks=[post_tool_batch])]
    return dataclasses.replace(options, disallowed_tools=[*options.disallowed_tools, *hidden], hooks=hooks)


async def metered(policy: Limitr, customer: str, run: AsyncIterable[Message]) -> AsyncIterator[Message]:
    """
    Meter the model's tokens from a run's messages, subagents included. Messages from one model response share
    its ID and usage, so each response is counted once. The usage already happened, so it's recorded even past a
    hard limit (`force`); the next model request is what gets stopped.
    """
    counted = set()
    async for msg in run:
        if isinstance(msg, AssistantMessage) and msg.usage and msg.message_id not in counted:
            counted.add(msg.message_id)
            u = msg.usage
            event = {
                'model': msg.model,
                'input': u.get('input_tokens', 0),
                'cache_write': u.get('cache_creation_input_tokens') or 0,
                'cache_read': u.get('cache_read_input_tokens') or 0,
                'output': u.get('output_tokens', 0),
            }
            tokens = event['input'] + event['cache_write'] + event['cache_read'] + event['output']
            policy.allow(customer, TOKENS, tokens, event, force=True)
        yield msg
