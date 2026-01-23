//
// Copyright 2026 Formata, Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Router } from "jsr:@oak/oak/router";
import { Application } from "jsr:@oak/oak/application";
import { claudeModel, claudeCountTokens, claudeSummarize } from "./claude.ts";
import { customer, policy } from "./limitr.ts";


const router = new Router();
router.post('/summarize', async (ctx) => {
    const { id, name, message } = await ctx.request.body.json();
    const res: Record<string, unknown> = {};

    // Get (or create) Limitr Cloud customer
    const cus = await customer(id, name);
    
    // Get the claude model to use based on current usage (overage = downgraded AI model)
    const model = claudeModel(cus);

    // Count the number of tokens about to be consumed (free token counting endpoint)
    const tokens = await claudeCountTokens(message, model);

    // Limitr resource/entitlement check + metering - only allows LLM call if hard usage limit not met
    const resource = 'summary_tokens';
    if (policy && await policy.allow(id, resource, tokens)) {
        res.summary = await claudeSummarize(message, model); // call to LLM

        // extras for reference
        res.model = model;
        res.used = await policy.value(id, resource);
        res.limit = await policy.limit(id, resource);
        res.remaining = await policy.remaining(id, resource);
    } else {
        res.error = 'hard token limit reached: summary not available';
    }
    
    ctx.response.body = res;
    ctx.response.status = 200;
});


const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
app.listen({ port: 4242, hostname: '127.0.0.1' });
console.log('demo server listening at 127.0.0.1:4242');
