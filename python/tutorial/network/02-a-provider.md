# 2. A provider

A provider is a policy with `network.provider`. Here's a weather service with one plan for agents, at a cent a
forecast:

```python
import json
import urllib.request
from urllib.error import HTTPError

from limitr import Limitr

# A weather service: a plan for agents, at a cent a forecast, and one route that plan reaches.
weather = Limitr('''
policy: {
    credits: {
        forecast: { label: 'Forecast', unit: 'forecast', price: { amount: 0.01 } }
    }
    plans: {
        agent: {
            label: 'Agents'
            entitlements: {
                forecasts: { description: 'Forecasts, a cent each', limit: { credit: 'forecast', mode: 'soft', value: 0 } }
            }
        }
    }
    network: {
        provider: {
            name: 'acme_weather'
            label: 'Acme Weather'
            url: 'http://localhost:8787'
            offers: ['agent']
            routes: {
                forecast: {
                    description: 'Get the weather forecast for a city'
                    method: 'GET'
                    path: '/forecast'
                    parameters: [{ name: 'city', description: 'The city, Ex. Boston' }]
                    entitlement: 'forecasts'
                }
            }
        }
    }
}''')

# Its identity. A real service keeps this key (vouchers are made out to it): pass secret_key= from your secrets.
network = weather.network()
print('identity:', len(network.public_key), 'characters of public key')


# One handler for everything: the manifest, vouchers, cancels, and requests to routes.
def work(call):
    return {'city': call.query.get('city'), 'forecast': 'sunny', 'high': 12}


# Serve it on a thread (network.wsgi(work) is the same handler as a WSGI app, for gunicorn, Flask, or Django).
server = network.serve(work, port=8787)

# What anyone sees: the manifest, signed by the service's key.
manifest = json.load(urllib.request.urlopen('http://localhost:8787/.well-known/limitr-network'))
message = json.loads(manifest['message'])
terms = json.loads(message['body']['terms'])
print('type:', message['type'], '| signed by its key:', manifest['key'] == network.public_key)
print('plans:', list(terms['plans']), '| a forecast costs', terms['credits']['forecast']['price'], 'runes')
print('routes:', list(terms['routes']), '| a rune is', terms['rune'])

# A request without a voucher is refused, and the work never runs.
try:
    urllib.request.urlopen('http://localhost:8787/forecast?city=Boston')
except HTTPError as error:
    print('without a voucher:', error.code, error.read().decode())

server.close()
```

It prints:

```text
identity: 44 characters of public key
type: manifest | signed by its key: True
plans: ['agent'] | a forecast costs 0.01 runes
routes: ['forecast'] | a rune is {'value': 1.0, 'currency': 'usd'}
without a voucher: 401 not a Limitr Network request
```

What happened:

- **The policy is the price list.** The plan, its entitlement, and the credit's price are ordinary Limitr (main
  tutorial, chapters 2 to 6). `network.provider` adds the service's name (it names its tools: `acme_weather_forecast`),
  its URL, the plans it offers on the network, and its **routes**.
- **A route** is a request a customer may make: a method and path, its parameters (they become the tool's input), and
  optionally the entitlement it meters (`entitlement: 'forecasts'` meters one forecast before the work runs; chapter 4
  meters in the work instead). Its `description` is what an agent reads to decide when to call it.
- **`weather.network()`** loads the Network module and gives the policy an identity: a key pair. The policy signs
  through it but never holds the secret key. A real service passes its key (`secret_key=`) so it stays the same
  across restarts, since vouchers are made out to it; `LimitrNetwork.generate_key()` makes one.
- **One handler** serves the protocol's own paths (the manifest at `/.well-known/limitr-network`, vouchers, cancels)
  and every route: `network.handle(request, work)` takes a `Request` and returns a `Response` (both from `limitr`).
  `network.wsgi(work)` is the same handler as a WSGI app, for gunicorn or waitress, or mounted in Flask or Django;
  `network.serve(work, port=...)` runs it on a thread with the standard library, as here. The work function runs
  only for a request that's signed by a voucher's key, not a replay, and allowed by the policy. It gets a
  `NetworkCall` (`route`, `customer`, `query`, `body`), and whatever it returns is the response body (a dict as JSON,
  a str as text, or a `Response`).
- **The manifest** is the service's **terms**, signed by its key: its plans, what each credit costs in runes (never
  what it costs the service), and its routes. It's built from the policy, so the price an agent agrees to is the
  price the policy charges.
- **A plain request is refused** (401) before any work runs. Without a voucher there's no customer to meter.

Next: [A consumer](03-a-consumer.md)
