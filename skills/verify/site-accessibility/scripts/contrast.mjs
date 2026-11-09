#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// contrast: WCAG 2.x contrast ratios for one color pair or a whole brand palette.
// Node 18+, zero dependencies. Usage: scripts/README.md
//
//   node scripts/contrast.mjs <fg> [bg] [--bg <color>] [--kind text|large|ui] [--level aa|aaa]
//        [--suggest] [--apca] [--format text|json]
//   node scripts/contrast.mjs --brand website-builder/brand.md [--level aa|aaa] [--suggest]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const VERSION = '0.1.0';

// WCAG 2.2 thresholds (1.4.3, 1.4.6, 1.4.11). Large text: >= 18pt (24 CSS px), or >= 14pt (18.66 CSS px) bold.
const LEVELS = [
  { key: 'aaNormal', label: 'AA normal text', min: 4.5, sc: '1.4.3' },
  { key: 'aaLarge', label: 'AA large text', min: 3, sc: '1.4.3' },
  { key: 'aaaNormal', label: 'AAA normal text', min: 7, sc: '1.4.6' },
  { key: 'aaaLarge', label: 'AAA large text', min: 4.5, sc: '1.4.6' },
  { key: 'ui', label: 'UI / graphics', min: 3, sc: '1.4.11' },
];
// Which check decides pass/fail for a given --kind and --level.
function requiredKey(kind, level) {
  if (kind === 'ui') return 'ui'; // 1.4.11 has no AAA counterpart
  if (kind === 'large') return level === 'aaa' ? 'aaaLarge' : 'aaLarge';
  return level === 'aaa' ? 'aaaNormal' : 'aaNormal';
}
const minFor = (key) => LEVELS.find((l) => l.key === key).min;

// ---------------------------------------------------------------------------
// Color parsing: hex (3/4/6/8), rgb()/rgba(), hsl()/hsla(), a few keywords.
// Returns { r, g, b, a } with r/g/b in 0..255 (floats allowed) and a in 0..1.
// ---------------------------------------------------------------------------
const KEYWORDS = { black: '#000000', white: '#ffffff', transparent: '#00000000' };

function parseColor(input) {
  const s = String(input).trim().toLowerCase();
  if (KEYWORDS[s]) return parseColor(KEYWORDS[s]);
  let m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^(rgba?|hsla?)\((.*)\)$/.exec(s);
  if (!m) return null;
  const fn = m[1].slice(0, 3);
  // Accept both "r, g, b, a" and "r g b / a".
  let body = m[2].trim();
  let alphaPart = null;
  const slash = body.split('/');
  if (slash.length === 2) { body = slash[0].trim(); alphaPart = slash[1].trim(); }
  else if (slash.length > 2) return null;
  const parts = body.includes(',') ? body.split(',').map((x) => x.trim()) : body.split(/\s+/);
  if (alphaPart === null && parts.length === 4) alphaPart = parts.pop();
  if (parts.length !== 3) return null;
  const a = alphaPart === null ? 1 : num(alphaPart, 1);
  if (a === null) return null;
  if (fn === 'rgb') {
    const ch = parts.map((p) => num(p, 255));
    if (ch.some((v) => v === null)) return null;
    return { r: clamp(ch[0], 0, 255), g: clamp(ch[1], 0, 255), b: clamp(ch[2], 0, 255), a: clamp(a, 0, 1) };
  }
  const hue = angle(parts[0]);
  const sat = num(parts[1], 1, true);
  const lig = num(parts[2], 1, true);
  if (hue === null || sat === null || lig === null) return null;
  return { ...hslToRgb(hue, clamp(sat, 0, 1), clamp(lig, 0, 1)), a: clamp(a, 0, 1) };
}
// Number or percentage; percent maps to 0..scale. pctOnly: plain numbers are read as percent (hsl s/l).
function num(t, scale, pctOnly = false) {
  const m = /^(-?\d*\.?\d+(?:e-?\d+)?)(%?)$/.exec(t);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (m[2] || pctOnly) return (v / 100) * scale;
  return v;
}
function angle(t) {
  const m = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(t);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const deg = { turn: v * 360, rad: (v * 180) / Math.PI, grad: v * 0.9 }[m[2]] ?? v;
  return ((deg % 360) + 360) % 360;
}
function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return { r: f(0), g: f(8), b: f(4) };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Source-over compositing in sRGB space, as browsers paint.
function over(top, under) {
  const a = top.a + under.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t, u) => (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
}

