const form = document.getElementById("timer-form");
const durationInput = document.getElementById("duration");
const statusList = document.getElementById("status");

/** @type {Map<string, { id: string; endsAtMs: number; status: string; remainingMs: number; completedAt?: number }>} */
const timers = new Map();

let animationFrame;

function formatRemaining(ms) {
  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0 && seconds > 0) {
    return `${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

function ensureAnimation() {
  if (animationFrame == null) {
    animationFrame = requestAnimationFrame(updateTimerRows);
  }
}

function updateTimerRows() {
  animationFrame = null;
  if (timers.size === 0) {
    return;
  }

  const now = Date.now();
  let structureDirty = false;

  statusList.querySelectorAll("[data-timer-id]").forEach(row => {
    const timerId = row.dataset.timerId;
    if (!timerId) {
      return;
    }
    const data = timers.get(timerId);
    if (!data) {
      row.remove();
      return;
    }

    const remainingMs = Math.max(data.endsAtMs - now, 0);
    const remainingElement = row.querySelector("[data-remaining]");
    if (remainingElement) {
      remainingElement.textContent = `${formatRemaining(remainingMs)} remaining`;
    }

    const stopButton = row.querySelector("button[data-stop]");
    if (stopButton instanceof HTMLButtonElement) {
      const completed = remainingMs === 0 || data.status === "completed";
      stopButton.disabled = completed;
      stopButton.textContent = completed ? "Done" : "Stop";
      if (completed) {
        data.status = "completed";
        data.remainingMs = 0;
        data.completedAt = data.completedAt ?? now;
      } else {
        data.status = "running";
        data.remainingMs = remainingMs;
        data.completedAt = undefined;
      }
    }

    if (data.status === "completed" && typeof data.completedAt === "number" && now - data.completedAt > 1500) {
      timers.delete(timerId);
      structureDirty = true;
    }
  });

  if (structureDirty) {
    renderStructure();
    return;
  }

  if (timers.size > 0) {
    animationFrame = requestAnimationFrame(updateTimerRows);
  }
}

function renderStructure() {
  if (timers.size === 0) {
    statusList.innerHTML = "<p>No active timers.</p>";
    return;
  }

  const fragment = document.createDocumentFragment();
  timers.forEach(timer => {
    const row = document.createElement("div");
    row.className = "timer-row";
    row.dataset.timerId = timer.id;

    const remaining = document.createElement("span");
    remaining.dataset.remaining = "true";
    remaining.textContent = `${formatRemaining(timer.remainingMs)} remaining`;
    row.append(remaining);

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.stop = timer.id;
    const completed = timer.status === "completed" || timer.remainingMs <= 0;
    button.textContent = completed ? "Done" : "Stop";
    button.disabled = completed;
    row.append(button);

    fragment.append(row);
  });

  statusList.replaceChildren(fragment);
  ensureAnimation();
}

function syncTimers(latest) {
  const known = new Set();
  latest.forEach(timer => {
    const existing = timers.get(timer.id);
    const endsAtMs =
      typeof timer.endsAt === "string" ? Number(new Date(timer.endsAt).getTime()) : Date.now() + timer.remainingMs;
    timers.set(timer.id, {
      id: timer.id,
      endsAtMs,
      remainingMs: timer.remainingMs,
      status: timer.status ?? existing?.status ?? "running",
      completedAt: existing?.completedAt
    });
    known.add(timer.id);
  });

  [...timers.keys()].forEach(id => {
    if (!known.has(id)) {
      timers.delete(id);
    }
  });

  renderStructure();
}

async function callTool(tool, args) {
  if (!window.openai?.callTool) {
    statusList.innerHTML = "<p>timer controls require an OpenAI Apps environment.</p>";
    throw new Error("window.openai.callTool is not available in this surface.");
  }
  const result = await window.openai.callTool(tool, args);
  const latest = result?.output?.timers ?? [];
  syncTimers(latest);
  ensureAnimation();
  return latest;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const duration = Number(durationInput.value);
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }
  const submitButton = form.querySelector("button");
  if (!(submitButton instanceof HTMLButtonElement)) {
    return;
  }
  submitButton.disabled = true;
  try {
    await callTool("timer", { duration });
  } catch (error) {
    console.error("Failed to start timer", error);
  } finally {
    submitButton.disabled = false;
  }
});

statusList.addEventListener("click", async event => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  if (target.disabled) {
    return;
  }
  const timerId = target.dataset.stop;
  if (!timerId) {
    return;
  }
  target.disabled = true;
  try {
    await callTool("timer", { action: "stop", id: timerId });
  } catch (error) {
    console.error("Failed to stop timer", error);
    target.disabled = false;
  }
});

async function refresh() {
  try {
    await callTool("timer", { action: "list" });
  } catch (error) {
    console.error("Failed to refresh timers", error);
  }
  requestAnimationFrame(() => setTimeout(refresh, 1000));
}

refresh();
