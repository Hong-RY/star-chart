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
      lives: 3, wave: 1,
      combo: 0, comboTimer: 0,
      slow: { energy: 1, active: false, lock: 0 },
      ship: { x: W / 2, y: H * 0.74, vx: 0, vy: 0, tilt: 0, invuln: 0 },
      target: { x: W / 2, y: H * 0.74 },
      stars: [], rocks: [], parts: [], pops: [],
      constIdx: 0, next: 0, done: [], card: null, cardT: 0,
      shields: 0, damageThis: false,
      pickups: [], effects: { magnet: 0, freeze: 0, phase: 0 },
      tide: null, boss: null, gallery: false,
      mode: 'story', loop: 0,
      unlocked: (function () { try { var raw = localStorage.getItem('starchart.unlocked'); var arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch (e) { return []; } })(),
      shake: 0, hitstop: 0, flash: 0, banner: null, overT: 0, paused: false,
      spawnT: 0.6, comboPop: 0
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
  function popup(x, y, text, size, color, burst) {
    G.pops.push({ x: x, y: y, text: text, life: 0.95, max: 0.95, size: size || 44, color: color || C.ink, burst: !!burst });
  }
  function banner(text, sub) {
    G.banner = { text: text, sub: sub || '', life: 1.9, max: 1.9 };
  }
  function rockShape(r, seed) { return SC.roughPoly(null, 0, 0, r, 11 + (seed % 4), seed, 0.2); }

  function spawnRock(x, y, r, seed) {
    var diff = Math.min(G.wave, 14);
    var speed = 200 + diff * 26 + Math.random() * 90;
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

  /* ---------------- 黄道十二宫：星点按真实星座形状排布，按连线顺序收集 ---------------- */
  var CONSTELLATIONS = [
    { id: 'aries', name: '白羊座', latin: 'ARIES', dates: '3.21 – 4.19', myth: '金羊毛的化身', stars: [[0.18, 0.62], [0.38, 0.50], [0.58, 0.46], [0.82, 0.34]], extra: [] },
    { id: 'taurus', name: '金牛座', latin: 'TAURUS', dates: '4.20 – 5.20', myth: '宙斯化身的白牛', stars: [[0.12, 0.22], [0.34, 0.40], [0.50, 0.58], [0.66, 0.40], [0.88, 0.22], [0.50, 0.74]], extra: [[2, 5]] },
    { id: 'gemini', name: '双子座', latin: 'GEMINI', dates: '5.21 – 6.21', myth: '永不分离的双生子', stars: [[0.28, 0.14], [0.30, 0.42], [0.26, 0.78], [0.42, 0.58], [0.62, 0.18], [0.66, 0.46], [0.70, 0.80]], extra: [[3, 6]] },
    { id: 'cancer', name: '巨蟹座', latin: 'CANCER', dates: '6.22 – 7.22', myth: '赫拉派出的巨蟹', stars: [[0.22, 0.58], [0.42, 0.44], [0.62, 0.56], [0.80, 0.34]], extra: [[0, 2]] },
    { id: 'leo', name: '狮子座', latin: 'LEO', dates: '7.23 – 8.22', myth: '尼米亚的猛狮', stars: [[0.16, 0.72], [0.24, 0.48], [0.34, 0.28], [0.50, 0.24], [0.60, 0.36], [0.56, 0.54], [0.72, 0.64], [0.86, 0.50]], extra: [[4, 7], [5, 7]] },
    { id: 'virgo', name: '处女座', latin: 'VIRGO', dates: '8.23 – 9.22', myth: '正义女神与麦穗', stars: [[0.18, 0.24], [0.38, 0.38], [0.54, 0.54], [0.66, 0.72], [0.56, 0.86], [0.80, 0.60], [0.88, 0.42]], extra: [[2, 5]] },
    { id: 'libra', name: '天秤座', latin: 'LIBRA', dates: '9.23 – 10.23', myth: '正义女神的秤', stars: [[0.26, 0.36], [0.52, 0.28], [0.74, 0.42], [0.58, 0.64], [0.32, 0.60]], extra: [] },
    { id: 'scorpio', name: '天蝎座', latin: 'SCORPIO', dates: '10.24 – 11.22', myth: '猎户俄里翁的宿敌', stars: [[0.18, 0.20], [0.28, 0.36], [0.40, 0.48], [0.52, 0.60], [0.64, 0.72], [0.78, 0.80], [0.86, 0.68], [0.80, 0.56]], extra: [[3, 7]] },
    { id: 'sagittarius', name: '射手座', latin: 'SAGITTARIUS', dates: '11.23 – 12.21', myth: '贤者半人马喀戎', stars: [[0.26, 0.56], [0.42, 0.44], [0.58, 0.50], [0.60, 0.70], [0.44, 0.76], [0.30, 0.72], [0.52, 0.30], [0.70, 0.36]], extra: [[1, 7], [2, 7]] },
    { id: 'capricorn', name: '摩羯座', latin: 'CAPRICORN', dates: '12.22 – 1.19', myth: '潘神的鱼尾', stars: [[0.22, 0.46], [0.40, 0.62], [0.58, 0.54], [0.74, 0.66], [0.60, 0.80], [0.42, 0.74]], extra: [[0, 5]] },
    { id: 'aquarius', name: '水瓶座', latin: 'AQUARIUS', dates: '1.20 – 2.18', myth: '倾倒青春之水', stars: [[0.18, 0.42], [0.34, 0.56], [0.46, 0.42], [0.58, 0.56], [0.70, 0.40], [0.82, 0.52]], extra: [[0, 3]] },
    { id: 'pisces', name: '双鱼座', latin: 'PISCES', dates: '2.19 – 3.20', myth: '爱与美的两条鱼', stars: [[0.14, 0.28], [0.26, 0.44], [0.34, 0.66], [0.24, 0.82], [0.46, 0.56], [0.64, 0.44], [0.78, 0.56], [0.80, 0.72], [0.68, 0.86]], extra: [[4, 6]] }
  ];

  function projectConstellation(c) {
    var bx0 = 340, bx1 = 1580, by0 = 270, by1 = 880;
    var minx = 1, maxx = 0, miny = 1, maxy = 0, i;
    for (i = 0; i < c.stars.length; i++) {
      minx = Math.min(minx, c.stars[i][0]); maxx = Math.max(maxx, c.stars[i][0]);
      miny = Math.min(miny, c.stars[i][1]); maxy = Math.max(maxy, c.stars[i][1]);
    }
    var spanX = Math.max(0.001, maxx - minx), spanY = Math.max(0.001, maxy - miny);
    var scale = Math.min((bx1 - bx0) / spanX, (by1 - by0) / spanY);
    var ox = bx0 + ((bx1 - bx0) - spanX * scale) / 2;
    var oy = by0 + ((by1 - by0) - spanY * scale) / 2;
    var out = [];
    for (i = 0; i < c.stars.length; i++) {
      out.push({
        x: ox + (c.stars[i][0] - minx) * scale,
        y: oy + (c.stars[i][1] - miny) * scale,
        order: i, lit: false, phase: Math.random() * SC.TAU
      });
    }
    return out;
  }

  function startConstellation(idx) {
    var c = CONSTELLATIONS[idx];
    G.constIdx = idx;
    G.wave = idx + 1 + G.loop * 12;
    G.next = 0;
    G.stars = projectConstellation(c);
    G.damageThis = false;
    banner('第 ' + (idx + 1) + ' 章', c.name + ' · ' + c.dates);
    SC.Audio.wave();
    if (idx === 3 || idx === 7) startTide();
    if (idx === 5 || idx === 11) startBoss();
  }

  function saveUnlocked(id) {
    if (G.unlocked.indexOf(id) === -1) G.unlocked.push(id);
    try { localStorage.setItem('starchart.unlocked', JSON.stringify(G.unlocked)); } catch (e) {}
  }

  var PICKUP_TYPES = ['magnet', 'freeze', 'phase'];
  function spawnPickup() {
    G.pickups.push({ x: rand(300, W - 300), y: rand(300, 820), phase: Math.random() * SC.TAU, type: PICKUP_TYPES[G.pickups.length % 3] });
  }
  function collectPickup(i) {
    var p = G.pickups[i];
    G.pickups.splice(i, 1);
    if (p.type === 'magnet') { G.effects.magnet = 8; popup(p.x, p.y - 30, '磁吸 8s', 34, C.accent2); }
    if (p.type === 'freeze') { G.effects.freeze = 3; popup(p.x, p.y - 30, '时停 3s', 34, C.accent2); }
    if (p.type === 'phase') { G.effects.phase = 5; popup(p.x, p.y - 30, '穿透 5s', 34, C.accent2); }
    burst(p.x, p.y, 16, [C.accent2, C.ink, C.surface], 320, 0.6);
    SC.Audio.combo(8);
  }

  function startTide() {
    G.tide = { t: 0, dur: 5.2, spawnT: 0, safe: { x: rand(W * 0.3, W * 0.7), y: rand(420, 700), r: 180 } };
    banner('墨潮', '躲进安全圈');
    SC.Audio.wave();
  }
  function startBoss() {
    G.boss = { t: 0, dur: 18, hp: 3, maxHp: 3, weak: [], flash: 0 };
    for (var i = 0; i < 3; i++) G.boss.weak.push({ taken: false, at: (i * 0.3 + 0.25) });
    banner('墨龙', '靠近赤色弱点');
    SC.Audio.wave();
  }

  /* ---------------- game actions ---------------- */
  function startGame(mode) {
    var best = G.best, unlocked = G.unlocked;
    G = makeState();
    G.state = 'play';
    G.best = best;
    G.unlocked = unlocked;
    G.mode = mode || 'story';
    startConstellation(0);
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
    G.damageThis = true;
    G.combo = 0; G.comboTimer = 0;
    if (G.shields > 0) {
      G.shields--;
      G.ship.invuln = 1.1;
      G.shake = 10;
      G.hitstop = 0.05;
      burst(G.ship.x, G.ship.y, 20, [C.accent2, C.ink, C.surface], 460, 0.7);
      popup(G.ship.x, G.ship.y - 64, '护盾碎', 52, C.accent2);
      SC.Audio.hit();
      return;
    }
    G.lives--;
    G.ship.invuln = 1.7;
    G.shake = 13;
    G.hitstop = 0.075;
    G.combo = 0; G.comboTimer = 0;
    burst(G.ship.x, G.ship.y, 26, [C.ink, C.accent, C.accent2], 520, 0.75);
    popup(G.ship.x, G.ship.y - 70, 'CRASH!', 64, C.surface, true);
    SC.Audio.hit();
    if (G.lives <= 0) gameOver();
  }
  function collectStar() {
    var s = G.stars[G.next];
    if (!s) return;
    s.lit = true;
    G.combo++; G.comboTimer = 2.2; G.comboPop = 1;
    var gain = 12 * mult();
    G.score += gain;
    burst(s.x, s.y, 10, [C.accent, C.ink, C.surface], 260, 0.5);
    popup(s.x, s.y - 34, '+' + gain, 40, C.ink);
    SC.Audio.collect(G.combo);
    if (G.combo > 0 && G.combo % 3 === 0) SC.Audio.combo(G.combo);
    G.next++;
    if (G.next >= G.stars.length) completeConstellation();
  }
  function completeConstellation() {
    var c = CONSTELLATIONS[G.constIdx];
    var perfect = !G.damageThis;
    G.done.push(G.constIdx);
    G.score += 120 + (perfect ? 120 : 0);
    if (perfect) G.shields = Math.min(2, G.shields + 1);
    G.card = { idx: G.constIdx, t: 0, perfect: perfect };
    saveUnlocked(c.id);
    spawnPickup();
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

    /* constellation card: freeze the field, show the finished figure */
    if (G.card) {
      G.cardT += dt;
      if (G.cardT > 3.2) {
        G.card = null; G.cardT = 0;
        if (G.constIdx + 1 >= CONSTELLATIONS.length && G.mode === 'endless') {
          G.loop++;
          G.done = [];
          startConstellation(0);
        } else if (G.constIdx + 1 >= CONSTELLATIONS.length) {
          G.state = 'complete';
          if (G.score > G.best) { G.best = G.score; try { localStorage.setItem('starchart.best', String(G.best)); } catch (e) {} }
          SC.Audio.clear();
        } else {
          startConstellation(G.constIdx + 1);
        }
      }
      return;
    }

    /* slow motion */
    var wantSlow = G.slow.active && G.slow.energy > 0 && G.slow.lock <= 0;
    G.targetScale = wantSlow ? 0.35 : 1;
    G.timeScale += (G.targetScale - G.timeScale) * Math.min(1, dt * 9);
    if (wantSlow) G.slow.energy = Math.max(0, G.slow.energy - dt / 3.0);
    else G.slow.energy = Math.min(1, G.slow.energy + dt / 2.6);
    if (G.slow.energy <= 0) G.slow.lock = 0.4;
    G.slow.lock = Math.max(0, G.slow.lock - dt);

    var sdt = dt * G.timeScale;
    var s = G.ship;

    /* temporary power-ups decay */
    for (var ek in G.effects) if (G.effects[ek] > 0) G.effects[ek] = Math.max(0, G.effects[ek] - dt);
    var frozen = G.effects.freeze > 0;

    /* pickups */
    for (var pi = G.pickups.length - 1; pi >= 0; pi--) {
      var pk = G.pickups[pi];
      pk.phase += dt * 3;
      if (SC.dist2(s.x, s.y, pk.x, pk.y) < Math.pow(44, 2)) collectPickup(pi);
    }

    /* magnet pulls the next star toward the comet */
    if (G.effects.magnet > 0) {
      var mag = G.stars[G.next];
      if (mag) {
        mag.x += (s.x - mag.x) * Math.min(1, dt * 1.8);
        mag.y += (s.y - mag.y) * Math.min(1, dt * 1.8);
      }
    }

    /* ink tide: dense rain, a safe circle dissolves meteors */
    if (G.tide) {
      G.tide.t += dt;
      G.tide.spawnT -= dt;
      if (G.tide.spawnT <= 0) {
        for (var tr = 0; tr < 3; tr++) spawnRock(null, -60 - Math.random() * 120, rand(18, 34));
        G.tide.spawnT = 0.12;
      }
      if (G.tide.t >= G.tide.dur) {
        G.score += 150;
        popup(W / 2, H * 0.42, '墨潮退去 +150', 56, C.accent);
        G.tide = null;
      }
    }

    /* boss: the ink dragon sweeps across the page */
    if (G.boss) {
      G.boss.t += dt;
      if (G.boss.flash > 0) G.boss.flash -= dt;
      var bt = G.boss.t / G.boss.dur;
      if (bt >= 1) { G.boss = null; }
      else {
        var headX = -320 + (W + 640) * bt;
        var headY = 330 + Math.sin(G.boss.t * 1.5) * 130;
        /* weak points ride on the body */
        for (var wi = 0; wi < G.boss.weak.length; wi++) {
          var wk = G.boss.weak[wi];
          if (wk.taken) continue;
          var wx = headX - 90 - wi * 95;
          var wy = 330 + Math.sin((G.boss.t - (wi + 1) * 0.22) * 1.5) * 130;
          if (SC.dist2(s.x, s.y, wx, wy) < Math.pow(46, 2)) {
            wk.taken = true; G.boss.hp--;
            G.score += 60;
            burst(wx, wy, 18, [C.accent, C.ink, C.surface], 420, 0.6);
            popup(wx, wy - 40, '弱点 +60', 30, C.accent);
            SC.Audio.combo(10);
            if (G.boss.hp <= 0) {
              G.shields = Math.min(2, G.shields + 1);
              G.score += 200;
              popup(W / 2, H * 0.36, '墨龙退散', 88, C.surface, true);
              burst(W / 2, 380, 30, [C.ink, C.accent], 520, 0.8);
              SC.Audio.clear();
              G.boss = null;
            }
          }
        }
        /* body contact hurts */
        if (G.boss && s.invuln <= 0 && G.effects.phase <= 0) {
          for (var bi = 0; bi < 7; bi++) {
            var bx = headX - 60 - bi * 64;
            var by = 330 + Math.sin((G.boss.t - (bi + 1) * 0.18) * 1.5) * 130;
            if (SC.dist2(s.x, s.y, bx, by) < Math.pow(46, 2)) { hitShip(); break; }
          }
        }
      }
    }

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
    if (G.comboPop > 0) G.comboPop = Math.max(0, G.comboPop - dt * 4);

    /* combo decay */
    if (G.combo > 0) { G.comboTimer -= dt; if (G.comboTimer <= 0) G.combo = 0; }

    /* spawning */
    G.spawnT -= sdt;
    if (G.spawnT <= 0) {
      var interval = Math.max(0.45, 1.15 - Math.min(G.wave, 10) * 0.07);
      spawnRock(null, null, null, null);
      if (Math.random() < 0.25 && G.wave >= 3) spawnRock(null, -140, rand(58, 82));
      G.spawnT = interval * (0.75 + Math.random() * 0.5);
    }

    /* rocks */
    for (var i = G.rocks.length - 1; i >= 0; i--) {
      var r = G.rocks[i];
      if (!frozen) { r.x += r.vx * sdt; r.y += r.vy * sdt; r.rot += r.vr * sdt; }
      if (G.tide && SC.dist2(r.x, r.y, G.tide.safe.x, G.tide.safe.y) < Math.pow(G.tide.safe.r, 2)) {
        burst(r.x, r.y, 8, [C.ink, C.accent2], 260, 0.5);
        G.rocks.splice(i, 1);
        continue;
      }
      if (r.y > H + 120) { G.rocks.splice(i, 1); continue; }
      var rr = r.r * 0.78;
      if (s.invuln <= 0 && G.effects.phase <= 0 && SC.dist2(s.x, s.y, r.x, r.y) < Math.pow(rr + 20, 2)) {
        G.rocks.splice(i, 1);
        hitShip();
        burst(r.x, r.y, 14, [C.ink, C.accent], 380, 0.6);
      }
    }

    /* constellation stars: only the next one in the drawing order is collectable */
    for (var j = 0; j < G.stars.length; j++) G.stars[j].phase += sdt * 3.4;
    var act = G.stars[G.next];
    if (act && SC.dist2(s.x, s.y, act.x, act.y) < Math.pow(50, 2)) collectStar();

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
    g.strokeStyle = 'rgba(20,19,16,0.18)';
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
    var c = CONSTELLATIONS[G.constIdx];
    var st = G.stars;
    if (!st.length) return;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';

    /* drawn segments */
    g.strokeStyle = C.accent2;
    g.lineWidth = 5;
    for (var i = 0; i < G.next - 1; i++) {
      g.beginPath();
      g.moveTo(st[i].x, st[i].y);
      g.lineTo(st[i + 1].x, st[i + 1].y);
      g.stroke();
    }
    /* extra edges of the figure appear once the constellation is closed */
    if (G.card) {
      for (var e = 0; e < c.extra.length; e++) {
        var a = st[c.extra[e][0]], b = st[c.extra[e][1]];
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    }
    /* dotted guide to the next star in the drawing order */
    if (G.next < st.length) {
      var nxt = st[G.next], prev = G.next > 0 ? st[G.next - 1] : null;
      g.save();
      g.setLineDash([10, 12]);
      g.strokeStyle = 'rgba(29,78,137,0.5)';
      g.lineWidth = 3;
      if (prev) { g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(nxt.x, nxt.y); g.stroke(); }
      g.setLineDash([]);
      g.strokeStyle = 'rgba(216,64,46,0.55)';
      g.lineWidth = 3;
      g.beginPath(); g.arc(nxt.x, nxt.y, 42, 0, SC.TAU); g.stroke();
      g.restore();
    }
    g.restore();
  }

  function drawStars(g) {
    for (var i = 0; i < G.stars.length; i++) {
      var st = G.stars[i];
      if (st.order < G.next) {
        /* lit node of the figure */
        g.save();
        g.beginPath(); g.arc(st.x, st.y, 10, 0, SC.TAU);
        g.fillStyle = C.accent2; g.fill();
        g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
        g.beginPath(); g.arc(st.x, st.y, 3.4, 0, SC.TAU);
        g.fillStyle = C.surface; g.fill();
        g.restore();
      } else if (st.order === G.next) {
        /* the next star to touch */
        var pulse = 1 + Math.sin(st.phase) * 0.12;
        var r = 26 * pulse;
        g.save();
        g.beginPath(); g.arc(st.x + Math.cos(st.phase * 0.7) * r * 1.7, st.y + Math.sin(st.phase * 0.7) * r * 1.7, 4.5, 0, SC.TAU);
        g.fillStyle = C.accent2; g.fill();
        g.restore();
        SC.star4(g, st.x, st.y, r, st.phase * 0.1, C.accent, 4);
        g.beginPath(); g.arc(st.x, st.y, r * 0.2, 0, SC.TAU);
        g.fillStyle = C.surface; g.fill();
        SC.comicText(g, (st.order + 1) + '/' + G.stars.length, st.x, st.y - 44, { size: 20, color: C.ink, align: 'center', lineWidth: 0, ghost: false });
      } else {
        /* not yet reachable: a faint ink dot keeps the shape readable */
        g.save();
        g.globalAlpha = 0.5;
        g.beginPath(); g.arc(st.x, st.y, 7, 0, SC.TAU);
        g.fillStyle = C.sub; g.fill();
        g.globalAlpha = 0.7;
        g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
        g.restore();
      }
    }
  }

  function drawPickups(g) {
    for (var i = 0; i < G.pickups.length; i++) {
      var p = G.pickups[i];
      var bob = Math.sin(p.phase) * 6;
      g.save();
      g.translate(p.x, p.y + bob);
      g.beginPath(); g.arc(0, 0, 30, 0, SC.TAU);
      g.fillStyle = C.surface; g.fill();
      g.lineWidth = 4; g.strokeStyle = C.ink; g.stroke();
      g.beginPath(); g.arc(0, 0, 36, 0, SC.TAU);
      g.setLineDash([4, 8]); g.lineWidth = 2; g.strokeStyle = C.accent2; g.stroke(); g.setLineDash([]);
      g.strokeStyle = C.accent2; g.fillStyle = C.accent2; g.lineWidth = 4; g.lineCap = 'round';
      if (p.type === 'magnet') {
        g.beginPath(); g.arc(0, 2, 11, Math.PI, 0); g.stroke();
        g.beginPath(); g.moveTo(-11, 2); g.lineTo(-11, 13); g.moveTo(11, 2); g.lineTo(11, 13); g.stroke();
      } else if (p.type === 'freeze') {
        for (var k = 0; k < 3; k++) {
          g.save(); g.rotate(k * Math.PI / 3);
          g.beginPath(); g.moveTo(0, -13); g.lineTo(0, 13); g.stroke();
          g.restore();
        }
      } else {
        g.setLineDash([6, 5]);
        g.beginPath(); g.arc(0, 0, 12, 0, SC.TAU); g.stroke();
        g.setLineDash([]);
        g.beginPath(); g.moveTo(-6, 6); g.lineTo(6, -6); g.moveTo(6, -6); g.lineTo(1, -6); g.moveTo(6, -6); g.lineTo(6, -1); g.stroke();
      }
      g.restore();
    }
  }

  function drawTide(g) {
    if (!G.tide) return;
    var s = G.tide.safe;
    var pulse = 0.55 + Math.sin(G.t * 6) * 0.15;
    g.save();
    g.setLineDash([16, 12]);
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(29,78,137,' + pulse.toFixed(2) + ')';
    g.beginPath(); g.arc(s.x, s.y, s.r, 0, SC.TAU); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 0.08;
    g.fillStyle = C.accent2;
    g.beginPath(); g.arc(s.x, s.y, s.r, 0, SC.TAU); g.fill();
    g.globalAlpha = 1;
    g.restore();
    SC.comicText(g, '安全圈', s.x, s.y - s.r - 16, { size: 22, color: C.accent2, align: 'center', outline: false, ghost: false });
  }

  function bossPos(i, t) {
    var headX = -320 + (W + 640) * (t / G.boss.dur);
    var x = headX - i * (i === 0 ? 40 : 62);
    var y = 330 + Math.sin((t - i * 0.18) * 1.5) * 130;
    return { x: x, y: y };
  }

  function drawBoss(g) {
    if (!G.boss) return;
    var t = G.boss.t;
    /* body from tail to head so the head sits on top */
    for (var i = 7; i >= 0; i--) {
      var p = bossPos(i, t);
      var r = i === 0 ? 52 : 40 - i * 2.6;
      g.save();
      g.translate(p.x, p.y);
      g.beginPath(); g.arc(0, 0, r, 0, SC.TAU);
      g.fillStyle = G.boss.flash > 0 ? C.surface : C.ink;
      g.fill();
      g.save();
      g.beginPath(); g.arc(0, 0, r, 0, SC.TAU); g.clip();
      g.globalAlpha = 0.35;
      g.fillStyle = SC.halftone(g, C.bg, 0.5, 8);
      g.beginPath(); g.arc(-r * 0.3, -r * 0.3, r * 0.75, 0, SC.TAU); g.fill();
      g.restore();
      g.lineWidth = 4; g.strokeStyle = C.ink; g.stroke();
      g.restore();
    }
    /* head details */
    var h = bossPos(0, t);
    g.save();
    g.translate(h.x, h.y);
    g.beginPath(); g.arc(12, -10, 8, 0, SC.TAU); g.fillStyle = C.accent; g.fill();
    g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    g.strokeStyle = C.ink; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(20, -34); g.lineTo(44, -58); g.stroke();
    g.beginPath(); g.moveTo(4, -44); g.lineTo(10, -70); g.stroke();
    g.restore();
    /* weak points */
    for (var wi = 0; wi < G.boss.weak.length; wi++) {
      var wk = G.boss.weak[wi];
      if (wk.taken) continue;
      var wp = bossPos(2 + wi * 2, t);
      SC.star4(g, wp.x, wp.y, 20 + Math.sin(G.t * 6 + wi) * 3, G.t * 0.4, C.accent, 4);
    }
    /* hp pips */
    SC.comicText(g, '墨 龙', W / 2, 208, { size: 22, color: C.accent, align: 'center', lineWidth: 0, ghost: false });
    var hx = W / 2 - 40, hy = 240;
    for (var hp = 0; hp < G.boss.maxHp; hp++) {
      g.save();
      g.translate(hx + hp * 32, hy);
      g.beginPath(); g.moveTo(0, -10); g.lineTo(10, 0); g.lineTo(0, 10); g.lineTo(-10, 0); g.closePath();
      if (hp < G.boss.hp) { g.fillStyle = C.accent; g.fill(); }
      g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke();
      g.restore();
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
      if (p.burst) {
        var br = p.size * 2.1;
        g.save();
        g.globalAlpha = Math.min(1, (1 - k) * 3) * 0.95;
        SC.printShape(g, SC.burstPts(0, 0, br, br * 0.72, 16, p.size), { fill: C.accent, lw: 6 });
        g.restore();
      }
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
    /* caption: current chapter and constellation */
    var cur = CONSTELLATIONS[G.constIdx];
    g.save();
    g.font = SC.font(32, 900);
    var capLabel = '第 ' + (G.constIdx + 1) + ' 章 · ' + cur.name + (G.loop > 0 ? ' · 无尽' + (G.loop + 1) : '');
    var capW = Math.max(320, g.measureText(capLabel).width + 56);
    g.restore();
    SC.panel(g, 64, 56, capW, 96, { sx: 8, sy: 8, lw: 5 });
    SC.comicText(g, capLabel, 88, 104, { size: 32, color: C.ink, lineWidth: 0, ghost: false });
    SC.comicText(g, cur.latin + ' · ' + cur.dates, 88, 136, { size: 18, color: C.sub, lineWidth: 0, ghost: false });

    /* twelve zodian slots */
    var dx0 = W / 2 - 143, dy = 100;
    for (var dz = 0; dz < 12; dz++) {
      var dx = dx0 + dz * 26;
      g.save();
      g.beginPath(); g.arc(dx, dy, 8, 0, SC.TAU);
      if (dz < G.done.length || (G.card && dz === G.done.length - 1 && G.done[dz] === G.constIdx)) {
        g.fillStyle = C.accent2; g.fill();
      } else if (dz === G.constIdx) {
        g.fillStyle = C.accent; g.fill();
      } else {
        g.fillStyle = C.surface; g.fill();
      }
      g.lineWidth = 2.5; g.strokeStyle = C.ink; g.stroke();
      g.restore();
    }
    SC.comicText(g, '黄道十二宫 ' + G.done.length + '/12', W / 2, dy + 36, { size: 16, color: C.sub, align: 'center', outline: false, ghost: false });

    /* score */
    SC.panel(g, W - 470, 56, 406, 136, { sx: 8, sy: 8, lw: 5 });
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
      SC.panel(g, cx, cy, 406, 64, { lw: 5, fill: C.accent, sx: 8, sy: 8 });
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
    /* shields earned by perfect constellations */
    for (var sh = 0; sh < 2; sh++) {
      var sx2 = 300 + sh * 46;
      g.save();
      g.translate(sx2, 978);
      g.beginPath();
      g.moveTo(0, -18); g.lineTo(15, -10); g.lineTo(15, 6); g.lineTo(0, 20); g.lineTo(-15, 6); g.lineTo(-15, -10);
      g.closePath();
      if (sh < G.shields) { g.fillStyle = C.accent2; g.fill(); }
      g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
      g.restore();
    }
    SC.comicText(g, '护盾', 288, 1022, { size: 18, color: C.sub, outline: false, ghost: false });

    /* active power-ups */
    var fx = 372;
    ['magnet', 'freeze', 'phase'].forEach(function (key) {
      var left = G.effects[key];
      if (left <= 0) return;
      g.save();
      g.translate(fx, 986);
      g.beginPath(); g.arc(0, 0, 22, 0, SC.TAU);
      g.fillStyle = C.accent2; g.fill();
      g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
      g.restore();
      SC.comicText(g, left.toFixed(0) + 's', fx, 1024, { size: 16, color: C.ink, align: 'center', outline: false, ghost: false });
      fx += 58;
    });

    /* slow meter */
    var mx = W / 2 - 240, my = 966, mw = 480, mh = 40;
    SC.panel(g, mx, my, mw, mh, { sx: 8, sy: 8, lw: 5 });
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
      SC.printShape(g, rockShape(26 + i * 8, 210 + i * 13), { fill: C.ink, lw: 4, shade: { color: C.bg, density: 0.45, dx: -5, dy: -6, alpha: 0.35 } });
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

    /* hero comet: the player, printed large over the chart path */
    g.save();
    g.strokeStyle = 'rgba(29,78,137,0.5)';
    g.lineWidth = 3;
    g.setLineDash([11, 13]);
    g.beginPath();
    g.moveTo(300, 930);
    g.bezierCurveTo(560, 720, 880, 560, 1290, 470);
    g.stroke();
    g.setLineDash([]);
    g.translate(985, 625);
    g.rotate(0.38);
    g.scale(2.25, 2.25);
    var hero = [[0, -46], [15, -6], [26, 20], [8, 13], [0, 26], [-8, 13], [-26, 20], [-15, -6]];
    SC.path(g, hero);
    g.fillStyle = C.bg; g.fill();
    g.lineWidth = 16; g.strokeStyle = C.bg; g.lineJoin = 'round'; g.stroke();
    SC.printShape(g, hero, { fill: '#FFFFFF', lw: 6, shade: { color: C.sub, density: 0.12, dx: 4, dy: 5 } });
    g.beginPath(); g.moveTo(0, -46); g.lineTo(9, -20); g.lineTo(-9, -20); g.closePath();
    g.fillStyle = C.accent2; g.fill(); g.lineWidth = 4; g.strokeStyle = C.ink; g.stroke();
    g.beginPath(); g.arc(0, -6, 5.5, 0, SC.TAU);
    g.fillStyle = C.accent2; g.fill(); g.lineWidth = 3; g.strokeStyle = C.ink; g.stroke();
    g.restore();

    /* hand-written label pointing at the comet */
    g.save();
    g.strokeStyle = C.sub; g.lineWidth = 2;
    g.beginPath(); g.moveTo(1110, 744); g.quadraticCurveTo(1060, 726, 1018, 700); g.stroke();
    g.restore();
    SC.comicText(g, '你在这里', 1118, 756, { size: 24, color: C.sub, outline: false, ghost: false });

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
    SC.comicText(g, '按顺序点亮星点 · 把黄道十二宫一页连完', 110, 636, { size: 21, color: C.accent2, outline: false, ghost: false });

    /* start button: printed panel, not a burst blob */
    var pulse = 1 + Math.sin(t * 3.2) * 0.02;
    g.save();
    g.translate(104 + 250, 700 + 52);
    g.scale(pulse, pulse);
    g.translate(-(104 + 250), -(700 + 52));
    SC.panel(g, 104, 700, 500, 104, { lw: 6, fill: C.accent });
    SC.comicText(g, '点击开始', 354, 772, { size: 56, color: C.surface, align: 'center', lineWidth: 2 });
    g.restore();
    SC.comicText(g, '鼠标 / 触屏移动　空格 缓速　M 静音　P 暂停　G 图鉴', 108, 866, { size: 22, color: C.sub, outline: false, ghost: false });

    /* best */
    if (G.best > 0) {
      SC.panel(g, W - 452, 872, 340, 100, { sx: 8, sy: 8, lw: 4 });
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
    SC.comicText(g, (G.mode === 'endless' ? '无尽第 ' + (G.loop + 1) + ' 轮 · ' : '') + '点亮 ' + G.done.length + ' / 12 个星座 · 止步在' + CONSTELLATIONS[G.constIdx].name, W / 2, py + 202, { size: 24, color: C.sub, align: 'center', outline: false, ghost: false });

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

  /* ---------------- constellation card / final gallery ---------------- */
  function figurePoints(c, x, y, w, h) {
    var minx = 1, maxx = 0, miny = 1, maxy = 0, i;
    for (i = 0; i < c.stars.length; i++) {
      minx = Math.min(minx, c.stars[i][0]); maxx = Math.max(maxx, c.stars[i][0]);
      miny = Math.min(miny, c.stars[i][1]); maxy = Math.max(maxy, c.stars[i][1]);
    }
    var spanX = Math.max(0.001, maxx - minx), spanY = Math.max(0.001, maxy - miny);
    var s = Math.min(w / spanX, h / spanY);
    var ox = x + (w - spanX * s) / 2, oy = y + (h - spanY * s) / 2;
    var out = [];
    for (i = 0; i < c.stars.length; i++) out.push({ x: ox + (c.stars[i][0] - minx) * s, y: oy + (c.stars[i][1] - miny) * s });
    return out;
  }

  function drawFigure(g, c, x, y, w, h, nodeR, withExtra) {
    var pts = figurePoints(c, x, y, w, h);
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = C.accent2; g.lineWidth = Math.max(2, nodeR * 0.36);
    g.beginPath();
    for (var i = 0; i < pts.length; i++) { i ? g.lineTo(pts[i].x, pts[i].y) : g.moveTo(pts[i].x, pts[i].y); }
    g.stroke();
    if (withExtra !== false) {
      for (var e = 0; e < c.extra.length; e++) {
        var a = pts[c.extra[e][0]], b = pts[c.extra[e][1]];
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    }
    for (var k = 0; k < pts.length; k++) {
      g.beginPath(); g.arc(pts[k].x, pts[k].y, nodeR, 0, SC.TAU);
      g.fillStyle = C.accent2; g.fill();
      g.lineWidth = Math.max(2, nodeR * 0.3); g.strokeStyle = C.ink; g.stroke();
    }
    g.restore();
  }

  function drawCard(g) {
    var c = CONSTELLATIONS[G.card.idx];
    var k = Math.min(1, G.cardT / 0.4);
    var ease = SC.expoOut(k);
    g.save();
    g.globalAlpha = 0.9 * ease;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.05 * ease;
    g.fillStyle = SC.halftone(g, C.ink, 0.3, 12);
    g.fillRect(0, 0, W, H);
    g.globalAlpha = ease;

    var pw = 900, ph = 540, px = (W - pw) / 2, py = (H - ph) / 2;
    var sc = 0.94 + 0.06 * ease;
    g.translate(W / 2, H / 2); g.scale(sc, sc); g.translate(-W / 2, -H / 2);
    SC.panel(g, px, py, pw, ph, { sx: 14, sy: 14, lw: 8 });

    SC.comicText(g, '第 ' + (G.card.idx + 1) + ' 章', px + 52, py + 66, { size: 24, color: C.sub, outline: false, ghost: false });

    /* the finished figure */
    var bx = px + 48, by = py + 96, bw = 380, bh = 336;
    drawFigure(g, c, bx, by, bw, bh, 7, true);

    /* name block */
    var tx = px + pw - 56;
    SC.comicText(g, c.name, tx, py + 152, { size: 66, color: C.ink, align: 'right', lineWidth: 0 });
    SC.comicText(g, c.latin, tx, py + 196, { size: 24, color: C.accent2, align: 'right', lineWidth: 0 });
    SC.comicText(g, c.dates, tx, py + 234, { size: 22, color: C.sub, align: 'right', outline: false, ghost: false });
    g.save();
    g.strokeStyle = 'rgba(20,19,16,0.3)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(px + 500, py + 262); g.lineTo(tx, py + 262); g.stroke();
    g.restore();
    SC.comicText(g, c.myth, tx, py + 306, { size: 26, color: C.ink, align: 'right', outline: false, ghost: false });
    SC.comicText(g, '+' + (120 + (G.card.perfect ? 120 : 0)), tx, py + 344, { size: 30, color: C.accent, align: 'right', lineWidth: 0, ghost: false });

    if (G.card.perfect) {
      SC.panel(g, px + 500, py + 372, 344, 58, { lw: 4, fill: C.accent2, sx: 6, sy: 6 });
      SC.comicText(g, '完美 · 护盾 +1', px + 672, py + 412, { size: 25, color: C.surface, align: 'center', lineWidth: 0, ghost: false });
    } else {
      SC.comicText(g, '护盾未获得', px + 672, py + 406, { size: 24, color: C.sub, align: 'center', outline: false, ghost: false });
    }

    /* auto-advance bar */
    var barW = pw - 112, barH = 8, barY = py + ph - 28;
    g.fillStyle = 'rgba(20,19,16,0.16)';
    g.fillRect(px + 56, barY, barW, barH);
    g.fillStyle = C.accent;
    g.fillRect(px + 56, barY, barW * SC.clamp(G.cardT / 3.2, 0, 1), barH);
    g.restore();
  }

  function drawGallery(g) {
    g.save();
    g.globalAlpha = 0.94; g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.08; g.fillStyle = SC.halftone(g, C.ink, 0.3, 12); g.fillRect(0, 0, W, H);
    g.restore();
    SC.comicText(g, '星座图鉴', W / 2, 128, { size: 60, color: C.ink, align: 'center', lineWidth: 0 });
    SC.comicText(g, '已点亮 ' + G.unlocked.length + ' / 12 · 点击任意处返回', W / 2, 172, { size: 22, color: C.sub, align: 'center', outline: false, ghost: false });
    var cols = 4, cellW = 322, cellH = 190, gapX = 22, gapY = 24;
    var gx0 = (W - (cols * cellW + (cols - 1) * gapX)) / 2, gy0 = 226;
    for (var i = 0; i < 12; i++) {
      var c = CONSTELLATIONS[i];
      var cx = gx0 + (i % cols) * (cellW + gapX);
      var cy = gy0 + Math.floor(i / cols) * (cellH + gapY);
      var open = G.unlocked.indexOf(c.id) !== -1;
      g.save();
      if (!open) g.globalAlpha = 0.35;
      SC.panel(g, cx, cy, cellW, cellH, { sx: 6, sy: 6, lw: 4 });
      drawFigure(g, c, cx + 24, cy + 18, cellW - 48, 108, 4, true);
      SC.comicText(g, open ? c.name : '未点亮', cx + cellW / 2, cy + 162, { size: 22, color: open ? C.ink : C.sub, align: 'center', lineWidth: 0, ghost: false });
      g.restore();
    }
    g.restore();
  }

  function drawComplete(g) {
    g.save();
    g.globalAlpha = 0.92;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.1;
    g.fillStyle = SC.halftone(g, C.ink, 0.3, 12);
    g.fillRect(0, 0, W, H);
    g.restore();

    SC.comicText(g, '十二星座集齐', W / 2, 150, { size: 68, color: C.ink, align: 'center', lineWidth: 0 });
    SC.comicText(g, '一整页星图，被你连完了', W / 2, 200, { size: 24, color: C.sub, align: 'center', outline: false, ghost: false });

    var cols = 4, rows = 3, cellW = 322, cellH = 158, gapX = 22, gapY = 18;
    var gridW = cols * cellW + (cols - 1) * gapX;
    var gx0 = (W - gridW) / 2, gy0 = 232;
    for (var i = 0; i < 12; i++) {
      var cx = gx0 + (i % cols) * (cellW + gapX);
      var cy = gy0 + Math.floor(i / cols) * (cellH + gapY);
      g.save();
      SC.panel(g, cx, cy, cellW, cellH, { sx: 6, sy: 6, lw: 4 });
      drawFigure(g, CONSTELLATIONS[i], cx + 24, cy + 16, cellW - 48, 96, 3.6, true);
      SC.comicText(g, CONSTELLATIONS[i].name, cx + cellW / 2, cy + 140, { size: 22, color: C.ink, align: 'center', lineWidth: 0, ghost: false });
      g.restore();
    }

    SC.comicText(g, '得分 ' + G.score, W / 2 - 210, 972, { size: 34, color: C.accent, align: 'center', lineWidth: 0 });
    SC.comicText(g, '最高 ' + G.best, W / 2 + 210, 972, { size: 34, color: C.ink, align: 'center', lineWidth: 0 });

    var pulse = 1 + Math.sin(G.t * 3.2) * 0.03;
    g.save();
    g.translate(W / 2, 822);
    g.scale(pulse, pulse);
    SC.panel(g, -272, -40, 240, 80, { lw: 6, fill: C.accent, sx: 8, sy: 8 });
    SC.comicText(g, '再连一遍', -152, 10, { size: 32, color: C.surface, align: 'center', lineWidth: 0, ghost: false });
    SC.panel(g, 32, -40, 240, 80, { lw: 6, fill: C.accent2, sx: 8, sy: 8 });
    SC.comicText(g, '无尽模式', 152, 10, { size: 32, color: C.surface, align: 'center', lineWidth: 0, ghost: false });
    g.restore();
    G.btns = [
      { x: W / 2 - 272, y: 782, w: 240, h: 80, action: 'restart' },
      { x: W / 2 + 32, y: 782, w: 240, h: 80, action: 'endless' }
    ];
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
    if (G.state === 'gallery') {
      drawFrame(ctx);
      drawGallery(ctx);
    } else if (G.state === 'complete') {
      drawFrame(ctx);
      drawComplete(ctx);
    } else if (G.state === 'title') {
      drawFrame(ctx);
      drawTitle(ctx);
    } else {
      drawChart(ctx);
      drawTide(ctx);
      drawStars(ctx);
      drawPickups(ctx);
      drawRocks(ctx);
      drawBoss(ctx);
      drawParts(ctx);
      drawShip(ctx);
      drawPops(ctx);
      drawFrame(ctx);
      if (G.state !== 'over') { drawHUD(ctx); drawBanner(ctx); }
      if (G.state === 'over') drawOver(ctx);
      if (G.card) drawCard(ctx);
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
      if (G.state === 'gallery') { G.state = 'title'; return; }
      if (G.state === 'complete') {
        var lp = toLogical(e.clientX, e.clientY);
        var hit = (G.btns || []).filter(function (b) { return lp.x >= b.x && lp.x <= b.x + b.w && lp.y >= b.y && lp.y <= b.y + b.h; })[0];
        if (hit && hit.action === 'endless') { startGame('endless'); return; }
        startGame('story'); return;
      }
      if (G.state === 'title' || G.state === 'over') { startGame('story'); return; }
      if (G.card) { G.cardT = 3.2; return; }
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
        else if (G.state === 'title' || G.state === 'over' || G.state === 'complete') startGame();
      }
      if (e.code === 'KeyP' && G.state === 'play') G.paused = !G.paused;
      if (e.code === 'KeyM') { SC.Audio.setMuted(!SC.Audio.muted); }
      if (e.code === 'KeyG' && (G.state === 'title' || G.state === 'gallery')) { G.state = G.state === 'gallery' ? 'title' : 'gallery'; }
      if (e.code === 'Escape' && G.state === 'gallery') G.state = 'title';
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
    base.lives = 3;
    base.shields = 1;
    base.score = 1240; base.shownScore = 1240;
    base.combo = 5; base.comboTimer = 1.8;
    base.slow.energy = 0.62;
    base.ship.x = 900; base.ship.y = 800;
    base.target.x = 900; base.target.y = 800;

    var rocks = [[430, 380, 50], [820, 250, 34], [1180, 400, 44], [1440, 640, 54], [1330, 300, 36], [650, 660, 42]];
    rocks.forEach(function (r, i) { base.rocks.push({ x: r[0], y: r[1], vx: 10, vy: 200, r: r[2], rot: i * 0.7, vr: 0.4, seed: 30 + i * 7, dead: false }); });

    var prng = SC.rngFrom(77);
    for (var i = 0; i < 22; i++) {
      var pa = prng() * SC.TAU, pd = 30 + prng() * 130;
      base.parts.push({ x: 900 + Math.cos(pa) * pd, y: 800 + Math.sin(pa) * pd, vx: Math.cos(pa) * 1.5, vy: Math.sin(pa) * 1.5, life: 0.5 + prng() * 0.35, max: 0.85, size: 5 + prng() * 9, color: i % 3 ? C.accent : C.ink, shape: 'dot', rot: pa, vr: 0.6 });
    }

    /* default scene: chapter 5, Leo, four stars already drawn */
    base.constIdx = 4; base.wave = 5;
    base.stars = projectConstellation(CONSTELLATIONS[4]);
    base.next = 4;
    for (var k = 0; k < base.next; k++) base.stars[k].lit = true;
    base.done = [0, 1, 2, 3];
    base.banner = { text: '第 5 章', sub: '狮子座 · 7.23 – 8.22', life: 1.4, max: 1.9 };

    if (name === 'hit') {
      base.shake = 10;
      base.pops.push({ x: 900, y: 660, text: 'CRASH!', life: 0.7, max: 0.95, size: 64, color: C.surface, burst: true });
      base.combo = 0; base.ship.invuln = 0;
    }
    if (name === 'card') {
      base.constIdx = 7; base.wave = 8;
      base.stars = projectConstellation(CONSTELLATIONS[7]);
      base.next = base.stars.length;
      base.stars.forEach(function (s) { s.lit = true; });
      base.done = [0, 1, 2, 3, 4, 5, 6];
      base.card = { idx: 7, t: 1.5, perfect: true };
      base.cardT = 1.5;
      base.banner = null;
      base.score = 2680; base.shownScore = 2680;
    }
    if (name === 'complete') {
      base.state = 'complete';
      base.done = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      base.score = 6840; base.shownScore = 6840;
      base.best = 5120;
    }
    if (name === 'boss') {
      base.boss = { t: 6.2, dur: 18, hp: 2, maxHp: 3, weak: [{ taken: true, at: 0.25 }, { taken: false, at: 0.55 }, { taken: false, at: 0.85 }], flash: 0 };
      base.banner = null;
      base.pickups.push({ x: 1180, y: 620, phase: 0.4, type: 'magnet' });
    }
    if (name === 'tide') {
      base.tide = { t: 1.4, dur: 5.2, spawnT: 0.1, safe: { x: 1020, y: 560, r: 180 } };
      base.banner = null;
      for (var ti = 0; ti < 10; ti++) base.rocks.push({ x: 200 + ti * 160, y: 120 + (ti % 3) * 140, vx: 0, vy: 380, r: 24, rot: ti, vr: 0.6, seed: 50 + ti, dead: false });
    }
    if (name === 'gallery') { base.state = 'gallery'; base.unlocked = ['aries', 'taurus', 'gemini', 'leo', 'scorpio', 'pisces']; }
    if (name === 'title') { base.state = 'title'; }
    if (name === 'pause') { base.paused = true; }
    if (name === 'slow') { base.timeScale = 0.35; base.slow.active = true; base.slow.energy = 0.55; base.banner = null; }
    if (name === 'over') {
      base.state = 'over';
      base.score = 3820; base.shownScore = 3820; base.best = 5120;
      base.done = [0, 1, 2];
      base.constIdx = 3;
      base.stars = projectConstellation(CONSTELLATIONS[3]);
      base.next = 2;
      base.stars[0].lit = true; base.stars[1].lit = true;
    }
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
