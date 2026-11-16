# Benchmarks

Small programs behind the numbers on [limitr.dev](https://limitr.dev). Run them yourself:

```bash
npm i @formata/limitr
node overspend.mjs
node latency.mjs

pip install limitr
python latency.py
```

## Concurrent agents and a hard allowance (`overspend.mjs`)

60 agent tasks start at once against a customer's 1,000,000-token monthly allowance. Each uses 25,000 to 45,000
tokens, known only when it finishes (2,107,107 tokens of demand in all). The same tasks run two ways:

- **Check, then record:** each task asks whether anything is left, runs, then records what it used. This is how a
  usage counter works, wherever it lives: every task starts before any of them has finished, so every check passes.
- **Reserve, then settle:** each task holds the most it can use (`reserve`), runs, then records what it really used
  and frees the rest (`settle`). Holds count against each other, so a task that doesn't fit waits for room.

| | Tasks run | Tokens used | vs the allowance |
|---|---|---|---|
| Check, then record | 60 | 2,107,107 | 2.1× (111% over) |
| Reserve, then settle | 27 | 953,334 | inside |

With engine 0.8.7. The task sizes come from a fixed seed, so every run gives the same numbers.

## How long a decision takes (`latency.mjs`, `latency.py`)

20,000 calls each, after a warm-up, on one customer, in one process:

| | p50 | p99 |
|---|---|---|
| TypeScript `allow` | 1.6 ms | 3.0 ms |
| TypeScript `check` | 0.7 ms | 1.2 ms |
| Python `allow` | 1.0 ms | 1.9 ms |
| Python `check` | 0.4 ms | 0.8 ms |

On a 2-core 2.3 GHz Xeon cloud VM, with Node 22 and Python 3.13. `allow` meters and sends events; `check` only
decides. There's no network call in either.
