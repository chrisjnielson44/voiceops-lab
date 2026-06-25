# VoiceOps — LiveKit voice agent

The deployable voice counterpart to the in-app text agent. Same payer-ops
behavior and the **same Neon ground-truth tools**, but over a real STT → LLM →
TTS pipeline. The LLM points at the local MLX server, so inference stays
on-device.

> Not auto-deployed. Real audio needs STT/TTS provider keys, and deploying to
> LiveKit Cloud requires interactive auth with **your** account.

## Run locally

```bash
cd agent
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in LOCAL_LLM_*, DATABASE_URL_UNPOOLED, and an STT/TTS key
python agent.py dev
```

With no STT/TTS key the agent still loads (LLM + tools wired); add a provider
(`OPENAI_API_KEY`, or Deepgram/Cartesia/ElevenLabs plugins) for real speech.

## Deploy to LiveKit Cloud

These steps are interactive and tied to your LiveKit account, so run them
yourself (in Claude Code you can prefix with `!`):

```bash
brew install livekit-cli
lk cloud auth            # opens a browser to authenticate your account
lk agent create          # registers + deploys this directory (uses Dockerfile)
```

`lk agent create` reads `livekit.toml` and the `Dockerfile`. After deploy,
connect a SIP trunk (LiveKit SIP or Twilio) to place real calls. The web app's
Telephony tab tracks the same configuration checklist.

## Architecture

- `agent.py` — `AgentSession` (STT/LLM/TTS/VAD) + `PayerOpsAgent` with
  `@function_tool` methods (`lookup_patient`, `verify_eligibility`,
  `verify_claim`, `escalate`) that query Neon directly.
- LLM via the OpenAI plugin pointed at `LOCAL_LLM_BASE_URL` (MLX).
- VAD via Silero (local). STT/TTS pluggable.
