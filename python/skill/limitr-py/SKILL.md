---
name: limitr-py
description: >
  Use Limitr from Python with the limitr package (pip install limitr): create the engine, load policies and
  customers, gate calls with allow/check, feature flags and rollouts, give or take a customer's features, reserve
  and settle LLM calls, predict output tokens before a call, handle events, persist customer state, connect to
  Limitr Cloud, load the Limitr Network module (limitr.network(), see the limitr-network skill), and govern calls
  made with the Anthropic Python SDK. Use for code that imports limitr or calls Limitr(...) / Limitr.cloud, and for
  integrating usage limits, credits, or pricing into a Python app (FastAPI, Flask, Django, workers, agents). Load the
  limitr skill for policy semantics and the stof skill for Stof syntax.
---

# Limitr for Python

`limitr` embeds the Limitr engine (the Stof spec compiled to BSTF) in a Stof document (`pystof`, from the `stof`
package) and wraps the policy's functions (at `root.policy`) as methods. It runs in-process; no network calls happen in
any hot path, and Cloud mode syncs over a background WebSocket.

This skill covers the Python API. What a policy means and how a call is decided is in the **limitr** skill; read it
before designing a policy or explaining a result. The API is the TypeScript SDK's (the **limitr-ts** skill) in
snake_case, with options as keyword arguments and no `await`.

## Install

```bash
pip install limitr
```

Python 3.8+. It depends on `stof` (0.11.6 or later) and `websockets` (for Cloud). A tutorial with runnable programs is
in the repo's `python/tutorial` (and `python/tutorial/network`).

## Create the engine

```python
from limitr import Limitr

limitr = Limitr("""
policy: {
    credits: {
        request: { label: 'Request' }
        ai_token: { price: { amount: 0.00002 }, overhead_cost: 0.000003 }
    }
    plans: {
        free: {
            default: true
            entitlements: {
                export_pdf: {}
                api: { limit: { credit: 'request', value: 1000, resets: true, reset_inc: 1day } }
                chat: { limit: { credit: 'ai_token', mode: 'soft', value: 50_000, resets: true } }
            }
        }
    }
}""")
```

- `Limitr(policy, format='stof', validate=True)` (or `Limitr.new(...)`) loads the engine and the policy, and raises
  `ValueError` with the validation message if the policy is invalid. `policy` can be text (Stof, or JSON, YAML, TOML
  with `format`), a dict, or BSTF bytes.
- `limitr.valid()` returns `(ok, message)`. `limitr.version()` is the engine version.
- Create one engine per process (or per policy) and keep it. It holds all customer state in memory.
- Thread-safe: every method is one engine call behind the instance's lock, and a running call lets other threads go
  on (the GIL is released while the engine runs). Two calls in a row are not atomic: see "Gate calls".

## Customers

```python
limitr.ensure_customer(user_id, 'pro', 'user', 'Ada', refs=[org_id], alts=[auth_id])  # creates if missing, True if created
limitr.create_customer(org_id, 'pro', 'org', 'Acme')                     # returns the customer record
limitr.set_customer_plan(user_id, 'team')                                # plan change (resets meters by default)
limitr.set_customer_period(org_id, sub.current_period_start * 1000, sub.current_period_end * 1000)  # billing period, ms
limitr.set_customer_expires(trial_id, time.time() * 1000 + 14 * 86_400_000)  # access ends (None: never)
limitr.customer(user_id)                                                 # dict, or None
```

Arguments are `(id, plan='', type='user', label='User', refs=None, alts=None, metadata=None)`. An empty plan inherits
from refs, then the policy's default plan. Use refs for user to team to org, and alts for other IDs (auth subject,
Stripe customer) that should resolve to the same customer. A customer's plan, gives, rules, and shared caps come
through refs only when the customers they lead to are loaded: without Cloud, load (or ensure) the org and team before
the user; with Cloud, they're loaded with it.

Times are ms since the epoch (`time.time() * 1000`) or a `datetime`. `set_customer_plan(id, plan,
overwrite_meters=False)` keeps usage across the plan change. IDs and alt IDs can't contain a period (the customer isn't
created): replace an email's periods, or keep it in metadata.

## Gate calls

