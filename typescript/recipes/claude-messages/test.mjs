// Tests for the recipe (limitr-messages.ts), against the real engine and a stand-in API client. Run: npm test
import assert from 'node:assert/strict';
import { Limitr } from '@formata/limitr';
import { governedCreate, decideToolUse, TOKENS } from './limitr-messages.ts';

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
}`);

/** A stand-in for `new Anthropic()`: counts input as given, answers with the output asked for, records requests. */
function fakeClient({ input = 100, output = 50, fail = false, wait = null } = {}) {
    const requests = [];
    return {
        requests,
        messages: {
            countTokens: async () => ({ input_tokens: input }),
            create: async (params) => {
                requests.push(params);
                if (wait) await wait;
                if (fail) throw new Error('overloaded');
                return {
                    id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: params.model, content: [],
                    stop_reason: 'end_turn', usage: { input_tokens: input, output_tokens: Math.min(output, params.max_tokens),
                    cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
                };
            },
        },
    };
}

const tool = (name) => ({ name, description: name, input_schema: { type: 'object', properties: {} } });
const params = (max_tokens = 800) => ({
    model: 'claude-haiku-5-5', max_tokens, messages: [{ role: 'user', content: 'hi' }],
    tools: [tool('get_weather'), tool('issue_refund'), tool('lookup_order')],
});

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok', name); }

await test('only the tools the customer can use are offered; unlisted tools always are', async () => {
    await policy.ensureCustomer('ada', 'starter');
    const client = fakeClient();
    await governedCreate(policy, client, 'ada', params());
    assert.deepEqual(client.requests[0].tools.map((t) => t.name), ['get_weather', 'lookup_order']);
    await policy.ensureCustomer('bo', 'pro');
    const pro = fakeClient();
    await governedCreate(policy, pro, 'bo', params());
    assert.deepEqual(pro.requests[0].tools.map((t) => t.name), ['get_weather', 'issue_refund', 'lookup_order']);
});

await test('a hard limit caps max_tokens at what is left, and the real usage is recorded', async () => {
    await policy.ensureCustomer('cy', 'starter');
    const client = fakeClient({ input: 300, output: 200 });
    const res = await governedCreate(policy, client, 'cy', params(2000));
    assert.ok(res.message);
    assert.equal(client.requests[0].max_tokens, 700);          // 1000 left - 300 input
    assert.equal(await policy.value('cy', TOKENS), 500);       // 300 in + 200 out, not the 1000 held
    assert.equal(await policy.held('cy', TOKENS), 0);
});

await test('a call whose input does not fit is refused with the reason, before any API call', async () => {
    await policy.ensureCustomer('di', 'starter');
    await policy.allow('di', TOKENS, 950, false);
    const client = fakeClient({ input: 100 });
    const res = await governedCreate(policy, client, 'di', params());
    assert.equal(res.refused, 'ai_tokens limit reached');
    assert.equal(client.requests.length, 0);
});

await test('room held by a call in flight shrinks the next call, so together they cannot overspend', async () => {
    await policy.ensureCustomer('ed', 'starter');
    let finish;
    const slow = fakeClient({ input: 100, output: 400, wait: new Promise((r) => { finish = r; }) });
    const first = governedCreate(policy, slow, 'ed', params(500));     // holds 100 + 500
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await policy.held('ed', TOKENS), 600);
    const second = fakeClient({ input: 100, output: 400 });
    await governedCreate(policy, second, 'ed', params(500));
    assert.equal(second.requests[0].max_tokens, 300);                 // 1000 - 600 held - 100 input
    finish();
    await first;
    assert.ok(await policy.value('ed', TOKENS) <= 1000);
    assert.equal(await policy.held('ed', TOKENS), 0);
});

await test('an API error releases the hold and rethrows', async () => {
    await policy.ensureCustomer('fy', 'starter');
    await assert.rejects(governedCreate(policy, fakeClient({ fail: true }), 'fy', params()), /overloaded/);
    assert.equal(await policy.held('fy', TOKENS), 0);
    assert.equal(await policy.value('fy', TOKENS), 0);
});

await test('a soft limit never caps max_tokens: usage past it is billed', async () => {
    const client = fakeClient({ input: 300, output: 900 });
    await governedCreate(policy, client, 'bo', params(2000));
    assert.equal(client.requests[0].max_tokens, 2000);
    assert.ok(await policy.value('bo', TOKENS) > 1000);
});

await test('a tool use is counted, then answered with the reason once refused', async () => {
    await policy.ensureCustomer('gu', 'starter');
    const use = (name, id) => ({ type: 'tool_use', id, name, input: {} });
    assert.equal(await decideToolUse(policy, 'gu', use('get_weather', 't1')), null);
    assert.deepEqual(await decideToolUse(policy, 'gu', use('get_weather', 't2')),
        { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'weather limit reached' });
    assert.deepEqual(await decideToolUse(policy, 'gu', use('issue_refund', 't3')),
        { type: 'tool_result', tool_use_id: 't3', is_error: true, content: 'refunds not available (not_entitled)' });
    assert.equal(await decideToolUse(policy, 'gu', use('lookup_order', 't4')), null);
    assert.equal(await policy.value('gu', 'weather'), 1);
});

console.log(`\n${passed} passed`);
