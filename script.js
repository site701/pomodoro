// Pomodoro + YouTube sync

// ---------- State ----------
const TIMER_MODES = {
  "25_5": { focus: 25 * 60, break: 5 * 60 },
  "50_10": { focus: 50 * 60, break: 10 * 60 },
};

const DEFAULT_SOURCES = {
  work: "https://www.youtube.com/watch?v=jfKfPfyJRdk", // lofi girl live
  break: "https://www.youtube.com/watch?v=DWcJFNfaw9c", // chillhop
};

let selectedModeKey = "25_5";
let isRunning = false;
let isFocusPhase = true;
let remainingSeconds = TIMER_MODES[selectedModeKey].focus;
let intervalId = null;
let completedPomodoros = 0;
let completedTasks = 0;
let accumulatedFocusSeconds = 0;
let accumulatedBreakSeconds = 0;

let player = null; // YT player instance
let isMuted = false;

// ---------- Elements ----------
const timeDisplay = document.getElementById("timeDisplay");
const statePill = document.getElementById("statePill");
const progressRing = document.getElementById("progressRing");
const startPauseBtn = document.getElementById("startPauseBtn");
const resetBtn = document.getElementById("resetBtn");
const skipBtn = document.getElementById("skipBtn");
const cycleCount = document.getElementById("cycleCount");

const autoStartNext = document.getElementById("autoStartNext");
const musicDuringBreak = document.getElementById("musicDuringBreak");
const pauseMusicOnPause = document.getElementById("pauseMusicOnPause");

const muteBtn = document.getElementById("muteBtn");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");

const workSourceInput = document.getElementById("workSource");
const breakSourceInput = document.getElementById("breakSource");
const applyWorkSrc = document.getElementById("applyWorkSrc");
const applyBreakSrc = document.getElementById("applyBreakSrc");

const goalForm = document.getElementById("goalForm");
const goalInput = document.getElementById("goalInput");
const goalPomodoros = document.getElementById("goalPomodoros");
const goalList = document.getElementById("goalList");

const statCompleted = document.getElementById("statCompleted");
const statFocusMinutes = document.getElementById("statFocusMinutes");
const statBreakMinutes = document.getElementById("statBreakMinutes");
const statPomodoros = document.getElementById("statPomodoros");

// ---------- Utilities ----------
function secondsToMMSS(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function clamp(min, value, max) { return Math.max(min, Math.min(value, max)); }

function parseYouTubeIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      return { type: "video", id: u.pathname.slice(1) };
    }
    if (u.searchParams.get("list")) {
      return { type: "playlist", id: u.searchParams.get("list") };
    }
    if (u.searchParams.get("v")) {
      return { type: "video", id: u.searchParams.get("v") };
    }
    return null;
  } catch (e) { return null; }
}

function setProgressVisual() {
  const total = isFocusPhase ? TIMER_MODES[selectedModeKey].focus : TIMER_MODES[selectedModeKey].break;
  const done = total - remainingSeconds;
  const ratio = clamp(0, done / total, 1);
  const deg = Math.round(360 * ratio);
  progressRing.style.background = `conic-gradient(var(--accent) ${deg}deg, rgba(255,255,255,0.08) ${deg}deg)`;
}

function updateUI() {
  timeDisplay.textContent = secondsToMMSS(remainingSeconds);
  statePill.textContent = isFocusPhase ? "Фокус" : "Перерыв";
  document.body.classList.toggle("state-focus", isFocusPhase);
  document.body.classList.toggle("state-break", !isFocusPhase);
  setProgressVisual();
}

function changeMode(key) {
  selectedModeKey = key;
  remainingSeconds = isFocusPhase ? TIMER_MODES[key].focus : TIMER_MODES[key].break;
  updateUI();
}

function resetTimer() {
  isRunning = false;
  isFocusPhase = true;
  remainingSeconds = TIMER_MODES[selectedModeKey].focus;
  clearInterval(intervalId);
  intervalId = null;
  startPauseBtn.textContent = "Старт";
  updateUI();
}