```python
if not limitr.allow(user_id, 'export_pdf'):        # feature flag
    raise Forbidden()
if not limitr.allow(user_id, 'api', 1):            # meter one request
    raise TooManyRequests()
limitr.allow(user_id, 'storage', '250MB')          # units in a string
limitr.increment(org_id, 'seats')                  # the limit's increment
ok = limitr.check(user_id, 'api', 50)              # dry run, changes nothing
```

`allow(customer, entitlement, value=0, event=True, overhead=None, force=False, detail=False)` and
`check(customer, entitlement, value=0, context=None, overhead=None, detail=False)`:

- `event`: True, False (no events), or event data (a dict or string). Event data is sent with the events as
  `event_data` and is the context for the credit's `overhead()` cost function (Ex. `{'model': m, 'input': i, 'output': o}`).
- `overhead`: the call's real provider cost in runes (USD by default), when you have it. It overrides the cost function.
- `force`: record usage that already happened, even past a hard limit or cap.
- `detail`: return the decision (a dict: `allowed`, `reason`, `used`, `limit`, `remaining`, `allowance`, `held`,
  `resets`, `access`, `limit_source`) instead of a bool. Tell a user or an agent why:

```python
d = limitr.check(user_id, 'api', 50, detail=True)
if not d['allowed']:
    return deny(f"Monthly limit reached, resets {d['resets']}" if d['reason'] == 'limit' else d['reason'])
```

Reads: `value`, `remaining`, `limit`, `allowance`, `cost`, `resets`, `rate`, `acceleration`, `projected_exhaustion`,
`remaining_credit`, `meter_object`, `limit_object`, `entitlement`, `plan`, `credit`, `credit_exchange`. Exchange rates
change at runtime with `set_exchange_pair(name, value, currency='rune')`, `exchange_pair(name)`, and
`remove_exchange_pair(name)`.

Each method call is atomic, but two calls are not: another request can run between a `check` and the following
`allow`. When concurrent requests must not overspend, use `reserve`. For one action with several entitlements, go
gates (`check`), then holds (`reserve`), then counts (`allow`), and `release` the holds if a count is refused.

## Feature flags and custom deals

Rollouts, kill switches, and per-call rules live in the policy (an entitlement's `enabled`, see the limitr skill), so
the app code stays the same `check`/`allow`:

```python
if not limitr.check(user_id, 'ai_assistant'):                                  # rollout decided by the policy
    raise NotFound()
show = limitr.check(user_id, 'new_checkout', 0, {'country': request.country})  # rule reads event data
features = limitr.features(user_id, {'country': request.country})             # everything usable now, for the UI

limitr.give_entitlement(org_id, 'sso')                                         # from the closest plan that has it
limitr.give_entitlement(org_id, 'api', 'enterprise', time.time() * 1000 + 14 * 86_400_000)  # that plan's limit, 14 days
limitr.take_entitlement(org_id, 'exports')                                     # pause one feature
limitr.restore_entitlement(org_id, 'exports')

limitr.set_customer_rules(org_id, ['acme_2027'])                               # the policy's rules, by name
limitr.entitlement_source(user_id, 'api')       # {'access': 'ref:org_1', 'limit': 'plan', 'customer': user_id}
```

- `features(customer, context=None)` returns entitlement names (None for an unknown customer). It's access, not
  capacity: a used-up metered entitlement is listed, so still `allow` usage.
- Gives and takes are stored on the customer (`given`, `taken`), so persisting customers persists them. An org's
  apply to the users on its plan. Per-customer targeting (a beta list) is customer metadata, read by a rule as
  `customer.metadata`.
- Entitlements with `track: True` send `feature-checked` on every check: forward it to your analytics.

## LLM calls: reserve, then settle

The policy's `chat` entitlement declares `estimate_basis: 'input'` and `estimate_segment: 'model'` (see the limitr
skill), so the event data alone sizes each prediction:

```python
import anthropic

client = anthropic.Anthropic()
hold = limitr.reserve(user_id, 'chat', context={'model': model, 'input': input_tokens})
if not hold:
    raise PaymentRequired()
try:
    res = client.messages.create(model=model, max_tokens=1024, messages=messages)
    used = res.usage.input_tokens + res.usage.output_tokens
    limitr.settle(user_id, 'chat', hold, used,
                  {'model': model, 'input': res.usage.input_tokens, 'output': res.usage.output_tokens})
except Exception:
    limitr.release(user_id, 'chat', hold)
    raise
```

