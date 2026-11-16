# Recipes (Python)

Copy-in code for using Limitr with other libraries, each with its tests. The same recipes in TypeScript are in
[typescript/recipes](../../typescript/recipes).

- [claude-agent-sdk](claude-agent-sdk): govern agents built on the Claude Agent SDK (`claude-agent-sdk`): hide tools by
  plan, decide and count every tool call, meter every model response, and stop a run when its tokens run out.
- [claude-messages](claude-messages): govern calls made with the Anthropic SDK (`anthropic`): offer only the tools a
  customer can use, cap `max_tokens` at what's left, hold room while a call runs, and record the real usage.

Each folder runs on its own:

```bash
cd claude-agent-sdk
pip install -r requirements.txt
pytest
```

The tests use the real engine and fakes for the API, so they need no API key. The docs show the same code:
[Claude Agent SDK](https://limitr.dev/docs/how-to/claude-agent-sdk) and
[Claude Messages API](https://limitr.dev/docs/how-to/claude-messages-api).
