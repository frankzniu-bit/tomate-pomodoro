(() => {
  "use strict";

  // Hand-drawn duel: a pencil-wielding hero versus a scribbled foe whose HP is the time left.
  window.createSketch = function (canvas, getState) {
    const ctx = canvas.getContext("2d");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const FOES = ["The Distraction", "Scroll Wraith", "Ping Goblin", "The Maybe-Later", "Tab Hydra"];
    const TAUNTS = ["ping!", "1 new msg", "just check?", "scroll…", "5 min?", "look up", "brb?"];
    const POWS = ["SHK!", "THWIP!", "POW", "SNIKT", "WHAM"];
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
    let leftS = 1, lastMode = null, modeAt = -10, wasRunning = false, attackT0 = 0;
    let hitAt = -10, lastHitCyc = -1, lastThrowCyc = -1;
    let defeat = null;
    let tufts = [], spires = [], motes = [];
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
    const easeOut = (k) => 1 - Math.pow(1 - k, 3);
    const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const easeBack = (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);

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
      ctx.beginPath();
      ctx.moveTo(L[0][0], L[0][1]);
      for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
      ctx.closePath();
      ctx.fill();
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
    const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];

    /* ---------- characters ---------- */
    function pencil(h, a, len) {
      const d = [Math.cos(a), Math.sin(a)], nrm = [-d[1], d[0]], hw = 4.4 * s;
      const back = add(h, d, -12 * s), tipBase = add(h, d, len), tip = add(tipBase, d, 17 * s);
      const P = (p, k) => add(p, nrm, hw * k);
      const body = [P(back, 1), P(tipBase, 1), tip, P(tipBase, -1), P(back, -1)];
      fillPoly(body, paper);
      stroke([...body, body[0], body[1]], 2.4, { j: 0.7, taper: false, v: 0.3 });
      stroke([add(back, d, 3 * s), add(tipBase, d, -2 * s)], 0.9, { j: 0.5 });
      const lead = add(tipBase, d, 11 * s);
      fillPoly([P(lead, 0.38), tip, P(lead, -0.38)], ink);
      const band = add(back, d, 7 * s);
      stroke([P(band, 1.2), P(band, -1.2)], 2.2, { j: 0.4 });
    }

    function hero(x, gy, o) {
      const u = s, t = o.t;
      const b = gy - (o.lift || 0);
      const bob = Math.sin(t * 2.4) * 2 * u;
      const st = o.step || 0;
      // shadow
      const sh = 1 - Math.min(0.6, (o.lift || 0) / (60 * u));
      stroke([[x - 24 * u * sh, gy + 5 * u], [x, gy + 6 * u], [x + 24 * u * sh, gy + 5 * u]], 2.2, { v: 0.3 });
      stroke([[x - 14 * u * sh, gy + 9 * u], [x + 16 * u * sh, gy + 9 * u]], 1, {});
      // legs + boots
      stroke([[x - 6 * u, b - 36 * u], [x - 9 * u - st * 6 * u, b - 17 * u], [x - 11 * u - st * 11 * u, b]], 3.4);
      stroke([[x + 6 * u, b - 36 * u], [x + 8 * u + st * 6 * u, b - 17 * u], [x + 12 * u + st * 11 * u, b]], 3.4);
      stroke([[x - 19 * u - st * 11 * u, b + 1 * u], [x - 9 * u - st * 11 * u, b]], 5.5, { taper: false });
      stroke([[x + 10 * u + st * 11 * u, b], [x + 21 * u + st * 11 * u, b + 1 * u]], 5.5, { taper: false });
      // scarf trailing behind
      const fl = Math.sin(t * 7) * 5 * u, drag = o.pose === "dash" ? 1.5 : 1;
      stroke([[x - 3 * u, b - 80 * u + bob], [x - 22 * u * drag, b - 76 * u + fl + bob], [x - 40 * u * drag, b - 82 * u - fl + bob], [x - 56 * u * drag, b - 72 * u + fl + bob]], 4.2, { v: 0.6 });
      stroke([[x - 5 * u, b - 76 * u + bob], [x - 24 * u * drag, b - 67 * u - fl + bob], [x - 40 * u * drag, b - 69 * u + fl + bob]], 1.4);
      // cloak, hatched
      const c = [
        [x, b - 84 * u + bob], [x - 13 * u, b - 62 * u + bob], [x - 29 * u, b - 30 * u],
        [x - 8 * u, b - 35 * u], [x + 7 * u, b - 31 * u], [x + 27 * u, b - 31 * u], [x + 14 * u, b - 63 * u + bob],
      ];
      fillPoly(c, paper);
      hatch(c, 5, 0.9);
      stroke([...c, c[0], c[1]], 3.8, { v: 0.55 });
      // arm + pencil sword
      const shoulder = [x + 8 * u, b - 68 * u + bob];
      const ad = [Math.cos(o.a + 0.9), Math.sin(o.a + 0.9)];
      const hand = add(shoulder, ad, 17 * u);
      stroke([shoulder, add(shoulder, ad, 9 * u), hand], 3.2);
      pencil(hand, o.a, 62 * u);
      blob(hand[0], hand[1], 4.5 * u, 4.5 * u, ink, 8);
      // head with a swept-back hood point
      const hy = b - 102 * u + bob, hr = 19 * u;
      stroke([[x - 10 * u, hy - 15 * u], [x - 26 * u, hy - 24 * u - fl * 0.3], [x - 46 * u, hy - 20 * u + fl * 0.6]], 4.2, { v: 0.5 });
      stroke([[x + 8 * u, hy - 17 * u], [x - 18 * u, hy - 29 * u], [x - 46 * u, hy - 20 * u + fl * 0.6]], 1.5);
      blob(x, hy, hr, hr * 1.04, paper);
      stroke(ell(x, hy, hr, hr * 1.04, { n: 12 }), 3.9, { v: 0.55 });
      if (o.happy) {
        stroke([[x + 1 * u, hy + 2 * u], [x + 5 * u, hy - 3 * u], [x + 9 * u, hy + 2 * u]], 2.4);
        stroke([[x + 11 * u, hy + 2 * u], [x + 14 * u, hy - 3 * u], [x + 18 * u, hy + 2 * u]], 2.4);
      } else if (t % 3.7 < 0.14) {
        stroke([[x + 1 * u, hy + 1 * u], [x + 8 * u, hy + 1 * u]], 2.4);
        stroke([[x + 11 * u, hy + 1 * u], [x + 17 * u, hy + 1 * u]], 2.4);
      } else {
        blob(x + 4.5 * u, hy + 1 * u, 3.4 * u, 6 * u, ink, 8);
        blob(x + 14 * u, hy + 1 * u, 3 * u, 5.4 * u, ink, 8);
      }
    }

    function heroSit(x, gy, t, sleepy) {
      const u = s;
      const br = Math.sin(t * 1.6) * 1.5 * u;
      stroke([[x - 30 * u, gy + 5 * u], [x + 40 * u, gy + 5 * u]], 2, { v: 0.3 });
      // pencil planted in the ground
      pencil([x - 44 * u, gy - 72 * u], 1.5, 60 * u);
      // legs out front
      stroke([[x + 4 * u, gy - 10 * u], [x + 20 * u, gy - 26 * u], [x + 34 * u, gy - 2 * u]], 3.4);
      stroke([[x - 2 * u, gy - 8 * u], [x + 14 * u, gy - 20 * u], [x + 28 * u, gy - 1 * u]], 3.4);
      stroke([[x + 30 * u, gy], [x + 42 * u, gy + 1 * u]], 5.5, { taper: false });
      stroke([[x + 24 * u, gy + 1 * u], [x + 35 * u, gy + 2 * u]], 5.5, { taper: false });
      // limp scarf
      stroke([[x - 4 * u, gy - 56 * u + br], [x - 16 * u, gy - 44 * u], [x - 20 * u, gy - 28 * u]], 4, { v: 0.6 });
      const c = [[x, gy - 60 * u + br], [x - 12 * u, gy - 40 * u], [x - 26 * u, gy - 2 * u], [x + 2 * u, gy - 6 * u], [x + 16 * u, gy - 8 * u], [x + 12 * u, gy - 40 * u + br]];
      fillPoly(c, paper);
      hatch(c, 5, 0.9);
      stroke([...c, c[0], c[1]], 3.8, { v: 0.55 });
      const hy = gy - 78 * u + br, hr = 18 * u;
      stroke([[x - 10 * u, hy - 14 * u], [x - 24 * u, hy - 18 * u], [x - 36 * u, hy - 4 * u]], 4, { v: 0.5 });
      blob(x, hy, hr, hr * 1.04, paper);
      stroke(ell(x, hy, hr, hr * 1.04, { n: 12 }), 3.9, { v: 0.55 });
      if (sleepy) {
        stroke([[x + 1 * u, hy + 1 * u], [x + 5 * u, hy + 4 * u], [x + 9 * u, hy + 1 * u]], 2.2);
        stroke([[x + 11 * u, hy + 1 * u], [x + 14 * u, hy + 4 * u], [x + 18 * u, hy + 1 * u]], 2.2);
        ctx.font = `700 ${Math.round(20 * Math.max(s, 0.8))}px Kalam, cursive`;
        for (let i = 0; i < 3; i++) {
          const k = ((t * 0.35 + i / 3) % 1);
          ctx.globalAlpha = Math.sin(k * Math.PI);
          ctx.fillText("z", x + 18 * u + k * 30 * u + i * 4 * u, hy - 24 * u - k * 50 * u);
        }
        ctx.globalAlpha = 1;
      } else {
        blob(x + 6 * u, hy + 2 * u, 3.2 * u, 5.6 * u, ink, 8);
        blob(x + 15 * u, hy + 2 * u, 2.8 * u, 5 * u, ink, 8);
      }
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
      // smoke curl
      const sm = [];
      for (let i = 0; i < 6; i++) sm.push([x + Math.sin(t * 1.2 + i * 0.9) * 8 * u, gy - (64 + i * 16) * u * Math.max(k, 0.5)]);
      ctx.globalAlpha = 0.6;
      stroke(sm, 1.4, {});
      ctx.globalAlpha = 1;
      // sparks
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
      // tendrils
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
      // eyes, mismatched
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
      // angry brows
      stroke([[e[0][0] - e[0][2] * 1.1, e[0][1] - e[0][2] * 1.5], [e[0][0] + e[0][2] * 1.0, e[0][1] - e[0][2] * 0.95]], 5, { taper: false });
      stroke([[e[1][0] - e[1][2] * 0.9, e[1][1] - e[1][2] * 1.1], [e[1][0] + e[1][2] * 1.2, e[1][1] - e[1][2] * 1.8]], 4.2, { taper: false });
      // jagged grin
      const m = [], my = y + r * 0.36;
      for (let i = 0; i <= 8; i++) m.push([x - r * 0.48 + i * r * 0.115, my + (i % 2 ? r * 0.1 : -r * 0.03) + Math.sin(i) * r * 0.03]);
      fillPoly([...m, [x + r * 0.44, my - r * 0.12], [x - r * 0.48, my - r * 0.1]], paper);
      stroke(m, 2.8, { v: 0.4 });
      stroke([m[0], [x, my - r * 0.14], m[m.length - 1]], 2.2);
      ctx.restore();
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
      const sc = k < 0.18 ? (k / 0.18) * 1.25 : 1.25 - Math.min(0.25, (k - 0.18) * 1.2);
      ctx.scale(sc, sc);
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * 6.28 + 0.2;
        const r0 = size * 0.9, r1 = size * (1.35 + (i % 2) * 0.35);
        stroke([[Math.cos(a) * r0, Math.sin(a) * r0 * 0.6], [Math.cos(a) * r1, Math.sin(a) * r1 * 0.6]], i % 2 ? 1.4 : 3);
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

    function drawFx(t, L) {
      for (let i = fx.length - 1; i >= 0; i--) {
        const e = fx[i];
        const k = (t - e.born) / e.life;
        if (k >= 1) {
          if (e.type === "bubble") {
            fx.push({ type: "puff", x: e.to[0], y: e.to[1], born: t, life: 0.45 });
            fx.push({ type: "pow", x: e.to[0] + 10 * s, y: e.to[1] - 26 * s, text: "nope", size: 18 * s, rot: -0.2, born: t, life: 0.6 });
          }
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
          stroke(pts, 11, { v: 0.2 });
          stroke(pts.map(([px, py]) => [px - 10 * s, py]), 1.4);
          stroke(pts.map(([px, py]) => [px + 9 * s, py]), 1.1);
          ctx.globalAlpha = 1;
        } else if (e.type === "splat") {
          ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
          for (const b of e.blobs) {
            const bx = e.x + b.dx * (0.6 + k * 0.6), by = e.y + b.dy * (0.6 + k * 0.6) + k * k * 30 * s;
            blob(bx, by, b.r, b.r * 0.9, ink, 9);
          }
          ctx.globalAlpha = 1;
        } else if (e.type === "pow") {
          pow(e.x, e.y, e.text, e.size, e.rot, k);
        } else if (e.type === "puff") {
          ctx.globalAlpha = 1 - k;
          for (let j = 0; j < 5; j++) {
            const a = (j / 5) * 6.28;
            const rr = (8 + 18 * k) * s;
            stroke(ell(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr, 6 * s, 6 * s, { n: 8 }), 1.6);
          }
          ctx.globalAlpha = 1;
        } else if (e.type === "bubble") {
          const kk = easeInOut(k);
          const bx = lerp(e.from[0], e.to[0], kk);
          const by = lerp(e.from[1], e.to[1], kk) - Math.sin(kk * Math.PI) * 70 * s;
          speech(bx, by, e.text);
        }
      }
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
      // ground: one heavy line, a few light ones
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
      // drifting ink motes
      ctx.globalAlpha = 0.5;
      for (const m of motes) {
        m.y -= m.v * dt;
        m.x += Math.sin(t * 0.8 + m.ph) * 6 * dt;
        if (m.y < H * 0.12) { m.y = gy - 10 * s; m.x = Math.random() * W; }
        blob(m.x, m.y, m.r * s, m.r * s, ink, 6);
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- frame ---------- */
    function layout() {
      const mob = W < 700;
      return { mob, gy: H * (mob ? 0.74 : 0.82), hx: W * (mob ? 0.22 : 0.28), vx: W * (mob ? 0.7 : 0.66) };
    }

    function draw(st, t, dt) {
      const L = layout();
      const left = st.remaining / st.total;
      leftS += (left - leftS) * Math.min(1, dt * 5);
      if (st.mode !== lastMode) { lastMode = st.mode; modeAt = t; leftS = left; }
      if (st.running && !wasRunning) attackT0 = t;
      wasRunning = st.running;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, W, H);
      if (grain) { ctx.fillStyle = grain; ctx.fillRect(0, 0, W, H); }
      ctx.fillStyle = ink;
      seed = 7919 * (boil + 1);

      scenery(L, t, dt);

      if (st.mode === "focus") {
        const appear = easeBack(clamp((t - modeAt) / 0.7, 0, 1));
        const r = s * (36 + 76 * leftS) * Math.max(appear, 0.01);
        const hit = Math.max(0, 1 - (t - hitAt) / 0.35);
        const vx = L.vx + hit * 16 * s;
        const vy = L.gy - r - 26 * s + Math.sin(t * 1.7) * 7 * s;
        let hx = L.hx, a = -1.0 + Math.sin(t * 2) * 0.08, lift = 0, step = 0, pose = "idle";

        if (st.running && !reduce) {
          const P = 2.6, el = t - attackT0, ph = (el % P) / P, cyc = Math.floor(el / P);
          const reach = L.vx - r * 0.75 - 92 * s;
          if (ph < 0.5) {
            step = 0;
          } else if (ph < 0.62) {
            const k = (ph - 0.5) / 0.12;
            hx = lerp(L.hx, reach, k * k);
            a = -2.0; step = Math.sin(k * 18) * 0.8; pose = "dash";
            for (let i = 0; i < 3; i++) stroke([[hx - 90 * s, L.gy - 34 * s - i * 24 * s], [hx - 40 * s, L.gy - 34 * s - i * 24 * s]], 1.4 - i * 0.2);
          } else if (ph < 0.76) {
            const k = (ph - 0.62) / 0.14;
            hx = reach; a = lerp(-2.1, 0.9, easeOut(k)); lift = Math.sin(k * Math.PI) * 16 * s; pose = "slash";
          } else {
            const k = (ph - 0.76) / 0.24;
            hx = lerp(reach, L.hx, easeInOut(k)); a = lerp(0.9, -1.0, k); step = Math.sin(k * 14) * 0.6;
          }
          if (ph >= 0.66 && cyc !== lastHitCyc && cyc >= 0) {
            lastHitCyc = cyc; hitAt = t;
            const cx = L.vx - r * 0.7, cy = vy;
            fx.push({ type: "slash", x: cx, y: cy, born: t, life: 0.22 });
            fx.push({ type: "pow", x: L.vx + r * 1.05, y: vy - r * 0.75, text: pick(POWS), size: 34 * s, rot: (Math.random() - 0.5) * 0.5, born: t, life: 0.75 });
            fx.push({ type: "splat", x: cx + 20 * s, y: cy, born: t, life: 1.1, blobs: Array.from({ length: 6 }, () => ({ dx: (Math.random() - 0.2) * 70 * s, dy: (Math.random() - 0.5) * 60 * s, r: (2 + Math.random() * 6) * s })) });
          }
          if (ph >= 0.08 && ph < 0.4 && cyc !== lastThrowCyc && cyc % 2 === 1) {
            lastThrowCyc = cyc;
            fx.push({ type: "bubble", from: [L.vx - r * 0.6, vy + r * 0.2], to: [L.hx + 34 * s, L.gy - 128 * s], text: pick(TAUNTS), born: t, life: 1.2 });
          }
        }

        // foe shadow
        for (let i = 0; i < 3; i++) {
          const rr = r * 0.75 * (1 - i * 0.25);
          stroke([[vx - rr, L.gy + 4 * s + i * 4 * s], [vx, L.gy + 6 * s + i * 4 * s], [vx + rr, L.gy + 4 * s + i * 4 * s]], i ? 1.1 : 2);
        }
        const dx = hx - vx, dy = L.gy - 100 * s - vy, dl = Math.hypot(dx, dy) || 1;
        villain(vx, vy, r, { t, hit, look: [dx / dl, dy / dl] });
        hero(hx, L.gy, { t, a, lift, step, pose });

        hud.label.textContent = "Now fighting";
        hud.name.textContent = FOES[st.done % FOES.length];
        hud.sub.textContent = `HP ${Math.ceil(left * 100)}%`;
      } else {
        const long = st.mode === "long";
        const since = defeat ? t - defeat.at : 99;
        if (since < 1.8) {
          const k = since / 1.8;
          ctx.globalAlpha = 1 - k;
          villain(defeat.x, defeat.y + k * 30 * s, defeat.r * (1 - k * 0.5), { t, hit: 1, look: [-1, 0] });
          ctx.globalAlpha = 1;
          // scribble it out
          const sx = [];
          const n = Math.floor(4 + k * 26);
          for (let i = 0; i < n; i++) sx.push([defeat.x + (i % 2 ? 1 : -1) * defeat.r * 0.9, defeat.y - defeat.r * 0.8 + (i / 30) * defeat.r * 1.8]);
          stroke(sx, 5.5, { v: 0.4, steps: 2 });
          pow(defeat.x, defeat.y - defeat.r - 30 * s, "GONE!", 46 * s, -0.12, Math.min(k * 1.4, 0.69));
          hero(L.hx, L.gy, { t, a: -1.57, lift: Math.abs(Math.sin(since * 6)) * 18 * s * (1 - k), happy: true });
        } else {
          const fireX = L.hx + 92 * s;
          campfire(fireX, L.gy, 0.3 + 0.7 * leftS, t);
          heroSit(L.hx, L.gy, t, long);
          if (!long) {
            // the foe, napping nearby; it will be back
            const rx = L.vx + 20 * s, ry = L.gy - 20 * s;
            scribble(rx, ry, 22 * s, 22, 1);
            scribble(rx, ry, 20 * s, 8, 2.6, 0.5);
            stroke([[rx - 8 * s, ry - 4 * s], [rx - 3 * s, ry - 2 * s]], 2);
            stroke([[rx + 3 * s, ry - 4 * s], [rx + 8 * s, ry - 2 * s]], 2);
            ctx.font = `700 ${Math.round(15 * Math.max(s, 0.8))}px Kalam, cursive`;
            ctx.textAlign = "center";
            ctx.fillText("…it'll be back", rx, ry - 36 * s);
          }
        }
        hud.label.textContent = long ? "Long rest" : "Resting";
        hud.name.textContent = "Campfire";
        hud.sub.textContent = `Embers ${Math.ceil(left * 100)}%`;
      }

      hud.fill.style.transform = `scaleX(${left.toFixed(3)})`;
      drawFx(t, L);
    }

    function frame(now) {
      if (!active) return;
      requestAnimationFrame(frame);
      const fps = reduce ? 4 : 12;
      if (now - lastDraw < 1000 / fps) return;
      const t = now / 1000;
      const dt = Math.min(lastT ? t - lastT : 0, 0.25);
      lastDraw = now; lastT = t;
      boil = (boil + 1) % 3;
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
        }
      },
      onComplete(prevMode, skipped) {
        if (!active || prevMode !== "focus" || skipped) return;
        const L = layout();
        const r = s * 40;
        defeat = { at: performance.now() / 1000, x: L.vx, y: L.gy - r - 26 * s, r: Math.max(r, 60 * s) };
      },
    };
  };
})();
