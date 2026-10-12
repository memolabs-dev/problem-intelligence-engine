# Problem Intelligence Engine
Evidence-first opportunity discovery. Local MVP scaffold, not production-ready.

## Run
`pnpm test` or `npm test` (Node 20+). No network, keys or database required for the initial scoring module.

## LLM key
`packages/agents/llm.mjs` speaks the OpenAI chat-completions API against any compatible
provider (`openai`, `openrouter`, or `custom`). Copy `.env.example` to `.env`, put one key
in it, then check the wiring:

```
cp .env.example .env    # then fill in PIE_LLM_API_KEY or the provider key var
pnpm llm:check          # prints provider, model, endpoint, keyPresent:true/false
```

The check never prints the key. `.env` is gitignored; `.env.example` holds no secrets.

Jev / TypeSafe is intentionally not wired here. Its API returns typed `noul`/`choice`/`score`
judgements rather than generated JSON, so it cannot supply the verbatim `evidenceQuote` that
`validateExtraction` requires for grounding. A Jev key belongs in the agent runtime that owns
the MCP server, not in this repository.

## Next milestone
Add authorized GitHub Issues and Hacker News connectors, raw observation schema, evidence-linked extraction, and an evaluation dataset before implementing market research agents.