function tick() {
  if (!isRunning) return;
  remainingSeconds -= 1;
  if (isFocusPhase) accumulatedFocusSeconds += 1; else accumulatedBreakSeconds += 1;
  if (remainingSeconds <= 0) {
    completePhase();
  }
  updateUI();
}

function completePhase() {
  if (isFocusPhase) {
    completedPomodoros += 1;
    statPomodoros.textContent = String(completedPomodoros);
  }
  isFocusPhase = !isFocusPhase;
  remainingSeconds = isFocusPhase ? TIMER_MODES[selectedModeKey].focus : TIMER_MODES[selectedModeKey].break;
  handleMusicOnPhaseChange();
  if (!autoStartNext.checked) {
    isRunning = false;
    startPauseBtn.textContent = "Старт";
    clearInterval(intervalId);
    intervalId = null;
  }
  if (isFocusPhase) {
    // finished a break => new cycle counted
    cycleCount.textContent = String(Number(cycleCount.textContent) + 1);
  }
}

function startTimer() {
  if (isRunning) return;
  isRunning = true;
  startPauseBtn.textContent = "Пауза";
  if (player && player.playVideo) player.playVideo();
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(tick, 1000);
}

function pauseTimer() {
  if (!isRunning) return;
  isRunning = false;
  startPauseBtn.textContent = "Старт";
  if (player && player.pauseVideo && pauseMusicOnPause.checked) player.pauseVideo();
  clearInterval(intervalId);
  intervalId = null;
}

function skipPhase() {
  completePhase();
  updateUI();
}

// ---------- Goals ----------
let goals = []; // { id, title, plannedPomodoros, donePomodoros, checked }

function persist() {
  localStorage.setItem("pomodoro_goals_v1", JSON.stringify(goals));
  localStorage.setItem("pomodoro_stats_v1", JSON.stringify({
    completedTasks, completedPomodoros, accumulatedFocusSeconds, accumulatedBreakSeconds
  }));
  localStorage.setItem("pomodoro_sources_v1", JSON.stringify({
    work: workSourceInput.value || DEFAULT_SOURCES.work,
    break: breakSourceInput.value || DEFAULT_SOURCES.break
  }));
}

function restore() {
  try {
    const savedGoals = JSON.parse(localStorage.getItem("pomodoro_goals_v1") || "[]");
    const savedStats = JSON.parse(localStorage.getItem("pomodoro_stats_v1") || "{}");
    const savedSources = JSON.parse(localStorage.getItem("pomodoro_sources_v1") || "{}");
    goals = savedGoals;
    completedTasks = savedStats.completedTasks || 0;
    completedPomodoros = savedStats.completedPomodoros || 0;
    accumulatedFocusSeconds = savedStats.accumulatedFocusSeconds || 0;
    accumulatedBreakSeconds = savedStats.accumulatedBreakSeconds || 0;
    workSourceInput.value = savedSources.work || DEFAULT_SOURCES.work;
    breakSourceInput.value = savedSources.break || DEFAULT_SOURCES.break;
  } catch (e) {}
}

function renderGoals() {
  goalList.innerHTML = "";
  goals.forEach(g => {
    const li = document.createElement("li");
    li.className = "goal-item";
    li.dataset.id = g.id;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = !!g.checked;
    check.addEventListener("change", () => {
      g.checked = check.checked;
      if (g.checked) completedTasks += 1; else completedTasks = Math.max(0, completedTasks - 1);
      updateStatsUI();
      persist();
    });

    const content = document.createElement("div");
    content.className = "content";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = g.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `Помодоро: ${g.donePomodoros}/${g.plannedPomodoros}`;
    content.appendChild(title);
    content.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";
    const incBtn = document.createElement("button");
    incBtn.className = "btn";
    incBtn.textContent = "+1";
    incBtn.title = "Добавить помодоро к задаче";
    incBtn.addEventListener("click", () => {
      g.donePomodoros = Math.min(g.plannedPomodoros, g.donePomodoros + 1);
      renderGoals();
      persist();
    });
    const decBtn = document.createElement("button");
    decBtn.className = "btn";
    decBtn.textContent = "-1";
    decBtn.title = "Убрать помодоро у задачи";
    decBtn.addEventListener("click", () => {
      g.donePomodoros = Math.max(0, g.donePomodoros - 1);
      renderGoals();
      persist();
    });
    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.textContent = "Удалить";
    delBtn.addEventListener("click", () => {
      goals = goals.filter(x => x.id !== g.id);
      renderGoals();
      persist();
    });
    actions.appendChild(incBtn);
    actions.appendChild(decBtn);
    actions.appendChild(delBtn);

    li.appendChild(check);
    li.appendChild(content);
    li.appendChild(actions);
    goalList.appendChild(li);
  });
}

