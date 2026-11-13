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
