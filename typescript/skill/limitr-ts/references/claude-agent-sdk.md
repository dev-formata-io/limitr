# Limitr with the Claude Agent SDK

Govern agents built on `@anthropic-ai/claude-agent-sdk` with a Limitr policy: hide the tools a customer can't use,
decide (and count) every tool call, meter every model response, and stop a run before its next model request once
the customer is out of tokens. It's plain code over the SDK's own options, hooks, and message stream, so `query()`
stays as it is. Copy the recipe into the app and change `TOOLS` and `TOKENS` to the policy's entitlements. The
tested copy, with its tests and a live check, is `typescript/recipes/claude-agent-sdk/` in the Limitr repo. For
calls made directly with the Messages API, see `claude-messages.md`.

## The policy

One entitlement per governed tool (a count, a flag, or a rate limit) and one that meters the model's tokens. Ex.:

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
                shell: { limit: { credit: 'call', mode: 'hard', value: 50, resets: true } }
                agent_tokens: { limit: { credit: 'ai_token', mode: 'hard', value: 2_000_000, resets: true } }
            }
        }
        pro: {
            entitlements: {
                shell: { limit: { credit: 'call', mode: 'hard', value: 1000, resets: true } }
                web_search: { limit: { credit: 'call', mode: 'hard', value: 500, resets: true } }
                refunds: {}
                agent_tokens: { limit: { credit: 'ai_token', mode: 'soft', value: 20_000_000, resets: true } }
            }
        }
    }
}
```

A tool missing from a customer's plan is hidden from the model. A soft `agent_tokens` bills past the allowance
instead of stopping. Give each model and direction its own credit, or a cost function, to price tokens (see the
limitr skill, "AI tokens per model"); the event data below carries `model`, `input`, `cache_write`, `cache_read`,
and `output`.

## The recipe

```ts
/**
 * Limitr + the Claude Agent SDK: decide every tool call and meter every model response with your policy.
 *
 * Copy this file into your app and change TOOLS and TOKENS to your policy's entitlements. It uses only the
 * Agent SDK's own options, hooks, and messages, so `query()` stays exactly as you use it today.
 */
import type { HookCallback, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Limitr, LimitrDecision } from '@formata/limitr';

/** The entitlement that decides each tool. Tools not listed here run as the SDK decides. */
export const TOOLS: Record<string, string> = {
    Bash: 'shell',
    WebSearch: 'web_search',
    mcp__billing__refund: 'refunds',
};

/** The entitlement that meters the model's tokens (Ex. a hard monthly allowance, or soft and billed). */
export const TOKENS = 'agent_tokens';


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


/**
 * Options for one governed run. Tools the customer can't use are hidden from the model, every listed tool call
 * is decided by the policy (and counted when allowed), and the run stops before the next model request once the
 * customer has no tokens left. Your own options and hooks are kept.
 */
export async function governed(policy: Limitr, customer: string, options: Options = {}): Promise<Options> {
    const features = (await policy.features(customer)) ?? [];
    const hidden = Object.entries(TOOLS).filter(([, ent]) => !features.includes(ent)).map(([tool]) => tool);

    // Before each tool call: count it against its entitlement, or deny it with the reason.
    const preToolUse: HookCallback = async (input) => {
        if (input.hook_event_name !== 'PreToolUse') return {};
        const entitlement = TOOLS[input.tool_name];
        if (!entitlement) return {};
        const event = { tool: input.tool_name, agent: input.agent_id ?? null };
        const d = await policy.allow(customer, entitlement, 1, event, undefined, false, true);
        if (d.allowed) return {};
        return {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: why(d),
            },
        };
    };

    // After each batch of tool calls, before the next model request: stop the run if no tokens are left.
    const postToolBatch: HookCallback = async () => {
        const d = await policy.check(customer, TOKENS, 1, undefined, undefined, true);
        return d.allowed ? {} : { continue: false, stopReason: why(d) };
    };

    return {
        ...options,
        disallowedTools: [...(options.disallowedTools ?? []), ...hidden],
        hooks: {
            ...options.hooks,
            PreToolUse: [...(options.hooks?.PreToolUse ?? []), { hooks: [preToolUse] }],
            PostToolBatch: [...(options.hooks?.PostToolBatch ?? []), { hooks: [postToolBatch] }],
        },
    };
}


