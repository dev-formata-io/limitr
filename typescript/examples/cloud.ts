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


import { assert } from "jsr:@std/assert@^1.0.16/assert";
import { Limitr } from "../main.ts";

// testing vars
const token = 'test_9h2xRkFzlu8rdHWW5MPOpBQ7';
const address = 'http://localhost:4242';
const user = 'test_1';

// grab policy & customer from server (add a ttl to update policy on an interval)
const policy = await Limitr.cloud(token, address, 'active', null) ?? await Limitr.new();
assert(await policy.addCloudCustomer(token, user, address));

// ready to limit & track (use async API with cloud policies)
if (await policy.allow(user, 'tokens', 200)) {
    console.log('Success, now do the thing');
} else {
    console.log('Blocked!! Notify the user or something');
}
console.log(policy.customers());
