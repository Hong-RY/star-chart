// QA helper: drive the headless browser over CDP and save screenshots.
// Usage (from a Node process): import { capture } from './tools/shot.mjs'
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9222';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function newTarget(url) {
  const res = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!res.ok) throw new Error('create target failed: ' + res.status);
  return await res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { try { ws.close(); } catch {} }
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    };
    ws.onerror = (e) => reject(new Error('ws error'));
  });
}

export async function capture(url, outPath, opts = {}) {
  const width = opts.width || 1920, height = opts.height || 1080;
  const settle = opts.settle == null ? 900 : opts.settle;
  const t = await newTarget('about:blank');
  const c = await connect(t.webSocketDebuggerUrl);
  try {
    await c.send('Network.enable');
    await c.send('Network.setCacheDisabled', { cacheDisabled: true });
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url });
    await sleep(settle);
    if (opts.evaluate) {
      await sleep(200);
      await c.send('Runtime.evaluate', { expression: opts.evaluate, awaitPromise: true });
    }
    await sleep(settle);
    const clip = opts.clip ? { x: opts.clip.x, y: opts.clip.y, width: opts.clip.w, height: opts.clip.h, scale: opts.clip.scale || 1 } : undefined;
    const shot = await c.send('Page.captureScreenshot', clip ? { format: 'png', clip, fromSurface: true } : { format: 'png', captureBeyondViewport: false, fromSurface: true });
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    return outPath;
  } finally {
    c.close();
    try { await fetch(CDP + '/json/close/' + t.id); } catch {}
  }
}
