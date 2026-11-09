#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tobias Haas
//
// slop-lint: mechanical checks for generic "AI look" tells in UI code and copy.
// Node 18+, zero dependencies. Usage and rule reference: scripts/README.md
//
//   node scripts/slop-lint.mjs [paths...] [--brand brand.md] [--adapter acss|tailwind|etch|bricks]
//        [--lang de|en] [--format text|json] [--fail-on error|warn] [--config .slop-lint.json]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const WB = String.raw`[\p{L}\p{N}]`; // Unicode letter/digit, used for word boundaries

// ---------------------------------------------------------------------------
// Thresholds (override in .slop-lint.json under "thresholds")
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  pxDistinct: 12,   // css/px-sprawl: distinct px values per file before reporting
  important: 3,     // css/important-overuse: !important count per file before reporting
  rounded: 5,       // tailwind/rounded-overuse: rounded-2xl/3xl uses per file before reporting
  glowBlurPx: 20,   // design/glow-shadow: minimum blur radius in px
  scaleMax: 1.02,   // design/hover-scale: largest acceptable hover scale
  trackingEm: 0.05, // design/uppercase-tracking: letter-spacing (em) that counts as wide
};

// ---------------------------------------------------------------------------
// Word lists (regex fragments, matched with Unicode word boundaries, case-insensitive)
// ---------------------------------------------------------------------------
const LISTS = {
  hypeEn: ['supercharg(?:e|es|ed|ing)', 'seamless(?:ly)?', 'unlock(?:s|ed|ing)?', 'revolutioni[sz](?:e|es|ed|ing)',
    'game[- ]?chang(?:er|ers|ing)', 'next[- ]level', 'cutting[- ]edge', 'world[- ]class'],
  softHypeEn: ['elevat(?:e|es|ed|ing)', 'empower(?:s|ed|ing|ment)?', 'leverag(?:e|es|ed|ing)', 'robust(?:ly|ness)?'],
  hypeDe: ['revolution(?:ä|ae)r\\p{L}*', 'nahtlos\\p{L}*', 'bahnbrechend\\p{L}*', 'einzigartig\\p{L}*', 'next[- ]level',
    'perfekt(?:e|en|em|er|es)?', 'optimal(?:e|en|em|er|es)?'],
  softHypeDe: ['innovativ\\p{L}*', 'ganzheitlich\\p{L}*', 'ma(?:ß|ss)geschneidert\\p{L}*'],
  aiPhraseEn: ["in today['’]s (?:fast[- ]paced|digital|ever[- ]changing) (?:world|landscape|age)", 'look no further',
    'dive (?:deep )?into', "whether you['’]re an?", 'unleash(?:es|ed|ing)? (?:the|your) (?:power|potential)',
    'harness(?:es|ed|ing)? the power', "it['’]s not just (?:a|an|about)", 'take (?:it|your \\p{L}+) to the next level'],
  aiPhraseDe: ['in der heutigen (?:schnelllebigen|digitalen) (?:welt|zeit)', 'tauchen sie (?:ein|tiefer)', 'entdecken sie',
    'mehr als nur', 'nicht nur\\b[^.!?\\n]{1,80}?\\bsondern auch', 'auf das nächste level', 'lassen sie uns gemeinsam'],
  greeting: ['welcome back', 'willkommen zurück', 'hey there', 'hi there', 'hallo zusammen'],
  placeholder: ['lorem ipsum','john doe', 'jane doe', 'max mustermann', 'erika mustermann',
    'firma xy', 'musterfirma', 'beispiel gmbh', 'acme(?: (?:inc|corp|gmbh))?\\.?'],
};

