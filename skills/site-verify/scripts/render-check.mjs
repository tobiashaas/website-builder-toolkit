#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// render-check: renders a live URL in the local Chrome through the Chrome DevTools Protocol
// and measures what a screenshot can't show: reflow, text contrast, gradient text, animations,
// alt text, accessible names, target size, zoom lock, console errors. Screenshots per width.
// Node 22+ (global WebSocket), zero dependencies. Usage: scripts/README.md
//
//   node scripts/render-check.mjs <url> [--widths 360,390,768,1024,1280,1440,1920]
//        [--format text|json] [--out <dir>|--no-out] [--reduced-motion] [--level aa|aaa]
//        [--wait 3000] [--chrome <path>]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';

const VERSION = '0.1.0';
const DEFAULT_WIDTHS = [360, 390, 768, 1024, 1280, 1440, 1920];
const START_TIMEOUT = 30000;
const LOAD_TIMEOUT = 45000;
const CONTRAST_CAP = 300;
const SHOT_MAX_HEIGHT = 16000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage(msg) {
  if (msg) process.stderr.write(`render-check: ${msg}\n`);
  process.stderr.write(`usage: node render-check.mjs <url> [--widths 360,390,768,1024,1280,1440,1920]
       [--format text|json] [--out <dir>|--no-out] [--reduced-motion] [--level aa|aaa]
       [--wait <ms>] [--chrome <path>]
`);
  process.exit(2);
}

function parseArgs(argv) {
  const a = { widths: DEFAULT_WIDTHS, format: 'text', out: undefined, reducedMotion: false, level: 'aa', wait: 3000, chrome: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) usage(`${t} needs a value`); return v; };
    if (t === '--widths') {
      a.widths = val().split(',').map((s) => Number(s.trim()));
      if (!a.widths.length || a.widths.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) usage('--widths takes integers between 200 and 4000, comma-separated');
    } else if (t === '--format') { a.format = val(); if (!['text', 'json'].includes(a.format)) usage('--format is text or json'); }
    else if (t === '--out') a.out = val();
    else if (t === '--no-out') a.out = null;
    else if (t === '--reduced-motion') a.reducedMotion = true;
    else if (t === '--level') { a.level = val().toLowerCase(); if (!['aa', 'aaa'].includes(a.level)) usage('--level is aa or aaa'); }
    else if (t === '--wait') { a.wait = Number(val()); if (!Number.isFinite(a.wait) || a.wait < 0) usage('--wait takes milliseconds'); }
    else if (t === '--chrome') a.chrome = val();
    else if (t === '-h' || t === '--help') usage();
    else if (t.startsWith('--')) usage(`unknown option ${t}`);
    else if (!a.url) a.url = t;
    else usage(`unexpected argument ${t}`);
  }
  if (!a.url) usage('no URL given');
  try { const u = new URL(a.url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { usage(`not an http(s) URL: ${a.url}`); }
  return a;
}

// ---------------------------------------------------------------------------
// Output folder: website-builder/reports/<date>-<slug>-render/ when a data folder exists
// ---------------------------------------------------------------------------
function findDataFolder(start) {
  let dir = path.resolve(start);
  for (;;) {
    const cand = path.join(dir, 'website-builder');
    if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) return cand;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
function slugFor(url) {
  const u = new URL(url);
  const s = `${u.hostname.replace(/^www\./, '')}${u.pathname}`.toLowerCase().replace(/\.(html?|php)$/, '');
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
}
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Chrome discovery and launch
// ---------------------------------------------------------------------------
function findChrome(explicit) {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const env = process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const cands = [];
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) cands.push(path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    for (const r of roots) cands.push(path.join(r, 'Chromium', 'Application', 'chrome.exe'));
    for (const r of roots) cands.push(path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  } else if (process.platform === 'darwin') {
    for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      cands.push(`${base}/Google Chrome.app/Contents/MacOS/Google Chrome`, `${base}/Chromium.app/Contents/MacOS/Chromium`, `${base}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`);
    }
  } else {
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const r = spawnSync('which', [bin], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) cands.push(r.stdout.trim());
    }
    cands.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium');
  }
  return cands.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome(bin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'render-check-'));
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--mute-audio',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
  const proc = spawn(bin, args, { stdio: 'ignore' });
  let exited = false;
  proc.on('exit', () => { exited = true; });
  const cleanup = async () => {
    try { proc.kill(); } catch {}
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(300); }
    }
  };
  // Chrome writes the chosen port into DevToolsActivePort; startup can take more than 10 s.
  const portFile = path.join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  while (Date.now() - t0 < START_TIMEOUT) {
    if (exited) break;
    try {
      const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
      if (port) {
        const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        return { info, cleanup };
      }
    } catch {}
    await sleep(250);
  }
  await cleanup();
  throw new Error(`Chrome did not open its debugging port within ${START_TIMEOUT / 1000} s (${bin})`);
}

