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

import { Limitr } from "../../../main.ts";
import { Router } from "jsr:@oak/oak/router";
import { Application } from 'jsr:@oak/oak/application';


// Grab the active Limitr policy from cloud or use a backup if offline (refreshes every 5 seconds)
const token = 'test_ppSa6IwJNQsLNtKX59wbUJGz';
const policy = await Limitr.cloud({ token }) ?? await Limitr.new();

// Populate some test customers just for testing!
// In real life, these would be populated with a clear addCustomer workflow and each endpoint could addCloudCustomer if cache miss
if (!await policy.addCloudCustomer('org_Formata')) await policy.createCustomer('org_Formata', 'paid', 'org', 'Formata');
if (!await policy.addCloudCustomer('cus_CJ')) await policy.createCustomer('cus_CJ', '', 'user', 'CJ Cummings', ['org_Formata']);

// Lets add some API keys to reference our two customers in the API
// In real life, these would be unique API keys that our app could add/remove from the cloud customer and check independently
await policy.addAltID('org_Formata', 'API_Formata');
await policy.addAltID('cus_CJ', 'API_CJ');


// Define routes for our API
const router = new Router();


// Get the current number of seats for an organization
// Since 'seats' scope is org, even a user passed here will work just fine
// Ex. `curl -H "Authorization: API_CJ" http://localhost:4242/seats`
router.get('/seats', async (ctx) => {
    const key = ctx.request.headers.get('Authorization');
    const seats = key ? await policy.value(key, 'seats') : null;
    if (seats === null) {
        ctx.response.status = 404;
        ctx.response.body = { error: 'Not found' };
    } else {
        ctx.response.status = 200;
        ctx.response.body = { value: seats };
    }
});


// Modify seats.
// Ex. add two seats: `curl -X POST -H "Authorization: API_CJ" -d "{ \"value\": 2 }" http://localhost:4242/seats`
router.post('/seats', async (ctx) => {
    const key = ctx.request.headers.get('Authorization');
    const { value } = await ctx.request.body.json();
    if (key && await policy.allow(key, 'seats', value)) {
        ctx.response.status = 200;
        ctx.response.body = { total: await policy.value(key, 'seats'), ok: true };
    } else {
        ctx.response.status = 400;
        ctx.response.body = { error: 'Limited to ' + await policy.limit(key ?? 'dne', 'seats') + ' seats, and already have ' + await policy.value(key ?? 'dne', 'seats') };
    }
});


// Listen
const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
app.listen({ port: 4242, hostname: '127.0.0.1' });
