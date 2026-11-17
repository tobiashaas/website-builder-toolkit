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
//        [--wait 3000] [--chrome <path>] [--css-effect] [--css-only <pattern>] [--direction <file>]

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
const CSS_EFFECT_CAP = 4000; // declarations tested per width
const CSS_EFFECT_LIST = 80; // findings listed before the rest is summed up
const CSS_EFFECT_SAMPLE = 300; // matched elements compared per rule; more are sampled evenly
// Stylesheets nobody on the project edits: WordPress core, plugins, the compiled Automatic.css (also by file name,
// as in static exports), reset and normalize files, the Bricks theme, packages.
// Left out of --css-effect unless --css-only names them.
const CSS_VENDOR = String.raw`/wp-includes/|/wp-admin/|/plugins/|/automatic-css/|/themes/bricks/|/node_modules/|/[^/?]*(?:automatic|acss|reset|normalize)[^/?]*\.css|<style#(?:global-styles|wp-block-library|classic-theme-styles|core-block-supports|wp-emoji|automatic)`;

// Style position (site-direction): one stage per axis, with the range each stage allows on the render.
// The same axes and stages as in slop-lint; that script reads literal CSS, this one measures computed values.
const STYLE_AXES = {
  density: { airy: [96, Infinity], regular: [56, 95.99], dense: [0, 55.99] }, // median vertical section padding in px
  type_contrast: { flat: [0, 2], medium: [2.01, 3.5], strong: [3.51, Infinity] }, // largest font size divided by body size
  shape: { sharp: [0, 2], soft: [3, 10], round: [10.01, Infinity] }, // corner radius in px
  color_budget: { 'one-accent': 1, 'two-families': 2, colorful: Infinity }, // hue families besides neutrals
  imagery: { photo: true, illustration: true, 'type-only': false }, // is there an image in the first viewport
};
const STYLE_LIST = 12; // findings listed per axis before the rest is summed up

