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
A weather service that sells forecasts on Limitr Network. Its policy says what it offers (a plan for agents, at a cent
a forecast), the routes that plan reaches, and one tool of its own (Stof that runs on the agent's side, for agents
that trust it, calling its routes). Limitr does the rest: the manifest, vouchers, checking and metering every request,
and receipts.

    python demos/network/provider.py
"""

import os
from wsgiref.simple_server import make_server

from limitr import Limitr

PORT = 8787

weather = Limitr(f'''
policy: {{
    credits: {{
        forecast: {{ label: 'Forecast', unit: 'forecast', price: {{ amount: 0.01 }} }}
    }}

    plans: {{
        agent: {{
            label: 'Agents'
            entitlements: {{
                forecasts: {{ description: 'Forecasts, a cent each', limit: {{ credit: 'forecast', mode: 'soft', value: 0 }} }}
            }}
        }}
    }}

    network: {{
        provider: {{
            name: 'acme_weather'
            label: 'Acme Weather'
            url: 'http://localhost:{PORT}'
            offers: ['agent']
            routes: {{
                forecast: {{
                    description: 'Get the weather forecast for a city'
                    method: 'GET'
                    path: '/forecast'
                    parameters: [{{ name: 'city', description: 'The city, Ex. Boston' }}]
                    entitlement: 'forecasts'
                }}
            }}

            // A tool of its own: two forecasts, compared on the agent's side (each request still signed and metered here).
            tools: {{
                compare: {{
                    description: 'Which of two cities will be warmer today'
                    parameters: [{{ name: 'a', description: 'A city' }}, {{ name: 'b', description: 'Another city' }}]
                }}
            }}
            logic: r#"
                fn compare(input: map) -> unknown {{
                    const a = self.forecast(input.get('a'));
                    const b = self.forecast(input.get('b'));
                    const warmer = a.get('high') >= b.get('high') ? a : b;
                    map(('warmer', warmer.get('city')), ('high', warmer.get('high')), ('by', Num::abs(a.get('high') - b.get('high'))))
                }}

                fn forecast(city: str) -> map {{
                    self.api.json(self.api.call('forecast', map(('city', city))))
                }}
            "#
        }}
    }}
}}
''')

# The provider's identity. Keep this key (vouchers are made out to it): here it comes from the environment, or a new
# one is made for this run.
network = weather.network(secret_key=os.environ.get('WEATHER_SECRET_KEY'))

# Today's highs (C), standing in for a real forecast.
HIGHS = {'Boston': 12, 'Denver': 15, 'Austin': 27, 'Seattle': 11}


def work(call):
    """
    Runs only for requests that are signed by a voucher's key, not replayed, and allowed (within the voucher's spend),
    whether the agent's host made them or this provider's tool did, on the agent's side.
    """
    city = call.query.get('city', 'somewhere')
    print(f'{call.customer} asked for {call.route}: {city}')
    return {'city': city, 'forecast': 'sunny', 'high': HIGHS.get(city, 20)}


# The protocol's own paths and the requests to its routes, all through one handler. network.wsgi(work) is it as a WSGI
# app: gunicorn, waitress, or a Flask or Django mount take it as is. Here, the standard library's server.
# (network.handle(request, work) is the same thing for any other framework: a limitr.Request in, a Response out.)
with make_server('localhost', PORT, network.wsgi(work)) as server:
    print(f'Acme Weather on http://localhost:{PORT} (manifest at /.well-known/limitr-network)')
    print(f'identity: {network.public_key}')
    server.serve_forever()
