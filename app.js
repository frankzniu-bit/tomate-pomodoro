(() => {
  "use strict";

  const MODES = {
    focus: { label: "Focus", minutes: 25, idle: "Ready when you are.", run: "Stay with the one thing." },
    short: { label: "Short break", minutes: 5, idle: "Step away for a moment.", run: "Breathe with the fruit." },
    long: { label: "Long break", minutes: 15, idle: "You earned a long one.", run: "Go somewhere without a screen." },
  };
  const ROUNDS = 4;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (s) => document.querySelector(s);
  const digits = [...document.querySelectorAll(".time .d b")];
  const ui = {
    kicker: $("#kicker"),
    status: $("#status"),
    toggle: $("#toggle"),
    toggleLabel: $("#toggleLabel"),
    reset: $("#reset"),
    skip: $("#skip"),
    roundNum: $("#roundNum"),
    dots: [...document.querySelectorAll("#dots i")],
    modeButtons: [...document.querySelectorAll(".modes button")],
  };

  const state = {
    mode: "focus",
    total: MODES.focus.minutes * 60000,
    remaining: MODES.focus.minutes * 60000,
    endAt: 0,
    running: false,
    done: 0, // completed focus sessions
  };

  try {
    const saved = JSON.parse(localStorage.getItem("tomate") || "null");
    if (saved && Number.isFinite(saved.done)) state.done = saved.done;
  } catch (_) {}
  const persist = () => {
    try { localStorage.setItem("tomate", JSON.stringify({ done: state.done })); } catch (_) {}
  };

  /* ---------- Timer ---------- */

  function setMode(mode) {
    state.mode = mode;
    state.total = state.remaining = MODES[mode].minutes * 60000;
    state.running = false;
    document.body.dataset.mode = mode;
    ui.modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    render(true);
  }

  function start() {
    if (state.remaining <= 0) state.remaining = state.total;
    state.endAt = performance.now() + state.remaining;
    state.running = true;
    ensureAudio();
    render(true);
  }

  function pause() {
    state.remaining = Math.max(0, state.endAt - performance.now());
    state.running = false;
    render(true);
  }

  function complete(skipped) {
    if (!skipped) chime();
    if (state.mode === "focus") {
      if (!skipped) state.done += 1;
      persist();
      setMode(state.done > 0 && state.done % ROUNDS === 0 ? "long" : "short");
      ui.status.textContent = skipped ? "Skipped. Take the break anyway." : "Gone. Well done — rest now.";
    } else {
      setMode("focus");
      ui.status.textContent = skipped ? "Back to it." : "Break's over. One more.";
    }
  }

  let lastText = "";
  function render(force) {
    const secs = Math.ceil(state.remaining / 1000);
    const text = String(Math.floor(secs / 60)).padStart(2, "0") + String(secs % 60).padStart(2, "0");
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
      const mmss = text.slice(0, 2) + ":" + text.slice(2);
      document.title = state.running ? `${mmss} · ${MODES[state.mode].label}` : "Tomate — a slow pomodoro";
    }
    if (!force) return;

    document.body.classList.toggle("running", state.running);
    ui.kicker.textContent = MODES[state.mode].label;
    ui.toggleLabel.textContent = state.running ? "Pause" : state.remaining < state.total ? "Resume" : "Start";
    const fresh = state.remaining === state.total && !state.running;
    if (fresh || state.running) ui.status.textContent = state.running ? MODES[state.mode].run : MODES[state.mode].idle;
    if (!state.running && !fresh) ui.status.textContent = "Paused.";

    const inCycle = state.done % ROUNDS;
    const cycleFull = state.done > 0 && inCycle === 0 && state.mode === "long";
    ui.dots.forEach((d, i) => d.classList.toggle("on", cycleFull || i < inCycle));
    ui.roundNum.textContent = String(state.done + 1).padStart(2, "0");
  }

  ui.toggle.addEventListener("click", () => (state.running ? pause() : start()));
  ui.reset.addEventListener("click", () => setMode(state.mode));
  ui.skip.addEventListener("click", () => complete(true));
  ui.modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === " ") {
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return; // let the button handle it
      e.preventDefault();
      state.running ? pause() : start();
    } else if (k === "r") setMode(state.mode);
    else if (k === "s") complete(true);
    else if (k === "1") setMode("focus");
    else if (k === "2") setMode("short");
    else if (k === "3") setMode("long");
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
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (state.running) {
      state.remaining = Math.max(0, state.endAt - now);
      render(false);
      if (state.remaining <= 0) { state.running = false; complete(false); }
    }

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

    if (prog) {
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

  setMode("focus");
  requestAnimationFrame(frame);
})();
