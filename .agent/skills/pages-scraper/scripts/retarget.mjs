#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  renameSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { dryRun: false };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = argv[++i];
    else if (a === "--recipe") args.recipe = argv[++i];
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else positional.push(a);
  }
  if (!args.root && positional[0]) args.root = positional[0];
  if (!args.recipe && positional[1]) args.recipe = positional[1];
  return args;
}

const args = parseArgs(process.argv);
if (args.help || !args.root || !args.recipe) {
  console.log("Usage: node retarget.mjs --root <mirrored-dir> --recipe <recipe.mjs> [--report report.txt] [--dry-run]");
  process.exit(args.help ? 0 : 1);
}

const ROOT = path.resolve(args.root);
const REPORT_PATH = path.resolve(args.report || path.join(ROOT, ".pages-scraper", "retarget-report.txt"));
const recipePath = path.resolve(args.recipe);
const recipe = (await import(pathToFileURL(recipePath).href)).default;
if (!recipe || typeof recipe !== "object") throw new Error("Recipe must default-export an object.");

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#x27": "'", "#x2F": "/", "#39": "'", nbsp: " " };
function unescapeHtml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (ENT[code] !== undefined) return ENT[code];
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function keyFor(file, k) { return file + "||" + k; }

function replaceTextNodes(html, map, file, stats) {
  if (!map) return html;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let out = "";
  let last = 0;
  let skip = null;
  let m;
  const apply = (seg) => {
    if (!seg || skip) return seg;
    const dec = unescapeHtml(seg);
    const core = dec.replace(/[\u00a0\u2007\u202f]/g, " ").trim();
    if (!core) return seg;
    let replacement;
    let matchedKey = null;
    for (const k of Object.keys(map)) {
      let hit = false;
      if (k.startsWith("~")) {
        try { hit = new RegExp(k.slice(1), "s").test(core); } catch { hit = false; }
      } else hit = core === k;
      if (!hit) continue;
      let v = map[k];
      if (Array.isArray(v)) {
        const arrKey = keyFor(file, k);
        const count = stats.arr[arrKey] || 0;
        v = v[Math.min(count, v.length - 1)];
        stats.arr[arrKey] = count + 1;
      }
      replacement = v;
      matchedKey = k;
      break;
    }
    if (replacement === null || replacement === undefined || matchedKey === null) return seg;
    stats.count[matchedKey] = (stats.count[matchedKey] || 0) + 1;
    const lead = (dec.match(/^\s+/) || [""])[0];
    const trail = (dec.match(/\s+$/) || [""])[0];
    return escapeHtml(lead + replacement + trail);
  };

  while ((m = re.exec(html))) {
    out += apply(html.slice(last, m.index));
    out += m[0];
    if (!m[1] && (m[2] === "script" || m[2] === "style")) skip = m[2];
    else if (m[1] && skip && m[2] === skip) skip = null;
    last = re.lastIndex;
  }
  out += apply(html.slice(last));
  return out;
}

function replaceAttrValues(html, map, attr) {
  if (!map) return html;
  const re = new RegExp(`(${attr}\\s*=\\s*)(?:"([^"]*)"|'([^']*)')`, "gi");
  return html.replace(re, (m, lead, d, s) => {
    const raw = d !== undefined ? d : s;
    const core = unescapeHtml(raw).trim();
    const neu = map[core];
    if (typeof neu !== "string") return m;
    return lead + (d !== undefined ? `"${escapeAttr(neu)}"` : `'${escapeAttr(neu)}'`);
  });
}