// ---------------------------------------------------------------------------
// RULES: data table. Each rule: id, severity (error|warn|info), message, fix, optional
// when(env) gate, optional adapter ('acss'|'tailwind'), and one or more detectors.
// Detector scopes:
//   text   regex/check per human-readable text segment (ctx: heading|button|link|label|title|attr|placeholder)
//   class  regex/check per class attribute value (Tailwind-style utilities, @apply)
//   decl   check(decl, block, file, env) per CSS declaration
//   block  check(block, file, env) per CSS rule block
//   css    regex/check on the CSS-only view of the file
//   raw    regex on raw markup/script source
//   markup check(file) on facts collected while parsing markup (e.g. img without alt)
//   file   check(file, env) for per-file aggregates
// re may be a RegExp or a function env => RegExp|null. check returns index(es) or {index,message}.
// Detector option skipAdapters: ['tailwind'] hides it when that adapter has a dedicated rule.
// ---------------------------------------------------------------------------
const RULES = [
  // ---------------- design ----------------
  { id: 'design/gradient-text', severity: 'error',
    message: 'Gradient text (background-clip: text over a gradient).',
    fix: 'Use a solid text color from the palette; carry emphasis with size, weight or position.',
    detect: [
      { scope: 'block', check: (b) => {
        const clip = b.decls.find((d) => /^(-webkit-)?background-clip$/.test(d.prop) && /\btext\b/.test(d.value));
        return clip && b.decls.some((d) => /gradient\(/i.test(d.value)) ? clip.index : null; } },
      { scope: 'class', check: (s) => {
        const m = /(?<![\w-])(?:[\w-]+:)*bg-clip-text(?![\w-])/.exec(s);
        return m && /(?<![\w-])(?:bg-(?:gradient-to|linear-to|linear|radial|conic)-|from-)/.test(s) ? m.index : null; } },
    ] },
  { id: 'design/ai-gradient', severity: 'warn',
    message: 'Purple/violet to blue/pink gradient, the default generated-UI look.',
    fix: 'Use a flat surface or a gradient within one palette family; derive color from the brand profile.',
    detect: [
      { scope: 'decl', check: (d, b, f, env) => {
        if (!/gradient\(/i.test(d.value)) return null;
        const fams = new Set(colorsIn(d.value).map((c) => c.fam));
        const hit = (fams.has('purple') && (fams.has('blue') || fams.has('pink'))) || (fams.has('blue') && fams.has('pink'));
        if (!hit || brandHasFamily(env.brand, 'purple')) return null;
        return d.valueIndex; } },
      { scope: 'class', skipAdapters: ['tailwind'], check: (s) => {
        if (!/(?<![\w-])bg-(?:gradient-to|linear-to|linear|radial|conic)/.test(s)) return null;
        const p = /(?<![\w-])(?:from|via|to)-(?:purple|violet|fuchsia)-\d/.exec(s);
        return p && /(?<![\w-])(?:from|via|to)-(?:blue|indigo|sky|cyan|pink|rose)-\d/.test(s) ? p.index : null; } },
    ] },
  { id: 'design/glow-shadow', severity: 'warn',
    message: 'Colored glow shadow (saturated color with a large blur).',
    fix: 'Use a neutral, low-alpha shadow for depth, or a border; never a neon glow.',
    detect: [
      { scope: 'decl', check: (d, b, f, env) => glowCheck(d, env) },
      { scope: 'class', re: /(?<![\w-])(?:[\w-]+:)*shadow-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?(?![\w-])/ },
    ] },
  { id: 'design/hover-scale', severity: 'warn',
    message: 'Hover scale above 1.02 (cards and buttons that grow on hover).',
    fix: 'Signal hover with color, border or a 1-2 px lift; keep scale at 1.02 or below.',
    detect: [
      { scope: 'block', check: (b, f, env) => {
        if (!/:hover/.test(b.chain)) return null;
        for (const d of b.decls) {
          const m = d.prop === 'transform' ? /scale(?:3d|x|y)?\(\s*([\d.]+)/i.exec(d.value) : d.prop === 'scale' ? /^([\d.]+)/.exec(d.value) : null;
          if (m && parseFloat(m[1]) > env.t.scaleMax) return d.index;
        }
        return null; } },
      { scope: 'class', re: /(?<![\w-])(?:group-)?hover:(?:[\w-]+:)*scale-(?:10[3-9]|1[1-9]\d|[2-9]\d\d|\[1\.(?:0[3-9]|[1-9])\d*\])(?![\w-])/ },
    ] },
  { id: 'design/infinite-animation', severity: 'warn',
    message: 'Infinite or attention-seeking animation on a non-loading element.',
    fix: 'Animate once on a state change, or only on loading indicators; respect prefers-reduced-motion.',
    detect: [
      { scope: 'decl', check: (d, b) => (/^animation(-iteration-count)?$/.test(d.prop) && /\binfinite\b/.test(d.value)
        && !LOADING_RE.test(b.chain) && !LOADING_RE.test(d.value)) ? d.index : null },
      { scope: 'class', re: /(?<![\w-])(?:[\w-]+:)*animate-(?:pulse|ping|bounce)(?![\w-])/, unless: (m, s) => LOADING_RE.test(s) },
    ] },
  { id: 'design/heavy-weight', severity: 'warn',
    message: 'Font weight 800/900 (extrabold/black).',
    fix: 'Use the weights defined in the brand profile; hierarchy usually needs size and spacing, not 900.',
    detect: [
      { scope: 'decl', check: (d, b) => (!/@font-face/.test(b.chain) && d.prop === 'font-weight'
        && /^(?:800|900|extra-?bold|black|heavy)$/i.test(d.value.trim())) ? d.valueIndex : null },
      { scope: 'class', re: /(?<![\w-])(?:[\w-]+:)*font-(?:extrabold|black|\[(?:800|900)\])(?![\w-])/ },
    ] },
  { id: 'design/uppercase-tracking', severity: 'warn',
    message: 'Uppercase text with wide letter-spacing (the generated "eyebrow" label).',
    fix: 'Use sentence case; if a label must be uppercase, keep tracking small and use it once per view.',
    detect: [
      { scope: 'block', check: (b, f, env) => {
        if (!b.decls.some((d) => d.prop === 'text-transform' && /uppercase/i.test(d.value))) return null;
        const ls = b.decls.find((d) => d.prop === 'letter-spacing');
        if (!ls) return null;
        const em = lenToEm(ls.value.trim());
        return em !== null && em >= env.t.trackingEm ? ls.index : null; } },
      { scope: 'class', skipAdapters: ['tailwind'], check: upperTrackingClass },
    ] },
  { id: 'design/negative-tracking-small', severity: 'warn',
    message: 'Negative letter-spacing on small or body text (heuristic).',
    fix: 'Tighten tracking only on large display sizes; keep body and UI text at normal tracking.',
    detect: [
      { scope: 'block', check: (b) => {
        const ls = b.decls.find((d) => d.prop === 'letter-spacing' && /^-\s*\d*\.?\d/.test(d.value.trim()));
        if (!ls) return null;
        const fs = b.decls.find((d) => d.prop === 'font-size');
        if (fs) return isSmallFontSize(fs.value) ? ls.index : null;
        const last = b.chain.split(/\s+/).pop() || '';
        return /\bh[1-3]\b|display|hero|title|headline|heading|jumbo|xxl|\bxl\b|big|large|lead/i.test(last) ? null : ls.index; } },
      { scope: 'class', check: (s) => {
        const m = /(?<![\w-])tracking-(?:tight|tighter|\[-[\d.]+\w*\])(?![\w-])/.exec(s);
        return m && /(?<![\w-])text-(?:xs|sm|base)(?![\w-])/.test(s) ? m.index : null; } },
    ] },
  { id: 'design/decorative-dashed-border', severity: 'info',
    message: 'Dotted or dashed border used as decoration.',
    fix: 'Reserve dashed borders for real states (drop zones, placeholders); use solid hairlines or spacing.',
    detect: [
      { scope: 'decl', check: (d) => /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-style)?$/.test(d.prop)
        && /\b(?:dotted|dashed)\b/.test(d.value) ? d.valueIndex : null },
      { scope: 'class', re: /(?<![\w-])(?:[\w-]+:)*border-(?:dashed|dotted)(?![\w-])/ },
    ] },

  // ---------------- css ----------------
  { id: 'css/transition-all', severity: 'warn',
    message: 'transition: all (or a transition without a property, which means all).',
    fix: 'Name the properties: transition: opacity 150ms ease-out, transform 150ms ease-out.',
    detect: [
      { scope: 'decl', check: (d) => {
        if (d.prop === 'transition-property') return /(^|,)\s*all\b/.test(d.value) ? d.valueIndex : null;
        if (d.prop !== 'transition') return null;
        return splitTop(d.value, ',').some((layer) => {
          const toks = splitTop(layer.trim(), ' ').filter(Boolean);
          if (toks[0] === 'all') return true;
          return toks.length > 0 && toks.some((t) => TIME_RE.test(t)) && toks.every((t) => TIME_RE.test(t) || EASING_RE.test(t));
        }) ? d.valueIndex : null; } },
      { scope: 'class', re: /(?<![\w-])(?:[\w-]+:)*transition-all(?![\w-])/ },
    ] },
  { id: 'css/animate-layout', severity: 'warn',
    message: 'Animating layout properties (width, height, top, left, ...).',
    fix: 'Animate transform and opacity; for size changes use transform: scale or grid-template-rows.',
    detect: [
      { scope: 'decl', check: (d, b) => {
        if (/^(?:transition|transition-property)$/.test(d.prop)) {
          return splitTop(d.value, ',').some((l) => LAYOUT_PROPS.test(splitTop(l.trim(), ' ')[0] || '')) ? d.valueIndex : null;
        }
        return b.ancestors.some((a) => /^@(?:-\w+-)?keyframes/.test(a)) && LAYOUT_PROPS.test(d.prop) ? d.index : null; } },
      { scope: 'class', re: /(?<![\w-])(?:[\w-]+:)*transition-\[(?:width|height|top|left|max-height)[^\]]*\](?![\w-])/ },
    ] },
  { id: 'css/important-overuse', severity: 'info',
    message: 'Many !important declarations in one file.',
    fix: 'Fix specificity at the source (layers, lower-specificity selectors) instead of stacking !important.',
    detect: [
      { scope: 'css', check: (f, env) => {
        const all = [...f.css.matchAll(/!\s*important\b/gi)];
        return all.length > env.t.important ? [{ index: all[0].index, message: `${all.length} !important declarations in this file.` }] : null; } },
    ] },
  { id: 'css/px-sprawl', severity: 'info',
    message: 'Many distinct one-off pixel values in one file.',
    fix: 'Map sizes to a spacing/type scale (tokens or rem steps) instead of hand-picked pixels.',
    detect: [
      { scope: 'file', check: (f, env) => {
        const seen = new Map();
        for (const b of f.blocks) for (const d of b.decls) for (const p of pxIn(d)) if (!seen.has(p.value)) seen.set(p.value, p.index);
        return seen.size > env.t.pxDistinct
          ? [{ index: [...seen.values()][0], message: `${seen.size} distinct px values in this file.` }] : null; } },
    ] },
  { id: 'css/arbitrary-px', severity: 'info',
    message: 'Arbitrary pixel value in a utility class (e.g. p-[13px]).',
    fix: 'Use the spacing/type scale; add a token if the value is a real, repeated need.',
    detect: [{ scope: 'class', skipAdapters: ['tailwind'], re: /(?<![\w-])(?:[\w-]+:)*-?[a-z][\w-]*-\[-?\d*\.?\d+px\](?![\w-])/ }] },

  // ---------------- copy ----------------
  { id: 'copy/hype-word', severity: 'error',
    message: 'Hype word.',
    fix: 'Say what the product does, concretely: the task, the number, the result.',
    detect: [
      { scope: 'text', re: (env) => env.lang === 'de' ? wordRe(LISTS.hypeDe) : wordRe(LISTS.hypeEn) },
    ] },
  { id: 'copy/soft-hype-word', severity: 'warn',
    message: 'Inflated word that usually hides a missing specific.',
    fix: 'Replace with the concrete claim (what changes, for whom, by how much) or delete.',
    detect: [
      { scope: 'text', re: (env) => env.lang === 'de' ? wordRe(LISTS.softHypeDe) : wordRe(LISTS.softHypeEn) },
    ] },
  { id: 'copy/ai-phrase', severity: 'warn',
    message: 'Stock phrase typical of generated copy.',
    fix: 'Start with the reader\'s situation or the concrete offer; cut the throat-clearing.',
    detect: [
      { scope: 'text', re: (env) => env.lang === 'de' ? wordRe(LISTS.aiPhraseDe) : wordRe(LISTS.aiPhraseEn) },
    ] },
  { id: 'copy/greeting-headline', severity: 'warn',
    message: 'Greeting as a headline ("Welcome back").',
    fix: 'Lead with the most useful information or the next action, not a greeting.',
    detect: [{ scope: 'text', ctx: ['heading', 'title'], re: wordRe(LISTS.greeting) }] },
  { id: 'copy/placeholder-content', severity: 'error',
    message: 'Placeholder content left in.',
    fix: 'Replace with real content from the brand profile or the user; never ship filler names or numbers.',
    detect: [
      { scope: 'text', notCtx: ['placeholder'], re: wordRe(LISTS.placeholder) },
      { scope: 'text', notCtx: ['placeholder'], re: /\[(?:X{1,3}|Y|N|Name|Company|Firma|Product|Produkt|Kunde|Client|City|Ort|Date|Datum|TBD|TODO|Insert[^\]\n]{0,30})\]/,
        unless: (m, s, i) => /(?:^|\n)\s*(?:[-*+]|\d+\.)\s*$/.test(s.slice(0, i)) },
      { scope: 'text', notCtx: ['placeholder'], re: /(?<![\d.,])123[.,]456(?!\d)|(?<![\w.-])[\w.-]+@example\.(?:com|org|net)\b/ },
    ] },
  { id: 'copy/unsourced-social-proof', severity: 'warn',
    message: 'Social proof claim without a visible source.',
    fix: 'Use only numbers listed in the brand profile facts, with source; otherwise remove the claim.',
    detect: [
      { scope: 'text', re: /\b(?:trusted|loved|used|chosen|relied on)\s+by\s+(?:over\s+|more than\s+)?\d[\d.,]*\s*[kKmM]?\+?/i },
      { scope: 'text', re: /\bjoin\s+(?:over\s+|more than\s+)?\d[\d.,]*\s*[kKmM]?\+?\s+\p{L}+/iu },
      { scope: 'text', re: /\d[\d.,]*\s*[kKmM]?\+\s+(?:happy\s+|satisfied\s+)?(?:customers|users|teams|companies|clients|kunden|nutzer)/i },
      { scope: 'text', re: /(?<![\p{L}])(?:über|mehr als|bereits)\s+\d[\d.,]*\+?\s+(?:zufriedene[n]?\s+|glückliche[n]?\s+)?(?:kunden|kund\p{L}*|nutzer\p{L}*|unternehmen|firmen|teams|mandanten)(?![\p{L}])/iu },
      { scope: 'text', re: /\b(?:5|five)[- ]stars?\b|★{4,}|⭐{3,}|\b5\s?\/\s?5\b|\b(?:5|fünf)\s+sterne/i },
    ] },
  { id: 'copy/emoji-in-ui', severity: 'warn',
    message: 'Emoji in a heading, button, link or label.',
    fix: 'Remove the emoji; use an icon from the project icon set if the element needs one.',
    detect: [{ scope: 'text', ctx: ['heading', 'button', 'link', 'label'], re: /(?![©®™\u2194-\u2199\u21A9\u21AA\u2122\u2139\u3030\u303D\u3297\u3299])\p{Extended_Pictographic}/u }] },
  { id: 'copy/sparkle-emoji', severity: 'warn',
    message: 'Sparkle emoji (✨), the signature of generated copy.',
    fix: 'Delete it.',
    detect: [{ scope: 'text', notCtx: ['heading', 'button', 'link', 'label'], re: /✨/u }] },
  { id: 'copy/exclamation', severity: 'warn',
    message: 'Exclamation mark in a heading or button.',
    fix: 'End with a period or nothing; let the content carry the energy.',
    detect: [{ scope: 'text', ctx: ['heading', 'button'], re: /!(?![=\w])/ }] },
  { id: 'copy/button-period', severity: 'warn',
    message: 'Button text ends with a period.',
    fix: 'Write button labels as verbs without end punctuation ("Send request").',
    detect: [{ scope: 'text', ctx: ['button'], re: /(?<![.…])\.\s*$/ }] },
  { id: 'copy/change-without-reference', severity: 'info',
    message: 'Percentage change without a reference ("+12%" compared to what?).',
    fix: 'Add the baseline and period ("+12% vs. Q1 2025") or drop the number.',
    detect: [{ scope: 'text', re: /(?<![\w.,])[+±\u2212-]\s?\d+(?:[.,]\d+)?\s?%/u,
      unless: (m, s, i) => /\b(?:vs\.?|versus|ggü\.?|gegenüber|compared|im vergleich|than|als|yoy|year[- ]over[- ]year|vorjahr|since|seit)/i.test(s.slice(i + m[0].length, i + m[0].length + 25)) }] },
  { id: 'copy/de-straight-quotes', severity: 'info', needs: 'lang de', when: (env) => env.lang === 'de', mentionsOk: true,
    message: 'Straight quotes in German prose.',
    fix: 'Use German quotation marks: „…“ (or »…« if the brand uses them).',
    detect: [{ scope: 'text', notCtx: ['attr'], re: /"[^"\n<>{}=]{2,120}"/ }] },

  // ---------------- brand (need --brand) ----------------
  { id: 'brand/banned-word', severity: 'error', when: (env) => !!env.brandRe.words,
    message: 'Word banned by the brand profile.', fix: 'Rephrase without it (see banned_words in the brand profile).',
    detect: [{ scope: 'text', re: (env) => env.brandRe.words }] },
  { id: 'brand/banned-phrase', severity: 'error', when: (env) => !!env.brandRe.phrases,
    message: 'Phrase banned by the brand profile.', fix: 'Rephrase (see banned_phrases in the brand profile).',
    detect: [{ scope: 'text', re: (env) => env.brandRe.phrases }] },
  { id: 'brand/claim-never', severity: 'error', when: (env) => !!env.brandRe.claims,
    message: 'Claim the brand never makes.', fix: 'Remove it; only state facts listed in the brand profile.',
    detect: [{ scope: 'text', re: (env) => env.brandRe.claims }] },
  { id: 'brand/address-du', severity: 'error', needs: 'brand + lang de', when: (env) => env.lang === 'de' && env.brand?.address === 'sie',
    message: 'du-address, but the brand profile says address: Sie.', fix: 'Address the reader with Sie/Ihnen/Ihr.',
    detect: [{ scope: 'text', notCtx: ['placeholder'], re: new RegExp(`(?<!${WB})(?:[Dd]u|[Dd]ich|[Dd]ir|[Dd]ein(?:e|en|em|er|es)?|[Ee]uch|[Ee]uer|[Ee]ure[mnrs]?)(?!${WB})`, 'u') }] },
  { id: 'brand/address-sie', severity: 'warn', needs: 'brand + lang de', when: (env) => env.lang === 'de' && env.brand?.address === 'du',
    message: 'Sie-address, but the brand profile says address: du.', fix: 'Address the reader with du/dich/dein.',
    detect: [{ scope: 'text', re: new RegExp(`(?<![.!?:»"„“]\\s{0,3})(?<!^\\s{0,3})(?:Sie|Ihnen|Ihre[mnrs]?)(?!${WB})`, 'u') }] },
  { id: 'brand/gendering', severity: 'error', when: (env) => env.brand?.gendering === 'none',
    message: 'Gender form (:innen, *innen, _innen, Innen), but the brand profile says gendering: none.',
    fix: 'Use the forms the brand profile specifies.',
    detect: [{ scope: 'text', re: /\p{L}+(?:[:*_\/·]innen|(?<=\p{Ll})Innen)(?!\p{L})/u }] },
  { id: 'brand/off-palette-color', severity: 'warn', when: (env) => env.palette.length > 0,
    message: 'Color not in the brand palette.', fix: 'Use a palette color or its token (see colors in the brand profile).',
    detect: [
      { scope: 'decl', check: (d, b, f, env) => d.prop.startsWith('$') ? null : hexIn(d.value)
        .filter((h) => !inPalette(h.hex, env.palette)).map((h) => ({ index: d.valueIndex + h.index, message: `Color ${h.hex} is not in the brand palette.` })) },
      { scope: 'class', check: (s, env) => [...s.matchAll(/\[(#[0-9a-f]{3,8})\]/gi)]
        .filter((m) => !inPalette(m[1], env.palette)).map((m) => ({ index: m.index + 1, message: `Color ${m[1]} is not in the brand palette.` })) },
    ] },
  { id: 'brand/off-brand-font', severity: 'warn', when: (env) => env.fonts.length > 0,
    message: 'Font family not listed in the brand profile.', fix: 'Use a family from fonts in the brand profile.',
    detect: [{ scope: 'decl', check: (d, b, f, env) => {
      if (d.prop !== 'font-family') return null;
      const first = splitTop(d.value, ',')[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase();
      if (!first || /^(?:var\(|inherit|initial|unset|revert|system-ui|sans-serif|serif|monospace|cursive|ui-|-apple-system|blinkmacsystemfont)/.test(first)) return null;
      return env.fonts.includes(first) ? null : { index: d.valueIndex, message: `Font "${first}" is not in the brand profile.` }; } }] },
  { id: 'brand/motion-none', severity: 'warn', when: (env) => env.brand?.motion === 'none',
    message: 'Animation, but the brand profile says motion: none.', fix: 'Remove the animation; show state changes instantly.',
    detect: [
      { scope: 'css', re: /@(?:-\w+-)?keyframes\b|(?<![\w-])animation(?:-name)?\s*:/ },
      { scope: 'class', re: /(?<![\w-])(?:[\w-]+:)*animate-(?!none\b)[\w-]+/ },
    ] },

  // ---------------- a11y ----------------
  { id: 'a11y/outline-none', severity: 'error',
    message: 'Focus outline removed without a replacement focus style.',
    fix: 'Keep the outline or add :focus-visible { outline: 2px solid <token>; outline-offset: 2px }.',
    detect: [
      { scope: 'block', check: (b, f) => {
        const d = b.decls.find((x) => /^outline(-style)?$/.test(x.prop) && /^(?:none|0)\b/.test(x.value.trim()));
        if (!d) return null;
        if (b.decls.some((x) => /^(?:box-shadow|border(?:-color|-bottom)?|text-decoration)$/.test(x.prop))) return null;
        return FOCUS_REPLACEMENT_RE.test(f.css) ? null : d.index; } },
      { scope: 'class', check: (s) => {
        const m = /(?<![\w-])(?:focus:)?outline-(?:none|hidden)(?![\w-])/.exec(s);
        return m && !/(?:focus|focus-visible|focus-within):(?:[\w-]+:)*(?:ring|outline|border|shadow)/.test(s) ? m.index : null; } },
    ] },
  { id: 'a11y/zoom-disabled', severity: 'error',
    message: 'Pinch zoom disabled (user-scalable=no / maximum-scale=1).',
    fix: 'Use <meta name="viewport" content="width=device-width, initial-scale=1">.',
    detect: [{ scope: 'raw', re: /user-scalable\s*=\s*(?:no|0)\b|maximum-scale\s*=\s*1(?:\.0+)?(?![\d.])/i }] },
  { id: 'a11y/img-alt', severity: 'error',
    message: 'Image without alt text.',
    fix: 'Add alt describing the content, or alt="" if purely decorative.',
    detect: [{ scope: 'markup', check: (f) => f.marks.imgNoAlt }] },
  { id: 'a11y/vague-link-text', severity: 'warn',
    message: 'Vague link text ("Click here", "Hier klicken").',
    fix: 'Make the link text name the destination ("Download the price list").',
    detect: [
      { scope: 'text', re: /\b(?:click here|klicken sie hier|hier klicken)\b/i },
      { scope: 'text', ctx: ['link'], re: /^\s*(?:here|hier|click|klick)\s*[.:]?\s*$/i },
    ] },

  // ---------------- adapter: acss ----------------
  { id: 'acss/raw-px', severity: 'warn', adapter: 'acss',
    message: 'Raw px value in an ACSS project.',
    fix: 'Use an ACSS token (spacing/text/radius variable) or wrap one-offs in to-rem().',
    detect: [{ scope: 'decl', check: (d) => { const p = pxIn(d); return p.length ? { index: p[0].index, message: `Raw px value ${p[0].value}px.` } : null; } }] },
  { id: 'acss/hardcoded-hex', severity: 'warn', adapter: 'acss',
    message: 'Hardcoded hex color in component CSS.',
    fix: 'Use the ACSS color tokens of the project palette instead of hex values.',
    detect: [{ scope: 'decl', check: (d) => /^(?:--|\$)/.test(d.prop) ? null : hexIn(d.value).map((h) => d.valueIndex + h.index) }] },
  { id: 'acss/bg-var-in-class', severity: 'warn', adapter: 'acss',
    message: 'background: var(--bg-…) inside an own class.',
    fix: 'Put the bg--* utility class on the element so ACSS color relationships (text, links, buttons) follow.',
    detect: [{ scope: 'decl', check: (d) => /^background(?:-color)?$/.test(d.prop) && /^var\(\s*--bg-/.test(d.value.trim()) ? d.valueIndex : null }] },
  { id: 'acss/max-width-media', severity: 'info', adapter: 'acss',
    message: 'max-width media query (desktop-first).',
    fix: 'Write mobile-first: base styles stacked, then @media (width >= to-rem(…)).',
    detect: [{ scope: 'css', re: /@media[^{;]*\bmax-width\b/ }] },

  // ---------------- adapter: tailwind ----------------
  { id: 'tailwind/purple-gradient', severity: 'warn', adapter: 'tailwind',
    message: 'Gradient utility with purple/violet/fuchsia/indigo stops.',
    fix: 'Use a flat brand color or a gradient within one brand family defined in the theme.',
    detect: [{ scope: 'class', check: (s) => {
      if (!/(?<![\w-])bg-(?:gradient-to|linear-to|linear|radial|conic)/.test(s)) return null;
      const m = /(?<![\w-])(?:from|via|to)-(?:purple|violet|fuchsia|indigo)-\d/.exec(s);
      return m ? m.index : null; } }] },
  { id: 'tailwind/rounded-overuse', severity: 'info', adapter: 'tailwind',
    message: 'rounded-2xl/rounded-3xl used everywhere.',
    fix: 'Define one radius scale in the theme and vary it by element size.',
    detect: [{ scope: 'file', check: (f, env) => {
      const hits = [];
      for (const s of f.classSegs) for (const m of s.text.matchAll(/(?<![\w-])(?:[\w-]+:)*rounded-(?:2xl|3xl)(?![\w-])/g)) hits.push(s.start + m.index);
      return hits.length > env.t.rounded ? [{ index: hits[0], message: `rounded-2xl/3xl used ${hits.length} times in this file.` }] : null; } }] },
  { id: 'tailwind/shadow-2xl', severity: 'info', adapter: 'tailwind',
    message: 'shadow-2xl (heavy floating-card shadow).',
    fix: 'Use a small neutral shadow or a border; reserve large shadows for overlays.',
    detect: [{ scope: 'class', re: /(?<![\w-])(?:[\w-]+:)*shadow-2xl(?![\w-])/ }] },
  { id: 'tailwind/arbitrary-value', severity: 'warn', adapter: 'tailwind',
    message: 'Arbitrary px value in a utility (e.g. p-[13px]).',
    fix: 'Use the theme scale; extend the theme if the value is a real, repeated need.',
    detect: [{ scope: 'class', re: /(?<![\w-])(?:[\w-]+:)*-?[a-z][\w-]*-\[-?\d*\.?\d+px\](?![\w-])/ }] },
  { id: 'tailwind/uppercase-tracking', severity: 'warn', adapter: 'tailwind',
    message: 'uppercase combined with tracking-wide*.',
    fix: 'Use sentence case; if uppercase is required, drop the wide tracking.',
    detect: [{ scope: 'class', check: upperTrackingClass }] },
];

// Meta findings emitted by the engine itself.
const META_RULES = {
  'file/minified-skipped': { severity: 'info', message: 'Minified or generated file skipped (most lines > 2000 chars).', fix: 'Lint the source file instead.' },
  'file/read-error': { severity: 'info', message: 'File could not be read.', fix: 'Check permissions and encoding.' },
};

// ---------------------------------------------------------------------------
// Constants used by detectors
// ---------------------------------------------------------------------------
const LOADING_RE = /load|spin|skeleton|progress|busy|pending|shimmer|placeholder/i;
const TIME_RE = /^-?\d*\.?\d+m?s$/;
const EASING_RE = /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|cubic-bezier\(.*\)|steps\(.*\)|linear\(.*\))$/;
const LAYOUT_PROPS = /^(?:width|height|max-height|min-height|max-width|min-width|top|left|right|bottom|inset)$/;
const FOCUS_REPLACEMENT_RE = /:focus(?:-visible|-within)?[^{}]*\{[^}]*(?:outline(?:-style|-color|-width)?\s*:(?!\s*(?:none|0)\b)[^;}]+|box-shadow\s*:)/i;
const EXT_KIND = {
  css: 'css', scss: 'css', less: 'css',
  html: 'markup', htm: 'markup', vue: 'markup', svelte: 'markup', php: 'markup',
  js: 'script', jsx: 'script', ts: 'script', tsx: 'script', mjs: 'script', cjs: 'script',
  md: 'md', mdx: 'md', json: 'json', txt: 'txt',
};
const DEFAULT_EXTS = new Set(['html', 'htm', 'css', 'scss', 'js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'php', 'md', 'mdx', 'json', 'txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.next', '.nuxt', '.svelte-kit', 'coverage', '.cache', 'website-builder']); // website-builder/: toolkit data (profile, audits quoting tells)
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', '.slop-lint.json']);
const SEV_RANK = { info: 1, warn: 2, error: 3 };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function wordRe(list, flags = 'iu') {
  const parts = (list || []).filter(Boolean);
  return parts.length ? new RegExp(`(?<!${WB})(?:${parts.join('|')})(?!${WB})`, flags) : null;
}
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function phraseRe(list) {
  return wordRe((list || []).map((p) => String(p).trim()).filter(Boolean).map((p) => esc(p).replace(/\s+/g, '\\s+')));
}
function blank(s) { return s.replace(/[^\n]/g, ' '); }
function maskRe(s, re) { return s.replace(re, (m) => blank(m)); }
function globalize(re) { return re.flags.includes('g') ? new RegExp(re.source, re.flags) : new RegExp(re.source, re.flags + 'g'); }
function* matchAll(re, s) {
  const g = globalize(re);
  let m;
  while ((m = g.exec(s))) { yield m; if (m[0] === '') g.lastIndex++; }
}
function splitTop(s, sep) {
  const out = []; let depth = 0, q = null, cur = '';
  for (const ch of s) {
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return sep === ' ' ? out.filter((x) => x !== '') : out;
}
function lenToEm(v) {
  const m = /^(-?\d*\.?\d+)(em|rem|px)?$/.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'px' ? n / 16 : m[2] ? n : (n === 0 ? 0 : null);
}
function isSmallFontSize(v) {
  v = v.trim().toLowerCase();
  const m = /^(\d*\.?\d+)(px|rem|em)$/.exec(v);
  if (m) return m[2] === 'px' ? parseFloat(m[1]) <= 20 : parseFloat(m[1]) <= 1.25;
  return /^(?:small|smaller|x-small|xx-small|medium)$/.test(v) || /var\(\s*--(?:text|font-size|fs)-(?:xs|s|m|sm|base|small|body)\b/.test(v);
}
function pxIn(d) {
  const out = [];
  for (const m of matchAll(/(?<![\w.#-])(-?\d*\.?\d+)px\b/, d.value)) {
    const n = Math.abs(parseFloat(m[1]));
    if (n <= 1) continue;
    const before = d.value.slice(0, m.index);
    const open = before.lastIndexOf('to-rem(');
    if (open !== -1 && before.indexOf(')', open) === -1) continue;
    out.push({ value: m[1], index: d.valueIndex + m.index });
  }
  return out;
}
function hexIn(v) {
  return [...v.matchAll(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/gi)].map((m) => ({ hex: m[0], index: m.index }));
}
function upperTrackingClass(s) {
  const m = /(?<![\w-])(?:[\w-]+:)*uppercase(?![\w-])/.exec(s);
  return m && /(?<![\w-])(?:[\w-]+:)*tracking-(?:wide|wider|widest|\[0?\.\d+(?:em|rem)\]|\[\d+px\])(?![\w-])/.test(s) ? m.index : null;
}

// ---- color ----
const NAMED_COLORS = {
  purple: '#800080', violet: '#ee82ee', indigo: '#4b0082', fuchsia: '#ff00ff', magenta: '#ff00ff', blueviolet: '#8a2be2',
  mediumpurple: '#9370db', darkviolet: '#9400d3', rebeccapurple: '#663399', blue: '#0000ff', royalblue: '#4169e1',
  dodgerblue: '#1e90ff', deepskyblue: '#00bfff', cyan: '#00ffff', aqua: '#00ffff', pink: '#ffc0cb', hotpink: '#ff69b4',
  deeppink: '#ff1493', red: '#ff0000', orange: '#ffa500', yellow: '#ffff00', green: '#008000', lime: '#00ff00', teal: '#008080',
};
const COLOR_TOKEN_RE = new RegExp(`#[0-9a-f]{3,8}(?![0-9a-z])|(?:rgba?|hsla?|oklch)\\([^()]*\\)|\\b(?:${Object.keys(NAMED_COLORS).join('|')})\\b`, 'gi');
function hexToRgb(hex) {
  let h = hex.replace('#', '').toLowerCase();
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}
function num(v, scale = 1) { return v.endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v); }
function hslFam(h, s, l) {
  if (s < 0.15 || l < 0.1 || l > 0.94) return 'neutral';
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 250) return 'blue';
  if (h < 295) return 'purple';
  return 'pink';
}
// Returns { fam, sat (0..1), a } or null.
function parseColor(tok) {
  const t = tok.trim().toLowerCase();
  let rgb = null;
  if (t.startsWith('#')) rgb = hexToRgb(t);
  else if (NAMED_COLORS[t]) rgb = hexToRgb(NAMED_COLORS[t]);
  else if (t.startsWith('rgb')) {
    const p = t.slice(t.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean);
    if (p.length >= 3) rgb = { r: num(p[0], 255), g: num(p[1], 255), b: num(p[2], 255), a: p[3] ? num(p[3]) : 1 };
  } else if (t.startsWith('hsl')) {
    const p = t.slice(t.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean);
    if (p.length >= 3) { const s = num(p[1]) / (p[1].endsWith('%') ? 1 : 100), l = num(p[2]) / (p[2].endsWith('%') ? 1 : 100);
      return { fam: hslFam(parseFloat(p[0]) % 360, s, l), sat: s, a: p[3] ? num(p[3]) : 1 }; }
  } else if (t.startsWith('oklch')) {
    const p = t.slice(t.indexOf('(') + 1, -1).split(/[\s/]+/).filter(Boolean);
    if (p.length >= 3) {
      const L = num(p[0]), C = parseFloat(p[1]), H = parseFloat(p[2]);
      let fam = 'neutral';
      if (C >= 0.03 && L > 0.1 && L < 0.97) {
        fam = H < 20 || H >= 345 ? 'pink' : H < 50 ? 'red' : H < 85 ? 'orange' : H < 115 ? 'yellow' : H < 175 ? 'green'
          : H < 225 ? 'cyan' : H < 280 ? 'blue' : H < 320 ? 'purple' : 'pink';
      }
      return { fam, sat: Math.min(1, C / 0.2), a: p[3] ? num(p[3]) : 1 };
    }
  }
  if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const dlt = max - min;
    s = l > 0.5 ? dlt / (2 - max - min) : dlt / (max + min);
    h = max === r ? (g - b) / dlt + (g < b ? 6 : 0) : max === g ? (b - r) / dlt + 2 : (r - g) / dlt + 4;
    h *= 60;
  }
  return { fam: hslFam(h, s, l), sat: s, a: rgb.a };
}
function colorsIn(v) { return [...v.matchAll(COLOR_TOKEN_RE)].map((m) => parseColor(m[0])).filter(Boolean); }
function glowCheck(d, env) {
  let layers = [];
  if (d.prop === 'box-shadow' || d.prop === 'text-shadow') layers = splitTop(d.value, ',');
  for (const m of d.value.matchAll(/drop-shadow\(((?:[^()]|\([^()]*\))*)\)/g)) layers.push(m[1]);
  for (const layer of layers) {
    const cols = [...layer.matchAll(COLOR_TOKEN_RE)];
    if (!cols.length) continue;
    const c = parseColor(cols[0][0]);
    if (!c || c.fam === 'neutral' || c.sat < 0.4 || c.a < 0.2) continue;
    const lens = layer.replace(COLOR_TOKEN_RE, ' ').split(/\s+/).filter((t) => /^-?\d*\.?\d+(px|rem|em)?$/.test(t))
      .map((t) => { const e = lenToEm(t); return e === null ? 0 : e * 16; });
    if ((lens[2] || 0) >= env.t.glowBlurPx) return d.valueIndex;
  }
  return null;
}
function normHex(h) { const c = hexToRgb(h); return c ? c : null; }
function inPalette(hex, palette) {
  const c = normHex(hex);
  if (!c) return true;
  const pc = parseColor(hex);
  if (pc && (pc.fam === 'neutral' || pc.sat < 0.12)) return true; // near-neutrals are allowed
  return palette.some((p) => Math.abs(p.r - c.r) <= 4 && Math.abs(p.g - c.g) <= 4 && Math.abs(p.b - c.b) <= 4);
}
function brandHasFamily(brand, fam) {
  return !!brand && (brand._hex || []).some((h) => parseColor(h)?.fam === fam);
}

// ---------------------------------------------------------------------------
// Minimal YAML subset parser (front matter): maps, lists, inline [..] and {..}, scalars
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
function loadBrand(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  const y = parseYaml(m ? m[1] : src) || {};
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => x !== null && x !== '').map(String);
  const str = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v && typeof v === 'object' ? str(v.stance || v.value || v.form) : '');
  const hexes = [];
  (function walk(v) {
    if (typeof v === 'string') { if (/^#[0-9a-f]{3,8}$/i.test(v.trim())) hexes.push(v.trim()); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  })(y.colors);
  const fonts = (Array.isArray(y.fonts) ? y.fonts : y.fonts ? [y.fonts] : [])
    .map((f) => (typeof f === 'string' ? f : f && (f.family || f.name)) || '')
    .map((f) => String(f).split(/[(,]/)[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase()).filter(Boolean);
  return {
    name: y.name || '',
    address: str(y.address ?? y.voice?.address),
    gendering: str(y.gendering ?? y.voice?.gendering),
    motion: str(y.motion),
    banned_words: list(y.banned_words),
    banned_phrases: list(y.banned_phrases),
    claims_never: list(y.claims_never),
    register: str(y.register),
    address_overrides: (Array.isArray(y.address_overrides) ? y.address_overrides : [])
      .filter((o) => o && o.path && o.address)
      .map((o) => ({ path: String(o.path), address: str(o.address), re: globToRe(String(o.path)) })),
    fonts,
    _hex: hexes,
  };
}

// ---------------------------------------------------------------------------
// File model: CSS view, CSS blocks/declarations, class segments, text segments
// ---------------------------------------------------------------------------
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'use', 'stop']);
const RAW_TAGS = new Set(['script', 'style', 'pre', 'code', 'textarea', 'noscript', 'kbd', 'samp']);
const ATTR_SRC = String.raw`(?:\s+[^\s"'<>\/={}]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}|[^\s"'=<>\x60]+))?|\s+\{(?:[^{}]|\{[^{}]*\})*\})*`;
const TAG_RE = new RegExp(String.raw`<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w.:-]*)(` + ATTR_SRC + String.raw`)\s*(\/?)>`, 'g');
const ATTR_RE = /([^\s"'<>\/={}]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})|([^\s"'=<>`]+)))?/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b[\w.-]+\.(?:com|de|org|net|io|dev)\/[^\s<>"')\]]*/g;
const CODEISH_RE = /[;=]|=>|&&|\|\||^\s*[.)(]|\(\s*$|\b(?:return|const|let|var|import|export|function|async|await)\b/;

// Project data folder written by site-wizard: <project>/website-builder/{setup.md,brand.md}
function findProjectData(start) {
  let dir = path.resolve(start);
  for (;;) {
    const cand = path.join(dir, 'website-builder');
    if (fs.existsSync(path.join(cand, 'setup.md')) || fs.existsSync(path.join(cand, 'brand.md'))) return cand;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
function loadSetup(dataDir) {
  const f = dataDir && path.join(dataDir, 'setup.md');
  if (!f || !fs.existsSync(f)) return {};
  const src = fs.readFileSync(f, 'utf8');
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  return (m && parseYaml(m[1])) || {};
}

function createFile(rel, raw, kind, ext) {
  return { rel, raw, kind, ext, cssRanges: [], inline: [], classSegs: [], textSegs: [], marks: { imgNoAlt: [] }, htmlLang: null };
}
function lineInfo(raw) {
  const starts = [0];
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) starts.push(i + 1);
  return (idx) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: idx - starts[lo] + 1 };
  };
}
function pushText(f, start, text, ctx) {
  const masked = maskRe(maskRe(text, URL_RE), /\{\{[\s\S]*?\}\}/g);
  if (/\p{L}/u.test(masked)) f.textSegs.push({ start, text: masked, ctx: new Set(ctx) });
}
function maskBraces(s) {
  let out = '', depth = 0;
  for (const ch of s) {
    if (ch === '{') depth++;
    out += depth > 0 && ch !== '\n' ? ' ' : ch;
    if (ch === '}' && depth > 0) depth--;
  }
  return out;
}

function analyzeMarkup(f, work, from, to, jsx) {
  const stack = [];
  let last = from;
  const re = new RegExp(TAG_RE.source, 'g');
  re.lastIndex = from;
  const handleText = (start, text) => {
    if (!text.trim()) return;
    if (jsx && !stack.length) return;
    let t = maskBraces(text);
    if (jsx && CODEISH_RE.test(t)) return;
    const ctx = new Set();
    for (const e of stack) for (const c of e.ctx) ctx.add(c);
    pushText(f, start, t, ctx);
  };
  let m;
  while ((m = re.exec(work)) && m.index < to) {
    handleText(last, work.slice(last, m.index));
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const closing = m[1] === '/', name = m[2].toLowerCase(), attrs = m[3] || '', self = m[4] === '/';
    if (closing) {
      const k = stack.map((e) => e.name).lastIndexOf(name);
      if (k !== -1) stack.length = k;
      continue;
    }
    const attrBase = m.index + 1 + m[2].length;
    const ctx = processAttrs(f, name, attrs, attrBase, m.index, jsx);
    if (RAW_TAGS.has(name) && !self) {
      const close = new RegExp(`</${name}\\s*>`, 'ig');
      close.lastIndex = re.lastIndex;
      const cm = close.exec(work);
      const end = cm && cm.index < to ? cm.index : to;
      if (name === 'style') f.cssRanges.push([re.lastIndex, end]);
      last = cm && cm.index < to ? cm.index + cm[0].length : to;
      re.lastIndex = last;
      continue;
    }
    if (!self && !VOID_TAGS.has(name)) stack.push({ name, ctx });
  }
  handleText(last, work.slice(last, to));
}

function processAttrs(f, name, attrs, base, tagIndex, jsx) {
  const found = {};
  for (const a of attrs.matchAll(ATTR_RE)) {
    const key = a[1].toLowerCase();
    const val = a[2] ?? a[3] ?? a[4] ?? a[5];
    const vStart = val === undefined ? -1 : base + a.index + a[0].length - val.length - (a[2] !== undefined || a[3] !== undefined ? 1 : 0);
    found[key] = val === undefined ? '' : val;
    if (val === undefined) continue;
    if (/^(?:class|classname|:class|v-bind:class|class:list|ngclass|\[ngclass\])$/.test(key)) f.classSegs.push({ start: vStart, text: val });
    else if (key === 'style' && a[4] === undefined) f.inline.push({ start: vStart, text: val });
    else if (/^(?:alt|title|aria-label)$/.test(key) && a[4] === undefined) pushText(f, vStart, val, ['attr']);
    else if (key === 'placeholder' && a[4] === undefined) pushText(f, vStart, val, ['attr', 'placeholder']);
  }
  if (name === 'img' && !('alt' in found) && !/\{\s*\.\.\./.test(attrs)) f.marks.imgNoAlt.push(tagIndex);
  if (name === 'html' && found.lang) f.htmlLang = found.lang.toLowerCase().slice(0, 2);
  if (name === 'meta' && /description|og:title|og:description/i.test(found.name || found.property || '') && found.content) {
    const i = attrs.indexOf(found.content);
    if (i !== -1) pushText(f, base + i, found.content, ['attr']);
  }
  if (name === 'input' && /^(?:submit|button)$/i.test(found.type || '') && found.value) {
    const i = attrs.indexOf(found.value);
    if (i !== -1) pushText(f, base + i, found.value, ['button']);
  }
  const ctx = [];
  const cls = found.class ?? found.classname ?? '';
  if (/^h[1-6]$/.test(name) || found.role === 'heading') ctx.push('heading');
  // Class-based detection only for elements that can act as a control, and only for a whole class token
  // ("btn", "button--primary", "cta"), never for "cta-heading" or "button-group".
  const textBlock = /^(h[1-6]|p|li|figcaption|blockquote|label|span)$/.test(name);
  const btnClass = /^(a|input)$/.test(name) && cls.split(/\s+/).some((t) => /^(?:[\w-]*(?:__|-))?(?:btn|button|cta)(?:--[\w-]+)?$/i.test(t));
  if (name === 'button' || name === 'summary' || found.role === 'button' || (!textBlock && btnClass)) ctx.push('button');
  if (name === 'a') ctx.push('link');
  if (/^(?:label|th|legend)$/.test(name)) ctx.push('label');
  if (name === 'title') ctx.push('title');
  return ctx;
}

function analyzeMarkdown(f, mdCode) {
  const raw = f.raw;
  const work = maskRe(raw, /<!--[\s\S]*?-->/g).replace(/\r/g, ' ');
  const lines = work.split('\n');
  let off = 0, i = 0;
  if (/^\uFEFF?---\s*$/.test(lines[0] || '')) {
    let j = 1;
    while (j < lines.length && !/^---\s*$/.test(lines[j])) j++;
    for (let k = 0; k <= Math.min(j, lines.length - 1); k++) off += lines[k].length + 1;
    i = j + 1;
  }
  let para = null, fence = null, prevBlank = true;
  const flush = () => { if (para) { pushText(f, para.start, para.parts.join('\n'), []); para = null; } };
  for (; i < lines.length; i++) {
    const l = lines[i], lineStart = off;
    off += l.length + 1;
    const fm = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/.exec(l);
    if (fence) {
      if (fm && fm[1][0] === fence.marker[0] && fm[1].length >= fence.marker.length && !fm[2]) {
        if (!mdCode) { /* fenced code is usually an example; lint it only with --md-code */ }
        else if (/^(?:css|scss|less)$/.test(fence.lang)) f.cssRanges.push([fence.start, lineStart]);
        else if (/^(?:html|htm|vue|svelte|jsx|tsx|xml)$/.test(fence.lang)) analyzeMarkup(f, work, fence.start, lineStart, /sx$/.test(fence.lang));
        fence = null;
      }
      continue;
    }
    if (fm) { flush(); fence = { marker: fm[1], lang: fm[2].toLowerCase(), start: off }; continue; }
    if (!l.trim()) { flush(); prevBlank = true; continue; }
    if (!para && prevBlank && /^(?: {4}|\t)/.test(l) && !/^\s*(?:[-*+]|\d+\.)\s/.test(l)) { prevBlank = false; continue; }
    prevBlank = false;
    if (/^\s*\[[^\]]+\]:\s*\S+/.test(l) || /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && /-{3,}/.test(l)) {
      if (para) para.parts.push(blank(l)); // keep offsets aligned inside the paragraph
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+/.exec(l);
    const ml = mdMaskLine(f, l, lineStart, heading ? ['heading'] : []);
    if (heading) { flush(); pushText(f, lineStart, ' '.repeat(heading[0].length) + ml.slice(heading[0].length), ['heading']); continue; }
    if (!para) para = { start: lineStart, parts: [] };
    para.parts.push(ml.replace(/^(\s*)>/, '$1 '));
  }
  flush();
}
function mdMaskLine(f, l, lineStart, extraCtx) {
  let s = maskRe(l, /(`+)[^`]*?\1/g);
  s = s.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (m, alt, src, idx) => {
    if (!alt.trim()) f.marks.imgNoAlt.push(lineStart + idx);
    else pushText(f, lineStart + idx + 2, alt, ['attr']);
    return blank(m);
  });
  s = s.replace(/\[([^\]\n]+)\](?:\(([^)]*)\)|\[[^\]]*\])/g, (m, text, dest, idx) => {
    pushText(f, lineStart + idx + 1, text, ['link', ...extraCtx]);
    return blank(m);
  });
  s = s.replace(/<img\b[^>]*>/gi, (m, idx) => { if (!/\balt\s*=/.test(m)) f.marks.imgNoAlt.push(lineStart + idx); return blank(m); });
  s = maskRe(s, /<\/?[A-Za-z][^>]*>/g);
  return maskRe(s, URL_RE);
}
function analyzeJson(f) {
  const keyRe = /(?:title|heading|headline|label|text|button|cta|description|subtitle|subheading|caption|tagline|body|content|message|summary|copy|intro|teaser|eyebrow)$/i;
  for (const m of f.raw.matchAll(/"([^"\\]*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const key = m[1];
    if (!keyRe.test(key) || !/\p{L}{2,}\s/u.test(m[2])) continue;
    const ctx = /(?:^|[^b])title$|heading$|headline$/i.test(key) && !/sub/i.test(key) ? ['heading']
      : /button|cta/i.test(key) ? ['button'] : /label$/i.test(key) ? ['label'] : [];
    pushText(f, m.index + m[0].length - m[2].length - 1, m[2], ctx);
  }
}
function analyzeTxt(f) {
  let start = 0;
  for (const part of f.raw.split(/\n\s*\n/)) {
    pushText(f, start, part, []);
    start += part.length;
    const sep = /\n\s*\n/.exec(f.raw.slice(start));
    start += sep ? sep[0].length : 0;
  }
}

function buildCssView(f) {
  const ranges = f.cssRanges.slice().sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [a, b] of ranges) {
    if (b <= pos) continue;
    const s = Math.max(a, pos);
    out += blank(f.raw.slice(pos, s)) + f.raw.slice(s, b);
    pos = b;
  }
  out += blank(f.raw.slice(pos));
  out = maskRe(out, /\/\*[\s\S]*?\*\//g);
  if (f.ext === 'scss' || f.ext === 'less' || f.kind === 'script') out = out.replace(/(^|[^:\\'"])(\/\/[^\n]*)/gm, (m, a, b) => a + blank(b));
  if (f.kind === 'script') out = maskRe(out, /\$\{[^}]*\}/g);
  return out;
}
function parseDecls(body, bodyStart) {
  const decls = [];
  let pos = 0;
  for (const piece of splitTop(body, ';')) {
    const m = /^(\s*)([-\w$@]+)\s*:/.exec(piece);
    if (m && !m[2].startsWith('@')) {
      const index = bodyStart + pos + m[1].length;
      const rawVal = piece.slice(m[0].length);
      const lead = rawVal.match(/^\s*/)[0].length;
      decls.push({ prop: m[2].toLowerCase(), value: rawVal.trim().replace(/\s*!\s*important\s*$/i, ''), index, valueIndex: index + (m[0].length - m[1].length) + lead });
    }
    pos += piece.length + 1;
  }
  return decls;
}
function parseCssBlocks(css) {
  const blocks = [], stack = [];
  let segStart = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      const sel = css.slice(segStart, i).trim().replace(/\s+/g, ' ');
      stack.push({ sel, open: i, children: [] });
      segStart = i + 1;
    } else if (c === '}') {
      const b = stack.pop();
      segStart = i + 1;
      if (!b) continue;
      if (stack.length) stack[stack.length - 1].children.push([b.open, i + 1]);
      let body = css.slice(b.open + 1, i);
      for (const [x, y] of b.children) body = body.slice(0, x - b.open - 1) + blank(body.slice(x - b.open - 1, y - b.open - 1)) + body.slice(y - b.open - 1);
      // a selector can follow a declaration without a semicolon only inside nested blocks; trim to last ';'
      const ancestors = stack.map((s) => s.sel);
      const chain = [...ancestors.filter((a) => !a.startsWith('@')), b.sel].join(' ');
      blocks.push({ sel: b.sel, chain, ancestors, bodyStart: b.open + 1, decls: parseDecls(body, b.open + 1) });
    } else if (c === ';' && stack.length) {
      segStart = i + 1;
    }
  }
  return blocks;
}

function buildModel(rel, raw, ext, opts = {}) {
  const kind = EXT_KIND[ext] || 'txt';
  const f = createFile(rel, raw, kind, ext);
  if (kind === 'css') f.cssRanges.push([0, raw.length]);
  if (kind === 'markup' || (kind === 'script' && ext !== 'ts')) {
    const work = ext === 'php' ? maskRe(raw, /<\?(?:php|=)?[\s\S]*?(?:\?>|$)/g) : raw;
    analyzeMarkup(f, work, 0, raw.length, kind === 'script');
  }
  if (kind === 'script' || ext === 'vue' || ext === 'svelte') {
    for (const m of raw.matchAll(/(?:styled(?:\.\w+|\([^)]*\))(?:\.attrs\([^)]*\))?|\bcss|createGlobalStyle|keyframes)\s*`([^`]*)`/g)) {
      const s = m.index + m[0].length - m[1].length - 1;
      f.cssRanges.push([s, s + m[1].length]);
    }
  }
  if (kind === 'md') analyzeMarkdown(f, opts.mdCode);
  if (kind === 'json') analyzeJson(f);
  if (kind === 'txt') analyzeTxt(f);
  f.css = buildCssView(f);
  f.blocks = parseCssBlocks(f.css);
  for (const s of f.inline) f.blocks.push({ sel: '[style]', chain: '[style]', ancestors: [], bodyStart: s.start, decls: parseDecls(s.text, s.start) });
  for (const m of f.css.matchAll(/@apply\s+([^;{}]+)/g)) f.classSegs.push({ start: m.index + m[0].length - m[1].length, text: m[1] });
  return f;
}

function detectLang(f) {
  if (f.htmlLang === 'de' || f.htmlLang === 'en') return f.htmlLang;
  const txt = f.textSegs.map((s) => s.text).join(' ').slice(0, 30000);
  const de = (txt.match(/(?<!\p{L})(?:und|der|die|das|nicht|mit|für|Sie|wir|ist|eine?|auf|zu|auch|oder|wie|bei|Ihre?)(?!\p{L})/gu) || []).length;
  const en = (txt.match(/(?<!\p{L})(?:the|and|with|for|you|your|is|are|to|of|we|this|that|or|on|in)(?!\p{L})/gu) || []).length;
  return de >= 3 && de > en ? 'de' : 'en';
}

// ---------------------------------------------------------------------------
// Inline directives: slop-lint-disable-next-line, -disable-line, -disable-file, -disable / -enable
// ---------------------------------------------------------------------------
function parseDirectives(raw) {
  const lines = raw.split('\n');
  const byLine = new Map(), file = [], ranges = [];
  let open = null;
  const ids = (rest) => {
    const r = rest.split(/-->|\*\/|\}/)[0].match(/[a-z0-9-]+\/[a-z0-9*-]+|(?<![\w/])\*(?![\w/])|(?<![\w/])[a-z]+(?=\s*(?:,|$))/gi);
    return r && r.length ? r : ['*'];
  };
  lines.forEach((l, idx) => {
    for (const m of l.matchAll(/slop-lint-(disable-next-line|disable-line|disable-file|disable|enable)\b([^\n]*)/g)) {
      const list = ids(m[2]), ln = idx + 1;
      if (m[1] === 'disable-next-line') byLine.set(ln + 1, [...(byLine.get(ln + 1) || []), ...list]);
      else if (m[1] === 'disable-line') byLine.set(ln, [...(byLine.get(ln) || []), ...list]);
      else if (m[1] === 'disable-file') file.push(...list);
      else if (m[1] === 'disable') open = { from: ln, ids: list };
      else if (m[1] === 'enable' && open) { ranges.push({ ...open, to: ln }); open = null; }
    }
  });
  if (open) ranges.push({ ...open, to: Infinity });
  return { byLine, file, ranges };
}
function idMatches(pattern, id) {
  if (pattern === '*' || pattern === id) return true;
  if (pattern.endsWith('/*')) return id.startsWith(pattern.slice(0, -1));
  return !pattern.includes('/') && id.startsWith(pattern + '/');
}
function isDisabled(dir, id, line) {
  if (dir.file.some((p) => idMatches(p, id))) return true;
  if ((dir.byLine.get(line) || []).some((p) => idMatches(p, id))) return true;
  return dir.ranges.some((r) => line >= r.from && line <= r.to && r.ids.some((p) => idMatches(p, id)));
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
function quotedRanges(s) {
  return [...s.matchAll(/"[^"\n]*"|“[^”\n]*”|„[^“”\n]*[“”]|‘[^’\n]*’|»[^«\n]*«|\*[^*\n]+\*|_[^_\n]+_/g)].map((m) => [m.index, m.index + m[0].length]);
}
// Docs often list tells ("Hype words: supercharge, seamless, unlock"). When a line holds two or more
// hits of one rule and every hit stands alone between list separators, treat them as mentions.
function dropMentionLists(raw, hits) {
  const byLine = new Map();
  for (const h of hits) {
    if (h.end === undefined) continue;
    const ls = raw.lastIndexOf('\n', h.index - 1) + 1;
    (byLine.get(ls) || byLine.set(ls, []).get(ls)).push(h);
  }
  const drop = new Set();
  for (const [ls, list] of byLine) {
    if (list.length < 2) continue;
    let le = raw.indexOf('\n', ls); if (le === -1) le = raw.length;
    const ok = list.every((h) => /(?:^|[,:;(|\/]|^\s*(?:[-*+]|\d+\.))\s*["“„]?$/.test(raw.slice(ls, h.index))
      && /^["”“]?\s*(?:[,;)|\/…]|\*\*|$)/.test(raw.slice(h.end, le)));
    if (ok) list.forEach((h) => drop.add(h));
  }
  if (drop.size) hits.splice(0, hits.length, ...hits.filter((h) => !drop.has(h)));
}
function normalizeHits(r, base = 0) {
  if (r === null || r === undefined || r === false) return [];
  const arr = Array.isArray(r) ? r : [r];
  return arr.filter((x) => x !== null && x !== undefined).map((x) => (typeof x === 'number' ? { index: base + x } : { ...x, index: base + x.index }));
}
function runRegex(re, text, base, unless) {
  const out = [];
  if (!re) return out;
  for (const m of matchAll(re, text)) {
    if (unless && unless(m, text, m.index)) continue;
    out.push({ index: base + m.index, end: base + m.index + Math.max(1, m[0].length) });
  }
  return out;
}

function lintFile(f, cfg) {
  let brand = cfg.brand;
  const ov = brand?.address_overrides?.find((o) => o.re.test(f.rel));
  if (ov) brand = { ...brand, address: ov.address };
  const env = {
    lang: cfg.lang === 'auto' ? detectLang(f) : cfg.lang,
    adapters: cfg.adapters, brand, brandRe: cfg.brandRe, palette: cfg.palette, fonts: cfg.brand?.fonts || [], t: cfg.thresholds,
  };
  const prose = f.kind === 'md' || f.kind === 'txt';
  const findings = [];
  for (const rule of RULES) {
    const sev = cfg.overrides[rule.id] ?? rule.severity;
    if (sev === 'off') continue;
    if (rule.adapter && !env.adapters.has(rule.adapter)) continue;
    if (rule.when && !rule.when(env)) continue;
    const ruleHits = [];
    for (const d of rule.detect) {
      if (d.skipAdapters && d.skipAdapters.some((a) => env.adapters.has(a))) continue;
      const re = typeof d.re === 'function' ? d.re(env) : d.re;
      let hits = [];
      if (d.scope === 'text') {
        for (const seg of f.textSegs) {
          if (d.ctx && !d.ctx.some((c) => seg.ctx.has(c))) continue;
          if (d.notCtx && d.notCtx.some((c) => seg.ctx.has(c))) continue;
          let h = d.check ? normalizeHits(d.check(seg.text, env), seg.start) : runRegex(re, seg.text, seg.start, d.unless);
          if (prose && !rule.mentionsOk && h.length) {
            // In docs, quoted or emphasized words are usually mentions, not use.
            const q = quotedRanges(seg.text);
            h = h.filter((x) => !q.some(([a, b]) => x.index - seg.start >= a && x.index - seg.start < b));
          }
          hits.push(...h);
        }
      } else if (d.scope === 'class') {
        for (const seg of f.classSegs) hits.push(...(d.check ? normalizeHits(d.check(seg.text, env), seg.start) : runRegex(re, seg.text, seg.start, d.unless)));
      } else if (d.scope === 'decl') {
        for (const b of f.blocks) for (const decl of b.decls) hits.push(...normalizeHits(d.check(decl, b, f, env)));
      } else if (d.scope === 'block') {
        for (const b of f.blocks) hits.push(...normalizeHits(d.check(b, f, env)));
      } else if (d.scope === 'css') {
        hits = d.check ? normalizeHits(d.check(f, env)) : runRegex(re, f.css, 0, d.unless);
      } else if (d.scope === 'raw') {
        if (f.kind === 'markup' || f.kind === 'script') hits = runRegex(re, f.raw, 0, d.unless);
      } else if (d.scope === 'markup') {
        hits = normalizeHits(d.check(f, env));
      } else if (d.scope === 'file') {
        hits = normalizeHits(d.check(f, env));
      }
      ruleHits.push(...hits);
    }
    ruleHits.sort((a, b) => a.index - b.index);
    if (prose) dropMentionLists(f.raw, ruleHits);
    let lastEnd = -1;
    for (const h of ruleHits) {
      if (h.end !== undefined && h.index < lastEnd) continue; // overlapping matches of one rule count once
      lastEnd = Math.max(lastEnd, h.end ?? h.index + 1);
      findings.push({ rule: rule.id, severity: sev, index: h.index, message: h.message || rule.message, fix: rule.fix });
    }
  }
  return findings;
}

function lintPath(abs, rel, cfg) {
  let raw;
  try { raw = fs.readFileSync(abs, 'utf8'); } catch {
    return [mkMeta(rel, 'file/read-error', cfg)];
  }
  const ext = path.extname(abs).slice(1).toLowerCase();
  if (/\.min\.[a-z]+$/i.test(abs)) return [mkMeta(rel, 'file/minified-skipped', cfg)];
  // Rendered pages (DOM dumps, server output) often sit on very few lines: reflow HTML at tag boundaries.
  if ((ext === 'html' || ext === 'htm') && raw.split('\n').some((l) => l.length > 2000)) {
    raw = raw.replace(/>\s*</g, '>\n<').replace(/\}(?=[^\n])/g, '}\n');
  }
  {
    const lines = raw.split('\n');
    const long = lines.filter((l) => l.length > 2000).length;
    if (long && long / lines.length > 0.2) return [mkMeta(rel, 'file/minified-skipped', cfg)];
    // Blank single overlong lines (inline SVG paths, embedded CSS blobs) but keep line numbers.
    if (long) raw = lines.map((l) => (l.length > 2000 ? '' : l)).join('\n');
  }
  const f = buildModel(rel, raw, ext, { mdCode: cfg.mdCode });
  const pos = lineInfo(raw);
  const dir = parseDirectives(raw);
  const seen = new Set();
  const out = [];
  for (const x of lintFile(f, cfg)) {
    const { line, col } = pos(Math.max(0, Math.min(x.index, raw.length)));
    const key = `${x.rule}:${line}:${col}`;
    if (seen.has(key) || isDisabled(dir, x.rule, line)) continue;
    seen.add(key);
    out.push({ file: rel, line, column: col, severity: x.severity, rule: x.rule, message: x.message, fix: x.fix });
  }
  return out.sort((a, b) => a.line - b.line || a.column - b.column);
}
function mkMeta(rel, id, cfg) {
  const m = META_RULES[id];
  return { file: rel, line: 1, column: 1, severity: cfg.overrides[id] ?? m.severity, rule: id, message: m.message, fix: m.fix };
}

// ---------------------------------------------------------------------------
// Files, config, CLI
// ---------------------------------------------------------------------------
function globToRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += esc(c);
  }
  return new RegExp(`^(?:${re})$|^(?:${re})/`);
}
function walk(p, out, cfg) {
  let st;
  try { st = fs.statSync(p); } catch { process.stderr.write(`slop-lint: cannot read ${p}\n`); return; }
  const rel = path.relative(process.cwd(), p).split(path.sep).join('/') || path.basename(p);
  if (cfg.ignore.some((re) => re.test(rel))) return;
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p).sort()) {
      if (SKIP_DIRS.has(e)) continue;
      walk(path.join(p, e), out, cfg);
    }
  } else if (DEFAULT_EXTS.has(path.extname(p).slice(1).toLowerCase()) && !SKIP_FILES.has(path.basename(p))) {
    out.push({ abs: p, rel });
  }
}
function parseArgs(argv) {
  const a = { paths: [], format: 'text', failOn: 'error', lang: null, adapters: null, brand: null, config: null, listRules: false, mdCode: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const val = () => { const [k, v] = x.split('='); if (v !== undefined) return v; if (i + 1 >= argv.length) usage(`missing value for ${k}`); return argv[++i]; };
    if (x === '-h' || x === '--help') usage();
    else if (x.startsWith('--brand')) a.brand = val();
    else if (x.startsWith('--adapter')) a.adapters = val();
    else if (x.startsWith('--lang')) a.lang = val();
    else if (x.startsWith('--format')) a.format = val();
    else if (x.startsWith('--fail-on')) a.failOn = val();
    else if (x.startsWith('--config')) a.config = val();
    else if (x === '--list-rules') a.listRules = true;
    else if (x === '--md-code') a.mdCode = true;
    else if (x.startsWith('--')) usage(`unknown option ${x}`);
    else a.paths.push(x);
  }
  return a;
}
function usage(err) {
  const txt = `Usage: node scripts/slop-lint.mjs [paths...] [options]
  --brand <brand.md>        brand profile (YAML front matter) for brand/* rules
  --adapter <list>          acss | tailwind | etch | bricks (comma-separated)
  --lang <de|en|auto>       copy language (default: auto per file)
  --format <text|json|md>   output format (md only with --list-rules)
  --fail-on <error|warn|info|none>   exit 1 if findings at/above this level (default: error)
  --config <file>           config file (default: ./.slop-lint.json if present)
  --md-code                 also lint fenced css/html code blocks in Markdown
  --list-rules              print the rule table
`;
  if (err) { process.stderr.write(`slop-lint: ${err}\n${txt}`); process.exit(2); }
  process.stdout.write(txt); process.exit(0);
}
function listRules(format) {
  const rows = RULES.map((r) => ({ id: r.id, severity: r.severity, adapter: r.needs || (r.adapter ? `--adapter ${r.adapter}` : r.id.startsWith('brand/') ? 'brand' : ''), message: r.message, fix: r.fix }));
  if (format === 'json') return process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  if (format === 'md') {
    process.stdout.write('| Rule | Severity | Needs | Flags | Fix |\n| --- | --- | --- | --- | --- |\n');
    for (const r of rows) process.stdout.write(`| \`${r.id}\` | ${r.severity} | ${r.adapter || 'core'} | ${r.message.replace(/\|/g, '\\|')} | ${r.fix.replace(/\|/g, '\\|')} |\n`);
    return;
  }
  for (const r of rows) process.stdout.write(`${r.id.padEnd(34)} ${r.severity.padEnd(5)} ${r.message}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.listRules) return listRules(args.format);
  let fileCfg = {}, cfgDir = process.cwd();
  const cfgPath = args.config || (fs.existsSync('.slop-lint.json') ? '.slop-lint.json' : null);
  if (cfgPath) {
    try { fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); cfgDir = path.dirname(path.resolve(cfgPath)); }
    catch (e) { usage(`cannot read config ${cfgPath}: ${e.message}`); }
  }
  const overrides = {};
  for (const [id, v] of Object.entries(fileCfg.rules || {})) {
    const s = typeof v === 'string' ? v : v && v.severity;
    if (!['off', 'info', 'warn', 'error'].includes(s)) usage(`invalid severity for ${id} in config`);
    overrides[id] = s;
  }
  const dataDir = findProjectData(process.cwd());
  const setup = loadSetup(dataDir);
  const setupAdapters = [setup.framework, setup.builder].map((v) => String(v || '').toLowerCase()).filter((v) => ['acss', 'tailwind', 'etch', 'bricks'].includes(v)).join(',');
  const adapters = new Set(String(args.adapters ?? fileCfg.adapter ?? fileCfg.adapters ?? setupAdapters).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  for (const a of adapters) if (!['acss', 'tailwind', 'etch', 'bricks'].includes(a)) usage(`unknown adapter ${a}`);
  const lang = String(args.lang ?? fileCfg.lang ?? setup.language ?? 'auto').toLowerCase();
  if (!['de', 'en', 'auto'].includes(lang)) usage(`unknown lang ${lang}`);
  const format = args.format;
  if (!['text', 'json'].includes(format)) usage(`unknown format ${format}`);
  const failOn = args.failOn ?? fileCfg.failOn;
  if (!['error', 'warn', 'info', 'none'].includes(failOn)) usage(`invalid --fail-on ${failOn}`);
  let brandPath = args.brand ?? (fileCfg.brand ? path.resolve(cfgDir, fileCfg.brand) : null);
  if (!brandPath && dataDir && String(setup.brand || '').toLowerCase() !== 'none') {
    const cand = path.resolve(dataDir, typeof setup.brand === 'string' && setup.brand.endsWith('.md') ? setup.brand : 'brand.md');
    if (fs.existsSync(cand)) brandPath = cand;
  }
  let brand = null;
  if (brandPath) {
    try { brand = loadBrand(brandPath); } catch (e) { usage(`cannot read brand profile ${brandPath}: ${e.message}`); }
  }
  const cfg = {
    lang, adapters, brand, overrides,
    thresholds: { ...THRESHOLDS, ...(fileCfg.thresholds || {}) },
    brandRe: { words: brand && wordRe(brand.banned_words.map(esc)), phrases: brand && phraseRe(brand.banned_phrases), claims: brand && phraseRe(brand.claims_never) },
    palette: brand ? brand._hex.map(hexToRgb).filter(Boolean) : [],
    ignore: (fileCfg.ignore || []).map(globToRe),
    mdCode: args.mdCode || !!fileCfg.markdownCode,
  };
  const files = [];
  for (const p of args.paths.length ? args.paths : ['.']) walk(path.resolve(p), files, cfg);
  // The brand profile lists banned words on purpose: never lint it as copy, only report that it parsed.
  if (brandPath) {
    const bp = path.resolve(brandPath);
    const before = files.length;
    for (let i = files.length - 1; i >= 0; i--) if (path.resolve(files[i].abs) === bp) files.splice(i, 1);
    if (files.length < before && format === 'text') {
      process.stdout.write(`brand profile ${path.relative(process.cwd(), bp)}: parsed, ${brand.banned_words.length} banned words, ${brand.banned_phrases.length} banned phrases, ${brand.claims_never.length} claims never, ${brand._hex.length} colors, ${brand.fonts.length} fonts. Not linted as copy.\n`);
    }
  }
  const findings = [];
  for (const f of files) findings.push(...lintPath(f.abs, f.rel, cfg));
  const count = { error: 0, warn: 0, info: 0 };
  for (const x of findings) count[x.severity]++;
  const flagged = new Set(findings.map((x) => x.file)).size;
  if (format === 'json') {
    process.stdout.write(JSON.stringify({ tool: 'slop-lint', version: 1, filesScanned: files.length, summary: { ...count, files: flagged },
      options: { lang, adapters: [...adapters], brand: brandPath || null, failOn }, findings }, null, 2) + '\n');
  } else {
    for (const x of findings) process.stdout.write(`${x.file}:${x.line}:${x.column}  ${x.severity.padEnd(5)}  ${x.rule}  ${x.message}  → ${x.fix}\n`);
    process.stdout.write(`${findings.length ? '\n' : ''}slop-lint: ${count.error} error(s), ${count.warn} warning(s), ${count.info} info in ${flagged} of ${files.length} file(s)\n`);
  }
  const min = SEV_RANK[failOn] || Infinity;
  process.exitCode = findings.some((x) => SEV_RANK[x.severity] >= min) ? 1 : 0;
}

main();
