/* STAR CHART — tiny WebAudio synth, zero samples */
(function (global) {
  'use strict';
  var AC = null, master = null, muted = false, enabled = true;

  function ensure() {
    if (AC) return AC;
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) { enabled = false; return null; }
    AC = new Ctx();
    master = AC.createGain();
    master.gain.value = 0.28;
    master.connect(AC.destination);
    return AC;
  }
  function resume() { ensure(); if (AC && AC.state === 'suspended') AC.resume(); }

  function env(node, t0, a, d, peak) {
    var g = node.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function tone(type, f0, f1, dur, peak, delay) {
    if (!enabled || muted) return;
    var ac = ensure(); if (!ac) return;
    var t0 = ac.currentTime + (delay || 0);
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    env(g, t0, 0.005, dur, peak);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(dur, peak, filterHz, delay) {
    if (!enabled || muted) return;
    var ac = ensure(); if (!ac) return;
    var t0 = ac.currentTime + (delay || 0);
    var len = Math.max(1, Math.floor(ac.sampleRate * dur));
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ac.createBufferSource(); src.buffer = buf;
    var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz || 1800;
    var g = ac.createGain(); env(g, t0, 0.004, dur, peak);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  var A = global.SC.Audio = {
    resume: resume,
    get muted() { return muted; },
    setMuted: function (m) { muted = !!m; },
    toggle: function () { muted = !muted; return muted; },
    collect: function (combo) {
      var step = Math.min(12, combo || 0);
      var f = 660 * Math.pow(2, step / 12);
      tone('triangle', f, f * 1.5, 0.09, 0.22);
      tone('sine', f * 2, f * 2.4, 0.06, 0.08, 0.01);
    },
    combo: function (n) { tone('square', 520, 780, 0.08, 0.1); tone('square', 780, 1170, 0.1, 0.08, 0.07); },
    hit: function () { noise(0.34, 0.5, 900); tone('sine', 130, 44, 0.32, 0.35); tone('square', 90, 40, 0.2, 0.12); },
    clear: function () {
      [523, 659, 784, 1046].forEach(function (f, i) { tone('triangle', f, f, 0.22, 0.16, i * 0.07); });
      noise(0.5, 0.18, 2600, 0.02);
    },
    slow: function (on) {
      if (on) { tone('sine', 420, 130, 0.35, 0.14); noise(0.3, 0.08, 700); }
      else { tone('sine', 150, 420, 0.25, 0.1); }
    },
    wave: function () { tone('sine', 90, 60, 0.22, 0.3); noise(0.18, 0.22, 500); },
    attack: function () {
      tone('square', 1180, 520, 0.07, 0.10);
      tone('sawtooth', 2400, 1600, 0.04, 0.04);
    },
    explode: function (big) {
      noise(big ? 0.55 : 0.3, big ? 0.5 : 0.32, big ? 700 : 1400);
      tone('sine', big ? 120 : 180, 38, big ? 0.5 : 0.26, big ? 0.4 : 0.22);
      if (big) tone('square', 70, 30, 0.35, 0.18, 0.02);
    },
    bossHit: function () {
      noise(0.16, 0.3, 900);
      tone('square', 220, 90, 0.12, 0.16);
    },
    over: function () { tone('triangle', 330, 220, 0.25, 0.2); tone('triangle', 220, 110, 0.5, 0.2, 0.22); }
  };
})(window);
