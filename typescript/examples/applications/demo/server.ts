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
import { summarize } from "./claude.ts";


const router = new Router();
router.post('/summarize', async (ctx) => {
    const { id, name, message } = await ctx.request.body.json();

    // Summarize the message with Claude, and track/enforce usage with Limitr
    // Model used will depend on user overage
    const res = await summarize(id, name, message);
    ctx.response.body = res;
    ctx.response.status = 200;
});


const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
app.listen({ port: 4242, hostname: '127.0.0.1' });
console.log('demo server listening at 127.0.0.1:4242');