// Minimal CDP client over one browser WebSocket, flat sessions.
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('CDP WebSocket failed')), { once: true }); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString());
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(`${m.error.message}${m.error.data ? ` (${m.error.data})` : ''}`)); else res(m.result);
    } else if (m.method) for (const l of listeners) l(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
  });
  return { send, on: (fn) => listeners.add(fn), off: (fn) => listeners.delete(fn), close: () => ws.close() };
}

// ---------------------------------------------------------------------------
// WCAG 2.x contrast formula, shared with site-accessibility (single source).
import { luminance, ratio } from '../../site-accessibility/scripts/contrast.mjs';
function over(top, under) {
  const a = top.a + under.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t, u) => (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
}
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const fmtRatio = (r) => { const t = (Math.floor(r * 100) / 100).toFixed(2); return `${t}:1`; };
const isLarge = (px, weight) => px >= 24 || (px >= 18.66 && weight >= 700);
const minRatio = (large, level) => (level === 'aaa' ? (large ? 4.5 : 7) : (large ? 3 : 4.5));

// ---------------------------------------------------------------------------
// In-page probe (stringified and run with Runtime.evaluate). Must be self-contained.
// ---------------------------------------------------------------------------
function pageProbe(opts) {
  const docEl = document.documentElement;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  const rgba = (str) => {
    if (colorCache.has(str)) return colorCache.get(str);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = str;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const c = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    if (/^\s*transparent\s*$/i.test(str) || /rgba\([^)]*,\s*0\s*\)$/.test(str)) c.a = 0;
    colorCache.set(str, c);
    return c;
  };
  if (opts.convert) return opts.convert.map(rgba);

  const sel = (el, pseudo) => {
    const parts = [];
    let e = el;
    for (let i = 0; i < 3 && e && e.nodeType === 1 && e !== document.body && e !== docEl; i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(s + '#' + CSS.escape(e.id)); break; }
      const cls = [...e.classList].slice(0, e === el ? 4 : 2);
      if (cls.length) s += '.' + cls.map((c) => CSS.escape(c)).join('.');
      parts.unshift(s);
      e = e.parentElement;
    }
    return (parts.join(' > ') || el.tagName.toLowerCase()) + (pseudo || '');
  };
  const hiddenByOpacity = (el) => { for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).opacity === '0') return true; return false; };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    if (getComputedStyle(el).visibility !== 'visible') return false;
    return !hiddenByOpacity(el);
  };
  const exposed = (el) => !el.closest('[aria-hidden="true"], [inert]');
  const sample = (t) => t.replace(/\s+/g, ' ').trim().slice(0, 50);
  const out = { vw: docEl.clientWidth, sw: docEl.scrollWidth, title: document.title, overflow: [], gradient: [], animations: [], images: [], names: [], targets: [], text: [], viewport: null };

  // 1. Reflow: outermost elements past the right edge; skip fixed subtrees and descendants of x-clipping boxes.
  if (out.sw > out.vw) {
    const state = new Map();
    for (const el of document.body.querySelectorAll('*')) {
      const ps = state.get(el.parentElement) || {};
      if (ps.skip) { state.set(el, { skip: true }); continue; }
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.display === 'none') { state.set(el, { skip: true }); continue; }
      const r = el.getBoundingClientRect();
      const off = r.width > 0 && r.right > out.vw + 0.5;
      if (off && !ps.off) out.overflow.push({ selector: sel(el), width: Math.round(r.width), right: Math.round(r.right), minWidth: cs.minWidth, cssWidth: cs.width });
      // Any overflow-x other than visible (hidden, clip, auto, scroll) or paint containment keeps children out of the page width.
      state.set(el, { skip: cs.overflowX !== 'visible' || /paint|strict|content/.test(cs.contain), off: ps.off || off });
    }
  }

  // 3. Gradient text and animations.
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if ((cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') && el.textContent.trim()) {
      out.gradient.push({ selector: sel(el), background: cs.backgroundImage.slice(0, 80), text: sample(el.textContent) });
    }
  }
  const TRANSFORMISH = new Set(['transform', 'translate', 'rotate', 'scale', 'offsetDistance', 'left', 'top', 'right', 'bottom', 'backgroundPosition']);
  for (const a of document.getAnimations()) {
    if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) continue;
    const eff = a.effect;
    if (!eff || !eff.target) continue;
    const timing = eff.getComputedTiming();
    let props = [];
    try { props = [...new Set(eff.getKeyframes().flatMap((k) => Object.keys(k)))].filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p)); } catch {}
    out.animations.push({
      selector: sel(eff.target, eff.pseudoElement || ''),
      name: a.animationName || a.id || 'script animation',
      infinite: timing.iterations === Infinity,
      running: a.playState === 'running',
      moves: props.some((p) => TRANSFORMISH.has(p)),
      props: props.slice(0, 6),
    });
  }

  // 4. Images without alt, links/buttons without an accessible name.
  for (const img of document.querySelectorAll('img:not([alt])')) {
    if (!exposed(img) || img.getClientRects().length === 0) continue;
    const role = img.getAttribute('role');
    if (role === 'presentation' || role === 'none') continue;
    out.images.push({ selector: sel(img), src: (img.currentSrc || img.getAttribute('src') || '').slice(0, 120) });
  }
  const nameOf = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t; }
    if ((el.getAttribute('aria-label') || '').trim()) return el.getAttribute('aria-label').trim();
    if (el.tagName === 'INPUT') { if ((el.value || '').trim()) return el.value; if (el.labels && [...el.labels].some((l) => l.textContent.trim())) return 'label'; }
    const txt = (el.innerText || '').trim();
    if (txt) return txt;
    for (const img of el.querySelectorAll('img[alt], [role="img"][aria-label], svg[aria-label]')) {
      const t = (img.getAttribute('alt') || img.getAttribute('aria-label') || '').trim();
      if (t) return t;
    }
    for (const t of el.querySelectorAll('svg title')) if (t.textContent.trim()) return t.textContent.trim();
    if ((el.getAttribute('title') || '').trim()) return el.getAttribute('title').trim();
    return '';
  };
  for (const el of document.querySelectorAll('a[href], button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]')) {
    if (!exposed(el) || el.getClientRects().length === 0 || getComputedStyle(el).visibility !== 'visible') continue;
    if (!nameOf(el)) out.names.push({ selector: sel(el), tag: el.tagName.toLowerCase(), href: (el.getAttribute('href') || '').slice(0, 100) });
  }

  // 5. Target size (2.5.8): < 24 x 24 CSS px, except inline links inside running text.
  for (const el of document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]')) {
    if (!exposed(el) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 24 && r.height >= 24) continue;
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline') {
      let block = el.parentElement;
      while (block && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
      const own = (el.innerText || '').trim().length;
      if (block && (block.innerText || '').trim().length > own + 1) continue;
    }
    out.targets.push({ selector: sel(el), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
  }

  // 6. Viewport meta.
  const vm = document.querySelector('meta[name="viewport"]');
  out.viewport = vm ? vm.getAttribute('content') || '' : null;

  // 2. Text contrast candidates: elements with their own visible text, deduped, marked for CDP.
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const parents = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.trim()) parents.add(n.parentElement);
  const scrollX0 = window.scrollX, scrollY0 = window.scrollY;
  let idx = 0;
  for (const el of parents) {
    if (idx >= opts.cap) break;
    if (!el || el.closest('script, style, noscript, template, svg, option, title')) continue;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') continue;
    const col = rgba(cs.color);
    if (col.a === 0) continue;
    const key = sel(el) + '|' + cs.color + '|' + cs.fontSize + '|' + cs.fontWeight;
    if (seen.has(key)) continue;
    seen.add(key);
    // Image or video behind the text? Walk the paint stack under the element center, then ancestors.
    let behind = null;
    const r = el.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, r.top + window.scrollY - innerHeight / 2));
    const rr = el.getBoundingClientRect();
    const cx = Math.min(innerWidth - 1, Math.max(0, rr.left + Math.min(rr.width, innerWidth) / 2));
    const cy = Math.min(innerHeight - 1, Math.max(0, rr.top + rr.height / 2));
    const stack = document.elementsFromPoint(cx, cy);
    const at = stack.indexOf(el);
    const checkBox = (e) => {
      if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|OBJECT|EMBED)$/.test(e.tagName)) return `${e.tagName.toLowerCase()} behind the text (${sel(e)})`;
      const ecs = getComputedStyle(e);
      // Gradients are resolved by CSS.getBackgroundColors; url() images are ignored by it, so flag them.
      if (/url\(|image-set\(|element\(|cross-fade\(/.test(ecs.backgroundImage || '')) return `background-image on ${sel(e)}`;
      if (ecs.filter !== 'none' || (ecs.backdropFilter && ecs.backdropFilter !== 'none') || ecs.mixBlendMode !== 'normal' || (e !== el && parseFloat(ecs.opacity) < 1 && !e.contains(el))) complex = true;
      const bgc = rgba(ecs.backgroundColor);
      if (bgc.a > 0) layers.push(ecs.backgroundColor);
      return bgc.a >= 1 ? 'stop' : null;
    };
    // Own fallback when CSS.getBackgroundColors gives up (it does for text next to overlapping inline children):
    // the background colors in the paint stack, top to bottom, unless a filter or blend mode is involved.
    const layers = [];
    let complex = false;
    const list = at >= 0 ? stack.slice(at) : [];
    for (let e = el; e && !list.includes(e); e = e.parentElement) list.push(e); // ancestors when the stack misses the element
    for (const e of list) { const v = checkBox(e); if (v === 'stop') break; if (v) { behind = v; break; } }
    el.setAttribute('data-rc-i', String(idx));
    out.text.push({ i: idx, selector: sel(el), color: cs.color, fontSize: parseFloat(cs.fontSize), fontWeight: parseInt(cs.fontWeight, 10) || 400, text: sample(el.textContent), behind, layers: complex ? null : layers });
    idx++;
  }
  window.scrollTo(scrollX0, scrollY0);
  return out;
}

// ---------------------------------------------------------------------------
// One width
// ---------------------------------------------------------------------------
async function checkWidth(cdp, url, width, args, outDir) {
  const findings = [];
  const add = (check, severity, selector, detail, extra = {}) => findings.push({ width, check, severity, selector, detail, ...extra });
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  const console_ = [];
  const requests = new Map();
  let loaded = false;
  const onEvent = (m) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params;
    switch (m.method) {
      case 'Page.loadEventFired': loaded = true; break;
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails;
        console_.push({ kind: 'exception', text: (d.exception && d.exception.description) || d.text, where: d.url || '' });
        break;
      }
      case 'Runtime.consoleAPICalled':
        if (p.type === 'error' || p.type === 'assert') console_.push({ kind: 'console.error', text: p.args.map((x) => x.value ?? x.description ?? '').join(' ') });
        break;
      case 'Log.entryAdded':
        if (p.entry.level === 'error' && p.entry.source !== 'network') console_.push({ kind: `log (${p.entry.source})`, text: p.entry.text, where: p.entry.url || '' });
        break;
      case 'Network.requestWillBeSent': requests.set(p.requestId, p.request.url); break;
      case 'Network.responseReceived':
        if (p.response.status >= 400) console_.push({ kind: 'request', text: `HTTP ${p.response.status}`, where: p.response.url });
        break;
      case 'Network.loadingFailed':
        if (!p.canceled) console_.push({ kind: 'request', text: p.blockedReason ? `blocked (${p.blockedReason})` : p.errorText, where: requests.get(p.requestId) || '' });
        break;
    }
  };
  cdp.on(onEvent);
  try {
    await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable', 'DOM.enable', 'CSS.enable'].map((m) => s(m)));
    const mobile = width < 768;
    await s('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
    if (mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (args.reducedMotion) await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const nav = await s('Page.navigate', { url });
    if (nav.errorText) { add('load', 'error', 'document', `navigation failed: ${nav.errorText}`); return findings; }
    const t0 = Date.now();
    while (!loaded && Date.now() - t0 < LOAD_TIMEOUT) await sleep(100);
    if (!loaded) add('load', 'warn', 'document', `load event did not fire within ${LOAD_TIMEOUT / 1000} s; measured anyway`);
    await sleep(args.wait);
    // Scroll through once so lazy content loads, then back to the top.
    await s('Runtime.evaluate', { awaitPromise: true, expression: `(async () => { const h = innerHeight; for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 40; y += h, i++) { scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); } scrollTo(0, 0); await new Promise(r => setTimeout(r, 400)); })()` });

    const ev = await s('Runtime.evaluate', { expression: `(${pageProbe})(${JSON.stringify({ cap: CONTRAST_CAP })})`, returnByValue: true });
    if (ev.exceptionDetails) throw new Error(`page probe failed: ${ev.exceptionDetails.exception?.description || ev.exceptionDetails.text}`);
    const p = ev.result.value;

    // 1. Reflow
    if (p.sw > p.vw) {
      add('reflow', 'error', 'html', `document is ${p.sw} px wide in a ${p.vw} px viewport (horizontal scroll, WCAG 1.4.10)`);
      for (const o of p.overflow.slice(0, 15)) add('reflow', 'error', o.selector, `${o.width} px wide, right edge at ${o.right} px (width ${o.cssWidth}, min-width ${o.minWidth})`);
      if (p.overflow.length > 15) add('reflow', 'error', '…', `${p.overflow.length - 15} more outermost offenders`);
    }

    // 2. Contrast via CSS.getBackgroundColors, the method DevTools uses.
    if (p.text.length) {
      const { root } = await s('DOM.getDocument', { depth: 0 });
      const { nodeIds } = await s('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-rc-i]' });
      const byIdx = new Map();
      await Promise.all(nodeIds.map(async (nodeId) => {
        const { attributes } = await s('DOM.getAttributes', { nodeId });
        const k = attributes.indexOf('data-rc-i');
        const bg = await s('CSS.getBackgroundColors', { nodeId }).catch(() => ({}));
        byIdx.set(Number(attributes[k + 1]), bg);
      }));
      await s('Runtime.evaluate', { expression: `document.querySelectorAll('[data-rc-i]').forEach(e => e.removeAttribute('data-rc-i'))` });
      const strings = new Set();
      for (const t of p.text) { strings.add(t.color); for (const c of [...(byIdx.get(t.i)?.backgroundColors || []), ...(t.layers || [])]) strings.add(c); }
      const list = [...strings];
      const conv = (await s('Runtime.evaluate', { expression: `(${pageProbe})(${JSON.stringify({ convert: list })})`, returnByValue: true })).result.value;
      const C = new Map(list.map((str, i) => [str, conv[i]]));
      const white = { r: 255, g: 255, b: 255, a: 1 };
      const seenPair = new Set();
      const manualBySource = new Map(); // one manual finding per image source, not per text element
      const fsz = (px) => `${Math.round(px * 10) / 10}px`;
      for (const t of p.text) {
        const bgs = byIdx.get(t.i)?.backgroundColors;
        const large = isLarge(t.fontSize, t.fontWeight);
        const need = minRatio(large, args.level);
        const desc = `${fsz(t.fontSize)} ${t.fontWeight}${large ? ', large' : ''}`;
        if (t.behind) {
          const m = manualBySource.get(t.behind) || { first: t, count: 0, need: 0 };
          m.count++; m.need = Math.max(m.need, need);
          manualBySource.set(t.behind, m);
          continue;
        }
        // CDP colors first: one is a flat background, several are gradient stops. When CDP gives up
        // (it does for text next to overlapping inline children), use the paint-stack colors from the probe.
        let backs = null;
        if (bgs && bgs.length) backs = bgs.map((b) => over(C.get(b), white));
        else if (t.layers) backs = [[...t.layers].reverse().reduce((acc, l) => over(C.get(l), acc), white)];
        if (!backs) {
          add('contrast', 'manual', t.selector, `background not measurable (filter, blend mode or complex stacking) behind "${t.text}"; sample the worst spot with contrast.mjs (${desc}, needs ${need}:1)`);
          continue;
        }
        const pairs = backs.map((bg) => { const fg = over(C.get(t.color), bg); return { fg, bg, r: ratio(fg, bg) }; });
        const worst = pairs.reduce((x, y) => (y.r < x.r ? y : x));
        if (worst.r >= need) continue;
        if (pairs.length > 1 && pairs.some((x) => x.r >= need)) {
          add('contrast', 'manual', t.selector, `gradient behind "${t.text}" (stops ${pairs.map((x) => `${hex(x.bg)} ${fmtRatio(x.r)}`).join(', ')}); check where the text sits (${desc}, needs ${need}:1)`);
          continue;
        }
        const key = `${t.selector}|${hex(worst.fg)}|${hex(worst.bg)}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        add('contrast', 'error', t.selector, `${fmtRatio(worst.r)} ${hex(worst.fg)} on ${hex(worst.bg)}${pairs.length > 1 ? ' (worst gradient stop)' : ''}, needs ${need}:1 (${desc}) "${t.text}"`, { ratio: Math.round(worst.r * 100) / 100, fg: hex(worst.fg), bg: hex(worst.bg) });
      }
      for (const [source, m] of manualBySource) {
        add('contrast', 'manual', m.first.selector, `${source}: ${m.count} text element(s) over it, first "${m.first.text}"; sample the lightest and darkest spot behind the text with contrast.mjs (needs up to ${m.need}:1)`);
      }
    }

    // 3. Gradient text, animations
    for (const g of p.gradient) add('gradient-text', 'warn', g.selector, `background-clip: text "${g.text}"; contrast can't be measured, use a solid color`);
    const anims = new Map();
    for (const a of p.animations) {
      const bad = args.reducedMotion ? a.running && (a.infinite || a.moves) : a.infinite && a.running;
      if (!bad) continue;
      const k = `${a.selector}|${a.name}`;
      if (!anims.has(k)) anims.set(k, a);
    }
    for (const a of anims.values()) {
      if (args.reducedMotion) add('reduced-motion', 'error', a.selector, `animation "${a.name}" still runs under prefers-reduced-motion: reduce (${a.infinite ? 'infinite' : 'finite'}${a.moves ? ', moves' : ''}; ${a.props.join(', ')})`);
      else add('animation', 'warn', a.selector, `infinite animation "${a.name}" (${a.props.join(', ')}); give it a pause control or stop it under prefers-reduced-motion`);
    }

    // 4. Alt and names
    for (const i of p.images) add('image-alt', 'error', i.selector, `img without alt attribute (${i.src || 'no src'}); alt="" if decorative`);
    for (const n of p.names) add('accessible-name', 'error', n.selector, `${n.tag}${n.href ? ` href="${n.href}"` : ''} has no accessible name (text, aria-label, aria-labelledby, title or img alt)`);

    // 5. Target size
    for (const t of p.targets.slice(0, 40)) add('target-size', 'warn', t.selector, `${t.w} × ${t.h} px, below 24 × 24 (WCAG 2.5.8; check spacing exception)`);
    if (p.targets.length > 40) add('target-size', 'warn', '…', `${p.targets.length - 40} more small targets`);

    // 6. Viewport meta
    if (p.viewport === null) add('viewport-meta', 'warn', 'meta[name=viewport]', 'missing; phones render a 980 px layout and zoom out');
    else {
      const kv = Object.fromEntries(p.viewport.split(/[,;]/).map((x) => x.split('=').map((y) => y.trim().toLowerCase())).filter((x) => x[0]));
      const us = kv['user-scalable'];
      const max = kv['maximum-scale'] !== undefined ? parseFloat(kv['maximum-scale']) : null;
      if (us === 'no' || us === '0') add('viewport-meta', 'error', 'meta[name=viewport]', `"${p.viewport}" disables zoom (user-scalable=${us}); use width=device-width, initial-scale=1`);
      if (max !== null && max < 2) add('viewport-meta', 'error', 'meta[name=viewport]', `"${p.viewport}" limits zoom (maximum-scale=${kv['maximum-scale']}); remove maximum-scale`);
    }

    // 7. Console and requests
    for (const c of console_) add('console', 'warn', c.kind, `${String(c.text).split('\n')[0].slice(0, 240)}${c.where ? ` (${c.where.slice(0, 160)})` : ''}`);

    // 8. Screenshot
    if (outDir) {
      const m = await s('Page.getLayoutMetrics');
      const size = m.cssContentSize || m.contentSize;
      const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.max(width, Math.ceil(size.width)), height: Math.min(SHOT_MAX_HEIGHT, Math.ceil(size.height)), scale: 1 } });
      fs.writeFileSync(path.join(outDir, `${width}.png`), Buffer.from(shot.data, 'base64'));
    }
    return findings;
  } finally {
    cdp.off(onEvent);
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
const ORDER = ['load', 'reflow', 'contrast', 'gradient-text', 'animation', 'reduced-motion', 'image-alt', 'accessible-name', 'target-size', 'viewport-meta', 'console'];
const countBy = (fs_) => ({ error: fs_.filter((f) => f.severity === 'error').length, warn: fs_.filter((f) => f.severity === 'warn').length, manual: fs_.filter((f) => f.severity === 'manual').length });
const summaryLine = (c, n) => `render-check: ${c.error} error(s), ${c.warn} warning(s), ${c.manual} manual check(s) at ${n} width(s)`;
function grouped(findings, widths) {
  return widths.map((w) => {
    const fw = findings.filter((f) => f.width === w);
    return { width: w, checks: ORDER.map((c) => ({ check: c, items: fw.filter((f) => f.check === c) })).filter((g) => g.items.length) };
  });
}
const also = (f) => (f.alsoAt && f.alsoAt.length ? ` (also at ${f.alsoAt.join(', ')})` : '');

function textReport(meta, findings) {
  const lines = [`render-check ${meta.url}`, `${meta.browser}, level ${meta.level.toUpperCase()}, reduced motion ${meta.reducedMotion ? 'emulated' : 'off'}`, ''];
  for (const g of grouped(findings, meta.widths)) {
    lines.push(`${g.width} px${g.checks.length ? '' : '  no findings'}`);
    for (const c of g.checks) {
      lines.push(`  ${c.check}`);
      for (const f of c.items) lines.push(`    ${f.severity.padEnd(6)} ${f.selector}  ${f.detail}${also(f)}`);
    }
    lines.push('');
  }
  if (meta.outDir) lines.push(`report and screenshots: ${meta.outDir}`, '');
  lines.push(summaryLine(countBy(findings), meta.widths.length));
  return lines.join('\n') + '\n';
}

function mdReport(meta, findings) {
  const c = countBy(findings);
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const l = [`# Render check: ${meta.url}`, '', `- Date: ${meta.date}`, `- Browser: ${meta.browser}`, `- Widths: ${meta.widths.join(', ')} px`, `- Contrast level: ${meta.level.toUpperCase()}`, `- Reduced motion: ${meta.reducedMotion ? 'emulated (prefers-reduced-motion: reduce)' : 'off'}`, `- Result: ${c.error} error(s), ${c.warn} warning(s), ${c.manual} manual check(s)`, '',
    'Automated checks only. Keyboard, screen reader, zoom and text spacing still need a person (`site-accessibility`).', ''];
  for (const g of grouped(findings, meta.widths)) {
    l.push(`## ${g.width} px`, '', `![${g.width} px](${g.width}.png)`, '');
    if (!g.checks.length) { l.push('No findings.', ''); continue; }
    l.push('| Check | Severity | Element | Detail |', '| --- | --- | --- | --- |');
    for (const ch of g.checks) for (const f of ch.items) l.push(`| ${f.check} | ${f.severity} | \`${esc(f.selector)}\` | ${esc(f.detail + also(f))} |`);
    l.push('');
  }
  return l.join('\n');
}

// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof WebSocket === 'undefined') {
    process.stderr.write(`render-check: needs Node 22 or newer (global WebSocket); this is Node ${process.versions.node}\n`);
    process.exit(2);
  }
  const bin = findChrome(args.chrome);
  if (!bin) {
    process.stderr.write(`render-check: Chrome not found${args.chrome ? ` at ${args.chrome}` : ''}. Install Google Chrome or Chromium, or pass --chrome <path> (or set CHROME_PATH).\n`);
    process.exit(2);
  }
  let outDir = null;
  if (args.out) outDir = path.resolve(args.out);
  else if (args.out === undefined) { const data = findDataFolder(process.cwd()); if (data) outDir = path.join(data, 'reports', `${today()}-${slugFor(args.url)}-render`); }
  if (outDir) fs.mkdirSync(outDir, { recursive: true });

  let chrome;
  try { chrome = await launchChrome(bin); } catch (e) { process.stderr.write(`render-check: ${e.message}\n`); process.exit(2); }
  const meta = { url: args.url, browser: chrome.info.Browser || 'Chrome', level: args.level, reducedMotion: args.reducedMotion, widths: args.widths, date: today(), outDir };
  let cdp;
  const all = [];
  try {
    cdp = await connect(chrome.info.webSocketDebuggerUrl);
    const seen = new Map();
    for (const w of args.widths) {
      const fw = await checkWidth(cdp, args.url, w, args, outDir);
      for (const f of fw) {
        // The same finding at several widths is reported once, at the first width, with alsoAt.
        const key = `${f.check}|${f.severity}|${f.selector}|${f.detail}`;
        if (seen.has(key)) { seen.get(key).alsoAt.push(w); continue; }
        f.alsoAt = [];
        seen.set(key, f);
        all.push(f);
      }
    }
  } catch (e) {
    process.stderr.write(`render-check: ${e.message}\n`);
    try { cdp && cdp.close(); } catch {}
    await chrome.cleanup();
    process.exit(2);
  }
  try { cdp.close(); } catch {}
  await chrome.cleanup();

  const counts = countBy(all);
  if (outDir) fs.writeFileSync(path.join(outDir, 'report.md'), mdReport(meta, all));
  if (args.format === 'json') {
    process.stdout.write(JSON.stringify({ tool: 'render-check', version: VERSION, url: args.url, browser: meta.browser, level: args.level, reducedMotion: args.reducedMotion, widths: args.widths, outDir, summary: counts, findings: all }, null, 2) + '\n');
  } else process.stdout.write(textReport(meta, all));
  process.exit(counts.error ? 1 : 0);
}

main();
