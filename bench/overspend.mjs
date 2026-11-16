// How far concurrent agent tasks overspend a hard allowance when each checks a counter first and records its usage
// when it finishes, versus holding room with reserve() and recording it with settle().
//
//   npm i @formata/limitr && node overspend.mjs
import { Limitr } from '@formata/limitr';

const POLICY = `
policy: {
    credits: { ai_token: { price: { amount: 0.00002 } overhead_cost: 0.000008 } }
    plans: {
        team: {
            default: true
            entitlements: {
                agent: { limit: { credit: 'ai_token', mode: 'hard', value: 1000000, resets: true } }
                api: { limit: { credit: 'ai_token', mode: 'soft', value: 1000000000, resets: true } }
            }
        }
    }
}`;

// N agent tasks start at once against a 1M-token monthly allowance. Each runs ~25-45k tokens, known only
// afterwards; max_tokens-style ceiling 50k. A seeded random so both runs see the same tasks.
let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const N = 60;
const tasks = Array.from({ length: N }, () => Math.round(25_000 + rand() * 20_000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function counter() {
    const l = await Limitr.new(POLICY); await l.ensureCustomer('acme');
    let ran = 0;
    await Promise.all(tasks.map(async (used) => {
        if (!(await l.check('acme', 'agent', 1))) return;            // anything left? then go
        ran++;
        await sleep(50 + used / 1000);                                 // the model runs
        await l.allow('acme', 'agent', used, true, undefined, true);   // record it (force: it happened)
    }));
    return { ran, used: await l.value('acme', 'agent') };
}

async function reserved() {
    const l = await Limitr.new(POLICY); await l.ensureCustomer('acme');
    let ran = 0, inFlight = 0;
    const waiting = [];   // tasks waiting for room, first come first served
    await Promise.all(tasks.map(async (used) => {
        let hold;
        // Hold the most a task can use. No room: wait for a running task to settle and free some.
        while (!(hold = await l.reserve('acme', 'agent', { value: 50_000 }))) {
            if (inFlight === 0) return;                                // nothing will free room: give up
            await new Promise((wake) => waiting.push(wake));
        }
        ran++; inFlight++;
        await sleep(50 + used / 1000);                                 // the model runs
        await l.settle('acme', 'agent', hold, used);                   // record what it used, free the rest
        inFlight--;
        waiting.splice(0).forEach((wake) => wake());                   // let waiting tasks try again, in order
    }));
    return { ran, used: await l.value('acme', 'agent') };
}

const total = tasks.reduce((a, b) => a + b, 0);
console.log(`\n${N} tasks at once, ${total.toLocaleString()} tokens of demand, 1,000,000-token allowance`);
for (const [name, run] of [['check, then record', counter], ['reserve, then settle', reserved]]) {
    const { ran, used } = await run();
    console.log(`${name}: ${ran} tasks ran, ${used.toLocaleString()} tokens used (${((used / 1e6 - 1) * 100).toFixed(0)}% vs the allowance)`);
}
