#
# Copyright 2026 Formata, Inc. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

"""
An agent that finds a tool it doesn't have and pays for it: it connects to Acme Weather with a voucher (up to 3 cents,
for an hour), gets the service's route as a tool, and calls it. No API key, no account, no integration: the voucher is
the agreement, and both sides see what it has spent. Then it trusts the service's own logic, and runs a tool the
service wrote, sealed and confined in this agent's policy.

    python demos/network/provider.py     (in another terminal first)
    python demos/network/consumer.py
"""

import json
import time

from limitr import Limitr, LimitrNetwork

agent = Limitr('policy: {}')
network = agent.network(name='demo_agent')   # a new identity for this run


# Every call comes back with a receipt signed by the provider: what this voucher has spent, and what's left.
def on_receipt(key, receipt):
    if key == 'network-receipt':
        print(f"  receipt from {receipt['label']}: spent {receipt['spent']}, {receipt['remaining']} left")


agent.add_handler('spend', on_receipt)

# 1. Connect: read the provider's terms, sign a voucher for its 'agent' plan, take its grant.
tools = network.connect('http://localhost:8787', 'agent', 0.03, time.time() * 1000 + 60 * 60 * 1000)
print('new tools:', tools)

# 2. The tools, as Claude sees them: pass these as `tools` in a Messages API request.
print(json.dumps(agent.claude_tools(), indent=2))

# 3. When Claude calls one (a tool_use block), run it. Each call is signed by this agent's key and metered by the
#    provider against the voucher.
for city in ['Boston', 'Denver', 'Austin']:
    print(city, agent.run_capability('acme_weather_forecast', {'city': city}))

# 4. The voucher is spent: the provider refuses the next call. A refusal is the tool's result (not an error), so an
#    agent can read it and say so; raising the spend stays the host's decision (step 5).
result = agent.run_capability('acme_weather_forecast', {'city': 'Seattle'})
refused = LimitrNetwork.refusal(result)
if refused:
    print(f"refused ({refused['status']}): {refused['reason']}; {refused['remaining']} left")

# 5. Top up (a newer voucher, more spend), and call again.
network.update('acme_weather', spend=0.10)
print('Seattle', agent.run_capability('acme_weather_forecast', {'city': 'Seattle'}))

# 6. Trust the service's logic: its own tools run here too, sealed and confined (they see nothing of this policy, call
#    no host, and reach the service only through its routes, each request signed for this voucher and metered there).
#    Connecting with trust='logic' does the same from the start.
print('new tools:', network.trust('acme_weather', 'logic'))
print('compare', agent.run_capability('acme_weather_compare', {'a': 'Boston', 'b': 'Austin'}))

# 7. End it.
print('connection:', network.connection('acme_weather'))
network.cancel('acme_weather')
print('cancelled: tools now', [tool['name'] for tool in agent.claude_tools()])
