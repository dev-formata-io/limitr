# Limitr with the Claude Messages API

Govern calls made with `@anthropic-ai/sdk` (`client.messages.create`) with a Limitr policy. Because the app makes each
call and runs its own tool loop, the policy can size each call exactly: offer only the tools the customer can use,
cap `max_tokens` at the tokens left under a hard limit, hold room for the whole call while it runs (so concurrent
calls can't overspend together), record the real usage when it returns, and answer refused tool uses with the reason.
Copy the recipe into the app and change `TOOLS` and `TOKENS` to the policy's entitlements. The tested copy, with its
tests and a live check, is `typescript/recipes/claude-messages/` in the Limitr repo. For agents built on the Claude
Agent SDK, see `claude-agent-sdk.md`.

## The policy

One entitlement per governed tool and one that meters the model's tokens. Ex.:

```stof
policy: {
    credits: {
        call: { label: 'Tool call' }
        ai_token: { label: 'AI token' }
    }
    plans: {
        starter: {
            default: true
            entitlements: {
                weather: { limit: { credit: 'call', mode: 'hard', value: 100, resets: true } }
                ai_tokens: { limit: { credit: 'ai_token', mode: 'hard', value: 1_000_000, resets: true } }
            }
        }
        pro: {
            entitlements: {
                weather: { limit: { credit: 'call', mode: 'hard', value: 5000, resets: true } }
                refunds: {}
                ai_tokens: { limit: { credit: 'ai_token', mode: 'soft', value: 20_000_000, resets: true } }
            }
        }
    }
}
```

A hard `ai_tokens` caps each call's `max_tokens` at what's left; a soft one never caps it and bills past the
allowance. The event data carries `model`, `input`, `cache_write`, `cache_read`, and `output` for pricing (a credit per
model and direction, or a cost function; see the limitr skill, "AI tokens per model").

## The recipe

```ts
/**
 * Limitr + the Claude Messages API (@anthropic-ai/sdk): size, decide, and meter every model call with your policy.
 *
 * Copy this file into your app and change TOOLS and TOKENS to your policy's entitlements. You keep making the
 * calls and running the tool loop yourself; these helpers sit around each call and each tool use.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Limitr, LimitrDecision } from '@formata/limitr';

/** The entitlement that decides each tool. Tools not listed here are always offered. */
export const TOOLS: Record<string, string> = {
    get_weather: 'weather',
    issue_refund: 'refunds',
};

/** The entitlement that meters the model's tokens (Ex. a hard monthly allowance, or soft and billed). */
export const TOKENS = 'ai_tokens';


/** Why a call was refused, in words the model (and your user) can act on. */
export function why(d: LimitrDecision): string {
    switch (d.reason) {
        case 'limit': return d.resets
            ? `${d.entitlement} limit reached, resets ${new Date(d.resets).toISOString()}`
            : `${d.entitlement} limit reached`;
        case 'governor': return `${d.entitlement} is rate limited, try again shortly`;
        case 'cap': return `spend cap reached (${d.cap})`;
        case 'held': return `${d.entitlement} is in use by other calls, try again shortly`;
        default: return `${d.entitlement} not available (${d.reason})`;
    }
}


export type Governed = { message: Anthropic.Message } | { refused: string };


/**
 * One governed model call. The tools the customer can't use are left out, the call's input is counted, a hard
 * token limit caps `max_tokens` at what's left, room for the whole call is held while it runs (so concurrent
 * calls can't overspend together), and the real usage is recorded when it returns. Refused with the reason when
 * the customer can't make the call; an API error releases the hold and rethrows.
 */
export async function governedCreate(
    policy: Limitr,
    client: Anthropic,
    customer: string,
    params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Governed> {
    // Offer only the tools the customer can use right now.
    const features = (await policy.features(customer)) ?? [];
    const tools = params.tools?.filter((t) => {
        const entitlement = 'name' in t ? TOOLS[t.name] : undefined;   // toolsets have no single name
        return !entitlement || features.includes(entitlement);
    });
    const request = { ...params, tools };

    // Count the input (a free API call), then see what's left.
    const { input_tokens: input } = await client.messages.countTokens({
        model: request.model,
        messages: request.messages,
        system: request.system,
        tools: request.tools,
    } as Anthropic.MessageCountTokensParams);
    const d = await policy.check(customer, TOKENS, input + 1, { model: request.model, input }, undefined, true);
    if (!d.allowed) return { refused: why(d) };

    // A hard limit caps the answer at what's left, less what other calls hold.
    let maxTokens = request.max_tokens;
    if (d.mode === 'hard' && d.allowance != null) {
        maxTokens = Math.min(maxTokens, Math.floor(d.allowance - d.held - input));
        if (maxTokens < 1) return { refused: why({ ...d, reason: 'limit' }) };
    }

    // Hold the most the call can use, run it, then record what it really used.
    const context = { model: request.model, input };
    const hold = await policy.reserve(customer, TOKENS, { value: input + maxTokens, context });
    if (!hold) return { refused: why(await policy.check(customer, TOKENS, input + maxTokens, context, undefined, true)) };
    try {
        const message = await client.messages.create({ ...request, max_tokens: maxTokens });
        const u = message.usage;
        const event = {
            model: message.model,
            input: u.input_tokens,
            cache_write: u.cache_creation_input_tokens ?? 0,
            cache_read: u.cache_read_input_tokens ?? 0,
            output: u.output_tokens,
        };
        await policy.settle(customer, TOKENS, hold, event.input + event.cache_write + event.cache_read + event.output, event);
        return { message };
    } catch (err) {
        await policy.release(customer, TOKENS, hold);
        throw err;
    }
}


/**
 * Decide one tool use from the model's response before you run it. Null when it may run (it's counted); otherwise
 * the tool result to send back instead, with the reason, so the model can adapt.
 */
export async function decideToolUse(
    policy: Limitr,
    customer: string,
    use: Anthropic.ToolUseBlock,
): Promise<Anthropic.ToolResultBlockParam | null> {
    const entitlement = TOOLS[use.name];
    if (!entitlement) return null;
    const d = await policy.allow(customer, entitlement, 1, { tool: use.name }, undefined, false, true);
    if (d.allowed) return null;
    return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: why(d) };
}
```

## Running it: a tool loop

```ts
import Anthropic from '@anthropic-ai/sdk';
import { governedCreate, decideToolUse } from './limitr-messages.js';

const client = new Anthropic();

async function chat(customer: string, messages: Anthropic.MessageParam[], tools: Anthropic.Tool[]) {
    while (true) {
        const res = await governedCreate(policy, client, customer, { model: 'claude-sonnet-5-5', max_tokens: 4096, messages, tools });
        if ('refused' in res) return { refused: res.refused };
        messages.push({ role: 'assistant', content: res.message.content });

        const uses = res.message.content.filter((b) => b.type === 'tool_use');
        if (uses.length === 0) return { message: res.message };
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of uses) {
            results.push((await decideToolUse(policy, customer, use)) ?? await runTool(use));  // your tool code
        }
        messages.push({ role: 'user', content: results });
    }
}
```

## What happens where

| Step | Limitr call | Why |
|---|---|---|
| Offer tools | `features(customer)` | The model never sees a tool the customer can't use (toolsets without a single name are always offered). |
| Count the input | `client.messages.countTokens(...)` | A free API call, so the call is sized by its real input. |
| Decide the call | `check(customer, TOKENS, input + 1, …, true)` | Refused with the reason before any model call. |
| Size the answer | `max_tokens = min(asked, allowance - held - input)` | Hard limits only. Room held by calls in flight counts. |
| Hold, run, record | `reserve(input + max_tokens)` → `settle(real usage)` | Concurrent calls can't overspend together; an API error `release`s. |
| Each tool use | `allow(customer, TOOLS[name], 1, …, true)` | Counted when it may run; otherwise a `tool_result` with `is_error` and the reason. |

## Variations

- **Skip the token count** to save a round trip: estimate the input (Ex. characters / 4), or let the engine predict
  it (`estimate_basis` on the entitlement; see the limitr skill, "Predict output tokens"). The hold is then an
  estimate, and `settle` still records the real usage.
- **A minimum answer size**: refuse when `max_tokens` would be under what's useful (Ex. 256) instead of 1.
- **Streaming**: call `client.messages.stream(...)` in place of `create`, and settle from `finalMessage()`'s usage.
  Release the hold if the stream errors.
- **Downgrade instead of refuse**: when what's left is low, switch `model` to a cheaper one before the call.
- **Tools priced by outcome**: `reserve` before running the tool and `settle` with the real amount after. A hold
  spends a governor's tokens like `allow`, so rate limits still hold.
- **Policy capabilities as tools**: `policy.claudeTools(customer)` returns the policy's capabilities as Claude tools,
  and `policy.claudeToolUse(use, customer)` runs one and returns its `tool_result`.

## Notes

- `max_tokens` is capped from a snapshot: two calls sized at the same moment both see the same allowance, but the
  holds make the later `reserve` fail if they don't both fit, and it's refused with the reason.
- Output is capped by `max_tokens`, so a call made through `governedCreate` stays within a hard limit (unless the
  call's billed input differs from the token count).
