"""
Scenario packs — the domain-agnostic core. A *pack* bundles everything a single
domain needs to run a real call: its scenarios, the agent/counterparty/predictor
prompts, a tool set (real SQL against that domain's tables), ground-truth
loading, and the entity references the orchestrator threads into tool calls.

Healthcare is just one pack (`app.packs.healthcare`). The orchestrator and the
voice/scenarios routers resolve a scenario's pack from the registry and stay
domain-neutral. See `app.packs.base.Pack` and `app.packs.registry`.
"""