function toHex(c) {
  const h = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

// ---------------------------------------------------------------------------
// WCAG 2.x relative luminance and contrast ratio (sRGB, threshold 0.04045 as in WCAG 2.2)
// ---------------------------------------------------------------------------
function channel(v8) {
  const c = v8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(c) {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}
function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// APCA-W3 0.0.98G-4g (informational only, not a WCAG 2.2 requirement)
// Constants from the published apca-w3 reference (Myndex, SAPC-8, 0.0.98G-4g).
// ---------------------------------------------------------------------------
const SA98G = {
  mainTRC: 2.4, sRco: 0.2126729, sGco: 0.7151522, sBco: 0.072175,
  normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65,
  blkThrs: 0.022, blkClmp: 1.414, scaleBoW: 1.14, scaleWoB: 1.14,
  loBoWoffset: 0.027, loWoBoffset: 0.027, deltaYmin: 0.0005, loClip: 0.1,
};
function apcaY(c) {
  const lin = (v) => Math.pow(clamp(v, 0, 255) / 255, SA98G.mainTRC);
  return SA98G.sRco * lin(c.r) + SA98G.sGco * lin(c.g) + SA98G.sBco * lin(c.b);
}
function apcaLc(text, bg) {
  let t = apcaY(text);
  let b = apcaY(bg);
  if (t <= SA98G.blkThrs) t += Math.pow(SA98G.blkThrs - t, SA98G.blkClmp);
  if (b <= SA98G.blkThrs) b += Math.pow(SA98G.blkThrs - b, SA98G.blkClmp);
  if (Math.abs(b - t) < SA98G.deltaYmin) return 0;
  let out;
  if (b > t) {
    const sapc = (Math.pow(b, SA98G.normBG) - Math.pow(t, SA98G.normTXT)) * SA98G.scaleBoW;
    out = sapc < SA98G.loClip ? 0 : sapc - SA98G.loBoWoffset;
  } else {
    const sapc = (Math.pow(b, SA98G.revBG) - Math.pow(t, SA98G.revTXT)) * SA98G.scaleWoB;
    out = sapc > -SA98G.loClip ? 0 : sapc + SA98G.loWoBoffset;
  }
  return out * 100;
}

// ---------------------------------------------------------------------------
// OKLCH (Björn Ottosson's OKLab), used by --suggest to keep hue and chroma
// ---------------------------------------------------------------------------
const toLin = (v) => channel(v);
const fromLin = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function rgbToOklch(c) {
  const r = toLin(c.r), g = toLin(c.g), b = toLin(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
}
function oklchToLinear({ L, C, h }) {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
// Map into sRGB by lowering chroma at constant L and h.
function oklchToRgb(lch) {
  const inGamut = (v) => v.every((x) => x >= -1e-6 && x <= 1 + 1e-6);
  let lin = oklchToLinear(lch);
  if (!inGamut(lin)) {
    let lo = 0, hi = lch.C;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...lch, C: mid }))) lo = mid; else hi = mid;
    }
    lin = oklchToLinear({ ...lch, C: lo });
  }
  const [r, g, b] = lin.map((x) => fromLin(clamp(x, 0, 1)));
  return { r, g, b, a: 1 };
}
// Nearest darker and lighter shade of fg (same OKLCH hue) that reaches min on bg.
function suggest(fg, bg, min) {
  const start = rgbToOklch(fg);
  const out = {};
  for (const [dir, step] of [['darker', -0.002], ['lighter', 0.002]]) {
    for (let L = start.L + step; L >= 0 && L <= 1; L += step) {
      const c = parseColor(toHex(oklchToRgb({ ...start, L })));
      const r = ratio(c, bg);
      if (r >= min) { out[dir] = { hex: toHex(c), ratio: r, deltaL: +(L - start.L).toFixed(3) }; break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Brand profile front matter (same YAML subset and data-folder lookup as slop-lint)
// ---------------------------------------------------------------------------
function stripYamlComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1])) && !/^#[0-9a-fA-F]{3,8}\b/.test(line.slice(i))) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
}
function splitTop(s, sep) {
  const out = [];
  let depth = 0, q = null, cur = '';
  for (const ch of s) {
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function yamlScalar(s) {
  s = s.trim();
  if (s === '') return null;
  if ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'"))) return s.slice(1, -1);
  if (s[0] === '[' && s.endsWith(']')) return splitTop(s.slice(1, -1), ',').map((x) => x.trim()).filter((x) => x !== '').map(yamlScalar);
  if (s[0] === '{' && s.endsWith('}')) {
    const o = {};
    for (const part of splitTop(s.slice(1, -1), ',')) {
      const i = part.indexOf(':');
      if (i > 0) o[part.slice(0, i).trim().replace(/^['"]|['"]$/g, '')] = yamlScalar(part.slice(i + 1));
    }
    return o;
  }
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^(null|~)$/i.test(s)) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return s;
}
function parseYaml(src) {
  const L = [];
  for (const raw of src.split(/\r?\n/)) {
    const t = stripYamlComment(raw);
    if (t.trim()) L.push({ ind: t.match(/^ */)[0].length, s: t.trim() });
  }
  let i = 0;
  const isItem = (s) => s === '-' || s.startsWith('- ');
  function block(ind) {
    if (i >= L.length) return null;
    if (isItem(L[i].s)) {
      const arr = [];
      while (i < L.length && L[i].ind === ind && isItem(L[i].s)) {
        const rest = L[i].s.slice(1).trimStart();
        if (rest === '') { i++; arr.push(i < L.length && L[i].ind > ind ? block(L[i].ind) : null); continue; }
        if (/^[^'"{\[][^:]*:(\s|$)/.test(rest)) { L[i] = { ind: ind + (L[i].s.length - rest.length), s: rest }; arr.push(block(L[i].ind)); }
        else { arr.push(yamlScalar(rest)); i++; }
      }
      return arr;
    }
    const obj = {};
    while (i < L.length && L[i].ind === ind && !isItem(L[i].s)) {
      const m = /^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(L[i].s);
      i++;
      if (!m) continue;
      const key = m[1].replace(/^['"]|['"]$/g, '');
      if (m[2] !== undefined && m[2] !== '') obj[key] = yamlScalar(m[2]);
      else if (i < L.length && (L[i].ind > ind || (L[i].ind === ind && isItem(L[i].s)))) obj[key] = block(L[i].ind);
      else obj[key] = null;
    }
    return obj;
  }
  return L.length ? block(L[0].ind) : {};
}
function frontMatter(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  return (m && parseYaml(m[1])) || {};
}
function findBrand(start) {
  let dir = path.resolve(start);
  for (;;) {
    const data = path.join(dir, 'website-builder');
    const brand = path.join(data, 'brand.md');
    const setup = path.join(data, 'setup.md');
    if (fs.existsSync(brand) || fs.existsSync(setup)) {
      const s = fs.existsSync(setup) ? frontMatter(setup) : {};
      if (String(s.brand || '').toLowerCase() === 'none') return null;
      const cand = path.join(data, typeof s.brand === 'string' && s.brand.endsWith('.md') ? s.brand : 'brand.md');
      return fs.existsSync(cand) ? cand : null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const TEXT_ROLE = /\b(text|ink|foreground|fg|heading|body|copy|link)\b/i;
const SURFACE_ROLE = /\b(surface|background|bg|canvas|paper|base|page)\b/i;
const UI_ROLE = /\b(accent|primary|secondary|brand|ui|icon|border|focus|cta|button)\b/i;

function loadPalette(file) {
  const y = frontMatter(file);
  const list = Array.isArray(y.colors) ? y.colors : [];
  const colors = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const hex = item.hex ?? item.value ?? item.color;
    if (!hex) continue;
    const c = parseColor(hex);
    if (!c) throw new Error(`cannot parse color "${hex}" (${item.name || 'unnamed'})`);
    colors.push({ name: String(item.name || hex), input: String(hex), role: String(item.role || ''), c });
  }
  const level = String(y.contrast ?? y.contrast_level ?? '').toLowerCase();
  return { name: y.name || '', colors, level: level === 'aaa' || level === 'aa' ? level : null };
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------
function check(fg, bg, opts, meta = {}) {
  const base = bg.a < 1 ? over(bg, opts.page) : bg;
  const shown = fg.a < 1 ? over(fg, base) : fg;
  const r = ratio(shown, base);
  const checks = Object.fromEntries(LEVELS.map((l) => [l.key, r >= l.min]));
  const key = meta.kind ? requiredKey(meta.kind, opts.level) : requiredKey(opts.kind, opts.level);
  const res = {
    fg: meta.fgName ?? opts.fgInput, bg: meta.bgName ?? opts.bgInput,
    fgHex: toHex(shown), bgHex: toHex(base), kind: meta.kind || opts.kind,
    ratio: r, ratioText: fmtRatio(r), checks, required: { check: key, min: minFor(key) }, pass: checks[key],
  };
  if (fg.a < 1 || bg.a < 1) res.composited = true;
  if (opts.apca) res.apcaLc = +apcaLc(shown, base).toFixed(1);
  if (opts.suggest && !res.pass) {
    res.suggestions = { aa: suggest(shown, base, minFor(requiredKey(res.kind, 'aa'))) };
    if (opts.level === 'aaa' && res.kind !== 'ui') res.suggestions.aaa = suggest(shown, base, minFor(requiredKey(res.kind, 'aaa')));
  }
  return res;
}
// Two decimals, but never print a rounded value that looks like a pass when the raw ratio fails.
function fmtRatio(r) {
  const misleading = LEVELS.some((l) => r < l.min && +r.toFixed(2) >= l.min);
  return misleading ? (Math.floor(r * 1000) / 1000).toFixed(3) : r.toFixed(2);
}

function brandPairs(pal) {
  const texts = pal.colors.filter((c) => TEXT_ROLE.test(c.role));
  const surfaces = pal.colors.filter((c) => SURFACE_ROLE.test(c.role));
  const uis = pal.colors.filter((c) => UI_ROLE.test(c.role) && !TEXT_ROLE.test(c.role) && !SURFACE_ROLE.test(c.role));
  const pairs = [];
  if (texts.length && surfaces.length) {
    for (const t of texts) for (const s of surfaces) if (t !== s) pairs.push({ fg: t, bg: s, kind: null });
    for (const u of uis) for (const s of surfaces) pairs.push({ fg: u, bg: s, kind: 'ui' });
    return { mode: 'roles', pairs };
  }
  for (let i = 0; i < pal.colors.length; i++)
    for (let j = i + 1; j < pal.colors.length; j++) pairs.push({ fg: pal.colors[i], bg: pal.colors[j], kind: null });
  return { mode: 'all-pairs', pairs };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
function printPair(res, opts) {
  const lines = [`${res.fg} on ${res.bg}  ${res.ratioText}:1${res.composited ? `  (composited: ${res.fgHex} on ${res.bgHex})` : ''}`];
  for (const l of LEVELS) {
    const mark = l.key === res.required.check ? '  <- required' : '';
    lines.push(`  ${pad(l.label, 16)} ${pad(`${l.min}:1`, 6)} ${res.checks[l.key] ? 'pass' : 'FAIL'}  (${l.sc})${mark}`);
  }
  if (res.apcaLc !== undefined) lines.push(`  APCA Lc ${res.apcaLc}  (informational, APCA-W3 0.0.98G-4g; not a WCAG 2.2 requirement)`);
  lines.push(...suggestionLines(res));
  return lines.join('\n');
}
function suggestionLines(res) {
  if (!res.suggestions) return [];
  const out = [];
  for (const [lvl, s] of Object.entries(res.suggestions)) {
    const parts = ['darker', 'lighter'].filter((d) => s[d]).map((d) => `${d} ${s[d].hex} (${fmtRatio(s[d].ratio)}:1, dL ${s[d].deltaL})`);
    out.push(`  suggest ${lvl.toUpperCase()}: ${parts.length ? parts.join(', ') : 'no shade of this hue reaches the level on this background'}`);
  }
  return out;
}
function printMatrix(results, pal, file, opts, mode) {
  const lines = [`Brand: ${pal.name || path.basename(file)}  (${file})`, `Level: ${opts.level.toUpperCase()}  pairs: ${mode === 'roles' ? 'text and UI roles on surface roles' : 'all pairs (no text/surface roles found)'}`, ''];
  const w = Math.max(...results.map((r) => `${r.fg} on ${r.bg}`.length), 10);
  for (const r of results) {
    const kind = r.kind === 'ui' ? 'ui' : r.kind === 'large' ? 'large' : 'text';
    lines.push(`${r.pass ? 'pass' : 'FAIL'}  ${pad(`${r.fg} on ${r.bg}`, w)}  ${pad(`${r.ratioText}:1`, 9)} ${pad(`${kind} >= ${r.required.min}`, 11)} ${r.fgHex} / ${r.bgHex}${r.apcaLc !== undefined ? `  Lc ${r.apcaLc}` : ''}`);
    lines.push(...suggestionLines(r));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage(msg) {
  if (msg) process.stderr.write(`contrast: ${msg}\n\n`);
  process.stderr.write(`Usage:
  node contrast.mjs <fg> [bg] [options]       one pair (bg defaults to --bg)
  node contrast.mjs --brand <brand.md>        matrix of the brand palette
  node contrast.mjs                           matrix of website-builder/brand.md, found upwards

Colors: #rgb #rgba #rrggbb #rrggbbaa, rgb()/rgba(), hsl()/hsla(), black, white.

Options:
  --bg <color>          page background under translucent colors (default #ffffff)
  --kind text|large|ui  what the pair is used for (default text)
  --level aa|aaa        level that decides the exit code (default aa, or contrast: in the brand profile)
  --suggest             nearest darker/lighter shade of the foreground that passes
  --apca                also print APCA Lc (informational, not a WCAG 2.2 requirement)
  --format text|json    output format (default text)
`);
  process.exit(2);
}
function parseArgs(argv) {
  const a = { pos: [], bg: null, kind: 'text', level: null, suggest: false, apca: false, format: 'text', brand: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const val = () => { const eq = x.indexOf('='); if (eq > 0) return x.slice(eq + 1); if (i + 1 >= argv.length) usage(`${x} needs a value`); return argv[++i]; };
    const name = x.split('=')[0];
    if (name === '--bg') a.bg = val();
    else if (name === '--kind') a.kind = val();
    else if (name === '--level') a.level = val().toLowerCase();
    else if (name === '--format') a.format = val();
    else if (name === '--brand') a.brand = val();
    else if (x === '--suggest') a.suggest = true;
    else if (x === '--apca') a.apca = true;
    else if (x === '-h' || x === '--help') usage();
    else if (x.startsWith('--')) usage(`unknown option ${x}`);
    else a.pos.push(x);
  }
  if (!['text', 'large', 'ui'].includes(a.kind)) usage(`--kind must be text, large or ui`);
  if (a.level && !['aa', 'aaa'].includes(a.level)) usage(`--level must be aa or aaa`);
  if (!['text', 'json'].includes(a.format)) usage(`--format must be text or json`);
  if (a.pos.length > 2) usage('at most two colors');
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const page = parseColor(args.bg ?? '#ffffff');
  if (!page) usage(`cannot parse --bg "${args.bg}"`);
  const pageOpaque = page.a < 1 ? over(page, { r: 255, g: 255, b: 255, a: 1 }) : page;
  const opts = { page: pageOpaque, kind: args.kind, level: args.level || 'aa', suggest: args.suggest, apca: args.apca };
  const json = args.format === 'json';

  if (args.pos.length) {
    const fg = parseColor(args.pos[0]);
    if (!fg) usage(`cannot parse color "${args.pos[0]}"`);
    let bg = pageOpaque, bgInput = args.bg ?? '#ffffff';
    if (args.pos[1]) { bg = parseColor(args.pos[1]); bgInput = args.pos[1]; if (!bg) usage(`cannot parse color "${args.pos[1]}"`); }
    const res = check(fg, bg, { ...opts, fgInput: args.pos[0], bgInput });
    if (json) process.stdout.write(JSON.stringify({ tool: 'contrast', version: VERSION, level: opts.level, results: [res], summary: { checked: 1, failed: res.pass ? 0 : 1 } }, null, 2) + '\n');
    else process.stdout.write(printPair(res, opts) + '\n');
    process.exit(res.pass ? 0 : 1);
  }

  const file = args.brand ? path.resolve(args.brand) : findBrand(process.cwd());
  if (!file) usage('no colors given and no website-builder/brand.md found');
  let pal;
  try { pal = loadPalette(file); } catch (e) { usage(`cannot read brand profile ${file}: ${e.message}`); }
  if (pal.colors.length < 2) usage(`brand profile ${file} lists fewer than two colors with a hex value`);
  if (!args.level && pal.level) opts.level = pal.level;
  const { mode, pairs } = brandPairs(pal);
  const results = pairs.map((p) => check(p.fg.c, p.bg.c, opts, { fgName: p.fg.name, bgName: p.bg.name, kind: p.kind || opts.kind }));
  const failed = results.filter((r) => !r.pass).length;
  if (json) process.stdout.write(JSON.stringify({ tool: 'contrast', version: VERSION, brand: file, level: opts.level, mode, results, summary: { checked: results.length, failed } }, null, 2) + '\n');
  else process.stdout.write(printMatrix(results, pal, file, opts, mode) + `\n\ncontrast: ${failed} of ${results.length} pair(s) fail ${opts.level.toUpperCase()}\n`);
  process.exit(failed ? 1 : 0);
}

// Run the CLI only when executed directly, so other scripts can import the formula.
export { parseColor, channel, luminance, ratio };
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
