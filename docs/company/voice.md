# Voice — talking to the company

Two ways in, both already wired:

## 1. From Claude's apps (MCP) — recommended for phone and hands-free

The runtime ships an MCP server (`runtime/src/mcp.ts`) that exposes the
company to any MCP client. Claude Desktop, Claude Code and the Claude
mobile app already do voice; pointing them at the company makes "what is
waiting for me?" or "approve the LinkedIn post" a spoken exchange with no
speech engineering on our side.

```bash
# Claude Code
claude mcp add hive-company -- node C:/path/to/ai-alpha-hive/runtime/dist/src/mcp.js --url http://localhost:4700 --company prodigal-ai

# Claude Desktop (claude_desktop_config.json)
{ "mcpServers": { "hive-company": { "command": "node", "args": ["…/runtime/dist/src/mcp.js", "--url", "http://localhost:4700", "--company", "prodigal-ai"] } } }
```

Tools: `list_companies`, `company_status`, `pending_approvals`,
`decide_approval`, `start_mission`, `recent_events`, `ask_company`,
`treasury`, `statement`, `pause_company`, `resume_company`. Every call goes
through the worker's HTTP API, so gates and audit apply unchanged. Set
`HIVE_API_TOKEN` on both sides when the worker is reachable beyond
localhost.

## 2. In the product (Voice screen)

`/c/<slug>/voice` is a conversation with the **board assistant**
(`runtime/src/board.ts`): a read-everything agent that can start missions
and decide approvals only on explicit instruction, and that says what it
did. Speech:

| Layer | Default | With a provider in the vault |
|---|---|---|
| Speech in | browser Web Speech API (Chrome/Edge) | `voice.stt: openai` (gpt-4o-transcribe) or `deepgram` (nova-3) via `POST /voice/stt` |
| Speech out | browser `speechSynthesis` | `voice.tts: openai` (gpt-4o-mini-tts) or `elevenlabs` (flash v2.5) via `POST /voice/tts` |

```yaml
voice:
  stt: browser        # browser | openai | deepgram
  tts: elevenlabs     # browser | openai | elevenlabs
  voice_id: 21m00Tcm4TlvDq8ikWAM
```

Keys (`OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`) live in
the company vault; the browser only ever receives audio.

## 3. Telegram voice notes

Board commands work as text (`/status`, `/approvals`, `/approve`, `/deny`,
`/statement`, `/mission`, `/ask`) and as **voice notes**: the poller in
`runtime/src/telegram.ts` downloads the OGG through `getFile`, transcribes
it with the company's server STT, and routes the words like a typed
command:

| Note starts with | Becomes |
|---|---|
| "mission …" | `/mission …` (a task tree is planned) |
| "approve …" / "deny …" + the first characters of a pending approval id | `/approve <id>` / `/deny <id> [note]` |
| anything else (including "approve the LinkedIn post") | `/ask …` — the board assistant, same rules as the Voice screen |

The reply is text, prefixed with what was heard; when `voice.tts` is set
the same answer is also sent back as a voice bubble (`sendVoice`, OGG or
MP3 as the provider returns it). Every note is logged as `telegram.voice`
with the chat id and a transcript preview.

What to store, because Telegram has no browser to transcribe in:

- Vault: `OPENAI_API_KEY` (STT via gpt-4o-transcribe, TTS via
  gpt-4o-mini-tts) **or** `DEEPGRAM_API_KEY` (STT via nova-3); optionally
  `ELEVENLABS_API_KEY` for the spoken reply.
- Company yaml:

```yaml
voice:
  stt: openai              # openai | deepgram — required for voice notes
  tts: elevenlabs          # optional: openai | elevenlabs
  voice_id: 21m00Tcm4TlvDq8ikWAM
```

Without `voice.stt` the bot answers a voice note with a one-line hint
naming the secret and the yaml line to add.

## Rules the assistant follows

- Two to five sentences, no lists, no markdown: written to be spoken.
- Decides an approval only when the human names it and says approve or
  deny; otherwise reads the pending list back and asks which.
- Every action is logged (`approval.decided by: voice`, `task.planned by:
  voice`) and shown under the reply.
- Amounts are spoken in whole currency units.

## Latency budget

Browser STT → `/ask` (one or two model turns) → TTS. With
`claude-sonnet-5` for the executive role the round trip is a few seconds;
the executive's model is used because it knows the company best. A
dedicated `voice_model:` override is a one-line addition when needed.
