"""
Limitr + the Claude Messages API (anthropic): size, decide, and meter every model call with your policy.

Copy this file into your app and change TOOLS and TOKENS to your policy's entitlements. You keep making the
calls and running the tool loop yourself; these helpers sit around each call and each tool use.
"""
import math
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import anthropic
from limitr import Decision, Limitr

# The entitlement that decides each tool. Tools not listed here are always offered.
TOOLS: Dict[str, str] = {
    'get_weather': 'weather',
    'issue_refund': 'refunds',
}

# The entitlement that meters the model's tokens (Ex. a hard monthly allowance, or soft and billed).
TOKENS = 'ai_tokens'


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


def governed_create(policy: Limitr, client: anthropic.Anthropic, customer: str, **params: Any) -> Dict[str, Any]:
    """
    One governed model call: {'message': message}, or {'refused': reason}. The tools the customer can't use are left
    out, the call's input is counted, a hard token limit caps `max_tokens` at what's left, room for the whole call
    is held while it runs (so concurrent calls can't overspend together), and the real usage is recorded when it
    returns. An API error releases the hold and raises.
    """
    # Offer only the tools the customer can use right now.
    features = policy.features(customer) or []
    request = dict(params)
    if request.get('tools') is not None:
        request['tools'] = [t for t in request['tools']
                            if TOOLS.get(t.get('name', '')) is None or TOOLS[t['name']] in features]

    # Count the input (a free API call), then see what's left.
    counted = client.messages.count_tokens(**{k: request[k] for k in ('model', 'messages', 'system', 'tools')
                                              if request.get(k) is not None})
    input = counted.input_tokens
    context = {'model': request['model'], 'input': input}
    d = policy.check(customer, TOKENS, input + 1, context, detail=True)
    if not d['allowed']:
        return {'refused': why(d)}

    # A hard limit caps the answer at what's left, less what other calls hold.
    max_tokens = request['max_tokens']
    if d.get('mode') == 'hard' and d.get('allowance') is not None:
        max_tokens = min(max_tokens, math.floor(d['allowance'] - d['held'] - input))
        if max_tokens < 1:
            return {'refused': why({**d, 'reason': 'limit'})}

    # Hold the most the call can use, run it, then record what it really used.
    hold = policy.reserve(customer, TOKENS, input + max_tokens, context)
    if not hold:
        return {'refused': why(policy.check(customer, TOKENS, input + max_tokens, context, detail=True))}
    try:
        message = client.messages.create(**{**request, 'max_tokens': max_tokens})
    except Exception:
        policy.release(customer, TOKENS, hold)
        raise
    u = message.usage
    event = {
        'model': message.model,
        'input': u.input_tokens,
        'cache_write': u.cache_creation_input_tokens or 0,
        'cache_read': u.cache_read_input_tokens or 0,
        'output': u.output_tokens,
    }
    policy.settle(customer, TOKENS, hold, event['input'] + event['cache_write'] + event['cache_read'] + event['output'], event)
    return {'message': message}


def decide_tool_use(policy: Limitr, customer: str, use: Any) -> Optional[Dict[str, Any]]:
    """
    Decide one tool use from the model's response before you run it. None when it may run (it's counted); otherwise
    the tool result to send back instead, with the reason, so the model can adapt.
    """
    entitlement = TOOLS.get(use.name)
    if not entitlement:
        return None
    d = policy.allow(customer, entitlement, 1, {'tool': use.name}, detail=True)
    if d['allowed']:
        return None
    return {'type': 'tool_result', 'tool_use_id': use.id, 'is_error': True, 'content': why(d)}