// Reads the style: block from the front matter of a direction file or brand profile. Returns {} when there is none.
function readStyle(file) {
  const src = fs.readFileSync(file, 'utf8');
  const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  const style = {};
  if (!fm) return style;
  let inside = false;
  for (const raw of fm[1].split(/\r?\n/)) {
    if (/^style\s*:\s*(#.*)?$/.test(raw)) { inside = true; continue; }
    if (!inside) continue;
    if (/^\S/.test(raw)) break;
    const m = /^\s+([\w-]+)\s*:\s*["']?([\w-]*)["']?\s*(?:#.*)?$/.exec(raw);
    if (!m || !m[2]) continue;
    const axis = m[1].replace('-', '_'), stage = m[2].toLowerCase();
    if (!STYLE_AXES[axis]) continue;
    if (!(stage in STYLE_AXES[axis])) throw new Error(`style.${axis}: "${m[2]}" is not one of ${Object.keys(STYLE_AXES[axis]).join(', ')}`);
    style[axis] = stage;
  }
  return style;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage(msg) {
  if (msg) process.stderr.write(`render-check: ${msg}\n`);
  process.stderr.write(`usage: node render-check.mjs <url> [--widths 360,390,768,1024,1280,1440,1920]
       [--format text|json] [--out <dir>|--no-out] [--reduced-motion] [--level aa|aaa]
       [--wait <ms>] [--chrome <path>] [--css-effect] [--css-only <pattern>] [--direction <file>]
`);
  process.exit(2);
}

function parseArgs(argv) {
  const a = { widths: DEFAULT_WIDTHS, format: 'text', out: undefined, reducedMotion: false, level: 'aa', wait: 3000, chrome: null, url: null, cssEffect: null, direction: null };
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
    else if (t === '--direction') a.direction = val();
    else if (t === '--css-effect') a.cssEffect = a.cssEffect || [];
    else if (t === '--css-only') a.cssEffect = val().split(',').map((x) => x.trim()).filter(Boolean);
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
  const out = { vw: docEl.clientWidth, sw: docEl.scrollWidth, title: document.title, overflow: [], gradient: [], animations: [], images: [], names: [], targets: [], text: [], viewport: null, hero: null, highPriority: 0, style: null };

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
  // 4b. Image priority: the largest img in the first viewport stands in for the LCP image.
  // Only <img> counts; CSS background images and text blocks are not considered.
  const vpArea = innerWidth * innerHeight;
  for (const img of document.querySelectorAll('img')) {
    const prio = (img.getAttribute('fetchpriority') || '').toLowerCase();
    if (prio === 'high') out.highPriority++;
    if (!visible(img)) continue;
    const r = img.getBoundingClientRect();
    const left = r.left + window.scrollX, top = r.top + window.scrollY;
    const w = Math.min(left + r.width, innerWidth) - Math.max(left, 0);
    const h = Math.min(top + r.height, innerHeight) - Math.max(top, 0);
    if (w <= 0 || h <= 0) continue;
    const share = (w * h) / vpArea;
    if (share < 0.15 || (out.hero && share <= out.hero.share)) continue;
    out.hero = { selector: sel(img), share, lazy: (img.getAttribute('loading') || '').toLowerCase() === 'lazy', high: prio === 'high', src: (img.currentSrc || img.getAttribute('src') || '').slice(0, 120) };
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

  // 7. Style position (with --direction): what the page really renders on each axis.
  if (opts.style) {
    const num = (v) => parseFloat(v) || 0;
    const st = { body: num(getComputedStyle(document.body).fontSize) || 16, top: null, sections: [], controls: [], boxes: [], colors: [], images: [] };
    const hsl = (c) => {
      const r = c.r / 255, g = c.g / 255, b = c.b / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
      if (max === min) return { h: 0, s: 0, l };
      const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: h * 60, s, l };
    };
    const seenColor = new Set();
    const addColor = (str, kind, el) => {
      const c = rgba(str);
      if (c.a < 0.5) return;
      const v = hsl(c);
      if (v.s < 0.25 || v.l < 0.12 || v.l > 0.9) return; // neutrals, near black, light tints
      const key = `${kind}|${c.r},${c.g},${c.b}`;
      if (seenColor.has(key)) return;
      seenColor.add(key);
      st.colors.push({ h: Math.round(v.h), kind, selector: sel(el), color: '#' + [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('') });
    };
    const CONTROL = 'button, [role="button"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]), select, textarea, a[class*="btn"], a[class*="button"]';
    const share = (r) => {
      const left = r.left + window.scrollX, top = r.top + window.scrollY;
      const w = Math.min(left + r.width, innerWidth) - Math.max(left, 0), h = Math.min(top + r.height, innerHeight) - Math.max(top, 0);
      return w > 0 && h > 0 ? (w * h) / (innerWidth * innerHeight) : 0;
    };
    const seenBox = new Set();
    let count = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (++count > 8000) break;
      const tag = el.tagName.toLowerCase();
      if (el.closest('svg') && tag !== 'svg') continue;
      if (!visible(el)) continue;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) {
        const fs = num(cs.fontSize);
        if (!st.top || fs > st.top.px) st.top = { px: fs, selector: sel(el), text: sample(el.textContent) };
        addColor(cs.color, 'text', el);
      }
      const bg = rgba(cs.backgroundColor);
      const edged = num(cs.borderTopWidth) > 0 && rgba(cs.borderTopColor).a > 0;
      const control = el.matches(CONTROL);
      if ((bg.a > 0 || edged || cs.boxShadow !== 'none' || control) && r.width >= 24 && r.height >= 16) {
        const v = cs.borderTopLeftRadius.split(' ')[0];
        const half = Math.min(r.width, r.height) / 2;
        const radius = Math.min(v.endsWith('%') ? (Math.min(r.width, r.height) * parseFloat(v)) / 100 : num(v), half);
        const square = Math.abs(r.width - r.height) <= Math.max(r.width, r.height) * 0.1;
        // Fully round and square is an avatar, a dot or an icon button: not part of the shape.
        if (!(radius >= half - 0.5 && square) && (control || radius > 0)) {
          const key = `${sel(el)}|${Math.round(radius)}`;
          if (!seenBox.has(key)) { seenBox.add(key); (control ? st.controls : st.boxes).push({ selector: sel(el), radius: Math.round(radius * 10) / 10, tag, boxed: bg.a > 0 || edged || cs.boxShadow !== 'none' }); }
        }
      }
      if (bg.a >= 0.5 && r.width * r.height >= 2000) addColor(cs.backgroundColor, 'background', el);
      const isImage = /^(img|video|canvas|svg|picture)$/.test(tag) || /url\(/.test(cs.backgroundImage || '');
      if (isImage && tag !== 'picture') { const sh = share(r); if (sh >= 0.05) st.images.push({ selector: sel(el), share: Math.round(sh * 100) }); }
    }
    // Sections: the outermost page bands; their own vertical padding, or that of their first child when they have none.
    const bands = [...document.querySelectorAll('main section, main > *, body > section')].filter((el) => visible(el) && el.getBoundingClientRect().height >= 200 && el.getBoundingClientRect().width >= innerWidth * 0.8);
    for (const el of bands) {
      if (bands.some((o) => o !== el && o.contains(el))) continue;
      const pad = (e) => { const c = getComputedStyle(e); return (num(c.paddingTop) + num(c.paddingBottom)) / 2; };
      const own = pad(el);
      const value = own > 0 ? own : el.firstElementChild ? pad(el.firstElementChild) : 0;
      if (value > 0) st.sections.push({ selector: sel(el), pad: Math.round(value) });
    }
    out.style = st;
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
// CSS effect probe (runs in the page): removes one declaration at a time and compares the computed
// style of the elements its rule matches. A declaration whose removal changes nothing is redundant
// at this width: another rule or the browser default already gives that value.
// Status per declaration: effect | no-effect | unmatched (selector matches nothing) | inactive
// (media or supports condition false) | unchecked (state or pseudo-element selector, container
// query, transition and animation properties, over the cap).
// ---------------------------------------------------------------------------
function cssEffectProbe(opts) {
  const base = (sh) => (sh.href ? sh.href.replace(location.origin, '') : `<style${sh.ownerNode && sh.ownerNode.id ? '#' + sh.ownerNode.id : ''}>`);
  const seenLabel = new Map();
  const labels = new Map(); // stylesheet -> unique label; anonymous <style> blocks get a running number
  for (const sh of document.styleSheets) {
    const n = (seenLabel.get(base(sh)) || 0) + 1;
    seenLabel.set(base(sh), n);
    labels.set(sh, n > 1 ? `${base(sh)} (${n})` : base(sh));
  }
  const vendor = new RegExp(opts.vendor, 'i');
  const want = (name) => (opts.patterns.length ? opts.patterns.some((p) => name.includes(p)) : !vendor.test(name));
  const out = { decls: [], sheets: [], unreadable: [], others: [], capped: false, altered: [], error: null };
  const STATE = /:(?:hover|focus|focus-visible|focus-within|active|visited|target|checked|disabled|invalid|user-invalid|open|popover-open|placeholder-shown)\b|::|:(?:before|after|first-line|first-letter)\b/i;
  // Not judged: transitions and animations (frozen during the probe) and border-image, which the serializer adds to every border shorthand.
  const SKIP_PROP = /^(?:transition|animation|border-image)(?:-|$)/;
  // Declarations as the browser serializes them: longhands that came from one shorthand are judged together.
  const split = (cssText) => {
    const decls = [];
    let depth = 0, quote = null, cur = '';
    for (const ch of cssText + ';') {
      if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ';' && depth <= 0) { const at = cur.indexOf(':'); if (at > 0) decls.push({ prop: cur.slice(0, at).trim(), text: cur.trim() }); cur = ''; continue; }
      cur += ch;
    }
    return decls;
  };
  // Running transitions would hide a change: the computed value right after a removal is still the old one.
  // A constructed stylesheet is not subject to a style-src policy and does not appear in document.styleSheets.
  let freeze;
  try {
    freeze = new CSSStyleSheet();
    freeze.replaceSync('*,*::before,*::after{transition:none!important;animation:none!important}');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, freeze];
  } catch (e) { out.error = `transitions could not be frozen (${e.message})`; return out; }

  // CSS nesting, desugared the way the specification describes it: "&" stands for :is(parent),
  // and a nested selector without "&" is a descendant of the parent.
  const splitList = (sel) => {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of sel) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  };
  const resolve = (sel, parent) => (parent ? splitList(sel).map((s) => (s.includes('&') ? s.replace(/&/g, `:is(${parent})`) : `:is(${parent}) ${s}`)).join(', ') : sel);
  // Where each "selector { declaration }" occurs, over every readable stylesheet, framework included.
  const places = new Map();
  const collect = (rules, name, parent) => {
    for (const r of rules) {
      const type = r.constructor.name;
      const selector = type === 'CSSStyleRule' ? resolve(r.selectorText, parent) : parent;
      if (type === 'CSSStyleRule') for (const d of split(r.style.cssText)) { const k = `${selector}|${d.text}`; if (!places.has(k)) places.set(k, []); places.get(k).push(name); }
      if (type === 'CSSImportRule') { try { if (r.styleSheet) collect(r.styleSheet.cssRules, name, ''); } catch {} }
      else if (r.cssRules && !/Keyframes/.test(type)) collect(r.cssRules, name, selector);
    }
  };
  for (const sh of document.styleSheets) { try { collect(sh.cssRules, labels.get(sh), ''); } catch {} }

  let tested = 0;
  const scratch = document.createElement('i').style;
  const styleRule = (rule, sheet, key, ctx, selector) => {
    const st = rule.style;
    const saved = st.cssText;
    const decls = split(saved);
    let els = null, fixed = null;
    // The probe restores a rule from its serialized text. Where that text does not survive a round trip
    // (a shorthand with var() next to one of its longhands, the all shorthand), the rule is left untouched.
    scratch.cssText = saved;
    if (!ctx.active) fixed = 'inactive';
    else if (ctx.unchecked || STATE.test(selector) || scratch.cssText !== saved || decls.length > 60 || /:\s*(?:;|$)/.test(saved)) fixed = 'unchecked';
    else {
      try { els = [...document.querySelectorAll(selector)]; } catch { fixed = 'unchecked'; }
      if (els && !els.length) fixed = 'unmatched';
    }
    // Every matched element up to the limit; beyond it an even spread, so the first elements in the document do not decide alone.
    let sample = els || [];
    if (sample.length > opts.sample) { const step = sample.length / opts.sample; sample = Array.from({ length: opts.sample }, (_, i) => sample[Math.floor(i * step)]); }
    for (const { prop, text } of decls) {
      let status = fixed;
      if (!status && SKIP_PROP.test(prop)) status = 'unchecked';
      if (!status && tested >= opts.cap) { status = 'unchecked'; out.capped = true; }
      if (!status) {
        tested++;
        const tmp = document.createElement('i').style;
        tmp.cssText = text;
        const longhands = tmp.length ? [...tmp] : [prop];
        const read = () => sample.flatMap((e) => { const cs = getComputedStyle(e); return longhands.map((l) => cs.getPropertyValue(l)); });
        const before = read();
        st.removeProperty(prop);
        const after = read();
        st.cssText = saved; // restores value, priority and order
        if (st.cssText !== saved) out.altered.push(`${sheet} › ${selector}`);
        status = before.some((v, i) => v !== after[i]) ? 'effect' : 'no-effect';
      }
      const twins = (places.get(`${selector}|${text}`) || []);
      const dup = twins.length > 1 ? [...new Set(twins.filter((x) => x !== sheet))].slice(0, 2).join(', ') || 'this stylesheet' : '';
      out.decls.push({ key: `${key}|${prop}`, sheet, selector, text, status, n: els ? els.length : 0, sampled: sample.length, dup });
    }
  };
  const mediaOn = (media) => !media || !media.mediaText || matchMedia(media.mediaText).matches;
  const walk = (rules, sheet, key, ctx) => {
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i], k = `${key}.${i}`, type = r.constructor.name;
      if (type === 'CSSStyleRule') {
        const selector = resolve(r.selectorText, ctx.parent);
        styleRule(r, sheet, k, ctx, selector);
        if (r.cssRules && r.cssRules.length) walk(r.cssRules, sheet, k, { ...ctx, parent: selector });
      }
      else if (type === 'CSSNestedDeclarations') { if (ctx.parent) styleRule(r, sheet, k, ctx, ctx.parent); }
      else if (type === 'CSSMediaRule') walk(r.cssRules, sheet, k, { ...ctx, active: ctx.active && mediaOn(r.media) });
      else if (type === 'CSSSupportsRule') walk(r.cssRules, sheet, k, { ...ctx, active: ctx.active && CSS.supports(r.conditionText) });
      else if (type === 'CSSLayerBlockRule') walk(r.cssRules, sheet, k, ctx);
      else if (type === 'CSSImportRule') {
        const on = ctx.active && mediaOn(r.media) && (!r.supportsText || CSS.supports(r.supportsText));
        try { if (r.styleSheet) walk(r.styleSheet.cssRules, sheet, k, { ...ctx, active: on }); } catch {}
      }
      else if (/^CSS(?:Keyframes|FontFace|Page|Property|CounterStyle|Namespace|LayerStatement|FontFeatureValues|FontPaletteValues)Rule$/.test(type)) continue;
      else if (r.cssRules) walk(r.cssRules, sheet, k, { ...ctx, unchecked: true }); // @container, @scope, @starting-style
    }
  };
  let index = 0;
  for (const sh of document.styleSheets) {
    index++;
    if (sh.disabled) continue;
    const name = labels.get(sh);
    if (!want(name)) { out.others.push(name); continue; }
    let rules;
    try { rules = sh.cssRules; } catch { out.unreadable.push(name); continue; }
    out.sheets.push(name);
    walk(rules, name, `${index}:${name}`, { active: mediaOn(sh.media), unchecked: false, parent: '' });
  }
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== freeze);
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
  let docStatus = null;
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
        if (p.type === 'Document' && docStatus === null && p.response.url.split('#')[0] === url.split('#')[0]) docStatus = p.response.status;
        if (p.response.status >= 400) console_.push({ kind: 'request', text: `HTTP ${p.response.status}`, where: p.response.url });
        break;
      case 'Page.javascriptDialogOpening':
        // An open alert, confirm or prompt blocks the page and every measurement after it.
        console_.push({ kind: 'dialog', text: `${p.type} dialog dismissed: ${String(p.message).slice(0, 120)}` });
        s('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
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
    if (docStatus !== null && docStatus >= 400) add('load', 'error', 'document', `the page answered HTTP ${docStatus}; what was measured is an error or block page, not the site (bot protection often blocks headless Chrome)`);
    await sleep(args.wait);
    // Scroll through once so lazy content loads, then back to the top.
    await s('Runtime.evaluate', { awaitPromise: true, expression: `(async () => { const h = innerHeight; for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 40; y += h, i++) { scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); } scrollTo(0, 0); await new Promise(r => setTimeout(r, 400)); })()` });

    const ev = await s('Runtime.evaluate', { expression: `(${pageProbe})(${JSON.stringify({ cap: CONTRAST_CAP, style: !!args.style })})`, returnByValue: true });
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

    // 4b. Image priority
    if (p.hero) {
      if (p.hero.lazy) add('image-priority', 'error', p.hero.selector, `largest image in the first viewport has loading="lazy" (${p.hero.src || 'no src'}); remove it and set fetchpriority="high", lazy loading delays the largest paint`);
      else if (!p.hero.high) add('image-priority', 'warn', p.hero.selector, `largest image in the first viewport has no fetchpriority="high" (${p.hero.src || 'no src'}); set it so the browser fetches this image first`);
    }
    if (p.highPriority > 2) add('image-priority', 'warn', 'img[fetchpriority=high]', `${p.highPriority} images with fetchpriority="high"; keep it to one or two, more cancels the effect`);

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

    // 7. Style position (with --direction)
    if (args.style && p.style) for (const f of styleFindings(p.style, args.style, width === args.styleWidth)) add('style-position', f.severity, f.selector, f.detail);

    // 7b. Console and requests
    for (const c of console_) add('console', 'warn', c.kind, `${String(c.text).split('\n')[0].slice(0, 240)}${c.where ? ` (${c.where.slice(0, 160)})` : ''}`);

    // 8. Screenshot
    if (outDir) {
      const m = await s('Page.getLayoutMetrics');
      const size = m.cssContentSize || m.contentSize;
      const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.max(width, Math.ceil(size.width)), height: Math.min(SHOT_MAX_HEIGHT, Math.ceil(size.height)), scale: 1 } });
      fs.writeFileSync(path.join(outDir, `${width}.png`), Buffer.from(shot.data, 'base64'));
    }
    // 9. CSS effect (opt-in), after the screenshot because it touches the stylesheets. Collected per width, combined in main.
    if (args.cssEffect) {
      const ce = await s('Runtime.evaluate', { expression: `(${cssEffectProbe})(${JSON.stringify({ patterns: args.cssEffect, cap: CSS_EFFECT_CAP, sample: CSS_EFFECT_SAMPLE, vendor: CSS_VENDOR })})`, returnByValue: true });
      if (ce.exceptionDetails) add('css-no-effect', 'manual', 'stylesheets', `CSS effect probe failed: ${String(ce.exceptionDetails.exception?.description || ce.exceptionDetails.text).split('\n')[0]}`);
      else if (ce.result.value.error) add('css-no-effect', 'manual', 'stylesheets', `CSS effect not checked: ${ce.result.value.error}`);
      else args.cssEffectRuns.push({ width, ...ce.result.value });
    }
    return findings;
  } finally {
    cdp.off(onEvent);
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Style position: compares what the probe measured with the confirmed stage per axis.
// Density and type contrast depend on the viewport, so they are judged at one reference width only.
// ---------------------------------------------------------------------------
function styleFindings(m, style, isRef) {
  const out = [];
  const warn = (selector, detail) => out.push({ severity: 'warn', selector, detail });
  // Stage bounds are stored with a small offset (2.01, 55.99) so neighbours do not overlap; print the plain number.
  const low = (v) => Math.floor(v * 10) / 10, high = (v) => (Math.round(v * 100) % 100 === 99 ? Math.floor(v) : v);
  const range = ([lo, hi]) => (hi === Infinity ? `above ${low(lo)}` : lo === 0 ? `up to ${high(hi)}` : `${low(lo)} to ${high(hi)}`);
  const listed = (items, each) => { items.slice(0, STYLE_LIST).forEach(each); if (items.length > STYLE_LIST) warn('…', `${items.length - STYLE_LIST} more`); };

  if (style.shape) {
    const [lo, hi] = STYLE_AXES.shape[style.shape];
    const high = [...m.controls, ...m.boxes].filter((b) => b.radius > hi);
    listed(high, (b) => warn(b.selector, `corner radius ${b.radius} px with shape "${style.shape}" (${range([lo, hi])} px)`));
    // Too small a radius is judged only on controls that show a box (fill, border or shadow): images and page
    // bands are square in every shape, and a text-only trigger has no corners to see.
    const small = m.controls.filter((b) => b.boxed && b.radius < Math.floor(lo));
    listed(small, (b) => warn(b.selector, `corner radius ${b.radius} px on <${b.tag}> with shape "${style.shape}" (${range([lo, hi])} px)`));
  }
  if (style.color_budget) {
    const max = STYLE_AXES.color_budget[style.color_budget];
    // Hue families: colors whose hues lie within 25 degrees of each other count as one.
    const sorted = [...m.colors].sort((a, b) => a.h - b.h);
    const families = [];
    for (const c of sorted) { const last = families[families.length - 1]; if (last && c.h - last[last.length - 1].h <= 25) last.push(c); else families.push([c]); }
    if (families.length > 1 && families[0][0].h + 360 - families[families.length - 1][families[families.length - 1].length - 1].h <= 25) families[0].push(...families.pop());
    if (families.length > max) warn('colors', `${families.length} hue families besides neutrals with color budget "${style.color_budget}" (${max}): ${families.map((f) => `${f[0].color} (${f[0].kind} of ${f[0].selector})`).slice(0, 5).join(', ')}`);
  }
  if (style.imagery) {
    const wants = STYLE_AXES.imagery[style.imagery];
    const big = m.images.filter((i) => i.share >= 10);
    if (!wants && m.images.length) warn(m.images[0].selector, `image covering ${m.images[0].share} % of the first viewport with imagery "type-only"`);
    if (wants && !big.length) warn('first viewport', `no image of at least 10 % of the first viewport with imagery "${style.imagery}"`);
  }
  if (!isRef) return out;
  if (style.type_contrast && m.top) {
    const [lo, hi] = STYLE_AXES.type_contrast[style.type_contrast];
    const ratio = m.top.px / m.body;
    if (ratio < lo - 0.005 || ratio > hi + 0.005) warn(m.top.selector, `largest font size ${Math.round(m.top.px * 10) / 10} px is ${ratio.toFixed(1)} times body size (${Math.round(m.body * 10) / 10} px) with type contrast "${style.type_contrast}" (${range([lo, hi])}) "${m.top.text}"`);
  }
  if (style.density) {
    const [lo, hi] = STYLE_AXES.density[style.density];
    const pads = m.sections.map((s) => s.pad).sort((a, b) => a - b);
    if (!pads.length) out.push({ severity: 'manual', selector: 'sections', detail: `no page section with vertical padding found; measure density "${style.density}" by hand` });
    else {
      const median = pads[Math.floor((pads.length - 1) / 2)];
      if (median < lo || median > hi) warn('sections', `median section padding ${median} px over ${pads.length} section(s) with density "${style.density}" (${range([lo, hi])} px); first: ${m.sections[0].selector}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSS effect: a declaration is reported when it had no effect at every width where it was tested
// and an effect at none. Rules that never matched are summed up, not listed: they may match other pages.
// ---------------------------------------------------------------------------
function cssEffectFindings(runs, patterns) {
  const findings = [];
  const add = (width, severity, selector, detail, alsoAt = []) => findings.push({ width, check: 'css-no-effect', severity, selector, detail, alsoAt });
  const first = runs[0];
  if (!first) return { findings, summary: null };
  const w0 = first.width;
  const sheets = [...new Set(runs.flatMap((r) => r.sheets))];
  const unreadable = [...new Set(runs.flatMap((r) => r.unreadable))];
  const skipped = [...new Set(runs.flatMap((r) => r.others))];
  if (!sheets.length && !unreadable.length) {
    const rest = skipped.slice(0, 12).join(', ') || 'none';
    add(w0, 'warn', 'stylesheets', patterns.length ? `no stylesheet matches "${patterns.join(', ')}"; on this page: ${rest}` : `no stylesheet of the project found; left out as framework or core: ${rest}. Name one with --css-only`);
    return { findings, summary: { sheets, skipped, tested: 0, noEffect: 0, unmatched: 0, unchecked: 0, capped: false } };
  }
  const byKey = new Map();
  for (const run of runs) for (const d of run.decls) {
    if (!byKey.has(d.key)) byKey.set(d.key, { ...d, at: {} });
    const e = byKey.get(d.key);
    e.at[run.width] = d.status;
    if (d.n > e.n) { e.n = d.n; e.sampled = d.sampled; }
  }
  const none = [], unmatched = new Set();
  let tested = 0, unchecked = 0;
  for (const d of byKey.values()) {
    const st = Object.values(d.at);
    if (st.includes('effect')) { tested++; continue; }
    if (st.includes('no-effect')) { tested++; none.push(d); continue; }
    if (st.includes('unmatched')) unmatched.add(`${d.sheet} › ${d.selector}`);
    else unchecked++;
  }
  for (const d of none.slice(0, CSS_EFFECT_LIST)) {
    const ws = Object.keys(d.at).filter((w) => d.at[w] === 'no-effect').map(Number);
    add(ws[0], 'warn', `${d.sheet} › ${d.selector}`, `${d.text} changes nothing on ${d.sampled < d.n ? `${d.sampled} sampled of ${d.n}` : `the ${d.n}`} matched element(s); ${d.dup ? `the same declaration is also in ${d.dup}` : 'another rule or the default already gives this value'}`, ws.slice(1));
  }
  if (none.length > CSS_EFFECT_LIST) add(w0, 'warn', '…', `${none.length - CSS_EFFECT_LIST} more declarations without effect`);
  if (unmatched.size) add(w0, 'manual', 'stylesheets', `${unmatched.size} rule(s) match nothing on this page (first: ${[...unmatched][0]}); check the other pages before deleting them`);
  if (unreadable.length) add(w0, 'manual', 'stylesheets', `not readable from the page (other origin): ${unreadable.slice(0, 8).join(', ')}`);
  const altered = [...new Set(runs.flatMap((r) => r.altered))];
  if (altered.length) add(w0, 'manual', 'stylesheets', `${altered.length} rule(s) could not be restored exactly after the probe (first: ${altered[0]}); results for this run are not reliable`);
  const capped = runs.some((r) => r.capped);
  return { findings, summary: { sheets, skipped, tested, noEffect: none.length, unmatched: unmatched.size, unchecked, capped } };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
const ORDER = ['load', 'reflow', 'contrast', 'gradient-text', 'animation', 'reduced-motion', 'image-alt', 'image-priority', 'accessible-name', 'target-size', 'viewport-meta', 'style-position', 'css-no-effect', 'console'];
const countBy = (fs_) => ({ error: fs_.filter((f) => f.severity === 'error').length, warn: fs_.filter((f) => f.severity === 'warn').length, manual: fs_.filter((f) => f.severity === 'manual').length });
const summaryLine = (c, n) => `render-check: ${c.error} error(s), ${c.warn} warning(s), ${c.manual} manual check(s) at ${n} width(s)`;
function grouped(findings, widths) {
  return widths.map((w) => {
    const fw = findings.filter((f) => f.width === w);
    return { width: w, checks: ORDER.map((c) => ({ check: c, items: fw.filter((f) => f.check === c) })).filter((g) => g.items.length) };
  });
}
const also = (f) => (f.alsoAt && f.alsoAt.length ? ` (also at ${f.alsoAt.join(', ')})` : '');

const cssEffectLines = (c) => [
  `css-effect: ${c.tested} declaration(s) tested in ${c.sheets.length} stylesheet(s): ${c.sheets.join(', ') || 'none'}`,
  `css-effect: left out as framework or core${c.skipped.length ? `: ${c.skipped.join(', ')}` : ': nothing'}`,
  `css-effect: ${c.noEffect} without effect, ${c.unmatched} rule(s) without a match, ${c.unchecked} declaration(s) not judged (states, pseudo-elements, container rules, inactive media, transitions)${c.capped ? `; stopped at ${CSS_EFFECT_CAP} declarations per width` : ''}`,
];
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
  if (meta.cssEffect) lines.push(...cssEffectLines(meta.cssEffect), '');
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
  if (meta.cssEffect) l.push('## CSS effect', '', ...cssEffectLines(meta.cssEffect).map((x) => `- ${x.replace(/^css-effect: /, '')}`), '');
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
  // Style position: the brand profile of the data folder first, then the direction file on top, axis by axis.
  if (args.direction) {
    try {
      const data = findDataFolder(process.cwd());
      const brand = data && fs.existsSync(path.join(data, 'brand.md')) ? readStyle(path.join(data, 'brand.md')) : {};
      const own = readStyle(args.direction);
      if (!Object.keys(own).length) throw new Error('no style position found (expected "style:" with at least one axis in the front matter)');
      args.style = { ...brand, ...own };
    } catch (e) { usage(`direction ${args.direction}: ${e.message}`); }
    // Density and type contrast are judged at the tested width closest to 1280 px, from 1024 px up.
    const wide = args.widths.filter((w) => w >= 1024);
    args.styleWidth = wide.length ? wide.reduce((a, b) => (Math.abs(b - 1280) < Math.abs(a - 1280) ? b : a)) : null;
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
  if (args.cssEffect) args.cssEffectRuns = [];
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

  if (args.style && args.styleWidth === null && (args.style.density || args.style.type_contrast)) {
    all.push({ width: args.widths[0], check: 'style-position', severity: 'manual', selector: 'widths', detail: 'density and type contrast are measured at 1024 px or wider; add such a width', alsoAt: [] });
  }
  const cssEffect = args.cssEffect ? cssEffectFindings(args.cssEffectRuns, args.cssEffect) : null;
  if (cssEffect) { all.push(...cssEffect.findings); meta.cssEffect = cssEffect.summary; }
  const counts = countBy(all);
  if (outDir) fs.writeFileSync(path.join(outDir, 'report.md'), mdReport(meta, all));
  if (args.format === 'json') {
    process.stdout.write(JSON.stringify({ tool: 'render-check', version: VERSION, url: args.url, browser: meta.browser, level: args.level, reducedMotion: args.reducedMotion, widths: args.widths, outDir, style: args.style || undefined, summary: counts, cssEffect: cssEffect ? cssEffect.summary : undefined, findings: all }, null, 2) + '\n');
  } else process.stdout.write(textReport(meta, all));
  process.exit(counts.error ? 1 : 0);
}

main();