/**
 * Meter the model's tokens from a run's messages, subagents included. Messages from one model response share
 * its ID and usage, so each response is counted once. The usage already happened, so it's recorded even past
 * a hard limit (`force`); the next model request is what gets stopped.
 */
export async function* metered(policy: Limitr, customer: string, run: AsyncIterable<SDKMessage>): AsyncGenerator<SDKMessage> {
    const counted = new Set<string>();
    for await (const msg of run) {
        if (msg.type === 'assistant' && !counted.has(msg.message.id)) {
            counted.add(msg.message.id);
            const u = msg.message.usage;
            const event = {
                model: msg.message.model,
                input: u.input_tokens,
                cache_write: u.cache_creation_input_tokens ?? 0,
                cache_read: u.cache_read_input_tokens ?? 0,
                output: u.output_tokens,
            };
            const tokens = event.input + event.cache_write + event.cache_read + event.output;
            await policy.allow(customer, TOKENS, tokens, event, undefined, true);
        }
        yield msg;
    }
}
```

## Running it

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Limitr } from '@formata/limitr';
import { governed, metered, why, TOKENS } from './limitr-agent.js';

const policy = await Limitr.new(policySource);   // or Limitr.cloud(...)

async function runAgent(customer: string, prompt: string) {
    const gate = await policy.check(customer, TOKENS, 1, undefined, undefined, true);
    if (!gate.allowed) return { refused: why(gate) };

    const run = query({ prompt, options: await governed(policy, customer, { model: 'claude-sonnet-5-5' }) });
    for await (const msg of metered(policy, customer, run)) {
        // handle messages exactly as before
    }
}
```

## What happens where

| Point | Code | Limitr call |
|---|---|---|
| Before the run | `check(customer, TOKENS, 1, …, true)` | Refuse up front, with the reason. |
| Building options | `features(customer)` → `disallowedTools` | The model never sees a tool the customer can't use. |
| Each tool call (`PreToolUse`) | `allow(customer, TOOLS[tool], 1, …, true)` | Counted when allowed; denied with `permissionDecisionReason` otherwise, which the model reads. |
| Each model response (stream) | `allow(customer, TOKENS, tokens, event, undefined, true)` | Counted once per response ID (responses with parallel tool calls repeat it), subagents included. `force`: it already happened. |
| Before the next model request (`PostToolBatch`) | `check(customer, TOKENS, 1, …, true)` | `continue: false` with the reason ends the run. |

## Variations

- **Tools priced by outcome** (Ex. a refund's amount, a job's runtime): `reserve` in `PreToolUse` (key the hold by
  `input.tool_use_id`), then `settle` in `PostToolUse` with the real amount, or `release` in `PostToolUseFailure`. A
  hold spends a governor's tokens like `allow`, so rate limits still hold.
- **Rules on a tool's arguments** (Ex. refunds under $200 on Pro): pass `input.tool_input` in the event data and
  read it in the entitlement's `enabled` rule (`context.input.amount`). The decision's `reason` is `'disabled'`.
- **Subagents as their own customers**: hooks carry `input.agent_id` inside a subagent. Create a customer per agent
  with a ref to the run's customer (shared caps and scoped entitlements apply through refs) and decide its tool calls
  as that customer.
- **Downgrade instead of stop**: in `PostToolBatch`, when `remaining` is low, call `setModel('claude-haiku-5-5')` on
  the `Query` that `query()` returned (keep a reference to it) and return `{}`.
- **A spend backstop**: `maxBudgetUsd` in the options caps the run by the SDK's own cost estimate (a client-side
  estimate, not billing data). The policy stays the source of truth.
- **Observe only**: drop the hooks, keep `metered`, and make the entitlements `observe`: usage is recorded and
  analyzed in Limitr Cloud, and nothing is refused.

## Notes

- Tool calls are counted when they're allowed, before they run. Count after the fact instead with `PostToolUse` if a
  failed call shouldn't count.
- Each method call is atomic. Two runs for the same customer can both pass the `PostToolBatch` check with only one
  response's worth left; the second response is still recorded (hard limits can be passed by usage that already
  happened), and the run stops at the next check. Use a soft limit with a cap if that overshoot must be bounded.
- The hooks run in the same process as `query()` (in-process callbacks), so they work wherever the SDK runs.
