(() => {
  "use strict";

  // Hand-drawn duel: a hero versus a scribbled boss whose HP is the time left.
  window.createSketch = function (canvas, getState, hooks = {}) {
    const ctx = canvas.getContext("2d");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const FOES = ["The Distraction", "Scroll Wraith", "Ping Goblin", "The Maybe-Later", "Tab Hydra"];
    const TAUNTS = ["ping!", "1 new msg", "just check?", "scroll…", "5 min?", "look up", "brb?"];
    const POWS = ["SHK!", "THWIP!", "POW", "SNIKT", "WHAM"];
    const PINGS = ["ping!", "psst", "brb?", "1 new", "hey"];
    const UNLOCKS = { pen: "thrust", ruler: "sweep", eraser: "slam" };
    const hud = {
      label: document.getElementById("foeLabel"),
      name: document.getElementById("foeName"),
      fill: document.getElementById("hpFill"),
      sub: document.getElementById("hpText"),
    };
    const noiseEl = document.getElementById("boilNoise");

    let W = 0, H = 0, dpr = 1, s = 1;
    let ink = "#141312", paper = "#F2F0EA", grain = null;
    let active = false, lastDraw = 0, lastT = 0, boil = 0;
    let leftS = 1, lastMode = null, modeAt = -10, wasRunning = false;
    let hitAt = -10, hitAmp = 1;
    let move = null, lastMove = "", forceNext = null, restUntil = 0, throwAt = Infinity, idle = null;
    let shieldUpUntil = -10;
    let defeat = null;
    let lastV = { x: 0, y: 0, r: 60 };
    let tufts = [], spires = [], motes = [];
    const pending = new Set(); // gear dropped but not yet picked up
    const fx = [];

    /* ---------- seeded randomness (re-seeded per frame = line boil) ---------- */
    let seed = 1;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const jit = (a) => (rnd() - 0.5) * 2 * a;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const lerp = (a, b, k) => a + (b - a) * k;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const easeIn = (k) => k * k;
    const easeOut = (k) => 1 - Math.pow(1 - k, 3);
    const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const easeBack = (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
    const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];

    /* ---------- brush primitives ---------- */
    function smooth(pts, closed, steps) {
      const n = pts.length;
      if (n < 3) return pts.slice();
      const get = (i) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
      const out = [];
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
        for (let k = 0; k < steps; k++) {
          const t = k / steps, t2 = t * t, t3 = t2 * t;
          out.push([
            0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
          ]);
        }
      }
      out.push(closed ? out[0] : pts[n - 1]);
      return out;
    }

    // A variable-width ink stroke: jittered, smoothed, pressure-tapered.
    function stroke(pts, w, o = {}) {
      const J = (o.j ?? 1.4) * s;
      const taper = o.taper ?? true;
      const q = smooth(pts.map(([x, y]) => [x + jit(J), y + jit(J)]), false, o.steps || 5);
      const n = q.length;
      if (n < 2) return;
      const ph = rnd() * 6.28, f = 0.8 + rnd() * 1.6, v = o.v ?? 0.45;
      const L = [], R = [];
      for (let i = 0; i < n; i++) {
        const a = q[Math.max(0, i - 1)], b = q[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const t = i / (n - 1);
        let ww = w * s * (1 + v * Math.sin(t * 6.28 * f + ph));
        if (taper) ww *= Math.min(1, t / 0.14 + 0.12, (1 - t) / 0.2 + 0.08);
        ww = Math.max(ww, 0.6 * s) * 0.5;
        L.push([q[i][0] - dy * ww, q[i][1] + dx * ww]);
        R.push([q[i][0] + dy * ww, q[i][1] - dx * ww]);
      }
      if (o.c) ctx.fillStyle = o.c;
      ctx.beginPath();
      ctx.moveTo(L[0][0], L[0][1]);
      for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
      ctx.closePath();
      ctx.fill();
      if (o.c) ctx.fillStyle = ink;
    }

    function ell(cx, cy, rx, ry, o = {}) {
      const n = o.n || 14;
      const a0 = o.a0 ?? rnd() * 6.28;
      const sw = o.sweep ?? 6.28 + 0.45 + rnd() * 0.5;
      const wob = o.wob ?? 0.06;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + (sw * i) / n, k = 1 + jit(wob);
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
      }
      return pts;
    }

    function path(poly) {
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
    }
    function fillPoly(poly, color) {
      ctx.fillStyle = color;
      path(poly);
      ctx.fill();
      ctx.fillStyle = ink;
    }
    function outline(poly, w, o = {}) {
      stroke([...poly, poly[0], poly[1]], w, { taper: false, v: 0.35, j: 0.8, ...o });
    }
    function blob(cx, cy, rx, ry, color, n = 12) {
      const pts = ell(cx, cy, rx, ry, { n, a0: 0, sweep: 6.28, wob: 0.07 }).slice(0, n);
      fillPoly(smooth(pts, true, 4), color);
    }
    function hatch(poly, gap, w) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const h = y1 - y0;
      ctx.save();
      path(poly);
      ctx.clip();
      for (let x = x0 - h; x < x1; x += gap * s) stroke([[x, y1], [x + h * 0.5, y0 + h * 0.5], [x + h, y0]], w, { j: 0.8, v: 0.4 });
      ctx.restore();
    }
    function scribble(cx, cy, r, count, w, min = 0.25) {
      const pts = [];
      let a = rnd() * 6.28;
      for (let i = 0; i < count; i++) {
        a += 0.5 + rnd() * 1.7;
        const rr = r * (min + rnd() * (1 - min));
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92]);
      }
      stroke(pts, w, { j: 0.5, v: 0.65, steps: 4 });
    }

    /* ---------- weapons + gear ---------- */
    function axes(a, hw) {
      const d = [Math.cos(a), Math.sin(a)], nrm = [-d[1], d[0]];
      return { d, P: (p, k) => add(p, nrm, hw * k) };
    }
    function pencil(h, a) {
      const { d, P } = axes(a, 4.4 * s);
      const back = add(h, d, -12 * s), tipBase = add(h, d, 62 * s), tip = add(tipBase, d, 17 * s);
      const body = [P(back, 1), P(tipBase, 1), tip, P(tipBase, -1), P(back, -1)];
      fillPoly(body, paper);
      outline(body, 2.4);
      stroke([add(back, d, 3 * s), add(tipBase, d, -2 * s)], 0.9, { j: 0.5 });
      const lead = add(tipBase, d, 11 * s);
      fillPoly([P(lead, 0.38), tip, P(lead, -0.38)], ink);
      const band = add(back, d, 7 * s);
      stroke([P(band, 1.2), P(band, -1.2)], 2.2, { j: 0.4 });
    }
    function pen(h, a) {
      const { d, P } = axes(a, 4.8 * s);
      const back = add(h, d, -16 * s), tipBase = add(h, d, 46 * s), tip = add(tipBase, d, 22 * s);
      const body = [P(back, 0.8), P(tipBase, 1), P(tipBase, -1), P(back, -0.8)];
      fillPoly(body, ink);
      outline(body, 2);
      const band = add(h, d, 30 * s);
      stroke([P(band, 1.1), P(band, -1.1)], 2.4, { c: paper, j: 0.3 });
      const nib = [P(tipBase, 0.95), tip, P(tipBase, -0.95)];
      fillPoly(nib, paper);
      outline(nib, 2);
      stroke([tipBase, add(tipBase, d, 13 * s)], 1, { j: 0.3 });
      const hole = add(tipBase, d, 7 * s);
      blob(hole[0], hole[1], 1.6 * s, 1.6 * s, ink, 6);
    }
    function ruler(h, a) {
      const { d, P } = axes(a, 5.5 * s);
      const back = add(h, d, -10 * s), end = add(h, d, 84 * s);
      const body = [P(back, 1), P(end, 1), P(end, -1), P(back, -1)];
      fillPoly(body, paper);
      outline(body, 2.4);
      for (let i = 1; i <= 11; i++) {
        const p = add(back, d, i * 8 * s);
        stroke([P(p, 1), P(p, i % 2 ? 0.45 : 0)], 1, { j: 0.3, taper: false });
      }
    }
    function eraser(h, a) {
      const { d, P } = axes(a, 11 * s);
      stroke([add(h, d, -12 * s), add(h, d, 50 * s)], 4.2, { taper: false, v: 0.2 });
      const c = add(h, d, 60 * s);
      const Q = (k, m) => add(P(c, m * 1.9), d, k * 12 * s);
      const head = [Q(-1, 1), Q(1, 1), Q(1, -1), Q(-1, -1)];
      fillPoly(head, paper);
      hatch([Q(-1, 1), Q(1, 1), Q(1, 0), Q(-1, 0)], 4, 0.9);
      outline(head, 3);
    }
    function weapon(name, h, a) {
      if (name === "pen") pen(h, a);
      else if (name === "ruler") ruler(h, a);
      else if (name === "eraser") eraser(h, a);
      else pencil(h, a);
    }
    function shieldAt(x, y, r) {
      blob(x, y, r, r * 1.08, paper, 10);
      stroke(ell(x, y, r, r * 1.08, { n: 12 }), 3.4, { v: 0.5 });
      stroke(ell(x, y, r * 0.55, r * 0.6, { n: 10 }), 1.2);
      blob(x, y, r * 0.18, r * 0.18, ink, 6);
    }
    function helmAt(x, hy, hr) {
      const h = [[x - hr * 1.2, hy - hr * 0.3], [x - hr * 0.15, hy - hr * 1.95], [x + hr * 1.15, hy - hr * 0.42]];
      fillPoly(h, paper);
      outline(h, 3.2);
      stroke([[x - hr * 0.15, hy - hr * 1.95], [x + hr * 0.05, hy - hr * 0.4]], 1.2);
      stroke([[x - hr * 1.3, hy - hr * 0.28], [x + hr * 1.25, hy - hr * 0.44]], 4.4, { taper: false });
    }
    function bootAt(x, y, flip) {
      const f = flip ? -1 : 1;
      const b = [[x, y - 12 * s], [x + 5 * f * s, y - 12 * s], [x + 6 * f * s, y - 3 * s], [x + 14 * f * s, y - 2 * s], [x + 14 * f * s, y + 1 * s], [x - 2 * f * s, y + 1 * s]];
      fillPoly(b, ink);
      outline(b, 1.6);
      stroke([[x - 1 * f * s, y - 8 * s], [x + 6 * f * s, y - 9 * s]], 1.2, { c: paper, j: 0.3 });
    }
    function icon(id, x, y, rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(0.62, 0.62);
      if (id === "pen" || id === "ruler" || id === "eraser") weapon(id, [-34 * s, 0], 0);
      else if (id === "shield") shieldAt(0, 0, 16 * s);
      else if (id === "helm") helmAt(0, 16 * s, 16 * s);
      else if (id === "boots") { bootAt(-10 * s, 6 * s, false); bootAt(10 * s, 6 * s, false); }
      else if (id === "cape") {
        const c = [[-18 * s, -16 * s], [18 * s, -16 * s], [22 * s, 18 * s], [8 * s, 12 * s], [-6 * s, 20 * s], [-20 * s, 14 * s]];
        fillPoly(c, paper);
        hatch(c, 4, 0.8);
        outline(c, 2.8);
      } else {
        blob(0, 4 * s, 10 * s, 12 * s, ink, 10);
        fillPoly([[-6 * s, -2 * s], [0, -20 * s], [6 * s, -2 * s]], ink);
      }
      ctx.restore();
    }

    /* ---------- characters ---------- */
    function hero(x, gy, o) {
      const u = s, t = o.t, g = o.gear;
      const b = gy - (o.lift || 0);
      const bob = Math.sin(t * (g.has("boots") ? 3 : 2.4)) * 2 * u + (o.crouch || 0);
      const st = o.step || 0;
      const sh = 1 - Math.min(0.6, (o.lift || 0) / (60 * u));
      stroke([[x - 24 * u * sh, gy + 5 * u], [x, gy + 6 * u], [x + 24 * u * sh, gy + 5 * u]], 2.2, { v: 0.3 });
      stroke([[x - 14 * u * sh, gy + 9 * u], [x + 16 * u * sh, gy + 9 * u]], 1, {});
      // legs + feet
      stroke([[x - 6 * u, b - 36 * u], [x - 9 * u - st * 6 * u, b - 17 * u], [x - 11 * u - st * 11 * u, b]], 3.4);
      stroke([[x + 6 * u, b - 36 * u], [x + 8 * u + st * 6 * u, b - 17 * u], [x + 12 * u + st * 11 * u, b]], 3.4);
      if (g.has("boots")) {
        bootAt(x - 11 * u - st * 11 * u, b, true);
        bootAt(x + 12 * u + st * 11 * u, b, false);
      } else {
        stroke([[x - 19 * u - st * 11 * u, b + 1 * u], [x - 9 * u - st * 11 * u, b]], 5.5, { taper: false });
        stroke([[x + 10 * u + st * 11 * u, b], [x + 21 * u + st * 11 * u, b + 1 * u]], 5.5, { taper: false });
      }
      const fl = Math.sin(t * 7) * 5 * u, drag = o.dash ? 1.5 : 1;
      if (g.has("cape")) {
        const cp = [[x - 4 * u, b - 82 * u + bob], [x - 30 * u * drag, b - 64 * u + fl], [x - 48 * u * drag, b - 30 * u - fl], [x - 34 * u * drag, b - 22 * u], [x - 16 * u, b - 28 * u], [x + 4 * u, b - 60 * u + bob]];
        fillPoly(cp, paper);
        hatch(cp, 7, 0.8);
        outline(cp, 3.2, { v: 0.5 });
      }
      stroke([[x - 3 * u, b - 80 * u + bob], [x - 22 * u * drag, b - 76 * u + fl + bob], [x - 40 * u * drag, b - 82 * u - fl + bob], [x - 56 * u * drag, b - 72 * u + fl + bob]], 4.2, { v: 0.6 });
      stroke([[x - 5 * u, b - 76 * u + bob], [x - 24 * u * drag, b - 67 * u - fl + bob], [x - 40 * u * drag, b - 69 * u + fl + bob]], 1.4);
      const shieldUp = g.has("shield") && o.shieldUp;
      if (g.has("shield") && !shieldUp) shieldAt(x - 17 * u, b - 58 * u + bob, 13 * u);
      const c = [
        [x, b - 84 * u + bob], [x - 13 * u, b - 62 * u + bob], [x - 29 * u, b - 30 * u],
        [x - 8 * u, b - 35 * u], [x + 7 * u, b - 31 * u], [x + 27 * u, b - 31 * u], [x + 14 * u, b - 63 * u + bob],
      ];
      fillPoly(c, paper);
      hatch(c, 5, 0.9);
      stroke([...c, c[0], c[1]], 3.8, { v: 0.55 });
      // arm + weapon
      const shoulder = [x + 8 * u, b - 68 * u + bob];
      const ad = [Math.cos(o.a + 0.9), Math.sin(o.a + 0.9)];
      const hand = add(shoulder, ad, 17 * u);
      stroke([shoulder, add(shoulder, ad, 9 * u), hand], 3.2);
      weapon(o.weapon, hand, o.a);
      blob(hand[0], hand[1], 4.5 * u, 4.5 * u, ink, 8);
      if (shieldUp) shieldAt(x + 30 * u, b - 66 * u + bob, 15 * u);
      // head
      const hy = b - 102 * u + bob, hr = 19 * u;
      if (!g.has("helm")) {
        stroke([[x - 10 * u, hy - 15 * u], [x - 26 * u, hy - 24 * u - fl * 0.3], [x - 46 * u, hy - 20 * u + fl * 0.6]], 4.2, { v: 0.5 });
        stroke([[x + 8 * u, hy - 17 * u], [x - 18 * u, hy - 29 * u], [x - 46 * u, hy - 20 * u + fl * 0.6]], 1.5);
      }
      blob(x, hy, hr, hr * 1.04, paper);
      stroke(ell(x, hy, hr, hr * 1.04, { n: 12 }), 3.9, { v: 0.55 });
      const ey = o.eyesUp ? -4 * u : 0;
      if (o.happy) {
        stroke([[x + 1 * u, hy + 2 * u], [x + 5 * u, hy - 3 * u], [x + 9 * u, hy + 2 * u]], 2.4);
        stroke([[x + 11 * u, hy + 2 * u], [x + 14 * u, hy - 3 * u], [x + 18 * u, hy + 2 * u]], 2.4);
      } else if (t % 3.7 < 0.14) {
        stroke([[x + 1 * u, hy + 1 * u], [x + 8 * u, hy + 1 * u]], 2.4);
        stroke([[x + 11 * u, hy + 1 * u], [x + 17 * u, hy + 1 * u]], 2.4);
      } else {
        blob(x + 4.5 * u, hy + 1 * u + ey, 3.4 * u, 6 * u, ink, 8);
        blob(x + 14 * u, hy + 1 * u + ey, 3 * u, 5.4 * u, ink, 8);
      }
      if (g.has("helm")) helmAt(x, hy - 4 * u, hr);
    }

    function heroSit(x, gy, t, sleepy, g) {
      const u = s;
      const br = Math.sin(t * 1.6) * 1.5 * u;
      stroke([[x - 30 * u, gy + 5 * u], [x + 40 * u, gy + 5 * u]], 2, { v: 0.3 });
      weapon(lastWeapon(g), [x - 44 * u, gy - 72 * u], 1.5);
      if (g.has("shield")) shieldAt(x - 62 * u, gy - 14 * u, 13 * u);
      stroke([[x + 4 * u, gy - 10 * u], [x + 20 * u, gy - 26 * u], [x + 34 * u, gy - 2 * u]], 3.4);
      stroke([[x - 2 * u, gy - 8 * u], [x + 14 * u, gy - 20 * u], [x + 28 * u, gy - 1 * u]], 3.4);
      if (g.has("boots")) { bootAt(x + 30 * u, gy, false); bootAt(x + 24 * u, gy + 1 * u, false); }
      else {
        stroke([[x + 30 * u, gy], [x + 42 * u, gy + 1 * u]], 5.5, { taper: false });
        stroke([[x + 24 * u, gy + 1 * u], [x + 35 * u, gy + 2 * u]], 5.5, { taper: false });
      }
      stroke([[x - 4 * u, gy - 56 * u + br], [x - 16 * u, gy - 44 * u], [x - 20 * u, gy - 28 * u]], 4, { v: 0.6 });
      const c = [[x, gy - 60 * u + br], [x - 12 * u, gy - 40 * u], [x - 26 * u, gy - 2 * u], [x + 2 * u, gy - 6 * u], [x + 16 * u, gy - 8 * u], [x + 12 * u, gy - 40 * u + br]];
      fillPoly(c, paper);
      hatch(c, 5, 0.9);
      stroke([...c, c[0], c[1]], 3.8, { v: 0.55 });
      const hy = gy - 78 * u + br, hr = 18 * u;
      if (!g.has("helm")) stroke([[x - 10 * u, hy - 14 * u], [x - 24 * u, hy - 18 * u], [x - 36 * u, hy - 4 * u]], 4, { v: 0.5 });
      blob(x, hy, hr, hr * 1.04, paper);
      stroke(ell(x, hy, hr, hr * 1.04, { n: 12 }), 3.9, { v: 0.55 });
      if (sleepy) {
        stroke([[x + 1 * u, hy + 1 * u], [x + 5 * u, hy + 4 * u], [x + 9 * u, hy + 1 * u]], 2.2);
        stroke([[x + 11 * u, hy + 1 * u], [x + 14 * u, hy + 4 * u], [x + 18 * u, hy + 1 * u]], 2.2);
        ctx.font = `700 ${Math.round(20 * Math.max(s, 0.8))}px Kalam, cursive`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.35 + i / 3) % 1;
          ctx.globalAlpha = Math.sin(k * Math.PI);
          ctx.fillText("z", x + 18 * u + k * 30 * u + i * 4 * u, hy - 24 * u - k * 50 * u);
        }
        ctx.globalAlpha = 1;
      } else {
        blob(x + 6 * u, hy + 2 * u, 3.2 * u, 5.6 * u, ink, 8);
        blob(x + 15 * u, hy + 2 * u, 2.8 * u, 5 * u, ink, 8);
      }
      if (g.has("helm")) helmAt(x, hy - 4 * u, hr);
    }

    function campfire(x, gy, k, t) {
      const u = s;
      stroke([[x - 24 * u, gy - 1 * u], [x + 24 * u, gy - 13 * u]], 6, { v: 0.3 });
      stroke([[x - 24 * u, gy - 13 * u], [x + 24 * u, gy - 1 * u]], 6, { v: 0.3 });
      for (const [i, hh] of [[-1, 36], [0, 56], [1, 32]]) {
        const fx0 = x + i * 10 * u;
        const h = hh * u * k * (0.9 + 0.15 * Math.sin(t * 9 + i * 2));
        const w = 10 * u * Math.max(k, 0.4);
        const flame = [[fx0, gy - 8 * u], [fx0 - w, gy - 8 * u - h * 0.35], [fx0 + jit(3 * u), gy - 8 * u - h], [fx0 + w, gy - 8 * u - h * 0.45], [fx0, gy - 8 * u]];
        stroke(flame, i === 0 ? 3.2 : 2.2, { v: 0.5 });
        if (i === 0) blob(fx0, gy - 8 * u - h * 0.28, w * 0.35, h * 0.22, ink, 8);
      }
      const sm = [];
      for (let i = 0; i < 6; i++) sm.push([x + Math.sin(t * 1.2 + i * 0.9) * 8 * u, gy - (64 + i * 16) * u * Math.max(k, 0.5)]);
      ctx.globalAlpha = 0.6;
      stroke(sm, 1.4, {});
      ctx.globalAlpha = 1;
      for (let i = 0; i < 3; i++) {
        const kk = (t * 0.6 + i / 3) % 1;
        blob(x + Math.sin(i * 3 + t) * 14 * u, gy - 20 * u - kk * 70 * u * k, 1.6 * u, 1.6 * u, ink, 6);
      }
    }

    function villain(x, y, r, o) {
      const sq = 1 + o.hit * 0.28;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sq, 1 / sq);
      ctx.translate(-x, -y);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 6.28 + o.t * 0.25;
        const reach = 1.32 + 0.16 * Math.sin(o.t * 3 + i * 1.7);
        stroke([
          [x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75],
          [x + Math.cos(a + 0.18) * r * 1.08, y + Math.sin(a + 0.18) * r * 1.08],
          [x + Math.cos(a - 0.12) * r * reach, y + Math.sin(a - 0.12) * r * reach],
        ], i % 3 ? 1.3 : 3.6);
      }
      blob(x, y, r * 0.96, r * 0.9, paper, 14);
      scribble(x, y, r, 70, 1.0);
      scribble(x, y, r * 0.96, 40, 0.9);
      scribble(x, y, r * 0.92, 14, 3.6, 0.55);
      stroke(ell(x, y, r, r * 0.92, { n: 16, wob: 0.12 }), 5, { v: 0.75 });
      const e = [[x - r * 0.34, y - r * 0.16, r * 0.25], [x + r * 0.12, y - r * 0.26, r * 0.17]];
      for (const [ex, ey, er] of e) {
        blob(ex, ey, er, er * 1.12, paper, 10);
        stroke(ell(ex, ey, er, er * 1.12, { n: 10 }), 2.8);
        if (o.hit > 0.35) {
          stroke([[ex - er * 0.6, ey - er * 0.6], [ex + er * 0.6, ey + er * 0.6]], 3.2, { taper: false });
          stroke([[ex + er * 0.6, ey - er * 0.6], [ex - er * 0.6, ey + er * 0.6]], 3.2, { taper: false });
        } else {
          blob(ex + o.look[0] * er * 0.45, ey + o.look[1] * er * 0.45, er * 0.4, er * 0.44, ink, 8);
        }
      }
      stroke([[e[0][0] - e[0][2] * 1.1, e[0][1] - e[0][2] * 1.5], [e[0][0] + e[0][2] * 1.0, e[0][1] - e[0][2] * 0.95]], 5, { taper: false });
      stroke([[e[1][0] - e[1][2] * 0.9, e[1][1] - e[1][2] * 1.1], [e[1][0] + e[1][2] * 1.2, e[1][1] - e[1][2] * 1.8]], 4.2, { taper: false });
      const m = [], my = y + r * 0.36;
      for (let i = 0; i <= 8; i++) m.push([x - r * 0.48 + i * r * 0.115, my + (i % 2 ? r * 0.1 : -r * 0.03) + Math.sin(i) * r * 0.03]);
      fillPoly([...m, [x + r * 0.44, my - r * 0.12], [x - r * 0.48, my - r * 0.1]], paper);
      stroke(m, 2.8, { v: 0.4 });
      stroke([m[0], [x, my - r * 0.14], m[m.length - 1]], 2.2);
      ctx.restore();
    }

    /* ---------- choreography ----------
       Each move is a pose over k in [0,1]; hits fire once at their k.
       c.home is the hero's resting x, c.reach is where the weapon meets the boss. */
    const MOVES = {
      lunge: {
        dur: 1.35, weapon: "pencil", hits: [[0.38, "big"]],
        pose(k, c) {
          if (k < 0.3) { const e = easeIn(k / 0.3); return { x: lerp(c.home, c.reach, e), a: -2.0, step: Math.sin(k * 40) * 0.8, dash: true }; }
          if (k < 0.48) { const e = (k - 0.3) / 0.18; return { x: c.reach, a: lerp(-2.1, 0.9, easeOut(e)), lift: Math.sin(e * Math.PI) * 14 * s }; }
          const e = (k - 0.48) / 0.52;
          return { x: lerp(c.reach, c.home, easeInOut(e)), a: lerp(0.9, -1.0, e), step: Math.sin(e * 12) * 0.6 };
        },
      },
      feint: {
        dur: 1.7, weapon: "pencil", hits: [[0.6, "small"]],
        pose(k, c) {
          const mid = lerp(c.home, c.reach, 0.45);
          if (k < 0.2) { const e = easeOut(k / 0.2); return { x: lerp(c.home, mid, e), a: lerp(-1.0, -0.3, e), step: Math.sin(k * 30) * 0.5 }; }
          if (k < 0.4) return { x: mid, a: -0.3 + Math.sin(k * 40) * 0.04 };
          if (k < 0.56) { const e = (k - 0.4) / 0.16; return { x: lerp(mid, c.reach + 6 * s, e * e), a: -0.05, dash: true }; }
          if (k < 0.66) return { x: c.reach + 6 * s, a: 0.02 };
          const e = (k - 0.66) / 0.34;
          return { x: lerp(c.reach + 6 * s, c.home, easeInOut(e)), a: lerp(0, -1, e), step: Math.sin(e * 12) * 0.6 };
        },
        boss(k) { return { lean: k > 0.2 && k < 0.4 ? 12 * s * Math.sin(((k - 0.2) / 0.2) * Math.PI) : 0 }; },
      },
      riposte: {
        dur: 1.9, weapon: "pencil", hits: [[0.7, "big"]],
        pose(k, c) {
          if (k < 0.38) return { x: c.home, a: lerp(-1.0, -1.4, k / 0.38) };
          if (k < 0.52) { const e = (k - 0.38) / 0.14; return { x: c.home - 26 * s * easeOut(e), a: -1.4, lift: Math.sin(e * Math.PI) * 12 * s, shieldUp: true }; }
          if (k < 0.64) { const e = (k - 0.52) / 0.12; return { x: lerp(c.home - 26 * s, c.reach, e * e), a: -2.0, dash: true }; }
          if (k < 0.76) { const e = (k - 0.64) / 0.12; return { x: c.reach, a: lerp(-2.1, 0.9, easeOut(e)), lift: Math.sin(e * Math.PI) * 10 * s }; }
          const e = (k - 0.76) / 0.24;
          return { x: lerp(c.reach, c.home, easeInOut(e)), a: lerp(0.9, -1, e), step: Math.sin(e * 12) * 0.6 };
        },
        boss(k) {
          if (k < 0.3) return { lean: 18 * s * easeOut(k / 0.3) };
          if (k < 0.46) { const e = (k - 0.3) / 0.16; return { lean: lerp(18 * s, -40 * s, easeIn(e)), lash: e }; }
          if (k < 0.6) return { lean: lerp(-40 * s, 0, (k - 0.46) / 0.14) };
          return { lean: 0 };
        },
      },
      thrust: {
        dur: 1.5, weapon: "pen", hits: [[0.34, "small"], [0.47, "small"], [0.6, "big"]],
        pose(k, c) {
          const rp = c.reach + 10 * s;
          if (k < 0.24) { const e = easeIn(k / 0.24); return { x: lerp(c.home, rp - 12 * s, e), a: -0.4, dash: true, step: Math.sin(k * 40) * 0.7 }; }
          if (k < 0.66) { const kk = (k - 0.24) / 0.42, pk = Math.abs(Math.sin(kk * Math.PI * 3)); return { x: rp - 12 * s + pk * 16 * s, a: -0.05 + (1 - pk) * 0.12 }; }
          const e = (k - 0.66) / 0.34;
          return { x: lerp(rp, c.home, easeInOut(e)), a: lerp(0, -1, e), step: Math.sin(e * 12) * 0.6 };
        },
      },
      sweep: {
        dur: 1.6, weapon: "ruler", hits: [[0.5, "sweep"]],
        pose(k, c) {
          const rp = c.reach - 14 * s;
          if (k < 0.28) { const e = easeIn(k / 0.28); return { x: lerp(c.home, rp, e), a: 2.6, dash: true, crouch: e * 8 * s }; }
          if (k < 0.6) { const e = (k - 0.28) / 0.32; return { x: rp, a: lerp(2.7, -0.5, easeOut(e)), crouch: 8 * s * (1 - e) }; }
          const e = (k - 0.6) / 0.4;
          return { x: lerp(rp, c.home, easeInOut(e)), a: lerp(-0.5, -1, e), step: Math.sin(e * 12) * 0.6 };
        },
      },
      slam: {
        dur: 1.8, weapon: "eraser", hits: [[0.62, "slam"]],
        pose(k, c) {
          const rp = c.reach - 4 * s;
          if (k < 0.26) { const e = easeIn(k / 0.26); return { x: lerp(c.home, rp, e), a: -1.9, dash: true }; }
          if (k < 0.52) { const e = (k - 0.26) / 0.26; return { x: rp, a: lerp(-1.9, -2.6, e), lift: Math.sin(e * Math.PI * 0.5) * 56 * s }; }
          if (k < 0.62) { const e = (k - 0.52) / 0.1; return { x: rp, a: lerp(-2.6, 0.5, e * e), lift: 56 * s * (1 - e * e) }; }
          if (k < 0.72) return { x: rp, a: 0.5, crouch: 6 * s };
          const e = (k - 0.72) / 0.28;
          return { x: lerp(rp, c.home, easeInOut(e)), a: lerp(0.5, -1, e), step: Math.sin(e * 12) * 0.6 };
        },
      },
    };

    const visibleGear = (st) => new Set(st.gear.filter((g) => !pending.has(g)));
    function lastWeapon(g) {
      let w = "pencil";
      for (const id of g) if (UNLOCKS[id]) w = id;
      return w;
    }
    function movePool(g) {
      const pool = ["lunge", "feint", "riposte"];
      for (const id of g) if (UNLOCKS[id]) pool.push(UNLOCKS[id]);
      return pool;
    }

    function choreo(st, t, g) {
      if (!st.running || reduce) { move = null; return; }
      if (!wasRunning) { restUntil = t + 1.2; throwAt = Infinity; }
      if (!move && t >= restUntil) {
        const pool = movePool(g);
        let name = forceNext && pool.includes(forceNext) ? forceNext : pick(pool);
        if (!forceNext && pool.length > 1) while (name === lastMove) name = pick(pool);
        if (pool.includes(forceNext)) forceNext = null;
        lastMove = name;
        move = { name, start: t, fired: new Set() };
        idle = null;
      }
      if (move && t - move.start >= MOVES[move.name].dur) {
        move = null;
        restUntil = t + 2.2 + Math.random() * 1.8;
        throwAt = Math.random() < 0.4 ? t + 0.5 : Infinity;
        if (Math.random() < 0.35) idle = { type: pick(["glance", "twirl"]), start: t + 0.9 };
      }
    }

    function strike(kind, x, y, r, t) {
      hitAt = t;
      hitAmp = kind === "small" ? 0.45 : kind === "slam" ? 1.35 : 1;
      if (kind === "small") {
        fx.push({ type: "tick", x, y: y + (Math.random() - 0.5) * r * 0.5, born: t, life: 0.4 });
        return;
      }
      fx.push({ type: "splat", x: x + 20 * s, y, born: t, life: 1.1, blobs: Array.from({ length: 6 }, () => ({ dx: (Math.random() - 0.2) * 70 * s, dy: (Math.random() - 0.5) * 60 * s, r: (2 + Math.random() * 6) * s })) });
      const px = lastV.x + r * 1.05, py = lastV.y - r * 0.75;
      if (kind === "sweep") {
        fx.push({ type: "sweep", x, y: y + r * 0.35, born: t, life: 0.25 });
        fx.push({ type: "pow", x: px, y: py, text: "SHHK", size: 28 * s, rot: -0.15, born: t, life: 0.7 });
      } else if (kind === "slam") {
        fx.push({ type: "shock", x: x + 10 * s, born: t, life: 0.55 });
        fx.push({ type: "pow", x: px, y: py, text: "WHUMP", size: 32 * s, rot: 0.12, born: t, life: 0.8 });
      } else {
        fx.push({ type: "slash", x, y, born: t, life: 0.22 });
        fx.push({ type: "pow", x: px, y: py, text: pick(POWS), size: 30 * s, rot: (Math.random() - 0.5) * 0.5, born: t, life: 0.75 });
      }
    }

    /* ---------- effects ---------- */
    function speech(x, y, text) {
      const fs = Math.round(12 * Math.max(s, 0.85));
      ctx.font = `500 ${fs}px "Geist Mono", ui-monospace, monospace`;
      const w2 = ctx.measureText(text).width / 2 + 9 * Math.max(s, 0.85), h2 = fs * 0.95;
      const box = [[x - w2, y - h2], [x + w2, y - h2], [x + w2, y + h2], [x + w2 * 0.2, y + h2], [x + w2 * 0.05, y + h2 + 9 * s], [x - w2 * 0.15, y + h2], [x - w2, y + h2]];
      fillPoly(box, paper);
      stroke([...box, box[0], box[1]], 2.3, { j: 0.8, taper: false, v: 0.35 });
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x, y + 1);
    }

    function pow(x, y, text, size, rot, k) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const sc = k < 0.18 ? (k / 0.18) * 1.2 : 1.2 - Math.min(0.2, (k - 0.18) * 1.2);
      ctx.scale(sc, sc);
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * 6.28 + 0.2;
        const r0 = size * 0.95, r1 = size * (1.3 + (i % 2) * 0.3);
        stroke([[Math.cos(a) * r0, Math.sin(a) * r0 * 0.6], [Math.cos(a) * r1, Math.sin(a) * r1 * 0.6]], i % 2 ? 1.2 : 2.4);
      }
      ctx.font = `900 ${size}px Rubik, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 7 * s;
      ctx.strokeStyle = paper;
      ctx.strokeText(text, 0, 0);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    function bubbleLanded(e, t, st) {
      if (e.back) {
        fx.push({ type: "puff", x: e.to[0], y: e.to[1], born: t, life: 0.45 });
        hitAt = t; hitAmp = 0.4;
      } else if (visibleGear(st).has("shield")) {
        shieldUpUntil = t + 0.45;
        fx.push({ type: "bubble", back: true, from: e.to, to: [lastV.x - lastV.r * 0.5, lastV.y], text: e.text, born: t, life: 0.7 });
        fx.push({ type: "tick", x: e.to[0] + 6 * s, y: e.to[1] + 30 * s, text: "tink", born: t, life: 0.45 });
      } else {
        fx.push({ type: "puff", x: e.to[0], y: e.to[1], born: t, life: 0.45 });
        fx.push({ type: "tick", x: e.to[0] + 10 * s, y: e.to[1] - 18 * s, text: "nope", born: t, life: 0.6 });
      }
    }

    function drawFx(t, L, st) {
      for (let i = fx.length - 1; i >= 0; i--) {
        const e = fx[i];
        const k = (t - e.born) / e.life;
        if (k >= 1) {
          if (e.type === "bubble") bubbleLanded(e, t, st);
          if (e.type === "loot" && !e.got) { pending.delete(e.id); }
          fx.splice(i, 1);
          continue;
        }
        if (k < 0) continue;
        if (e.type === "slash") {
          ctx.globalAlpha = 1 - k;
          const pts = [];
          for (let j = 0; j <= 8; j++) {
            const a = -1.25 + (2.5 * j) / 8;
            pts.push([e.x - 40 * s + Math.cos(a) * 66 * s, e.y + Math.sin(a) * 66 * s]);
          }
          stroke(pts, 10, { v: 0.2 });
          stroke(pts.map(([px, py]) => [px - 10 * s, py]), 1.3);
          ctx.globalAlpha = 1;
        } else if (e.type === "sweep") {
          ctx.globalAlpha = 1 - k;
          const pts = [];
          for (let j = 0; j <= 10; j++) {
            const a = Math.PI - 0.25 - (Math.PI - 0.5) * (j / 10);
            pts.push([e.x + Math.cos(a) * 90 * s, e.y + Math.sin(a) * 18 * s]);
          }
          stroke(pts, 9, { v: 0.2 });
          stroke(pts.map(([px, py]) => [px, py + 7 * s]), 1.2);
          ctx.globalAlpha = 1;
        } else if (e.type === "shock") {
          ctx.globalAlpha = 1 - k;
          for (let j = -3; j <= 3; j++) {
            if (!j) continue;
            const gx = e.x + j * (12 + k * 26) * s, h = (14 - Math.abs(j) * 3) * s * (1 - k * 0.5);
            stroke([[gx, L.gy - 2 * s], [gx + Math.sign(j) * 4 * s, L.gy - h]], 2.2);
          }
          stroke([[e.x - 60 * s * (0.4 + k), L.gy + 3 * s], [e.x, L.gy + 5 * s], [e.x + 60 * s * (0.4 + k), L.gy + 3 * s]], 1.4);
          ctx.globalAlpha = 1;
        } else if (e.type === "tick") {
          ctx.globalAlpha = 1 - k;
          for (let j = 0; j < 3; j++) {
            const a = -0.9 + j * 0.9;
            stroke([[e.x + Math.cos(a) * 8 * s, e.y + Math.sin(a) * 8 * s], [e.x + Math.cos(a) * (16 + k * 8) * s, e.y + Math.sin(a) * (16 + k * 8) * s]], 1.6);
          }
          ctx.font = `500 ${Math.round(11 * Math.max(s, 0.85))}px "Geist Mono", ui-monospace, monospace`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(e.text || "tk", e.x + 20 * s, e.y - 14 * s - k * 8 * s);
          ctx.globalAlpha = 1;
        } else if (e.type === "splat") {
          ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
          for (const b of e.blobs) blob(e.x + b.dx * (0.6 + k * 0.6), e.y + b.dy * (0.6 + k * 0.6) + k * k * 30 * s, b.r, b.r * 0.9, ink, 9);
          ctx.globalAlpha = 1;
        } else if (e.type === "pow") {
          pow(e.x, e.y, e.text, e.size, e.rot, k);
        } else if (e.type === "puff") {
          ctx.globalAlpha = 1 - k;
          for (let j = 0; j < 5; j++) {
            const a = (j / 5) * 6.28, rr = (8 + 18 * k) * s;
            stroke(ell(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr, 6 * s, 6 * s, { n: 8 }), 1.6);
          }
          ctx.globalAlpha = 1;
        } else if (e.type === "bubble") {
          const kk = easeInOut(k);
          const bx = lerp(e.from[0], e.to[0], kk);
          const by = lerp(e.from[1], e.to[1], kk) - Math.sin(kk * Math.PI) * (e.back ? 30 : 70) * s;
          speech(bx, by, e.text);
        } else if (e.type === "loot") {
          drawLoot(e, k, t, L);
        } else if (e.type === "power") {
          const cx = L.hx, cy = L.gy - 70 * s;
          ctx.globalAlpha = 1 - k;
          for (let j = 0; j < 12; j++) {
            const a = (j / 12) * 6.28;
            const r0 = (50 + k * 40) * s, r1 = r0 + (j % 2 ? 10 : 22) * s;
            stroke([[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]], j % 2 ? 1.2 : 2.4);
          }
          ctx.font = `700 ${Math.round(19 * Math.max(s, 0.85))}px Kalam, cursive`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 6 * s;
          ctx.strokeStyle = paper;
          const label = "+ " + e.name, ly = L.gy - 172 * s - k * 14 * s;
          ctx.strokeText(label, cx, ly);
          ctx.fillText(label, cx, ly);
          ctx.globalAlpha = 1;
        }
      }
    }

    // A drop arcs out of the boss, rests on the ground with a glint, then flies to the hero.
    function drawLoot(e, k, t, L) {
      const land = [lerp(L.hx, L.vx, 0.5), L.gy - 12 * s];
      const to = [L.hx, L.gy - 70 * s];
      let x, y, rot = 0;
      if (k < 0.3) {
        const kk = k / 0.3;
        x = lerp(e.from[0], land[0], kk);
        y = lerp(e.from[1], land[1], kk) - Math.sin(kk * Math.PI) * 90 * s;
        rot = kk * 7;
      } else if (k < 0.62) {
        const kk = (k - 0.3) / 0.32;
        x = land[0];
        y = land[1] - Math.abs(Math.sin(kk * Math.PI * 2)) * 12 * s * (1 - kk);
        rot = 0.3 * (1 - kk);
        for (let j = 0; j < 4; j++) {
          const a = t * 3 + j * (Math.PI / 2), r0 = 22 * s, r1 = (j % 2 ? 30 : 36) * s;
          stroke([[x + Math.cos(a) * r0, y + Math.sin(a) * r0], [x + Math.cos(a) * r1, y + Math.sin(a) * r1]], 1.6);
        }
      } else if (k < 0.84) {
        const kk = easeIn((k - 0.62) / 0.22);
        x = lerp(land[0], to[0], kk);
        y = lerp(land[1], to[1], kk) - Math.sin(kk * Math.PI) * 40 * s;
        rot = kk * 4;
      } else {
        if (!e.got) {
          e.got = true;
          pending.delete(e.id);
          fx.push({ type: "power", name: e.name, born: t, life: 1.5 });
        }
        return;
      }
      icon(e.id, x, y, rot);
    }

    /* ---------- scenery ---------- */
    function scenery(L, t, dt) {
      const { gy } = L;
      ctx.globalAlpha = 0.42;
      const hill = [];
      for (let i = 0; i <= 10; i++) {
        const x = (W * i) / 10;
        hill.push([x, gy - 46 * s - 34 * s * Math.sin(i * 0.7 + 1.3) - 14 * s * Math.sin(i * 1.9)]);
      }
      stroke(hill, 1.3, { j: 1.5 });
      for (const sp of spires) {
        const { x, h, w } = sp;
        stroke([[x - w, gy], [x - w * 0.75, gy - h * 0.55], [x - w * 0.5, gy - h * 0.8], [x, gy - h]], 1.6);
        stroke([[x + w, gy], [x + w * 0.75, gy - h * 0.55], [x + w * 0.5, gy - h * 0.8], [x, gy - h]], 1.6);
        for (const f of [0.3, 0.55, 0.78]) stroke([[x - w * (1 - f * 0.6), gy - h * f], [x + w * (1 - f * 0.6), gy - h * f]], 1);
        blob(x, gy - h * 0.66, w * 0.18, w * 0.3, ink, 8);
        stroke([[x, gy - h], [x + jit(2 * s), gy - h - 18 * s]], 1.2);
      }
      ctx.globalAlpha = 1;
      const g = [];
      for (let i = -1; i <= 9; i++) g.push([(W * i) / 8, gy + jit(4 * s)]);
      stroke(g, 4.8, { j: 2, v: 0.55, taper: false });
      stroke([[W * 0.04, gy + 12 * s], [W * 0.2, gy + 15 * s], [W * 0.36, gy + 11 * s]], 1.2);
      stroke([[W * 0.52, gy + 17 * s], [W * 0.74, gy + 13 * s], [W * 0.94, gy + 18 * s]], 1.2);
      stroke([[W * 0.3, gy + 30 * s], [W * 0.46, gy + 27 * s]], 0.9);
      for (const x of tufts) {
        stroke([[x, gy], [x - 4 * s, gy - 9 * s], [x - 7 * s, gy - 14 * s]], 1.6);
        stroke([[x + 3 * s, gy], [x + 4 * s, gy - 11 * s], [x + 3 * s, gy - 17 * s]], 2);
        stroke([[x + 6 * s, gy], [x + 10 * s, gy - 8 * s]], 1.3);
      }
      ctx.globalAlpha = 0.5;
      for (const m of motes) {
        m.y -= m.v * dt;
        m.x += Math.sin(t * 0.8 + m.ph) * 6 * dt;
        if (m.y < H * 0.12) { m.y = gy - 10 * s; m.x = Math.random() * W; }
        blob(m.x, m.y, m.r * s, m.r * s, ink, 6);
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- Break Brawl: a playable round during breaks ----------
       Jump the rolling ink, slash the pings back at the boss. */
    const BEST_KEY = "tomate-brawl-best";
    let best = 0;
    try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (_) {}
    let game = null;
    const pressed = { jump: false, slash: false };

    function newGame(t, g) {
      const hearts = g.has("shield") ? 4 : 3;
      return {
        phase: "play", t0: t, phaseAt: t, y: 0, vy: 0, slashAt: -10, hurtAt: -10,
        hearts, maxHearts: hearts, hp: 100, level: 1, score: 0,
        shots: [], nextShot: t + 2.4, bossHitAt: -10, throwAt: -10,
      };
    }
    function saveBest(score) {
      if (score <= best) return;
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (_) {}
    }
    function stopGame() {
      if (!game) return;
      saveBest(game.score);
      game = null;
      pressed.jump = pressed.slash = false;
      if (hooks.onGameChange) hooks.onGameChange(false);
    }

    function hurt(t, x, y) {
      const G = game;
      G.hearts -= 1;
      G.hurtAt = t;
      fx.push({ type: "splat", x, y, born: t, life: 0.8, blobs: Array.from({ length: 4 }, () => ({ dx: (Math.random() - 0.5) * 40 * s, dy: (Math.random() - 0.5) * 30 * s, r: (2 + Math.random() * 4) * s })) });
      fx.push({ type: "tick", x, y: y - 24 * s, text: "oof", born: t, life: 0.6 });
      if (G.hearts <= 0) {
        G.phase = "lost";
        G.phaseAt = t;
        G.shots = [];
        saveBest(G.score);
      }
    }

    function updateGame(t, dt, L, g) {
      let G = game;
      const restart = (pressed.jump || pressed.slash) && G.phase === "lost" && t - G.phaseAt > 0.7;
      if (restart) { game = G = newGame(t, g); G.nextShot = t + 1.2; }
      const grav = 2600 * s;
      if (pressed.jump && G.phase !== "lost" && G.y <= 0) G.vy = Math.sqrt(2 * grav * (g.has("boots") ? 132 : 110) * s);
      if (pressed.slash && G.phase !== "lost" && t - G.slashAt > 0.3) G.slashAt = t;
      pressed.jump = pressed.slash = false;

      G.vy -= grav * dt;
      G.y = Math.max(0, G.y + G.vy * dt);
      if (G.y === 0 && G.vy < 0) G.vy = 0;

      if (G.phase === "won" && t - G.phaseAt > 2) {
        G.phase = "play";
        G.level += 1;
        G.hp = 100;
        G.nextShot = t + 1.2;
      }
      if (G.phase !== "play") return;

      const hx = L.hx, bx = L.vx;
      const speed = (250 + G.level * 45 + Math.min(t - G.t0, 120) * 1.2) * s;
      if (t >= G.nextShot) {
        const ping = Math.random() < 0.55;
        G.shots.push(ping
          ? { type: "ping", x: bx - 50 * s, y: L.gy - 96 * s, v: speed * 0.85, text: pick(PINGS) }
          : { type: "ink", x: bx - 40 * s, y: L.gy - 11 * s, v: speed });
        G.throwAt = t;
        G.nextShot = t + Math.max(0.7, 1.7 - G.level * 0.12 - (t - G.t0) * 0.004) + Math.random() * 0.6;
      }

      const invuln = t - G.hurtAt < 1;
      const slashing = t - G.slashAt < 0.16;
      for (const sh of G.shots) {
        if (sh.back) {
          sh.x += sh.v * dt;
          if (sh.x >= bx - 40 * s) {
            sh.dead = true;
            G.hp -= 10;
            G.score += 1;
            G.bossHitAt = t;
            fx.push({ type: "puff", x: sh.x, y: sh.y, born: t, life: 0.4 });
            fx.push({ type: "pow", x: bx + 70 * s, y: L.gy - 170 * s, text: pick(POWS), size: 24 * s, rot: (Math.random() - 0.5) * 0.4, born: t, life: 0.6 });
            if (G.hp <= 0) {
              G.phase = "won";
              G.phaseAt = t;
              G.score += 5;
              for (const o of G.shots) o.dead = true;
            }
          }
          continue;
        }
        sh.x -= sh.v * dt;
        if (sh.type === "ping") {
          if (slashing && sh.x - hx < 112 * s && sh.x - hx > -6 * s) {
            sh.back = true;
            sh.v *= 1.6;
            fx.push({ type: "tick", x: sh.x - 10 * s, y: sh.y + 24 * s, text: "tink", born: t, life: 0.4 });
          } else if (sh.x < hx + 12 * s) {
            sh.dead = true;
            fx.push({ type: "puff", x: sh.x, y: sh.y, born: t, life: 0.4 });
            if (!invuln) hurt(t, hx + 10 * s, sh.y);
          }
        } else {
          if (!sh.hit && Math.abs(sh.x - hx) < 16 * s && G.y < 26 * s) {
            sh.hit = true;
            if (!invuln) hurt(t, hx, L.gy - 20 * s);
          }
          if (sh.x < -40 * s) sh.dead = true;
        }
      }
      G.shots = G.shots.filter((o) => !o.dead);
    }

    function heart(x, y, full) {
      const h = [[x, y + 7 * s], [x - 8 * s, y - 1 * s], [x - 7 * s, y - 7 * s], [x - 2 * s, y - 8 * s], [x, y - 4 * s], [x + 2 * s, y - 8 * s], [x + 7 * s, y - 7 * s], [x + 8 * s, y - 1 * s]];
      fillPoly(smooth(h, true, 3), full ? ink : paper);
      outline(h, 1.8);
    }

    function banner(L, title, sub, help, alpha) {
      if (alpha <= 0) return;
      const y = L.gy - 186 * s, x = W / 2;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.strokeStyle = paper;
      ctx.lineWidth = 7 * s;
      ctx.font = `900 ${Math.round(34 * Math.max(s, 0.8))}px Rubik, sans-serif`;
      ctx.strokeText(title, x, y);
      ctx.fillText(title, x, y);
      ctx.font = `700 ${Math.round(17 * Math.max(s, 0.85))}px Kalam, cursive`;
      ctx.strokeText(sub, x, y + 34 * Math.max(s, 0.8));
      ctx.fillText(sub, x, y + 34 * Math.max(s, 0.8));
      ctx.font = `500 ${Math.round(11 * Math.max(s, 0.85))}px "Geist Mono", ui-monospace, monospace`;
      ctx.strokeText(help, x, y + 60 * Math.max(s, 0.8));
      ctx.fillText(help, x, y + 60 * Math.max(s, 0.8));
      ctx.globalAlpha = 1;
    }

    function drawGame(t, L, g, st) {
      const G = game, hx = L.hx;
      const r = 62 * s;
      const bh = Math.max(0, 1 - (t - G.bossHitAt) / 0.35);
      const lean = -Math.max(0, 1 - (t - G.throwAt) / 0.3) * 14 * s;
      const bx = L.vx + bh * 14 * s + lean, by = L.gy - r - 26 * s + Math.sin(t * 1.7) * 6 * s;
      lastV = { x: bx, y: by, r };

      if (G.phase === "won") {
        const k = Math.min(1, (t - G.phaseAt) / 1.2);
        ctx.globalAlpha = 1 - k;
        villain(bx, by + k * 20 * s, r * (1 - k * 0.4), { t, hit: 1, look: [-1, 0] });
        ctx.globalAlpha = 1;
        pow(bx, by - r - 30 * s, "GONE!", 40 * s, -0.12, Math.min(k * 1.4, 0.69));
      } else {
        for (let i = 0; i < 3; i++) {
          const rr = r * 0.75 * (1 - i * 0.25);
          stroke([[bx - rr, L.gy + 4 * s + i * 4 * s], [bx, L.gy + 6 * s + i * 4 * s], [bx + rr, L.gy + 4 * s + i * 4 * s]], i ? 1.1 : 2);
        }
        villain(bx, by, r, { t, hit: Math.min(bh, 1), look: [-1, 0.35] });
      }

      for (const sh of G.shots) {
        if (sh.type === "ping") speech(sh.x, sh.y, sh.text);
        else {
          blob(sh.x, sh.y, 11 * s, 10 * s, ink, 10);
          stroke([[sh.x + 14 * s, sh.y - 4 * s], [sh.x + 32 * s, sh.y - 3 * s]], 1.4);
          stroke([[sh.x + 13 * s, sh.y + 5 * s], [sh.x + 25 * s, sh.y + 6 * s]], 1);
        }
      }

      if (G.phase === "lost") {
        heroSit(hx, L.gy, t, true, g);
      } else {
        const sk = (t - G.slashAt) / 0.2;
        const a = sk < 1 ? lerp(-2.1, 0.9, easeOut(sk)) : -1.0 + Math.sin(t * 2) * 0.08;
        if (t - G.hurtAt < 1 && Math.floor(t * 12) % 2 === 0) ctx.globalAlpha = 0.3;
        hero(hx, L.gy, { t, a, lift: G.y, step: G.y > 0 ? 0.5 : 0, weapon: lastWeapon(g), gear: g, happy: G.phase === "won" });
        ctx.globalAlpha = 1;
      }

      // hearts under the hero, boss HP + score under the boss
      for (let i = 0; i < G.maxHearts; i++) heart(hx - ((G.maxHearts - 1) * 11 - i * 22) * s, L.gy + 32 * s, i < G.hearts);
      const bw = 96 * s, bt = L.gy + 26 * s;
      const hpw = bw * Math.max(0, G.hp) / 100;
      if (hpw > 1) hatch([[L.vx - bw / 2, bt], [L.vx - bw / 2 + hpw, bt], [L.vx - bw / 2 + hpw, bt + 9 * s], [L.vx - bw / 2, bt + 9 * s]], 3, 0.9);
      outline([[L.vx - bw / 2, bt], [L.vx + bw / 2, bt], [L.vx + bw / 2, bt + 9 * s], [L.vx - bw / 2, bt + 9 * s]], 1.8);
      ctx.font = `500 ${Math.round(11 * Math.max(s, 0.85))}px "Geist Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`LVL ${G.level}  ·  ${G.score}  ·  BEST ${Math.max(best, G.score)}`, L.vx, bt + 26 * s);

      const help = L.mob ? "tap left: jump · tap right: slash" : "space / ↑ jump · x / j slash · esc quit";
      if (G.phase === "lost") banner(L, "OOF.", `Score ${G.score}. Jump or slash to go again.`, help, 1);
      else banner(L, "BREAK BRAWL", "Jump the ink. Slash the pings back.", help, 3 - (t - G.t0));

      hud.label.textContent = "Break brawl";
      hud.name.textContent = bossName(st);
      hud.sub.textContent = `Hearts ${G.hearts} · Score ${G.score} · Best ${Math.max(best, G.score)}`;
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (!game) return;
      e.preventDefault();
      pressed[e.clientX < W / 2 ? "jump" : "slash"] = true;
    });

    /* ---------- frame ---------- */
    function layout() {
      const mob = W < 700;
      return { mob, gy: H * (mob ? 0.74 : 0.82), hx: W * (mob ? 0.22 : 0.28), vx: W * (mob ? 0.7 : 0.66) };
    }

    function bossName(st) {
      const cur = st.tasks.find((x) => x.id === st.currentId);
      return cur ? cur.text : FOES[st.done % FOES.length];
    }

    function draw(st, t, dt) {
      const L = layout();
      const g = visibleGear(st);
      const left = st.remaining / st.total;
      leftS += (left - leftS) * Math.min(1, dt * 5);
      if (st.mode !== lastMode) { lastMode = st.mode; modeAt = t; leftS = left; move = null; }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, W, H);
      if (grain) { ctx.fillStyle = grain; ctx.fillRect(0, 0, W, H); }
      ctx.fillStyle = ink;
      seed = 7919 * (boil + 1);

      scenery(L, t, dt);
      if (game && st.mode === "focus") stopGame();

      if (st.mode === "focus") {
        choreo(st, t, g);
        const appear = easeBack(clamp((t - modeAt) / 0.7, 0, 1));
        const r = s * (36 + 76 * leftS) * Math.max(appear, 0.01);
        const c = { home: L.hx, reach: L.vx - r * 0.75 - 92 * s };

        let p = { x: c.home, a: -1.0 + Math.sin(t * 2) * 0.08, lift: 0, step: 0, crouch: 0 };
        let weaponName = lastWeapon(g);
        let bossPose = { lean: 0 };
        if (move) {
          const M = MOVES[move.name];
          const k = clamp((t - move.start) / M.dur, 0, 1);
          p = { ...p, ...M.pose(k, c) };
          weaponName = M.weapon;
          if (M.boss) bossPose = M.boss(k);
          for (const [hk, kind] of M.hits) {
            if (k >= hk && !move.fired.has(hk)) {
              move.fired.add(hk);
              strike(kind, L.vx - r * 0.7, lastV.y, r, t);
            }
          }
        } else if (idle && t >= idle.start) {
          const kk = t - idle.start;
          if (kk > 1) idle = null;
          else if (idle.type === "glance") p.eyesUp = true;
          else p.a += easeInOut(kk) * Math.PI * 2;
        }
        if (st.running && t >= throwAt) {
          throwAt = Infinity;
          fx.push({ type: "bubble", from: [L.vx - r * 0.6, lastV.y + r * 0.2], to: [L.hx + 34 * s, L.gy - 128 * s], text: pick(TAUNTS), born: t, life: 1.2 });
        }

        const hit = Math.max(0, 1 - (t - hitAt) / 0.35) * hitAmp;
        const vx = L.vx + hit * 16 * s + bossPose.lean;
        const vy = L.gy - r - 26 * s + Math.sin(t * 1.7) * 7 * s;
        lastV = { x: vx, y: vy, r };

        for (let i = 0; i < 3; i++) {
          const rr = r * 0.75 * (1 - i * 0.25);
          stroke([[vx - rr, L.gy + 4 * s + i * 4 * s], [vx, L.gy + 6 * s + i * 4 * s], [vx + rr, L.gy + 4 * s + i * 4 * s]], i ? 1.1 : 2);
        }
        const dx = p.x - vx, dy = L.gy - 100 * s - vy, dl = Math.hypot(dx, dy) || 1;
        villain(vx, vy, r, { t, hit: Math.min(hit, 1), look: [dx / dl, dy / dl] });
        if (bossPose.lash) {
          const tip = [lerp(vx - r, p.x + 30 * s, bossPose.lash), L.gy - 60 * s];
          stroke([[vx - r * 0.8, vy + r * 0.2], [lerp(vx - r, tip[0], 0.5), vy - 20 * s], tip], 4.5, { v: 0.6 });
        }
        if (p.dash && g.has("cape")) {
          for (const [off, al] of [[-34, 0.16], [-66, 0.08]]) {
            ctx.globalAlpha = al;
            hero(p.x + off * s, L.gy, { t, ...p, weapon: weaponName, gear: g });
          }
          ctx.globalAlpha = 1;
        }
        hero(p.x, L.gy, { t, ...p, weapon: weaponName, gear: g, shieldUp: p.shieldUp || t < shieldUpUntil });

        hud.label.textContent = "Now fighting";
        hud.name.textContent = bossName(st);
        hud.sub.textContent = `HP ${Math.ceil(left * 100)}% · Kit ${st.gear.length}/7`;
      } else if (game) {
        move = null;
        updateGame(t, dt, L, g);
        drawGame(t, L, g, st);
      } else {
        move = null;
        const long = st.mode === "long";
        const since = defeat ? t - defeat.at : 99;
        if (since < 1.8) {
          const k = since / 1.8;
          ctx.globalAlpha = 1 - k;
          villain(defeat.x, defeat.y + k * 30 * s, defeat.r * (1 - k * 0.5), { t, hit: 1, look: [-1, 0] });
          ctx.globalAlpha = 1;
          const sx = [];
          const n = Math.floor(4 + k * 26);
          for (let i = 0; i < n; i++) sx.push([defeat.x + (i % 2 ? 1 : -1) * defeat.r * 0.9, defeat.y - defeat.r * 0.8 + (i / 30) * defeat.r * 1.8]);
          stroke(sx, 5.5, { v: 0.4, steps: 2 });
          pow(defeat.x, defeat.y - defeat.r - 30 * s, "GONE!", 46 * s, -0.12, Math.min(k * 1.4, 0.69));
          hero(L.hx, L.gy, { t, a: -1.57, lift: Math.abs(Math.sin(since * 6)) * 18 * s * (1 - k), happy: true, weapon: lastWeapon(g), gear: g });
        } else {
          campfire(L.hx + 92 * s, L.gy, 0.3 + 0.7 * leftS, t);
          heroSit(L.hx, L.gy, t, long, g);
          if (!long) {
            const rx = L.vx + 20 * s, ry = L.gy - 20 * s;
            scribble(rx, ry, 22 * s, 22, 1);
            scribble(rx, ry, 20 * s, 8, 2.6, 0.5);
            stroke([[rx - 8 * s, ry - 4 * s], [rx - 3 * s, ry - 2 * s]], 2);
            stroke([[rx + 3 * s, ry - 4 * s], [rx + 8 * s, ry - 2 * s]], 2);
            ctx.font = `700 ${Math.round(15 * Math.max(s, 0.8))}px Kalam, cursive`;
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";
            ctx.fillText("…it'll be back", rx, ry - 36 * s);
          }
        }
        hud.label.textContent = long ? "Long rest" : "Resting";
        hud.name.textContent = "Campfire";
        hud.sub.textContent = `Embers ${Math.ceil(left * 100)}% · Kit ${st.gear.length}/7`;
      }

      wasRunning = st.running;
      hud.fill.style.transform = `scaleX(${(game ? Math.max(0, game.hp) / 100 : left).toFixed(3)})`;
      drawFx(t, L, st);
    }

    function frame(now) {
      if (!active) return;
      requestAnimationFrame(frame);
      const fps = game ? 30 : reduce ? 4 : 12;
      if (now - lastDraw < 1000 / fps) return;
      const t = now / 1000;
      const dt = Math.min(lastT ? t - lastT : 0, 0.25);
      lastDraw = now; lastT = t;
      boil = game ? Math.floor(now / 83) % 3 : (boil + 1) % 3;
      if (noiseEl) noiseEl.setAttribute("seed", String(boil + 1));
      draw(getState(), t, dt);
    }

    /* ---------- setup ---------- */
    function readPalette() {
      const cs = getComputedStyle(document.documentElement);
      ink = cs.getPropertyValue("--ink").trim() || ink;
      paper = cs.getPropertyValue("--bg").trim() || paper;
      const g = document.createElement("canvas");
      g.width = g.height = 160;
      const gx = g.getContext("2d");
      gx.fillStyle = ink;
      for (let i = 0; i < 1400; i++) {
        gx.globalAlpha = Math.random() * 0.07;
        gx.fillRect(Math.random() * 160, Math.random() * 160, 1, 1);
      }
      grain = ctx.createPattern(g, "repeat");
    }

    function resize() {
      W = innerWidth; H = innerHeight;
      dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      s = Math.min(W / 520, H / 1000, 1.25);
      tufts = Array.from({ length: Math.round(W / 140) }, () => Math.random() * W);
      spires = W >= 700
        ? [[0.05, 240, 20], [0.11, 160, 14], [0.89, 280, 22], [0.955, 180, 15]]
        : [[0.07, 150, 13], [0.94, 190, 15]];
      spires = spires.map(([fx0, h, w]) => ({ x: W * fx0, h: h * s, w: w * s }));
      motes = Array.from({ length: 16 }, () => ({ x: Math.random() * W, y: H * (0.15 + Math.random() * 0.6), v: 8 + Math.random() * 14, r: 1.2 + Math.random() * 2.2, ph: Math.random() * 6 }));
    }
    addEventListener("resize", () => active && resize());
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => active && setTimeout(readPalette, 0));

    return {
      setActive(on) {
        if (on === active) return;
        active = on;
        if (on) {
          resize();
          readPalette();
          lastMode = null;
          lastT = 0;
          if (document.fonts) document.fonts.load("900 40px Rubik").catch(() => {});
          requestAnimationFrame(frame);
        } else {
          pending.clear();
          stopGame();
        }
      },
      startGame() {
        const st = getState();
        if (!active || st.mode === "focus") return;
        game = newGame(performance.now() / 1000, visibleGear(st));
        fx.length = 0;
        if (hooks.onGameChange) hooks.onGameChange(true);
      },
      stopGame,
      playing: () => !!game,
      input(action) { if (game) pressed[action] = true; },
      onComplete(prevMode, skipped) {
        if (!active || prevMode !== "focus" || skipped) return;
        defeat = { at: performance.now() / 1000, x: lastV.x, y: lastV.y, r: Math.max(lastV.r, 60 * s) };
      },
      onLoot(item) {
        if (!active) return;
        if (item.id !== "ink") pending.add(item.id);
        if (UNLOCKS[item.id]) forceNext = UNLOCKS[item.id];
        fx.push({ type: "loot", id: item.id, name: item.name, from: [lastV.x, lastV.y], born: performance.now() / 1000, life: 2.6 });
      },
    };
  };
})();
