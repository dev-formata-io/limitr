// How long one allow() and one check() take, in process (TypeScript).
//
//   npm i @formata/limitr && node latency.mjs
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

{
    const l = await Limitr.new(POLICY);
    await l.ensureCustomer('acme');
    for (let i = 0; i < 2000; i++) await l.allow('acme', 'api', 10);   // warm up
    for (const fn of ['allow', 'check']) {
        const t = [];
        for (let i = 0; i < 20000; i++) { const s = performance.now(); await l[fn]('acme', 'api', 10); t.push(performance.now() - s); }
        t.sort((a, b) => a - b);
        const q = (p) => t[Math.floor(p * t.length)].toFixed(3);
        console.log(`${fn}: p50 ${q(0.5)} ms, p99 ${q(0.99)} ms (TypeScript, ${t.length} calls)`);
    }
}

