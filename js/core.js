/* STAR CHART — core: math, palette, print/ink drawing primitives */
(function (global) {
  'use strict';

  var SC = global.SC = {};

  /* ---------- math ---------- */
  SC.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  SC.lerp = function (a, b, t) { return a + (b - a) * t; };
  SC.lerpAngle = function (a, b, t) { var d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; return a + d * t; };
  SC.dist2 = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  SC.TAU = Math.PI * 2;

  SC.rngFrom = function (seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* spring 0..1 progress for UI pops */
  SC.spring = function (t, duration, bounce) {
    duration = duration || 0.5; bounce = bounce == null ? 0.15 : bounce;
    if (t <= 0) return 0;
    var w = SC.TAU / duration, z = 1 - bounce, x;
    if (Math.abs(z - 1) < 1e-4) x = Math.exp(-w * t) * (1 + (w) * t);
    else if (z < 1) { var wd = w * Math.sqrt(1 - z * z); x = Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t)); }
    else { var r = Math.sqrt(z * z - 1), a = -w * (z - r), b2 = -w * (z + r), A = (-b2) / (a - b2); x = A * Math.exp(a * t) + (1 - A) * Math.exp(b2 * t); }
    return 1 - x;
  };
  SC.expoOut = function (p) { return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p); };
  SC.cubicOut = function (p) { return 1 - Math.pow(1 - p, 3); };
  SC.easeOutBack = function (p, s) { s = s == null ? 1.7 : s; var q = p - 1; return 1 + (s + 1) * q * q * q + s * q * q; };

  /* ---------- palette (huashu 色板规范：6 键，禁用蓝紫大面积) ---------- */
  SC.C = {
    bg: '#F2ECDC',
    surface: '#FBF7EC',
    ink: '#141310',
    sub: '#6E6552',
    accent: '#D8402E',
    accent2: '#1D4E89',
    paperShade: '#E6DFC9'
  };

  /* ---------- cached canvases: halftone + paper grain ---------- */
  var HALF = {}, GRAIN = null;

  function halftonePattern(ctx, color, density, tile) {
    tile = tile || 12;
    var key = color + '|' + density + '|' + tile;
    if (HALF[key]) return HALF[key];
    var c = document.createElement('canvas');
    c.width = c.height = tile * 2;
    var g = c.getContext('2d');
    var r = (tile / 2) * Math.sqrt(SC.clamp(density, 0.04, 1)) * 1.12;
    g.fillStyle = color;
    [[tile * 0.5, tile * 0.5], [tile * 1.5, tile * 1.5]].forEach(function (p) {
      g.beginPath(); g.arc(p[0], p[1], r, 0, SC.TAU); g.fill();
    });
    var pat = ctx.createPattern(c, 'repeat');
    HALF[key] = pat;
    return pat;
  }
  SC.halftone = halftonePattern;

  SC.paperGrain = function (ctx) {
    if (GRAIN) return GRAIN;
    var n = 200, c = document.createElement('canvas');
    c.width = c.height = n;
    var g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data;
    var rnd = SC.rngFrom(20261101);
    for (var i = 0; i < d.length; i += 4) {
      var v = 0, r = rnd();
      if (r > 0.86) v = 255;
      d[i] = 120; d[i + 1] = 110; d[i + 2] = 90;
      d[i + 3] = v ? 14 : 0;
    }
    g.putImageData(img, 0, 0);
    GRAIN = ctx.createPattern(c, 'repeat');
    return GRAIN;
  };

  /* ---------- ink drawing ---------- */
  /* polygon with slightly rough, deterministic edge (hand-printed feel) */
  SC.roughPoly = function (ctx, cx, cy, radius, sides, seed, jitter) {
    var rnd = SC.rngFrom(seed), pts = [], i, a, r;
    jitter = jitter == null ? 0.12 : jitter;
    for (i = 0; i < sides; i++) {
      a = (i / sides) * SC.TAU + rnd() * 0.16;
      r = radius * (1 + (rnd() * 2 - 1) * jitter);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  };

  SC.path = function (ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  /* fill + halftone shading + ink outline, one call */
  SC.printShape = function (ctx, pts, opt) {
    opt = opt || {};
    var fill = opt.fill || SC.C.surface;
    var line = opt.line || SC.C.ink;
    var lw = opt.lw == null ? 5 : opt.lw;
    var shade = opt.shade || null;      /* {color, density, dx, dy} */
    var pat, i;
    /* base plate */
    ctx.save();
    SC.path(ctx, pts);
    ctx.fillStyle = fill;
    ctx.fill();
    /* halftone plate, offset: clipped to the shape */
    if (shade) {
      ctx.clip();
      ctx.save();
      ctx.globalAlpha = shade.alpha == null ? 1 : shade.alpha;
      pat = halftonePattern(ctx, shade.color || SC.C.ink, shade.density || 0.35, shade.tile || 12);
      ctx.translate(shade.dx || 6, shade.dy || 8);
      ctx.fillStyle = pat;
      ctx.fillRect(-2000, -2000, 6000, 6000);
      ctx.restore();
    }
    ctx.restore();
    /* ink key line */
    SC.path(ctx, pts);
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = line;
    ctx.stroke();
    return ctx;
  };

  /* comic impact burst */
  SC.burstPts = function (cx, cy, rOuter, rInner, spikes, seed) {
    var rnd = SC.rngFrom(seed || 7), pts = [], i, a, r;
    for (i = 0; i < spikes * 2; i++) {
      a = (i / (spikes * 2)) * SC.TAU + rnd() * 0.08;
      r = i % 2 === 0 ? rOuter * (0.9 + rnd() * 0.22) : rInner * (0.85 + rnd() * 0.3);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  };

  /* 4-point star / sparkle */
  SC.star4 = function (ctx, x, y, r, rot, color, lw) {
    var pts = [], i, a, rr;
    for (i = 0; i < 8; i++) {
      a = rot + (i / 8) * SC.TAU - Math.PI / 2;
      rr = i % 2 === 0 ? r : r * 0.34;
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    ctx.save();
    SC.path(ctx, pts);
    ctx.fillStyle = color || SC.C.accent;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw == null ? 4 : lw;
    ctx.strokeStyle = SC.C.ink;
    ctx.stroke();
    ctx.restore();
  };

  /* heavy comic type with ink outline + optional misregistration ghosts */
  SC.font = function (size, weight) {
    return (weight || 900) + ' ' + Math.round(size) + "px 'Arial Black','Microsoft YaHei','PingFang SC',sans-serif";
  };

  /* Chrome strokes CJK fallback glyphs badly (fills the whole glyph),
     so the ink outline is stamped by drawing the text on a ring of offsets. */
  SC.comicText = function (ctx, text, x, y, opt) {
    opt = opt || {};
    var size = opt.size || 72;
    var color = opt.color || SC.C.ink;
    var lw = opt.lineWidth == null ? size * 0.012 : opt.lineWidth;
    if (size <= 26) lw = 0;
    var align = opt.align || 'left';
    var base = opt.baseline || 'alphabetic';
    var i, a;
    ctx.save();
    ctx.font = SC.font(size, opt.weight);
    ctx.textAlign = align;
    ctx.textBaseline = base;
    if (opt.ghost !== false && size >= 26) {
      var gx = opt.ghostX == null ? Math.max(2, size * 0.012) : opt.ghostX;
      var gy = opt.ghostY == null ? Math.max(2, size * 0.012) : opt.ghostY;
      ctx.fillStyle = opt.ghostA || 'rgba(29,78,137,0.55)';
      ctx.fillText(text, x - gx, y + gy);
      ctx.fillStyle = opt.ghostB || 'rgba(216,64,46,0.42)';
      ctx.fillText(text, x + gx, y - gy);
    }
    if (opt.outline !== false && lw > 0) {
      ctx.fillStyle = opt.stroke || SC.C.ink;
      var n = size >= 120 ? 10 : 8;
      var r = lw * 0.5;
      for (i = 0; i < n; i++) {
        a = (i / n) * SC.TAU;
        ctx.fillText(text, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.86);
      }
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  };

  /* panel: cream card with ink border and offset halftone shadow */
  SC.panel = function (ctx, x, y, w, h, opt) {
    opt = opt || {};
    ctx.save();
    /* hard ink shadow, the way a printed card sits on the page */
    ctx.fillStyle = opt.shadow || SC.C.ink;
    ctx.fillRect(x + (opt.sx == null ? 8 : opt.sx), y + (opt.sy == null ? 8 : opt.sy), w, h);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fillStyle = opt.fill || SC.C.surface;
    ctx.fill();
    ctx.lineWidth = opt.lw == null ? 6 : opt.lw;
    ctx.strokeStyle = SC.C.ink;
    ctx.stroke();
    ctx.restore();
  };

  SC.roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  SC.W = 1920;
  SC.H = 1080;

})(window);