- `reserve(customer, entitlement, value=None, context=None, basis=None, segment=None, ttl=None, quantile=0.9,
  overhead=None)` returns a hold ID, or None (not allowed now). Without `value`, it holds the predicted amount, or the
  standard increment until something has been learned.
- `settle(customer, entitlement, hold, value, event=True, overhead=None, basis=None, segment=None)` records the real
  usage and learns from it. Pass the provider's reported cost as `overhead` when you have it.
- `release` drops a hold; `held` is the room held now. Unsettled holds expire after the policy's `hold_ttl` (10 min).
- `estimate(customer, entitlement, context=None, quantile=0.9)` returns `{'value', 'overhead', 'samples', 'source',
  'scope'}` or None. `observe(customer, entitlement, value, context=None, overhead=None)` records a call without a
  hold.
- Keep the segment field's values low-cardinality (a model name, a feature), never a user or request ID.

Per-model billing without estimates: a credit and an entitlement per model and direction (`sonnet_input`,
`sonnet_output`), recorded after the call with `allow(user_id, f'{model}_input', res.usage.input_tokens)`.

### Predict output tokens before a call

Add an entitlement with no limit next to `chat` (never metered, so it only learns):
`chat_output: { estimate_basis: 'input', estimate_segment: 'model' }`. Record each call's output, then ask before the
next one:

```python
limitr.observe(user_id, 'chat_output', res.usage.output_tokens,
               context={'model': model, 'input': res.usage.input_tokens})          # after the call
p = limitr.estimate(user_id, 'chat_output', context={'model': model, 'input': input_tokens}, quantile=0.5)
expected_output = p['value'] if p else None   # None until something has been learned for this model
```

### Tools for Claude

Capabilities in the policy (and Limitr Network routes) are tools: `limitr.claude_tools(customer)` lists the ones the
customer can use, ready for `tools=` in `client.messages.create`; for each `tool_use` block,
`limitr.claude_tool_use(block.model_dump(), customer)` returns the `tool_result` to send back (or
`limitr.run_capability(block.name, block.input, customer)` for the raw result).

## Spend caps

```python
limitr.add_customer_cap(org_id, 500, cap_id='org_monthly', shared=True, resets=True, reset_sch='monthly:1')
limitr.add_customer_cap(user_id, 15, credit='euro', overage_only=True)
limitr.customer_cap(org_id, 'org_monthly')       # dict (meter_value is spend so far)
limitr.reset_customer_cap(org_id, 'org_monthly')
limitr.remove_customer_cap(org_id, 'org_monthly')
```

Keyword options: `cap_id`, `credit` (default `'rune'`), `exchangeable`, `ignore_grants`, `overage_only`,
`observe_only`, `overhead_cost`, `follow_decrements`, `hard_trailing`, `shared`, `shared_with`, `scope`, `resets`,
`reset_inc` (ms), `reset_sch`, `expires_on`, `send_events`. Returns None if the cap ID already exists.

Margins for a pipeline or session: `start_margin_measurement(customer, cap_id)` adds two observe-only caps;
`capture_margin_measurement(customer, cap_id)` returns `{'charged', 'costs', 'margin', 'raw_margin'}` and removes
them. `customer_margin_snapshot(customer)` is the customer's margin this period.

## Grants and topups

`apply_customer_topup(customer, topup)` after a purchase, `ensure_customer_included_topups(customer)` for included
topups, `remaining_credit(customer, credit)` for the balance, and `ensure_customer_plan_quantity(customer)` to charge
the plan's subscription entitlement once. On Limitr Cloud, `apply_customer_topup` asks Cloud to buy the topup: Cloud
charges first, then the grant arrives; it returns False if the charge failed or Cloud didn't answer in 30 seconds.

## Events

```python
def billing(name, event):
    if name == 'meter-overage':
        charge(event['customer']['id'], event['entitlement'], event['overage_price'])
    elif name == 'customer-set':
        db.customers.put(event['id'], event)

limitr.add_handler('billing', billing)
```