function updateStatsUI() {
  statCompleted.textContent = String(completedTasks);
  statPomodoros.textContent = String(completedPomodoros);
  statFocusMinutes.textContent = String(Math.floor(accumulatedFocusSeconds / 60));
  statBreakMinutes.textContent = String(Math.floor(accumulatedBreakSeconds / 60));
}

goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = goalInput.value.trim();
  if (!title) return;
  const planned = clamp(1, Number(goalPomodoros.value || 1), 12);
  goals.push({ id: crypto.randomUUID(), title, plannedPomodoros: planned, donePomodoros: 0, checked: false });
  goalInput.value = "";
  renderGoals();
  persist();
});

// ---------- YouTube Player ----------
function loadPlayerWithUrl(url) {
  const parsed = parseYouTubeIdFromUrl(url);
  const opts = {
    height: "360",
    width: "640",
    playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1 }
  };
  if (!player) {
    player = new YT.Player("player", {
      ...opts,
      videoId: parsed && parsed.type === "video" ? parsed.id : undefined,
      events: {
        onReady: () => { if (isRunning) player.playVideo(); },
      }
    });
  } else {
    if (parsed) {
      if (parsed.type === "playlist") {
        player.loadPlaylist({ list: parsed.id, index: 0, startSeconds: 0, suggestedQuality: "default" });
      } else {
        player.loadVideoById(parsed.id);
      }
    }
  }
}

function handleMusicOnPhaseChange() {
  const workUrl = workSourceInput.value || DEFAULT_SOURCES.work;
  const breakUrl = breakSourceInput.value || DEFAULT_SOURCES.break;
  const nextUrl = isFocusPhase ? workUrl : breakUrl;

  if (!isFocusPhase && !musicDuringBreak.checked) {
    if (player && player.pauseVideo) player.pauseVideo();
    return;
  }

  if (player) {
    loadPlayerWithUrl(nextUrl);
    if (isRunning) {
      // Slight delay to let the new media attach
      setTimeout(() => { if (player && player.playVideo) player.playVideo(); }, 150);
    }
  }
}

// Global for YT
window.onYouTubeIframeAPIReady = function() {
  // Initialize with work source
  loadPlayerWithUrl(workSourceInput.value || DEFAULT_SOURCES.work);
};

// ---------- Events ----------
startPauseBtn.addEventListener("click", () => {
  if (isRunning) {
    pauseTimer();
  } else {
    startTimer();
    if (player && player.playVideo) player.playVideo();
  }
});

resetBtn.addEventListener("click", () => {
  resetTimer();
});

skipBtn.addEventListener("click", () => {
  skipPhase();
});

document.querySelectorAll('input[name="mode"]').forEach(r => {
  r.addEventListener("change", (e) => {
    const val = e.target.value;
    changeMode(val);
  });
});

applyWorkSrc.addEventListener("click", () => {
  const url = workSourceInput.value || DEFAULT_SOURCES.work;
  loadPlayerWithUrl(url);
  persist();
});
applyBreakSrc.addEventListener("click", () => { persist(); });

muteBtn.addEventListener("click", () => {
  if (!player) return;
  isMuted = !isMuted;
  if (isMuted) player.mute(); else player.unMute();
  muteBtn.textContent = isMuted ? "🔇" : "🔈";
});
playBtn.addEventListener("click", () => { if (player && player.playVideo) player.playVideo(); });
pauseBtn.addEventListener("click", () => { if (player && player.pauseVideo) player.pauseVideo(); });

// Persist on unload
window.addEventListener("beforeunload", persist);

// ---------- Bootstrap ----------
restore();
renderGoals();
updateStatsUI();
updateUI();