function applyMeta(html, meta) {
  if (!meta) return html;
  if (meta.title) {
    const title = escapeAttr(meta.title);
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
    html = html.replace(/<meta\s+property=["']og:title["']\s+content=["'][^"']*["']\s*\/?\s*>/i, `<meta property="og:title" content="${title}">`);
    html = html.replace(/<meta\s+name=["']twitter:title["']\s+content=["'][^"']*["']\s*\/?\s*>/i, `<meta name="twitter:title" content="${title}">`);
  }
  if (meta.desc) {
    const desc = escapeAttr(meta.desc);
    html = html.replace(/<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*\/?\s*>/i, `<meta name="description" content="${desc}">`);
    html = html.replace(/<meta\s+property=["']og:description["']\s+content=["'][^"']*["']\s*\/?\s*>/i, `<meta property="og:description" content="${desc}">`);
    html = html.replace(/<meta\s+name=["']twitter:description["']\s+content=["'][^"']*["']\s*\/?\s*>/i, `<meta name="twitter:description" content="${desc}">`);
  }
  return html;
}

function replaceOccurrences(html, pattern, replacements) {
  let i = 0;
  return html.replace(pattern, (m) => replacements[i++] ?? m);
}

function listHtml(dir, base = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listHtml(full, rel));
    else if (name.toLowerCase().endsWith(".html")) out.push(rel.replace(/\\/g, "/"));
  }
  return out;
}

const stats = { count: {}, arr: {} };
const perFileReport = [];
const previewHtml = new Map();
const files = listHtml(ROOT);
const globalMap = recipe.global || {};
const perFile = recipe.perFile || {};
const meta = recipe.meta || {};
const attrNames = recipe.attributes || ["alt"];

for (const file of files) {
  const full = path.join(ROOT, file);
  let html = readFileSync(full, "utf8");
  const before = html;
  const pf = perFile[file] || {};
  const effectiveMap = { ...globalMap, ...pf };

  // One pass makes per-file values true overrides when the same source key exists globally.
  html = replaceTextNodes(html, effectiveMap, file, stats);

  for (const attr of attrNames) {
    html = replaceAttrValues(html, effectiveMap, attr);
  }

  html = applyMeta(html, meta[file]);

  for (const item of recipe.raw || []) {
    if (item.from instanceof RegExp) html = html.replace(item.from, item.to);
    else html = html.split(String(item.from)).join(String(item.to));
  }

  for (const region of recipe.regions || []) {
    const replacements = region.files?.[file];
    if (!replacements) continue;
    if (!(region.pattern instanceof RegExp)) throw new Error(`Region ${region.name || "(unnamed)"} pattern must be RegExp`);
    html = replaceOccurrences(html, region.pattern, replacements);
  }

  previewHtml.set(file, html);
  if (html !== before) {
    if (!args.dryRun) writeFileSync(full, html, "utf8");
    perFileReport.push(`${args.dryRun ? "WOULD UPDATE" : "UPDATED"} ${file}`);
  } else perFileReport.push(`~~~ no change: ${file}`);
}

const unusedKeys = [];
for (const src of [globalMap, ...Object.values(perFile)]) {
  for (const k of Object.keys(src || {})) if (!stats.count[k]) unusedKeys.push(k);
}

if (!args.dryRun && Array.isArray(recipe.slugs)) {
  for (const file of listHtml(ROOT)) {
    const full = path.join(ROOT, file);
    let html = readFileSync(full, "utf8");
    const before = html;
    for (const [oldSlug, newSlug] of recipe.slugs) html = html.split(oldSlug).join(newSlug);
    if (html !== before) writeFileSync(full, html, "utf8");
  }
  for (const [oldSlug, newSlug] of recipe.slugs) {
    const oldDir = path.join(ROOT, oldSlug);
    const newDir = path.join(ROOT, newSlug);
    if (!existsSync(oldDir)) continue;
    mkdirSync(path.dirname(newDir), { recursive: true });
    if (existsSync(newDir)) throw new Error(`Cannot rename ${oldSlug} -> ${newSlug}: destination exists`);
    renameSync(oldDir, newDir);
  }
}

const leftovers = {};
const tokens = recipe.leftovers || [];
for (const file of listHtml(ROOT)) {
  const raw = args.dryRun && previewHtml.has(file)
    ? previewHtml.get(file)
    : readFileSync(path.join(ROOT, file), "utf8");
  const text = unescapeHtml(raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
  for (const token of tokens) {
    const value = String(token);
    if (!value) continue;
    const count = text.split(value).length - 1;
    if (count > 0) leftovers[value] = (leftovers[value] || 0) + count;
  }
}

const report = [];
report.push(`# Retarget report${args.dryRun ? " (dry run)" : ""}`);
report.push(`root: ${ROOT}`);
report.push(`recipe: ${recipePath}`);
report.push("\n=== unused replacement keys ===");
if (!unusedKeys.length) report.push("  none");
else for (const k of unusedKeys) report.push("  " + k.slice(0, 160));
report.push("\n=== leftover source strings (page text only) ===");
const leftoverEntries = Object.entries(leftovers).sort((a, b) => b[1] - a[1]);
if (!leftoverEntries.length) report.push("  none");
else for (const [k, v] of leftoverEntries) report.push(`  ${v}x ${k}`);
report.push("\n=== per-file ===");
report.push(...perFileReport);

if (!args.dryRun) {
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, report.join("\n"));
}
console.log(report.join("\n"));
