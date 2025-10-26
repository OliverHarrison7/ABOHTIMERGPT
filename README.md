# TimerGPT (ChatGPT Timer App)

TimerGPT is a multi-surface timer experience for ChatGPT built with the OpenAI Apps SDK and the Model Context Protocol (MCP). It keeps the interaction conversational while offering inline cards, inspect lists, fullscreen workflows, and an optional PiP countdown that follows the platform design guidelines.

## Features
- Natural-language control of focus, break, and custom timers.
- Inline summary card with minimal metadata and a single prominent CTA.
- Inspect view list that stays scannable with consistent hierarchy.
- Fullscreen routine builder for multi-step timer workflows.
- PiP widget for active countdowns that auto-dismisses when timers complete.
- File-backed persistence so timers survive server restarts (`.timergpt/timers.json`).
- Accessibility-first copy, neutral tone, and no unsolicited proactivity.

## Project Layout
- `app.json` — App manifest declaring available surfaces and metadata.
- `src/types.ts` — Shared timer type definitions.
- `src/state/timerStore.ts` — In-memory timer persistence and lifecycle helpers.
- `src/tools/timerTool.ts` — Zod-validated tool handlers used by the MCP server.
- `src/ui/builders.ts` — Surface builders that translate timers into inline/inspect/fullscreen/PiP payloads.
- `src/server.ts` — MCP server wiring tools to ChatGPT Apps surfaces and notifications.
- `docs/timer-app-architecture.md` — Detailed UX and architecture plan aligned with the design guidelines.

## Running Locally
> Requires Node.js 20+. Packages are listed but not installed yet.

```bash
npm install
npm run dev
```

The `dev` script now serves a Streamable HTTP endpoint at `http://127.0.0.1:2091/mcp`. For local ChatGPT testing, tunnel that port (for example `ngrok http 2091`) and use the public `/mcp` URL when creating a connector.

Timers are persisted to `.timergpt/timers.json` relative to the working directory. Override the location with `TIMERGPT_STORAGE_PATH=/custom/path.json`.

## Tests

```bash
npm run test
```

Integration tests exercise the end-to-end timer lifecycle using the Node.js test runner.

## Design Guideline Alignment
- **Minimal inline metadata:** `buildInlineCard` keeps to a single headline, succinct status line, and one CTA.
- **Inspect scannability:** `buildInspectRow` limits content to three lines and removes redundant badges.
- **Fullscreen composer:** `buildFullscreenSheet` exposes a structured, three-step experience with space for deeper edits while keeping the ChatGPT composer active.
- **PiP behavior:** `buildPip` respects auto-dismiss rules and avoids extra controls beyond pause/resume.
- **Tone & proactivity:** Messages are contextual, concise, and never promotional. Completion notifications explain why the app surfaced.
- **Accessibility:** All surfaces supply descriptive `accessibilityLabel` strings and rely on platform typography and colors.
- **Structured payloads:** `buildTimerStructuredContent` packages inline/inspect/fullscreen/PiP data for the Apps SDK runtime.

## Next Steps
1. Replace the custom structured payload with the official `@openai/chatgpt-apps` UI primitives once the package is available publicly.
2. Swap file-backed persistence for the Apps SDK storage API to support multi-user deployments.
3. Extend the UX to cover recurring timer series and pip pin/unpin commands.
4. Localize copy via the Apps SDK i18n utilities to support additional locales.
