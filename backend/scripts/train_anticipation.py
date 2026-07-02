"""Train the anticipation learner by running local-model simulations.

This is not gradient training of the LLM. It runs real VoiceOps simulations with
the configured local OpenAI-compatible model(s), captures prefetch hit/miss
feedback, and persists those observations into `prediction_learner_stats`.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import time
from collections import Counter
from typing import Any

from app import db
from app.agent.dispatch import run_call
from app.agent.run_store import create_run
from app.config import settings
from app.llm.local_llm import local_llm_health, local_model_id
from app.packs import custom_store
from app.packs.registry import all_scenarios


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local-model sims to train persisted anticipation priors.")
    parser.add_argument("--runs", type=int, default=6, help="Total simulation runs to execute.")
    parser.add_argument(
        "--scenario",
        action="append",
        dest="scenarios",
        help="Scenario id to train on. Repeat for multiple. Defaults to all built-in/custom scenarios.",
    )
    parser.add_argument("--model", default=None, help="Agent model id. Defaults to LOCAL_LLM_MODEL.")
    parser.add_argument(
        "--fast-model",
        default=None,
        help="Fast model for payer/predictor. Defaults to LOCAL_LLM_FAST_MODEL, then --model.",
    )
    parser.add_argument("--engine", choices=["legacy", "langgraph"], default="legacy", help="Simulation engine to use.")
    parser.add_argument("--timeout-sec", type=float, default=240.0, help="Per-run timeout.")
    parser.add_argument("--migrate", action="store_true", help="Run Alembic migrations before training.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON only.")
    return parser.parse_args()


def _run_id() -> str:
    return f"train_{int(time.time() * 1000):x}_{secrets.token_hex(3)}"


async def _learner_stats(scenario_ids: list[str]) -> list[dict[str, Any]]:
    if not scenario_ids:
        return []
    rows = await db.query(
        """SELECT scenario_id, tool, hits, misses, updated_at
           FROM prediction_learner_stats
           WHERE scenario_id = ANY($1::text[])
           ORDER BY scenario_id, tool""",
        [scenario_ids],
    )
    return rows


def _summarize_run(run) -> dict[str, Any]:
    kinds = Counter(e.get("kind") for e in run.events)
    done = next((e for e in reversed(run.events) if e.get("kind") == "done"), {})
    last_set = next((e.get("predictionSet") for e in reversed(run.events) if e.get("kind") == "predictionSet"), None)
    return {
        "runId": run.id,
        "scenarioId": run.scenario_id,
        "outcome": done.get("outcome") or ("stopped" if run.stopped else "unknown"),
        "events": dict(kinds),
        "predictionStats": dict(run.pred_stats),
        "lastPredictionSet": last_set,
    }


def _upgrade_head() -> None:
    from alembic import command
    from alembic.config import Config

    command.upgrade(Config("alembic.ini"), "head")


async def _amain(args: argparse.Namespace) -> int:
    if args.runs <= 0:
        raise SystemExit("--runs must be positive")

    settings.agent_engine = args.engine
    if args.fast_model is not None:
        settings.local_llm_fast_model = args.fast_model

    model = args.model or local_model_id()
    health = await local_llm_health()
    if not health.get("ok"):
        raise SystemExit(
            f"Local LLM is not reachable at {settings.local_llm_base_url}: {health.get('detail')}. "
            "Start MLX/Ollama/OpenAI-compatible server first."
        )

    await db.connect()
    try:
        await custom_store.load_all()
        scenario_map = {s.id: s for s in all_scenarios()}
        scenario_ids = args.scenarios or sorted(scenario_map)
        unknown = [sid for sid in scenario_ids if sid not in scenario_map]
        if unknown:
            raise SystemExit(f"Unknown scenario id(s): {', '.join(unknown)}")

        before = await _learner_stats(scenario_ids)
        results: list[dict[str, Any]] = []
        for idx in range(args.runs):
            scenario_id = scenario_ids[idx % len(scenario_ids)]
            run = create_run(id=_run_id(), scenario_id=scenario_id, model=model, user_id="trainer")
            try:
                await asyncio.wait_for(run_call(run), timeout=args.timeout_sec)
            except TimeoutError:
                run.stopped = True
                run.abort.set()
                results.append({"runId": run.id, "scenarioId": scenario_id, "error": "timeout"})
                continue
            results.append(_summarize_run(run))

        after = await _learner_stats(scenario_ids)
        output = {
            "model": model,
            "fastModel": settings.local_llm_fast_model or model,
            "engine": settings.agent_engine,
            "runsRequested": args.runs,
            "runsCompleted": sum(1 for r in results if not r.get("error")),
            "scenarios": scenario_ids,
            "learnerBefore": before,
            "learnerAfter": after,
            "runs": results,
        }
        if args.json:
            print(json.dumps(output, default=str))
        else:
            print(json.dumps(output, indent=2, default=str))
        return 0
    finally:
        await db.disconnect()


def main() -> None:
    args = _parse_args()
    if args.migrate:
        _upgrade_head()
    raise SystemExit(asyncio.run(_amain(args)))


if __name__ == "__main__":
    main()
