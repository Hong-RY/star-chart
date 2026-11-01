/* STAR CHART — game loop, entities, comic-print renderer */
(function (global) {
  'use strict';
  var SC = global.SC, C = SC.C, W = SC.W, H = SC.H;
  var canvas, ctx, view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  var params = new URLSearchParams(location.search);
  var SHOT = params.get('shot');
  var muted = false;

  /* ---------------- state ---------------- */
  function makeState() {
    return {
      state: 'title',
      t: 0,
      timeScale: 1,
      targetScale: 1,
      score: 0, shownScore: 0,
      best: (function () { try { return +(localStorage.getItem('starchart.best') || 0); } catch (e) { return 0; } })(),
      lives: 3, wave: 1, waveTimer: 0,
      combo: 0, comboTimer: 0,
      slow: { energy: 1, active: false, lock: 0 },
      ship: { x: W / 2, y: H * 0.74, vx: 0, vy: 0, tilt: 0, invuln: 0 },
      target: { x: W / 2, y: H * 0.74 },
      stars: [], rocks: [], parts: [], pops: [],
      chart: [],            /* completed constellations: array of point arrays */
      trailPts: [],         /* stars collected for the constellation being drawn */
      shake: 0, hitstop: 0, flash: 0, banner: null, overT: 0, paused: false,
      spawnT: 0.4, starT: 0.2, comboPop: 0
    };
  }
  var G = makeState();

  /* ---------------- canvas ---------------- */
  function resize() {
    var w = global.innerWidth, h = global.innerHeight;
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var s = Math.min(w / W, h / H);
    view.scale = s; view.ox = (w - W * s) / 2; view.oy = (h - H * s) / 2; view.dpr = dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  /* ---------------- helpers ---------------- */
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function mult() { return Math.min(5, 1 + Math.floor(G.combo / 3)); }

  function burst(x, y, n, colors, speed, life, shape) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * SC.TAU, sp = speed * (0.35 + Math.random() * 0.9);
      G.parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: life * (0.6 + Math.random() * 0.7),
        max: life, size: 5 + Math.random() * 9,
        color: pick(colors), shape: shape || 'dot', rot: Math.random() * SC.TAU,
        vr: (Math.random() - 0.5) * 8
      });
    }
  }
  function popup(x, y, text, size, color) {
    G.pops.push({ x: x, y: y, text: text, life: 0.95, max: 0.95, size: size || 44, color: color || C.ink });
  }
  function banner(text, sub) {
    G.banner = { text: text, sub: sub || '', life: 1.9, max: 1.9 };
  }
  function rockShape(r, seed) { return SC.roughPoly(null, 0, 0, r, 11 + (seed % 4), seed, 0.2); }

  function spawnRock(x, y, r, seed) {
    var speed = 200 + G.wave * 26 + Math.random() * 90;
    G.rocks.push({
      x: x == null ? rand(160, W - 160) : x,
      y: y == null ? -80 : y,
      vx: rand(-46, 46), vy: speed,
      r: r || rand(38, 72),
      rot: Math.random() * SC.TAU, vr: rand(-1.1, 1.1),
      seed: seed || (Math.random() * 99999) | 0,
      dead: false
    });
  }

  function spawnStar() {
    for (var k = 0; k < 12; k++) {
      var x = rand(180, W - 180), y = rand(240, H - 300), ok = true;
      for (var i = 0; i < G.rocks.length; i++) {
        if (SC.dist2(x, y, G.rocks[i].x, G.rocks[i].y) < Math.pow(G.rocks[i].r + 70, 2)) { ok = false; break; }
      }
      if (ok) { G.stars.push({ x: x, y: y, phase: Math.random() * SC.TAU, seed: (Math.random() * 9999) | 0 }); return; }
    }
  }

  /* ---------------- game actions ---------------- */
  function startGame() {
    var best = G.best;
    G = makeState();
    G.state = 'play';
    G.best = best;
    banner('第 1 波', '墨陨开始落下');
    SC.Audio.resume();
  }
  function gameOver() {
    G.state = 'over';
    G.overT = 0;
    if (G.score > G.best) { G.best = G.score; try { localStorage.setItem('starchart.best', String(G.best)); } catch (e) {} }
    SC.Audio.over();
  }
  function hitShip() {
    if (G.ship.invuln > 0 || G.state !== 'play') return;
    G.lives--;
    G.ship.invuln = 1.7;
    G.shake = 13;
    G.hitstop = 0.075;
    G.combo = 0; G.comboTimer = 0;
    burst(G.ship.x, G.ship.y, 26, [C.ink, C.accent, C.accent2], 520, 0.75);
    popup(G.ship.x, G.ship.y - 70, 'CRASH!', 64, C.accent);
    SC.Audio.hit();
    if (G.lives <= 0) gameOver();
  }
  function collectStar(i) {
    var s = G.stars[i];
    G.stars.splice(i, 1);
    G.combo++; G.comboTimer = 2.2; G.comboPop = 1;
    var gain = 10 * mult();
    G.score += gain;
    G.trailPts.push({ x: s.x, y: s.y });
    burst(s.x, s.y, 10, [C.accent, C.ink, C.surface], 260, 0.5);
    popup(s.x, s.y - 34, '+' + gain, 40, C.ink);
    SC.Audio.collect(G.combo);
    if (G.combo > 0 && G.combo % 3 === 0) SC.Audio.combo(G.combo);
    if (G.trailPts.length >= 7) completeConstellation();
  }
  function completeConstellation() {
    G.chart.push(G.trailPts.slice());
    G.trailPts = [];
    G.score += 100;
    popup(W / 2, H * 0.44, '星座完成', 96, C.accent);
    popup(W / 2, H * 0.44 + 78, '+100', 56, C.ink);
    SC.Audio.clear();
    G.shake = 16;
    for (var i = 0; i < G.rocks.length; i++) {
      var r = G.rocks[i];
      burst(r.x, r.y, 12, [C.ink, C.accent], 420, 0.7);
    }
    G.rocks.length = 0;
    for (var k = 0; k < 3; k++) G.parts.push({ ring: true, x: W / 2, y: H * 0.5, r0: 30 + k * 70, life: 1.0, max: 1.0, color: C.accent });
  }

  /* ---------------- update ---------------- */
  function step(dt) {
    G.t += dt;
    if (G.state !== 'play') {
      G.shownScore += (G.score - G.shownScore) * Math.min(1, dt * 8);
      return;
    }
    if (G.hitstop > 0) { G.hitstop -= dt; return; }

    /* slow motion */
    var wantSlow = G.slow.active && G.slow.energy > 0 && G.slow.lock <= 0;
    G.targetScale = wantSlow ? 0.35 : 1;
    G.timeScale += (G.targetScale - G.timeScale) * Math.min(1, dt * 9);
    if (wantSlow) G.slow.energy = Math.max(0, G.slow.energy - dt / 3.0);
    else G.slow.energy = Math.min(1, G.slow.energy + dt / 2.6);
    if (G.slow.energy <= 0) G.slow.lock = 0.4;
    G.slow.lock = Math.max(0, G.slow.lock - dt);

    var sdt = dt * G.timeScale;

    /* keyboard steering moves the spring target */
    var kdx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var kdy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (kdx || kdy) {
      G.target.x = SC.clamp(G.target.x + kdx * 1100 * dt, 90, W - 90);
      G.target.y = SC.clamp(G.target.y + kdy * 1100 * dt, 170, H - 120);
    }

    /* ship spring */
    var sk = 150, sd = 19, s = G.ship;
    var ax = (G.target.x - s.x) * sk - s.vx * sd;
    var ay = (G.target.y - s.y) * sk - s.vy * sd;
    s.vx += ax * sdt; s.vy += ay * sdt;
    s.x += s.vx * sdt; s.y += s.vy * sdt;
    s.x = SC.clamp(s.x, 70, W - 70); s.y = SC.clamp(s.y, 150, H - 110);
    s.tilt += (SC.clamp(s.vx / 900, -1, 1) * 0.32 - s.tilt) * Math.min(1, dt * 12);
    s.invuln = Math.max(0, s.invuln - dt);
    G.trailPts.length && 0;
    if (G.comboPop > 0) G.comboPop = Math.max(0, G.comboPop - dt * 4);

    /* combo decay */
    if (G.combo > 0) { G.comboTimer -= dt; if (G.comboTimer <= 0) G.combo = 0; }

    /* spawning */
    G.spawnT -= sdt;
    if (G.spawnT <= 0) {
      var interval = Math.max(0.42, 1.15 - G.wave * 0.07);
      spawnRock(null, null, null, null);
      if (Math.random() < 0.25 && G.wave >= 3) spawnRock(null, -140, rand(58, 82));
      G.spawnT = interval * (0.75 + Math.random() * 0.5);
    }
    G.starT -= sdt;
    if (G.starT <= 0 && G.stars.length < 4) { spawnStar(); G.starT = 0.9 + Math.random() * 0.7; }

    /* rocks */
    for (var i = G.rocks.length - 1; i >= 0; i--) {
      var r = G.rocks[i];
      r.x += r.vx * sdt; r.y += r.vy * sdt; r.rot += r.vr * sdt;
      if (r.y > H + 120) { G.rocks.splice(i, 1); continue; }
      var rr = r.r * 0.78;
      if (s.invuln <= 0 && SC.dist2(s.x, s.y, r.x, r.y) < Math.pow(rr + 20, 2)) {
        G.rocks.splice(i, 1);
        hitShip();
        burst(r.x, r.y, 14, [C.ink, C.accent], 380, 0.6);
      }
    }

    /* stars */
    for (var j = G.stars.length - 1; j >= 0; j--) {
      var st = G.stars[j];
      st.phase += sdt * 3.4;
      if (SC.dist2(s.x, s.y, st.x, st.y) < Math.pow(46, 2)) collectStar(j);
    }

    /* particles */
    for (var p = G.parts.length - 1; p >= 0; p--) {
      var pt = G.parts[p];
      pt.life -= dt;
      if (pt.life <= 0) { G.parts.splice(p, 1); continue; }
      if (!pt.ring) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= 0.96; pt.vy *= 0.96; pt.rot += pt.vr * dt; }
    }
    for (var q = G.pops.length - 1; q >= 0; q--) {
      var pp = G.pops[q]; pp.life -= dt; if (pp.life <= 0) G.pops.splice(q, 1);
    }
    if (G.banner) { G.banner.life -= dt; if (G.banner.life <= 0) G.banner = null; }
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 46);
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 3.2);

    /* waves */
    G.waveTimer += sdt;
    if (G.waveTimer >= 22) {
      G.waveTimer = 0; G.wave++;
      banner('第 ' + G.wave + ' 波', '墨陨更密了');
      SC.Audio.wave();
    }
    G.shownScore += (G.score - G.shownScore) * Math.min(1, dt * 10);
  }

  /* ---------------- draw: world ---------------- */
  function drawPaper(g) {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    g.save();
    g.globalAlpha = 0.9;
    g.fillStyle = SC.paperGrain(g);
    g.fillRect(0, 0, W, H);
    g.restore();

    /* drifting halftone clouds (background must never be dead) */
    var t = G.t;
    for (var i = 0; i < 3; i++) {
      var cx = ((t * (6 + i * 4) + i * 640) % (W + 600)) - 300;
      var cy = 220 + i * 300;
      g.save();
      g.globalAlpha = 0.16;
      g.fillStyle = SC.halftone(g, C.sub, 0.3, 14);
      g.beginPath();
      g.ellipse(cx, cy, 320 + i * 60, 150 + i * 26, -0.3, 0, SC.TAU);
      g.fill();
      g.restore();
    }

    /* engraved astrolabe, very low contrast, gives the page a centre of gravity */
    g.save();
    g.strokeStyle = 'rgba(110,101,82,0.30)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(W / 2, H * 0.54, 330, 0, SC.TAU); g.stroke();
    g.beginPath(); g.arc(W / 2, H * 0.54, 300, 0, SC.TAU); g.stroke();
    var spin = G.t * 0.012;
    for (var d0 = 0; d0 < 72; d0++) {
      var a0 = (d0 / 72) * SC.TAU + spin;
      var rr0 = d0 % 6 === 0 ? 288 : 300;
      g.beginPath();
      g.moveTo(W / 2 + Math.cos(a0) * rr0, H * 0.54 + Math.sin(a0) * rr0);
      g.lineTo(W / 2 + Math.cos(a0) * 316, H * 0.54 + Math.sin(a0) * 316);
      g.stroke();
    }
    g.restore();

    /* star-chart graticule */
    g.save();
    g.strokeStyle = 'rgba(110,101,82,0.22)';
    g.lineWidth = 2;
    g.setLineDash([3, 10]);
    [480, 960, 1440].forEach(function (x) { g.beginPath(); g.moveTo(x, 150); g.lineTo(x, H - 140); g.stroke(); });
    [360, 720].forEach(function (y) { g.beginPath(); g.moveTo(110, y); g.lineTo(W - 110, y); g.stroke(); });
    g.setLineDash([]);
    g.restore();
  }

  function drawChart(g) {
    /* completed constellations */
    g.save();
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.strokeStyle = C.accent2;
    for (var c = 0; c < G.chart.length; c++) {
      var pts = G.chart[c];
      g.beginPath();
      for (var i = 0; i < pts.length; i++) { i ? g.lineTo(pts[i].x, pts[i].y) : g.moveTo(pts[i].x, pts[i].y); }
      if (pts.length > 2) g.closePath();
      g.stroke();
      for (var k = 0; k < pts.length; k++) {
        g.beginPath(); g.arc(pts[k].x, pts[k].y, 7, 0, SC.TAU);
        g.fillStyle = C.accent2; g.fill();
        g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); g.lineWidth = 5;
      }
    }
    /* live constellation */
    if (G.trailPts.length) {
      g.setLineDash([12, 10]);
      g.strokeStyle = 'rgba(29,78,137,0.55)';
      g.lineWidth = 4;
      g.beginPath();
      for (var j = 0; j < G.trailPts.length; j++) { j ? g.lineTo(G.trailPts[j].x, G.trailPts[j].y) : g.moveTo(G.trailPts[j].x, G.trailPts[j].y); }
      g.stroke();
      g.setLineDash([]);
      for (var m = 0; m < G.trailPts.length; m++) {
        g.beginPath(); g.arc(G.trailPts[m].x, G.trailPts[m].y, 4, 0, SC.TAU);
        g.fillStyle = 'rgba(29,78,137,0.6)'; g.fill();
      }
    }
    g.restore();
  }

  function drawStars(g) {
    for (var i = 0; i < G.stars.length; i++) {
      var st = G.stars[i];
      var pulse = 1 + Math.sin(st.phase) * 0.14;
      var r = 26 * pulse;
      g.save();
      g.globalAlpha = 0.85;
      var oa = st.phase * 0.7;
      g.beginPath();
      g.arc(st.x + Math.cos(oa) * r * 1.85, st.y + Math.sin(oa) * r * 1.85, 4.5, 0, SC.TAU);
      g.fillStyle = C.accent2; g.fill();
      g.restore();
      SC.star4(g, st.x, st.y, r, st.phase * 0.1, C.accent, 4);
      g.beginPath(); g.arc(st.x, st.y, r * 0.2, 0, SC.TAU);
      g.fillStyle = C.surface; g.fill();
    }
  }

  function drawRocks(g) {
    for (var i = 0; i < G.rocks.length; i++) {
      var r = G.rocks[i];
      g.save();
      g.translate(r.x, r.y);

      /* burning trail always points straight up, independent of the splat's spin */
      g.save();
      g.fillStyle = 'rgba(110,101,82,0.12)';
      g.beginPath();
      g.moveTo(-r.r * 0.5, 0);
      g.quadraticCurveTo(-r.r * 0.18, -r.r * 1.7, r.r * 0.06, -r.r * 2.3);
      g.quadraticCurveTo(r.r * 0.26, -r.r * 1.1, r.r * 0.5, 0);
      g.closePath();
      g.fill();
      g.globalAlpha = 0.35;
      g.fillStyle = SC.halftone(g, C.bg, 0.45, 9);
      g.fill();
      g.restore();

      g.rotate(r.rot);
      var pts = rockShape(r.r, r.seed);
      SC.printShape(g, pts, { fill: C.ink, lw: 5 });
      /* directional red halftone crescent instead of an all-over dot pattern */
      g.save();
      SC.path(g, pts); g.clip();
      g.globalAlpha = 0.5;
      g.fillStyle = SC.halftone(g, C.bg, 0.55, 8);
      g.beginPath();
      g.arc(-r.r * 0.42, -r.r * 0.46, r.r * 0.72, 0, SC.TAU);
      g.fill();
      g.restore();

      /* misregistration ghost in print blue */
      g.save();
      g.globalAlpha = 0.3;
      g.translate(4, -4);
      SC.path(g, pts);
      g.strokeStyle = C.accent2; g.lineWidth = 3; g.stroke();
      g.restore();

      /* cream highlight arc + cracks */
      g.save();
      SC.path(g, pts); g.clip();
      g.globalAlpha = 0.55;
      g.strokeStyle = C.bg; g.lineWidth = Math.max(4, r.r * 0.13);
      g.beginPath(); g.arc(0, 0, r.r * 0.78, -2.6, -1.8); g.stroke();
      g.globalAlpha = 0.7; g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-r.r * 0.42, -r.r * 0.18); g.lineTo(r.r * 0.05, r.r * 0.2); g.lineTo(-r.r * 0.16, r.r * 0.5);
      g.stroke();
      g.restore();

      /* ink drips escaping the splat */
      var rr = SC.rngFrom(r.seed + 3);
      g.fillStyle = C.ink;
      for (var d = 0; d < 2; d++) {
        var da = Math.PI * 0.55 + rr() * Math.PI * 0.4;
        var dr = r.r * (0.98 + rr() * 0.22);
        var ds = r.r * (0.1 + rr() * 0.08);
        g.beginPath();
        g.arc(Math.cos(da) * dr, Math.sin(da) * dr, ds, 0, SC.TAU);
        g.fill();
      }
      g.restore();
    }
  }

  function drawShip(g) {
    var s = G.ship;
    if (s.invuln > 0 && (Math.floor(s.invuln * 14) % 2 === 0)) return;
    var speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    var tilt = s.tilt;
    g.save();
    g.translate(s.x, s.y);
    g.rotate(tilt);
    g.scale(1.26, 1.26);

    /* motion ghosts: two offset silhouettes, alpha by speed */
    var ghost = SC.clamp(speed / 620, 0, 1.4);
    if (ghost > 0.04) {
      g.save();
      for (var gi = 2; gi >= 1; gi--) {
        g.globalAlpha = 0.10 * ghost * (3 - gi);
        g.fillStyle = C.ink;
        g.beginPath();
        g.moveTo(0, -46 + gi * (8 + ghost * 14));
        g.lineTo(15, -6 + gi * (8 + ghost * 14));
        g.lineTo(26, 20 + gi * (8 + ghost * 14));
        g.lineTo(8, 13 + gi * (8 + ghost * 14));
        g.lineTo(0, 26 + gi * (8 + ghost * 14));
        g.lineTo(-8, 13 + gi * (8 + ghost * 14));
        g.lineTo(-26, 20 + gi * (8 + ghost * 14));
        g.lineTo(-15, -6 + gi * (8 + ghost * 14));
        g.closePath();
        g.fill();
      }
      g.restore();
    }

    /* dart body: white card stock with a paper halo so it never sinks into the page */
    var body = [[0, -46], [15, -6], [26, 20], [8, 13], [0, 26], [-8, 13], [-26, 20], [-15, -6]];
    g.save();
    SC.path(g, body);
    g.fillStyle = C.bg; g.fill();
    g.lineWidth = 15; g.strokeStyle = C.bg; g.lineJoin = 'round'; g.stroke();
    g.restore();
    SC.printShape(g, body, { fill: '#FFFFFF', lw: 6, shade: { color: C.sub, density: 0.12, dx: 4, dy: 5 } });

    /* red nose + red wing edges */
    g.beginPath(); g.moveTo(0, -46); g.lineTo(9, -20); g.lineTo(-9, -20); g.closePath();
    g.fillStyle = C.accent2; g.fill(); g.lineWidth = 4; g.strokeStyle = C.ink; g.stroke();

    g.save();
    g.globalAlpha = 0.9;
    g.strokeStyle = C.accent; g.lineWidth = 3;
    g.beginPath(); g.moveTo(15, -4); g.lineTo(24, 17); g.stroke();
    g.beginPath(); g.moveTo(-15, -4); g.lineTo(-24, 17); g.stroke();
    g.restore();

    /* porthole */
    g.beginPath(); g.arc(0, -6, 5.5, 0, SC.TAU);
    g.fillStyle = C.accent2; g.fill();
    g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();

    g.restore();
  }

  function drawParts(g) {
    for (var i = 0; i < G.parts.length; i++) {
      var p = G.parts[i], a = Math.max(0, p.life / p.max);
      if (p.ring) {
        var k = 1 - a;
        g.save();
        g.globalAlpha = a * 0.55;
        g.strokeStyle = p.color; g.lineWidth = 7 - k * 5;
        g.beginPath(); g.arc(p.x, p.y, p.r0 + k * 760, 0, SC.TAU); g.stroke();
        g.restore();
        continue;
      }
      g.save();
      g.globalAlpha = a;
      g.translate(p.x, p.y); g.rotate(p.rot);
      g.fillStyle = p.color;
      if (p.shape === 'square') { g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); }
      else { g.beginPath(); g.arc(0, 0, p.size / 2, 0, SC.TAU); g.fill(); }
      g.restore();
    }
  }

  function drawPops(g) {
    for (var i = 0; i < G.pops.length; i++) {
      var p = G.pops[i];
      var k = 1 - p.life / p.max;
      var scale = k < 0.2 ? SC.easeOutBack(k / 0.2, 2.4) : 1;
      g.save();
      g.globalAlpha = Math.min(1, (1 - k) * 2.2);
      g.translate(p.x, p.y - k * 46);
      g.scale(scale * (1 + k * 0.06), scale * (1 + k * 0.06));
      SC.comicText(g, p.text, 0, 0, { size: p.size, color: p.color, align: 'center', lineWidth: Math.max(3, p.size * 0.045) });
      g.restore();
    }
  }

  /* ---------------- draw: page furniture ---------------- */
  function drawFrame(g) {
    g.save();
    g.lineWidth = 8; g.strokeStyle = C.ink;
    g.strokeRect(26, 26, W - 52, H - 52);
    g.lineWidth = 2; g.strokeStyle = 'rgba(20,19,16,0.35)';
    g.strokeRect(44, 44, W - 88, H - 88);
    /* crop marks */
    g.strokeStyle = C.ink; g.lineWidth = 5;
    var m = 18;
    [[44, 44, 1, 1], [W - 44, 44, -1, 1], [44, H - 44, 1, -1], [W - 44, H - 44, -1, -1]].forEach(function (c) {
      g.beginPath();
      g.moveTo(c[0] + c[2] * m, c[1]); g.lineTo(c[0], c[1]); g.lineTo(c[0], c[1] + c[3] * m);
      g.stroke();
    });
    g.restore();
  }

  function drawHUD(g) {
    /* caption: width follows the text so the right edge is not hollow */
    g.save();
    g.font = SC.font(32, 900);
    var capW = Math.max(300, g.measureText('星图 · 第 ' + G.wave + ' 波').width + 56);
    g.restore();
    SC.panel(g, 64, 56, capW, 96, { sx: 8, sy: 8, lw: 5 });
    SC.comicText(g, '星图 · 第 ' + G.wave + ' 波', 88, 104, { size: 32, color: C.ink, lineWidth: 0, ghost: false });
    SC.comicText(g, 'STAR CHART / 第一话', 88, 136, { size: 18, color: C.sub, lineWidth: 0, ghost: false });

    /* score */
    SC.panel(g, W - 470, 56, 406, 136, { sx: -8, sy: 8, lw: 5 });
    SC.comicText(g, 'SCORE', W - 100, 94, { size: 22, color: C.sub, align: 'right', ghost: false, lineWidth: 0 });
    SC.comicText(g, String(Math.round(G.shownScore)), W - 96, 166, { size: 78, color: C.ink, align: 'right', lineWidth: 0 });

    /* combo chip */
    if (G.combo >= 2) {
      var cs = 1 + G.comboPop * 0.16;
      var cx = W - 470, cy = 218;
      g.save();
      g.translate(cx + 150, cy + 32);
      g.scale(cs, cs);
      g.translate(-(cx + 150), -(cy + 32));
      SC.panel(g, cx, cy, 406, 64, { lw: 5, fill: C.accent, sx: 6, sy: 6 });
      SC.comicText(g, '×' + mult() + ' 连击', cx + 203, cy + 44, { size: 32, color: C.surface, align: 'center', lineWidth: 0, ghost: false });
      g.restore();
    }

    /* lives */
    for (var i = 0; i < 3; i++) {
      var alive = i < G.lives;
      g.save();
      g.translate(92 + i * 58, 986);
      g.beginPath();
      g.moveTo(0, -20); g.lineTo(10, -2); g.lineTo(6, 16); g.lineTo(-6, 16); g.lineTo(-10, -2);
      g.closePath();
      if (alive) { g.fillStyle = C.accent; g.fill(); }
      g.lineWidth = 4; g.strokeStyle = C.ink; g.stroke();
      g.restore();
    }
    SC.comicText(g, '生命', 84, 1022, { size: 18, color: C.sub, outline: false, ghost: false });

    /* slow meter */
    var mx = W / 2 - 240, my = 966, mw = 480, mh = 40;
    SC.panel(g, mx, my, mw, mh, { sx: 7, sy: 7, lw: 5 });
    var e = G.slow.energy;
    g.save();
    g.beginPath(); g.rect(mx + 6, my + 6, (mw - 12) * e, mh - 12); g.clip();
    g.fillStyle = SC.halftone(g, C.accent2, G.slow.active ? 0.62 : 0.4, 10);
    g.fillRect(mx, my, mw, mh);
    g.restore();
    SC.comicText(g, '空格 缓速', mx + mw / 2, my - 14, { size: 21, color: C.ink, align: 'center', lineWidth: 0, ghost: false });
    if (G.slow.lock > 0) SC.comicText(g, '过热', mx + mw / 2, my + 30, { size: 18, color: C.accent, align: 'center', outline: false, ghost: false });

    /* best */
    SC.comicText(g, '最高 ' + G.best, W - 92, 1020, { size: 22, color: C.sub, align: 'right', lineWidth: 0, ghost: false });
  }

  function drawBanner(g) {
    if (!G.banner) return;
    var b = G.banner;
    var k = 1 - b.life / b.max;
    var inP = SC.clamp(k / 0.16, 0, 1), outP = SC.clamp((k - 0.78) / 0.22, 0, 1);
    var bx = -260 + (W / 2 + 260) * SC.expoOut(inP) + outP * 1500;
    g.save();
    g.translate(bx, 150);
    SC.panel(g, -260, 0, 520, 118, { sx: 10, sy: 10, lw: 6 });
    g.fillStyle = C.accent;
    g.fillRect(-260, 0, 14, 118);
    SC.comicText(g, b.text, -216, 68, { size: 52, color: C.ink, lineWidth: 0 });
    SC.comicText(g, b.sub, -214, 102, { size: 22, color: C.accent, outline: false, ghost: false });
    g.restore();
  }

  function drawSlowOverlay(g) {
    if (G.timeScale > 0.85) return;
    var k = (1 - G.timeScale) / 0.65;
    g.save();
    g.fillStyle = 'rgba(29,78,137,' + (0.10 * k).toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
    /* blue print registration frame, like a frozen film cell */
    g.globalAlpha = 0.5 * k;
    g.strokeStyle = C.accent2; g.lineWidth = 10;
    g.strokeRect(18, 18, W - 36, H - 36);
    g.restore();
    SC.comicText(g, '缓 速', W - 108, 700, { size: 30, color: C.accent2, align: 'right', lineWidth: 0, ghost: false });
  }

  /* ---------------- screens ---------------- */
  function drawTitle(g) {
    var t = G.t;

    /* drifting ink meteors on the right half (page must never be dead) */
    for (var i = 0; i < 3; i++) {
      var x = 1240 + i * 210 + Math.sin(t * 0.25 + i * 2.1) * 26;
      var y = 120 + ((t * 20 + i * 300) % (H - 160));
      g.save(); g.translate(x, y); g.rotate(t * 0.18 + i * 1.3);
      SC.printShape(g, rockShape(26 + i * 8, 210 + i * 13), { fill: C.ink, lw: 4, shade: { color: C.accent, density: 0.4, dx: -5, dy: -6 } });
      g.restore();
    }

    /* constellation engraving, upper right */
    g.save();
    g.strokeStyle = C.accent2; g.lineWidth = 4; g.lineCap = 'round';
    var cp = [[1163, 263], [1316, 206], [1467, 302], [1387, 437], [1220, 406], [1163, 263]];
    g.beginPath();
    cp.forEach(function (p, i) { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    g.stroke();
    cp.forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 7, 0, SC.TAU); g.fillStyle = C.accent2; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke(); g.lineWidth = 4; });
    g.restore();
    for (var k = 0; k < 7; k++) {
      SC.star4(g, 1310 + Math.sin(k * 2.3) * 240, 320 + Math.cos(k * 1.9) * 180, 8 + (k % 3) * 3, t * 0.2 + k, C.accent, 3);
    }

    /* caption panel */
    SC.panel(g, 100, 104, 300, 70, { lw: 4 });
    SC.comicText(g, '第一话 · 墨陨', 122, 150, { size: 27, color: C.ink, lineWidth: 0, ghost: false });

    /* title lockup */
    SC.comicText(g, '星图', 100, 424, { size: 210, color: C.ink, lineWidth: 6 });
    SC.comicText(g, 'STAR CHART', 108, 502, { size: 58, color: C.accent, lineWidth: 4, ghost: true, ghostX: 2, ghostY: 2 });
    g.save();
    g.strokeStyle = C.ink; g.lineWidth = 3;
    g.beginPath(); g.moveTo(110, 540); g.lineTo(640, 540); g.stroke();
    g.restore();
    SC.comicText(g, '在陨落之前，点亮一整页星图', 110, 592, { size: 30, color: C.sub, outline: false, ghost: false });
    SC.comicText(g, '躲开墨陨 · 收集星点 · 集满七颗连成星座', 110, 636, { size: 21, color: C.accent2, outline: false, ghost: false });

    /* start button: printed panel, not a burst blob */
    var pulse = 1 + Math.sin(t * 3.2) * 0.02;
    g.save();
    g.translate(104 + 250, 700 + 52);
    g.scale(pulse, pulse);
    g.translate(-(104 + 250), -(700 + 52));
    SC.panel(g, 104, 700, 500, 104, { lw: 6, fill: C.accent });
    SC.comicText(g, '点击开始', 354, 772, { size: 56, color: C.surface, align: 'center', lineWidth: 2 });
    g.restore();
    SC.comicText(g, '鼠标 / 触屏移动　空格 缓速　M 静音　P 暂停', 108, 866, { size: 22, color: C.sub, outline: false, ghost: false });

    /* best */
    if (G.best > 0) {
      SC.panel(g, W - 452, 872, 340, 100, { sx: -8, sy: 8, lw: 4 });
      SC.comicText(g, '最高分', W - 140, 914, { size: 22, color: C.sub, align: 'right', outline: false, ghost: false });
      SC.comicText(g, String(G.best), W - 140, 956, { size: 46, color: C.ink, align: 'right', lineWidth: 4 });
    }

    /* small footer note */
    SC.comicText(g, 'NO.01　一页会动的星图', W - 108, 1030, { size: 18, color: C.sub, align: 'right', outline: false, ghost: false });
  }

  function drawOver(g) {
    /* clean paper veil: the page is finished, the noise steps back */
    g.save();
    g.globalAlpha = 0.78;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    g.restore();

    var pw = 900, ph = 540, px = (W - pw) / 2, py = (H - ph) / 2 - 10;
    SC.panel(g, px, py, pw, ph, { sx: 16, sy: 16, lw: 8 });
    /* corner marks inside the panel */
    g.save();
    g.strokeStyle = C.accent; g.lineWidth = 6;
    var cm = 30, cg = 56;
    [[px + cm, py + cm, 1, 1], [px + pw - cm, py + cm, -1, 1], [px + cm, py + ph - cm, 1, -1], [px + pw - cm, py + ph - cm, -1, -1]].forEach(function (c) {
      g.beginPath();
      g.moveTo(c[0] + c[2] * cg, c[1]); g.lineTo(c[0], c[1]); g.lineTo(c[0], c[1] + c[3] * cg);
      g.stroke();
    });
    g.restore();

    SC.comicText(g, '本话完', W / 2, py + 150, { size: 104, color: C.ink, align: 'center', lineWidth: 6 });
    SC.comicText(g, '第 ' + G.wave + ' 波 · 点亮 ' + G.chart.length + ' 条星座', W / 2, py + 202, { size: 24, color: C.sub, align: 'center', outline: false, ghost: false });

    g.save();
    g.strokeStyle = 'rgba(20,19,16,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(px + 120, py + 240); g.lineTo(px + pw - 120, py + 240); g.stroke();
    g.restore();

    SC.comicText(g, '得分', px + 230, py + 300, { size: 24, color: C.sub, align: 'center', outline: false, ghost: false });
    SC.comicText(g, String(G.score), px + 230, py + 380, { size: 82, color: C.accent, align: 'center', lineWidth: 0 });
    SC.comicText(g, '最高', px + pw - 230, py + 300, { size: 24, color: C.sub, align: 'center', outline: false, ghost: false });
    SC.comicText(g, String(G.best), px + pw - 230, py + 380, { size: 82, color: C.ink, align: 'center', lineWidth: 0 });

    var pulse = 1 + Math.sin(G.t * 3.2) * 0.03;
    g.save();
    g.translate(W / 2, py + ph - 78);
    g.scale(pulse, pulse);
    SC.panel(g, -220, -44, 440, 88, { lw: 6, fill: C.accent, sx: 8, sy: 8 });
    SC.comicText(g, '点击再来一次', 0, 14, { size: 40, color: C.surface, align: 'center', lineWidth: 0, ghost: false });
    g.restore();
  }

  function drawPause(g) {
    g.save();
    g.globalAlpha = 0.7;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.14;
    g.fillStyle = SC.halftone(g, C.ink, 0.3, 12);
    g.fillRect(0, 0, W, H);
    g.restore();
    SC.panel(g, W / 2 - 240, H / 2 - 140, 480, 280, { lw: 7, sx: 12, sy: 12 });
    SC.comicText(g, '暂停', W / 2, H / 2 - 20, { size: 92, color: C.ink, align: 'center', lineWidth: 5 });
    SC.comicText(g, '按 P 继续 · 空格 缓速', W / 2, H / 2 + 56, { size: 24, color: C.sub, align: 'center', outline: false, ghost: false });
  }

  /* ---------------- render ---------------- */
  function render() {
    if (!ctx) return;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, global.innerWidth, global.innerHeight);
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);

    drawPaper(ctx);
    if (G.state !== 'title') drawChart(ctx);
    if (G.state === 'title') {
      drawFrame(ctx);
      drawTitle(ctx);
    } else {
      drawStars(ctx);
      drawRocks(ctx);
      drawParts(ctx);
      drawShip(ctx);
      drawPops(ctx);
      drawFrame(ctx);
      if (G.state !== 'over') { drawHUD(ctx); drawBanner(ctx); }
      if (G.state === 'over') drawOver(ctx);
      if (G.paused) drawPause(ctx);
    }
    drawSlowOverlay(ctx);
    ctx.restore();
  }

  /* ---------------- loop ---------------- */
  var last = 0, raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    if (!G.paused) step(dt);
    render();
  }

  /* ---------------- input ---------------- */
  function toLogical(clientX, clientY) {
    return { x: (clientX - view.ox) / view.scale, y: (clientY - view.oy) / view.scale };
  }
  var keys = { left: false, right: false, up: false, down: false };
  var pointers = {};

  function bindInput() {
    canvas.addEventListener('pointermove', function (e) {
      if (G.state !== 'play') return;
      var p = toLogical(e.clientX, e.clientY);
      G.target.x = p.x; G.target.y = p.y;
    }, { passive: true });
    canvas.addEventListener('pointerdown', function (e) {
      SC.Audio.resume();
      pointers[e.pointerId] = true;
      if (Object.keys(pointers).length >= 2 && G.state === 'play') G.slow.active = true;
      if (e.button === 2) { if (G.state === 'play') G.slow.active = true; return; }
      if (G.state === 'title' || G.state === 'over') { startGame(); return; }
      if (G.state === 'play') { var p = toLogical(e.clientX, e.clientY); G.target.x = p.x; G.target.y = p.y; }
    });
    canvas.addEventListener('pointerup', function (e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2 && G.state === 'play' && G.timeScale < 0.85) G.slow.active = false;
      if (e.button === 2) G.slow.active = false;
    }, { passive: true });
    canvas.addEventListener('pointercancel', function (e) {
      delete pointers[e.pointerId];
      G.slow.active = false;
    }, { passive: true });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    global.addEventListener('blur', function () { if (G.state === 'play') G.paused = true; G.slow.active = false; });
    global.addEventListener('keydown', function (e) {
      if (e.code === 'Space') {
        e.preventDefault();
        if (G.state === 'play') G.slow.active = true;
        else if (G.state === 'title' || G.state === 'over') startGame();
      }
      if (e.code === 'KeyP' && G.state === 'play') G.paused = !G.paused;
      if (e.code === 'KeyM') { SC.Audio.setMuted(!SC.Audio.muted); }
      if (e.code === 'KeyR' && G.state !== 'title') startGame();
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = true;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = true;
    });
    global.addEventListener('keyup', function (e) {
      if (e.code === 'Space') G.slow.active = false;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = false;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = false;
    });
  }

  /* ---------------- shots (deterministic screenshots for QA) ---------------- */
  function buildShot(name) {
    var base = makeState();
    base.state = 'play';
    base.best = 5120;
    base.score = 1240;
    base.shownScore = 1240;
    base.wave = 3;
    base.lives = 2;
    base.combo = 5;
    base.comboTimer = 1.8;
    base.slow.energy = 0.62;
    base.ship.x = 900; base.ship.y = 760;
    base.target.x = 900; base.target.y = 760;
    var rocks = [
      [430, 380, 50], [820, 250, 34], [1180, 400, 44], [1440, 640, 54], [1330, 300, 36], [650, 640, 42]
    ];
    rocks.forEach(function (r, i) { base.rocks.push({ x: r[0], y: r[1], vx: 10, vy: 200, r: r[2], rot: i * 0.7, vr: 0.4, seed: 30 + i * 7, dead: false }); });
    base.stars.push({ x: 1040, y: 420, phase: 0.4, seed: 1 }, { x: 700, y: 640, phase: 1.7, seed: 2 }, { x: 1320, y: 740, phase: 2.9, seed: 3 });
    base.trailPts = [{ x: 1120, y: 600 }, { x: 1210, y: 660 }, { x: 1300, y: 590 }];
    base.chart = [[{ x: 300, y: 760 }, { x: 420, y: 820 }, { x: 560, y: 770 }, { x: 520, y: 900 }]];
    var prng = SC.rngFrom(77);
    for (var i = 0; i < 22; i++) {
      var pa = prng() * SC.TAU, pd = 30 + prng() * 130;
      base.parts.push({ x: 900 + Math.cos(pa) * pd, y: 760 + Math.sin(pa) * pd, vx: Math.cos(pa) * 1.5, vy: Math.sin(pa) * 1.5, life: 0.5 + prng() * 0.35, max: 0.85, size: 5 + prng() * 9, color: i % 3 ? C.accent : C.ink, shape: 'dot', rot: pa, vr: 0.6 });
    }
    base.banner = { text: '第 3 波', sub: '墨陨更密了', life: 1.4, max: 1.9 };
    if (name === 'hit') {
      base.shake = 10; base.pops.push({ x: 900, y: 640, text: 'CRASH!', life: 0.7, max: 0.95, size: 64, color: C.accent });
      base.combo = 0; base.ship.invuln = 0;
    }
    if (name === 'clear') {
      base.score = 2480; base.shownScore = 2480;
      base.pops.push({ x: W / 2, y: 470, text: '星座完成', life: 0.6, max: 0.95, size: 92, color: C.accent });
      base.banner = null;
      base.parts.push({ ring: true, x: W / 2, y: H / 2, r0: 60, life: 0.8, max: 0.9, color: C.accent2 });
      base.parts.push({ ring: true, x: W / 2, y: H / 2, r0: 180, life: 0.8, max: 0.9, color: C.accent2 });
    }
    if (name === 'title') { base.state = 'title'; }
    if (name === 'pause') { base.paused = true; }
    if (name === 'slow') { base.timeScale = 0.35; base.slow.active = true; base.slow.energy = 0.55; base.banner = null; }
    if (name === 'over') { base.state = 'over'; base.score = 3820; base.shownScore = 3820; base.best = 5120; }
    G = base;
  }

  /* ---------------- boot ---------------- */
  function boot() {
    canvas = document.getElementById('stage');
    ctx = canvas.getContext('2d');
    resize();
    bindInput();
    global.addEventListener('resize', resize);

    if (SHOT) {
      buildShot(SHOT);
      G.t = 1.6;
      resize();
      render();
      /* let fonts settle, then re-render once */
      setTimeout(function () { render(); }, 120);
      global.__SC = { G: function () { return G; }, render: render, buildShot: buildShot, startGame: startGame };
      return;
    }
    raf = requestAnimationFrame(frame);
    global.__SC = { G: function () { return G; }, render: render, startGame: startGame, step: step, setState: function (s) { G.state = s; }, damage: function () { G.ship.invuln = 0; hitShip(); } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
