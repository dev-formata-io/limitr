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

import { Limitr } from "../main.ts";

const policy = await Limitr.new(`
policy:
  credits:
    token:
      description: "A single AI token for model usage"
  plans:
    free:
      entitlements:
        tokens:
          limit:
            credit: token
            value: 1000
            mode: soft  # allows overage events
    pro:
      entitlements:
        tokens:
          limit:
            credit: token
            value: 10000
`, 'yaml');

// create test subjects
await policy.addSubject('free_user', 'free');
await policy.addSubject('pro_user', 'pro');

// add events either in doc (custom libs) or to policy as pre-defined (App.meter_overage, etc..)
policy.doc.lib('App', 'meter_overage', (json: string) => { const r = JSON.parse(json); console.log('Overage subject: ', r.subject, r.balance); });
policy.doc.lib('Custom', 'example_event_handler', (user: string, balance: number) => { console.log("firing a custom event handler for", user, balance); });
policy.doc.parse(`
    #[meter-overage]
    fn meter_over_limit(val: obj) {
        const user = val.subject.id ?? 'dne';
        const balance = val.balance ?? 0;
        ?Custom.example_event_handler(user, balance);
    }
`);

// determin allowed or not while metering usage
const allowed = await policy.meter('free_user', 'tokens', 1400);
if (!allowed) console.log('Free user is not allowed');
