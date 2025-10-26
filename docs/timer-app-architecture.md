# TimerGPT Architecture & UX Plan

## Goals
- Provide a conversational-first timer experience that feels native inside ChatGPT.
- Follow Apps SDK design guidelines for surfaces, visual hierarchy, and tone.
- Support multiple concurrent timers with natural-language control and lightweight UI affordances.

## User Journeys
1. **Create a timer inline**
   - User asks: “Set a 25-minute pomodoro timer.”
   - App replies with an inline summary card showing timer name, duration, start/stop controls.
   - Timers start automatically and the card updates with remaining time badges.
2. **Review and adjust timers in inspect mode**
   - User opens the inspect view to see all active/completed timers.
   - Inspect layout lists timers with status, remaining time, and quick actions (pause, resume, extend).
   - A single CTA per item (“Open details” or “Resume”) keeps scannability.
3. **Deep editing in fullscreen**
   - For renaming, configuring recurring timers, or stacking multiple intervals, the fullscreen layout provides a step-by-step form.
   - Composer remains visible; user can continue typing adjustments, which the server interprets as tool calls.
4. **Persistent countdown via PiP**
   - When a timer is active, the user can pin a PiP widget that stays visible while they chat.
   - PiP shows remaining time, quick pause/resume, and auto-dismisses when all timers finish.

## Surfaces & Components
- **Inline Card (`TimerSummaryCard`)**
  - Minimal metadata: timer label, formatted remaining time, status chip.
  - Primary CTA (“Open details”) leads to inspect view; secondary actions available via conversational follow-up.
  - Badge area surfaces contextual info (e.g., “Focus”, “Break”).
- **Inspect View (`TimerListInspector`)**
  - Uses list layout with system spacing and consistent iconography.
  - Each row includes status icon, title, remaining time, and one CTA.
- **Fullscreen (`TimerComposerSheet`)**
  - Multi-step workflow for creating complex routines (interval training, recurring pomodoro sets).
  - Summary header, collapsible advanced settings, confirmation step.
- **PiP Widget (`ActiveTimerPip`)**
  - Compact countdown with progress ring.
  - Auto-closes when session ends to respect system behavior.

## Data Model
```ts
interface Timer {
  id: string;
  label: string;
  durationMs: number;
  remainingMs: number;
  status: "scheduled" | "running" | "paused" | "completed" | "cancelled";
  startedAt?: string; // ISO timestamp
  endsAt?: string;    // ISO timestamp
  repeat?: {
    intervalMs: number;
    occurrences?: number;
  };
  category?: "focus" | "break" | "custom";
}
```

Timers persist per user session via the server’s storage API. Expired timers trigger a notification message rather than unsolicited proactivity.

## Tooling & APIs
- **TimerManager Tool**
  - `startTimer`, `pauseTimer`, `resumeTimer`, `cancelTimer`, `listTimers`, `extendTimer`.
  - Validates durations, enforces a sane number of concurrent timers (≤5), ensures friendly tone in responses.
- **Notifications**
  - Uses system composer to deliver “Timer completed” messages with clear context and CTA to restart.

## Tone & Content
- Responses stay concise, action-oriented, and contextual (e.g., “Your 25-minute Focus timer is running. It ends at 3:25 PM.”).
- No promotional text; copy matches ChatGPT’s voice.
- Accessibility: textual countdowns, alt text for icons (“Progress ring showing 5 minutes remaining”).

## Open Questions
- Decide on default timer labels when user omits (fallback: “Timer #1”).
- Confirm whether recurring timers should auto-create follow-up cards or remain conversational only.
- Validate PiP update cadence vs. system limits.