- Handlers receive `(name, value)`; objects arrive as dicts (unlike TypeScript's JSON strings). All handlers get every
  event. `remove_handler(name)` and `clear_handlers()` manage them.
- Handlers run during the engine call that sent the event, on that thread: keep them quick, and don't call the same
  Limitr instance from one (queue the work instead). A coroutine handler is scheduled on the running event loop.
- A handler that raises is logged (the `limitr` logger) and skipped; the call that sent the event isn't affected.
- Event names and payloads are in the limitr skill (`references/events.md`). Meter events carry the call's cost
  (`meter.overhead_diff`) and list price (`meter.price_diff`) in runes.

## Persist customer state

Without Cloud, save customers and load them back: save on `customer-set` and meter events (their `customer` carries
its meters), or periodically from `limitr.customers()` (a dict by ID); load on startup with `load_customers(records)`
(a list or a dict by ID), or `set_customer(record)` one at a time (`ensure_set_customer` only sets a missing one).

## Change the policy at runtime

`set_plan(id, plan_stof)`, `delete_plan(id)`, `set_notifications(stof)`, `set_capabilities(stof)`, and
`difference(other)`. For anything else, call the engine directly: `limitr.doc_call('policy.some_function', *args)`.
`limitr.doc` is the underlying `pystof.Doc`, for host functions the policy can call
(`limitr.doc.lib('App', 'name', fn)`) or HTTP from the policy (`limitr.doc.allow_http_hosts(['api.example.com'])`). A
local policy is sandboxed: no network, files, or environment unless you add them. Every policy call has a time limit
(5 seconds by default; `limitr.set_max_execution_time(ms)`).

## Limitr Cloud

```python
limitr = Limitr.cloud(os.environ['LIMITR_TOKEN'])   # None if Cloud refuses the token (the limitr logger says why)
```

- Cloud sends the active policy (and updates to it, live), and customers on demand. Everything else is the same API.
- Keyword options: `policy` (an ID, or `'active'`), `connect_timeout` (ms, 5000), `deny_unconnected` (default True:
  refuse calls while disconnected, with the reason `unconnected`), `validate`, `http_hosts` (True: any public host),
  `max_execution_time` (ms), `batch_ms` (250; 0 sends each update right away).
- A customer not loaded locally is fetched from Cloud on first use (`add_cloud_customer`), with the customers its refs
  lead to, and `ensure_customer` creates it only when Cloud doesn't have it. `connected` says whether it's connected;
  it reconnects on its own.
- Call `limitr.close()` on shutdown to send pending updates.
- **Never put a key where users can read it** (a desktop app, a script you hand out, a browser). The server mints a
  client token for the signed-in customer: `POST https://api.limitr.dev/v1/server/client-tokens` with
  `Authorization: Bearer <key>` and `{ customer, ttl_seconds? }` returns `{ token, customer, expires }` (an hour by
  default, 60 to 86,400 seconds; the customer must exist, or 404). The client connects with `Limitr.cloud(token)`.
  A token reaches only that customer and the customers its refs lead to, meters usage but can't create or change
  customers, and stops when it expires or its key is deleted. A Python server mints them for its web clients the same
  way (Ex. with `urllib.request` or `httpx`).
- A Cloud engine's handlers get `internal-customer-updated` (the customer, as JSON) each time Cloud sends a customer
  it holds (loaded, or changed in Cloud), after it has the new copy: a desktop app redraws from there.

## Limitr Network

`limitr.network(secret_key=..., name=..., channels=...)` loads the Network module: sell routes with
`network.handle(request, work)` (or `network.wsgi(work)` for gunicorn, Flask, Django), or buy them with
`network.connect(url, plan, spend, expires)` and run them as tools. On a `Limitr.cloud()` engine, Limitr Cloud is its
operator over the engine's connection. The **limitr-network** skill covers it.

## Common mistakes

1. **Re-creating the engine per request.** All state lives in the instance. Create it once.
2. **`check` then `allow` under concurrency.** Not atomic across requests; use `reserve` / `settle`.
3. **Calling the instance from an event handler.** It runs during that instance's call; queue the work.
4. **Seconds instead of ms.** Times are ms since the epoch (`time.time() * 1000`), or pass a `datetime`.
5. **Missing the basis.** On an entitlement with `estimate_basis`, every `reserve` and `settle` needs that field in
   its event data, or the call is metered but not learned from.
6. **High-cardinality `segment` values.** Each one keeps an estimate in memory forever.
7. **Losing state on restart** without Cloud. Persist customers from events and load them on boot.
8. **Forgetting `overhead` when the provider reports cost.**
9. **Hard-coding rollouts in the app.** Put the rule in the entitlement's `enabled`.
10. **Treating `features` as permission to use.** It lists access; metered usage still goes through `allow`.
