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
