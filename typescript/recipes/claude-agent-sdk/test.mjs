// Tests for the recipe (limitr-agent.ts), against the real engine and the hooks' real input shapes. Run: npm test
import assert from 'node:assert/strict';
import { Limitr } from '@formata/limitr';
import { governed, metered, why, TOKENS } from './limitr-agent.ts';

const policy = await Limitr.new(`
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
}`);

const base = { session_id: 's', transcript_path: '/tmp/t.jsonl', cwd: '/tmp' };
const signal = { signal: new AbortController().signal };
const pre = (tool) => ({ ...base, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {}, tool_use_id: `tu_${tool}` });
const batch = { ...base, hook_event_name: 'PostToolBatch', tool_calls: [] };
const hookOf = (opts, event) => opts.hooks[event].at(-1).hooks[0];

async function* stream(messages) { for (const m of messages) yield m; }
const assistant = (id, usage, parent = null) => ({
    type: 'assistant', parent_tool_use_id: parent, uuid: crypto.randomUUID(), session_id: 's',
    message: { id, model: 'claude-sonnet-5-5', role: 'assistant', type: 'message', content: [], stop_reason: null, usage },
});

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok', name); }

await test('tools the customer cannot use are hidden; yours are kept', async () => {
    await policy.ensureCustomer('ada', 'starter');
    const opts = await governed(policy, 'ada', { disallowedTools: ['Write'] });
    assert.deepEqual(opts.disallowedTools.sort(), ['WebSearch', 'Write', 'mcp__billing__refund']);
    const pro = await (await policy.ensureCustomer('bo', 'pro'), governed(policy, 'bo'));
    assert.deepEqual(pro.disallowedTools, []);
});

await test('your own hooks and options are kept, ours are added after', async () => {
    const mine = async () => ({});
    const opts = await governed(policy, 'ada', { model: 'claude-sonnet-5-5', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [mine] }] } });
    assert.equal(opts.model, 'claude-sonnet-5-5');
    assert.equal(opts.hooks.PreToolUse.length, 2);
    assert.equal(opts.hooks.PreToolUse[0].hooks[0], mine);
    assert.equal(opts.hooks.PostToolBatch.length, 1);
});

await test('a tool call is counted, then denied with the reason at the limit', async () => {
    await policy.ensureCustomer('cy', 'starter');
    const hook = hookOf(await governed(policy, 'cy'), 'PreToolUse');
    assert.deepEqual(await hook(pre('Bash'), 'tu_1', signal), {});
    assert.deepEqual(await hook(pre('Bash'), 'tu_2', signal), {});
    const denied = await hook(pre('Bash'), 'tu_3', signal);
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(denied.hookSpecificOutput.permissionDecisionReason, 'shell limit reached');
    assert.equal(await policy.value('cy', 'shell'), 2);
});

await test('a tool the customer lacks is denied even if the model calls it anyway', async () => {
    const hook = hookOf(await governed(policy, 'cy'), 'PreToolUse');
    const denied = await hook(pre('WebSearch'), 'tu_4', signal);
    assert.equal(denied.hookSpecificOutput.permissionDecisionReason, 'web_search not available (not_entitled)');
});

await test('tools not in TOOLS pass through untouched', async () => {
    const hook = hookOf(await governed(policy, 'cy'), 'PreToolUse');
    assert.deepEqual(await hook(pre('Read'), 'tu_5', signal), {});
});

await test('model usage is metered once per response, subagents included', async () => {
    await policy.ensureCustomer('di', 'starter');
    const usage = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 40 };
    const seen = [];
    for await (const m of metered(policy, 'di', stream([
        assistant('msg_1', usage),                          // text
        assistant('msg_1', usage),                          // tool use from the same response
        { type: 'user', message: { role: 'user', content: [] }, parent_tool_use_id: null, session_id: 's' },
        assistant('msg_2', { input_tokens: 20, output_tokens: 30 }, 'tu_agent'), // a subagent's response
    ]))) seen.push(m.type);
    assert.deepEqual(seen, ['assistant', 'assistant', 'user', 'assistant']); // messages pass through unchanged
    assert.equal(await policy.value('di', TOKENS), 200 + 50);
});

await test('usage past a hard limit is still recorded, and the run stops before the next request', async () => {
    await policy.ensureCustomer('ed', 'starter');
    const opts = await governed(policy, 'ed');
    const stop = hookOf(opts, 'PostToolBatch');
    assert.deepEqual(await stop(batch, undefined, signal), {});
    for await (const _ of metered(policy, 'ed', stream([assistant('msg_big', { input_tokens: 900, output_tokens: 300 })]))) {}
    assert.equal(await policy.value('ed', TOKENS), 1200);
    const res = await stop(batch, undefined, signal);
    assert.equal(res.continue, false);
    assert.equal(res.stopReason, 'agent_tokens limit reached');
});

await test('why() words every reason', async () => {
    const d = { entitlement: 'shell', resets: null, cap: 'budget' };
    assert.equal(why({ ...d, reason: 'governor' }), 'shell is rate limited, try again shortly');
    assert.equal(why({ ...d, reason: 'cap' }), 'spend cap reached (budget)');
    assert.equal(why({ ...d, reason: 'limit', resets: Date.UTC(2026, 11, 1) }), 'shell limit reached, resets 2026-12-01T00:00:00.000Z');
    assert.equal(why({ ...d, reason: 'taken' }), 'shell not available (taken)');
});

console.log(`\n${passed} passed`);
