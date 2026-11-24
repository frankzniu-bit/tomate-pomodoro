(() => {
  "use strict";

  const COPY = {
    focus: { label: "Focus", idle: "Ready when you are.", run: "Stay with the one thing.", sketch: "Hold the line." },
    short: { label: "Short break", idle: "Step away for a moment.", run: "Breathe with the fruit.", sketch: "Rest by the fire." },
    long: { label: "Long break", idle: "You earned a long one.", run: "Go somewhere without a screen.", sketch: "Sleep it off. It will be back." },
  };
  const PRESETS = {
    classic: { focus: 25, short: 5, long: 15, rounds: 4 },
    deep: { focus: 50, short: 10, long: 20, rounds: 3 },
    sprint: { focus: 15, short: 3, long: 10, rounds: 4 },
  };
  const LIMITS = { focus: [1, 99], short: [1, 60], long: [1, 90], rounds: [2, 8] };
  const LOOT = [
    { id: "pen", kind: "Weapon", name: "Fountain Pen", desc: "Unlocks the Thrust: three quick pokes." },
    { id: "shield", kind: "Armor", name: "Ink Shield", desc: "Knocks thrown distractions back at the boss." },
    { id: "ruler", kind: "Weapon", name: "Ruler Blade", desc: "Unlocks the Sweep: one long, low cut." },
    { id: "helm", kind: "Armor", name: "Folded Helm", desc: "Paper-thin. Oddly reassuring." },
    { id: "eraser", kind: "Weapon", name: "Eraser Maul", desc: "Unlocks the Slam: leap, then erase." },
    { id: "cape", kind: "Armor", name: "Margin Cape", desc: "Dashes leave an afterimage." },
    { id: "boots", kind: "Armor", name: "Quick Boots", desc: "Lighter on your feet." },
  ];
  const DROP_MS = 5 * 60000;
  const MAX_TASKS = 8;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (s) => document.querySelector(s);
  const digits = [...document.querySelectorAll(".time .d b")];
  const ui = {
    kicker: $("#kicker"),
    status: $("#status"),
    quest: $("#quest"),
    play: $("#play"),
    toggle: $("#toggle"),
    toggleLabel: $("#toggleLabel"),
    reset: $("#reset"),
    skip: $("#skip"),
    roundNum: $("#roundNum"),
    dots: $("#dots"),
    modeButtons: [...document.querySelectorAll(".modes button")],
    taskCount: $("#taskCount"),
    taskForm: $("#taskForm"),
    taskInput: $("#taskInput"),
    taskList: $("#taskList"),
    kitList: $("#kitList"),
    resetKit: $("#resetKit"),
    presetButtons: [...document.querySelectorAll("[data-preset]")],
    fields: [...document.querySelectorAll("[data-setting]")],
    scrim: $("#scrim"),
    sheets: { tasks: $("#tasksSheet"), timer: $("#timerSheet") },
    toast: $("#toast"),
  };

  const state = {
    mode: "focus",
    total: 25 * 60000,
    remaining: 25 * 60000,
    endAt: 0,
    running: false,
    done: 0, // completed focus sessions
    style: "fruit",
    settings: { ...PRESETS.classic },
    tasks: [], // { id, text, done, poms }
    currentId: null,
    gear: [], // loot ids, in the order received
    drops: 0, // loot drops in the current focus session
  };

  const clampSetting = (k, v) => Math.round(Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Number(v) || LIMITS[k][0])));

  try {
    const saved = JSON.parse(localStorage.getItem("tomate") || "null") || {};
    if (Number.isFinite(saved.done)) state.done = saved.done;
    if (saved.style === "fruit" || saved.style === "sketch") state.style = saved.style;
    if (saved.settings) for (const k of Object.keys(LIMITS)) if (k in saved.settings) state.settings[k] = clampSetting(k, saved.settings[k]);
    if (Array.isArray(saved.tasks)) {
      state.tasks = saved.tasks
        .filter((t) => t && typeof t.text === "string")
        .slice(0, MAX_TASKS)
        .map((t) => ({ id: String(t.id), text: t.text.slice(0, 60), done: !!t.done, poms: Number(t.poms) || 0 }));
    }
    if (state.tasks.some((t) => t.id === saved.currentId)) state.currentId = saved.currentId;
    if (Array.isArray(saved.gear)) state.gear = saved.gear.filter((g) => LOOT.some((l) => l.id === g));
  } catch (_) {}
  if (location.hash === "#sketch" || location.hash === "#fruit") state.style = location.hash.slice(1);

  const persist = () => {
    try {
      localStorage.setItem("tomate", JSON.stringify({
        done: state.done, style: state.style, settings: state.settings,
        tasks: state.tasks, currentId: state.currentId, gear: state.gear,
      }));
    } catch (_) {}
  };

  const currentTask = () => state.tasks.find((t) => t.id === state.currentId) || null;

  /* ---------- Timer ---------- */

  function setMode(mode) {
    state.mode = mode;
    state.total = state.remaining = state.settings[mode] * 60000;
    state.running = false;
    state.drops = 0;
    if (mode === "focus" && sketch.playing()) sketch.stopGame();
    document.body.dataset.mode = mode;
    ui.modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    render(true);
  }

  function start() {
    if (state.remaining <= 0) state.remaining = state.total;
    state.endAt = Date.now() + state.remaining;
    state.running = true;
    ensureAudio();
    render(true);
  }

  function pause() {
    state.remaining = Math.max(0, state.endAt - Date.now());
    state.running = false;
    render(true);
  }

  function complete(skipped) {
    if (!skipped) chime();
    sketch.onComplete(state.mode, skipped);
    if (state.mode === "focus") {
      if (!skipped) {
        state.done += 1;
        const t = currentTask();
        if (t) t.poms += 1;
      }
      persist();
      renderTasks();
      setMode(state.done > 0 && state.done % state.settings.rounds === 0 ? "long" : "short");
      ui.status.textContent = skipped ? "Skipped. Take the break anyway." : "Gone. Well done — rest now.";
    } else {
      setMode("focus");
      ui.status.textContent = skipped ? "Back to it." : "Break's over. One more.";
    }
  }

  // One drop per 5 minutes of focus; the last one lands as the session ends.
  function checkLoot() {
    if (state.mode !== "focus") return;
    const due = Math.floor((state.total - state.remaining) / DROP_MS);
    if (due <= state.drops) return;
    state.drops = due;
    const item = LOOT.find((l) => !state.gear.includes(l.id));
    if (item) {
      state.gear.push(item.id);
      persist();
      renderKit();
      showToast(item.kind === "Weapon" ? "New weapon" : "New gear", item.name, item.desc);
      sketch.onLoot(item);
    } else {
      showToast("Loot", "Spare ink", "The kit is complete. Keep swinging.");
      sketch.onLoot({ id: "ink", name: "Spare ink" });
    }
  }

  let toastTimer = 0;
  function showToast(kicker, name, desc) {
    ui.toast.querySelector(".toast-k").textContent = kicker;
    ui.toast.querySelector(".toast-name").textContent = name;
    ui.toast.querySelector(".toast-desc").textContent = desc;
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 5000);
  }

  let lastText = "";
  function render(force) {
    const secs = Math.ceil(state.remaining / 1000);
    const mins = Math.floor(secs / 60);
    const text = String(mins % 100).padStart(2, "0") + String(secs % 60).padStart(2, "0");
    if (text !== lastText) {
      [...text].forEach((ch, i) => {
        const el = digits[i];
        if (el.textContent !== ch) {
          el.textContent = ch;
          if (!reduceMotion && lastText) {
            el.classList.remove("roll");
            void el.offsetWidth;
            el.classList.add("roll");
          }
        }
      });
      lastText = text;
      const mmss = String(mins).padStart(2, "0") + ":" + text.slice(2);
      document.title = state.running ? `${mmss} · ${COPY[state.mode].label}` : "Tomate — a slow pomodoro";
    }
    if (!force) return;

    document.body.classList.toggle("running", state.running);
    ui.kicker.textContent = COPY[state.mode].label;
    ui.toggleLabel.textContent = state.running ? "Pause" : state.remaining < state.total ? "Resume" : "Start";
    const fresh = state.remaining === state.total && !state.running;
    if (state.running) ui.status.textContent = state.style === "sketch" ? COPY[state.mode].sketch : COPY[state.mode].run;
    else ui.status.textContent = fresh ? COPY[state.mode].idle : "Paused.";

    const rounds = state.settings.rounds;
    if (ui.dots.children.length !== rounds) ui.dots.innerHTML = "<i></i>".repeat(rounds);
    const inCycle = state.done % rounds;
    const cycleFull = state.done > 0 && inCycle === 0 && state.mode === "long";
    [...ui.dots.children].forEach((d, i) => d.classList.toggle("on", cycleFull || i < inCycle));
    ui.roundNum.textContent = String(state.done + 1).padStart(2, "0");
    renderQuest();
    const playing = sketch.playing();
    ui.play.hidden = state.mode === "focus";
    ui.play.textContent = playing ? "Quit brawl" : "Fight it anyway";
    document.body.classList.toggle("brawl", playing);
  }

  function renderQuest() {
    const t = currentTask();
    ui.quest.classList.toggle("empty", !t);
    ui.quest.innerHTML = "";
    const label = document.createElement("span");
    label.className = "quest-k";
    label.textContent = t ? (state.style === "sketch" ? "Boss" : "Working on") : "+";
    const name = document.createElement("span");
    name.className = "quest-name";
    name.textContent = t ? t.text : "Name this pomodoro";
    ui.quest.append(label, name);
  }

  ui.toggle.addEventListener("click", () => (state.running ? pause() : start()));
  ui.reset.addEventListener("click", () => setMode(state.mode));
  ui.skip.addEventListener("click", () => complete(true));
  ui.modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "escape") {
      if (sketch.playing() && !openSheet) return sketch.stopGame();
      return closeSheets();
    }
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (openSheet) return;
    if (sketch.playing()) {
      const act = k === " " || k === "arrowup" || k === "w" ? "jump" : k === "x" || k === "j" || k === "enter" ? "slash" : null;
      if (act) {
        e.preventDefault();
        if (!e.repeat) sketch.input(act);
        return;
      }
    }
    if (k === " ") {
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return; // let the button handle it
      e.preventDefault();
      state.running ? pause() : start();
    } else if (k === "r") setMode(state.mode);
    else if (k === "s") complete(true);
    else if (k === "1") setMode("focus");
    else if (k === "2") setMode("short");
    else if (k === "3") setMode("long");
    else if (k === "v") setStyle(state.style === "sketch" ? "fruit" : "sketch");
    else if (k === "t") { e.preventDefault(); showSheet("tasks"); }
  });

  /* ---------- Sheets: tasks + timer settings ---------- */

  let openSheet = null, lastFocus = null;
  function showSheet(name) {
    closeSheets();
    lastFocus = document.activeElement;
    openSheet = name;
    ui.scrim.hidden = false;
    ui.sheets[name].hidden = false;
    requestAnimationFrame(() => {
      ui.scrim.classList.add("open");
      ui.sheets[name].classList.add("open");
      const first = ui.sheets[name].querySelector("input:not(:disabled)") || ui.sheets[name].querySelector("button");
      if (first) first.focus();
    });
  }
  function closeSheets() {
    if (!openSheet) return;
    const el = ui.sheets[openSheet];
    el.classList.remove("open");
    ui.scrim.classList.remove("open");
    setTimeout(() => { el.hidden = true; ui.scrim.hidden = true; }, 200);
    openSheet = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  ui.scrim.addEventListener("click", closeSheets);
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheets));
  document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => showSheet(b.dataset.open)));
  ui.quest.addEventListener("click", () => showSheet("tasks"));

  function renderTasks() {
    ui.taskList.innerHTML = "";
    if (!state.tasks.length) {
      const li = document.createElement("li");
      li.className = "task-empty";
      li.textContent = "Nothing yet. Name the one thing this pomodoro is for.";
      ui.taskList.append(li);
    }
    for (const t of state.tasks) {
      const li = document.createElement("li");
      li.className = "task" + (t.done ? " done" : "") + (t.id === state.currentId ? " current" : "");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = t.done;
      box.setAttribute("aria-label", `Mark "${t.text}" done`);
      box.addEventListener("change", () => toggleTask(t.id));
      const name = document.createElement("button");
      name.className = "task-name";
      name.textContent = t.text;
      name.title = "Focus on this";
      name.setAttribute("aria-pressed", String(t.id === state.currentId));
      name.addEventListener("click", () => setCurrent(t.id));
      const meta = document.createElement("span");
      meta.className = "task-meta";
      meta.textContent = t.id === state.currentId ? "Now" : t.poms ? `${t.poms}×` : "";
      const del = document.createElement("button");
      del.className = "task-del";
      del.textContent = "×";
      del.setAttribute("aria-label", `Delete "${t.text}"`);
      del.addEventListener("click", () => removeTask(t.id));
      li.append(box, name, meta, del);
      ui.taskList.append(li);
    }
    const open = state.tasks.filter((t) => !t.done).length;
    ui.taskCount.textContent = open ? String(open) : "";
    ui.taskInput.disabled = state.tasks.length >= MAX_TASKS;
    ui.taskInput.placeholder = ui.taskInput.disabled ? "List is full. Finish something first." : "What needs doing?";
    renderQuest();
  }
  function nextOpen() {
    const t = state.tasks.find((x) => !x.done);
    return t ? t.id : null;
  }
  function setCurrent(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.done) t.done = false;
    state.currentId = id;
    persist();
    renderTasks();
  }
  function toggleTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    if (t.done && state.currentId === id) state.currentId = nextOpen();
    persist();
    renderTasks();
  }
  function removeTask(id) {
    state.tasks = state.tasks.filter((x) => x.id !== id);
    if (state.currentId === id) state.currentId = nextOpen();
    persist();
    renderTasks();
  }
  ui.taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = ui.taskInput.value.trim().slice(0, 60);
    if (!text || state.tasks.length >= MAX_TASKS) return;
    const t = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false, poms: 0 };
    state.tasks.push(t);
    if (!currentTask()) state.currentId = t.id;
    ui.taskInput.value = "";
    persist();
    renderTasks();
  });

  function renderSettings() {
    ui.fields.forEach((f) => (f.value = state.settings[f.dataset.setting]));
    ui.presetButtons.forEach((b) => {
      const p = PRESETS[b.dataset.preset];
      b.setAttribute("aria-pressed", String(Object.keys(p).every((k) => p[k] === state.settings[k])));
    });
  }
  function applySettings() {
    persist();
    renderSettings();
    // A session already under way keeps its length; fresh ones pick up the change.
    if (!state.running && state.remaining === state.total) setMode(state.mode);
    else render(true);
  }
  ui.fields.forEach((f) => f.addEventListener("change", () => {
    state.settings[f.dataset.setting] = clampSetting(f.dataset.setting, f.value);
    applySettings();
  }));
  ui.presetButtons.forEach((b) => b.addEventListener("click", () => {
    state.settings = { ...PRESETS[b.dataset.preset] };
    applySettings();
  }));

  function renderKit() {
    ui.kitList.innerHTML = "";
    for (const l of LOOT) {
      const has = state.gear.includes(l.id);
      const li = document.createElement("li");
      li.className = has ? "has" : "locked";
      li.innerHTML = `<span class="kit-kind"></span><span class="kit-name"></span>`;
      li.querySelector(".kit-kind").textContent = l.kind;
      li.querySelector(".kit-name").textContent = has ? l.name : "Locked";
      li.title = has ? l.desc : "Drops every 5 minutes of focus";
      ui.kitList.append(li);
    }
    ui.resetKit.hidden = !state.gear.length;
  }
  let resetArmed = false;
  ui.resetKit.addEventListener("click", () => {
    if (!resetArmed) {
      resetArmed = true;
      ui.resetKit.textContent = "Click again to reset";
      setTimeout(() => { resetArmed = false; ui.resetKit.textContent = "Reset kit"; }, 3000);
      return;
    }
    resetArmed = false;
    ui.resetKit.textContent = "Reset kit";
    state.gear = [];
    persist();
    renderKit();
  });

  /* ---------- Sound ---------- */

  let audio;
  function ensureAudio() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch (_) {}
  }
  function chime() {
    if (!audio) return;
    const now = audio.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.14);
      g.gain.linearRampToValueAtTime(0.18, now + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 1.6);
      o.connect(g).connect(audio.destination);
      o.start(now + i * 0.14);
      o.stop(now + i * 0.14 + 1.7);
    });
  }

  /* ---------- Shader ---------- */

  const canvas = $("#gl");
  const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });

  const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const FRAG = `
    precision highp float;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uFlow;
    uniform float uLeft;
    uniform float uBreath;
    uniform vec2 uMouse;
    uniform vec3 uBg;
    uniform vec3 uInk;
    uniform vec3 uAccent;

    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x){
      vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

    void main(){
      float m = min(uRes.x, uRes.y);
      vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / m;
      vec2 mo = (uMouse - 0.5 * uRes) / m;
      vec2 p = uv - mo * 0.05;

      float t = uFlow * 0.18;
      float n = fbm(vec3(p * 2.1 + vec2(0.0, t * 0.4), t));
      float ang = atan(p.y, p.x);
      float r = mix(0.035, 0.36, uLeft) * (1.0 + 0.07 * uBreath);
      float wob = (n - 0.5) * 0.32 + 0.025 * sin(ang * 3.0 + uFlow * 0.7);
      float field = length(p) - r * (1.0 + wob);
      float aa = 1.6 / m;
      float fill = 1.0 - smoothstep(-aa, aa, field);

      // Topographic contours radiating from the fruit
      float freq = 26.0;
      float c = fract(field * freq - uFlow * 0.25);
      float lw = aa * freq * 0.9;
      float line = 1.0 - smoothstep(0.0, lw, min(c, 1.0 - c));
      float fade = exp(-max(field, 0.0) * 3.2) * smoothstep(0.0, 0.01, field);
      vec3 col = mix(uBg, uInk, line * fade * 0.18);

      // Soft cast light on the fruit
      vec2 lp = p - vec2(-0.35, 0.45) * r;
      float light = 1.0 - smoothstep(0.0, r * 1.6, length(lp));
      float rim = smoothstep(-r * 0.25, 0.0, field);
      vec3 fruit = uAccent * (0.86 + 0.22 * light) - rim * 0.05;
      fruit += (n - 0.5) * 0.06;
      col = mix(col, fruit, fill);

      // Film grain
      float g = hash(vec3(gl_FragCoord.xy, floor(uTime * 24.0)));
      col += (g - 0.5) * 0.045;

      gl_FragColor = vec4(col, 1.0);
    }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  let prog, U = {};
  try {
    if (!gl) throw new Error("no webgl");
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ["uRes", "uTime", "uFlow", "uLeft", "uBreath", "uMouse", "uBg", "uInk", "uAccent"].forEach(
      (n) => (U[n] = gl.getUniformLocation(prog, n))
    );
  } catch (err) {
    prog = null;
    document.documentElement.classList.add("no-gl");
  }

  const hex = (h) => {
    h = h.trim().replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  };
  let palette;
  const readPalette = () => {
    const cs = getComputedStyle(document.documentElement);
    palette = { bg: hex(cs.getPropertyValue("--bg")), ink: hex(cs.getPropertyValue("--ink")), accent: hex(cs.getPropertyValue("--accent")) };
  };
  readPalette();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readPalette);

  const mouse = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2 };
  addEventListener("pointermove", (e) => { mouse.tx = e.clientX; mouse.ty = e.clientY; });

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    if (prog) gl.viewport(0, 0, canvas.width, canvas.height);
  }
  addEventListener("resize", resize);
  resize();

  let left = 1, flow = 0, breath = 0, last = performance.now();
  // Wall-clock time, so the countdown stays true across sleep and throttling.
  function tick() {
    if (!state.running) return;
    state.remaining = Math.max(0, state.endAt - Date.now());
    render(false);
    checkLoot();
    if (state.remaining <= 0) { state.running = false; complete(false); }
  }

  // Browsers pause requestAnimationFrame in background tabs and throttle page timers,
  // so a worker keeps the tab title counting and the alarm on time.
  try {
    const src = "setInterval(() => postMessage(0), 250);";
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    worker.onmessage = () => tick();
  } catch (_) {
    setInterval(tick, 250);
  }
  document.addEventListener("visibilitychange", () => tick());

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    tick();

    const target = state.remaining / state.total;
    left += (target - left) * Math.min(1, dt * 4);
    const speed = reduceMotion ? 0.2 : state.running ? 1 : 0.35;
    flow += dt * speed;
    const isBreak = state.mode !== "focus";
    // Breaks breathe on a 4s in / 4s out cycle
    const bTarget = isBreak && state.running ? Math.sin((now / 8000) * Math.PI * 2) : 0;
    breath += (bTarget - breath) * Math.min(1, dt * 3);
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 3);
    mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 3);

    if (state.style === "sketch") {
      // the sketch renderer draws on its own canvas
    } else if (prog) {
      const dpr = canvas.width / innerWidth;
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, now / 1000);
      gl.uniform1f(U.uFlow, flow);
      gl.uniform1f(U.uLeft, left);
      gl.uniform1f(U.uBreath, breath * (isBreak ? 2.2 : 0));
      gl.uniform2f(U.uMouse, mouse.x * dpr, canvas.height - mouse.y * dpr);
      gl.uniform3fv(U.uBg, palette.bg);
      gl.uniform3fv(U.uInk, palette.ink);
      gl.uniform3fv(U.uAccent, palette.accent);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      document.documentElement.style.setProperty("--left", left.toFixed(3));
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Style ---------- */

  const sketch = window.createSketch(document.getElementById("sketch"), () => state, {
    onGameChange: () => render(true),
  });
  const styleButtons = [...document.querySelectorAll(".switch button")];

  function setStyle(style) {
    state.style = style;
    document.documentElement.dataset.style = style;
    styleButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.style === style)));
    try { history.replaceState(null, "", style === "sketch" ? "#sketch" : location.pathname + location.search); } catch (_) {}
    persist();
    readPalette();
    sketch.setActive(style === "sketch");
    render(true);
  }
  styleButtons.forEach((b) => b.addEventListener("click", () => setStyle(b.dataset.style)));

  ui.play.addEventListener("click", () => {
    if (sketch.playing()) sketch.stopGame();
    else {
      if (state.style !== "sketch") setStyle("sketch");
      if (!state.running && state.remaining === state.total) start();
      sketch.startGame();
    }
    ui.play.blur();
  });

  setStyle(state.style);
  renderTasks();
  renderSettings();
  renderKit();
  setMode("focus");
  requestAnimationFrame(frame);
})();
