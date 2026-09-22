#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { json: false, fail: true };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--no-fail") args.fail = false;
    else if (a === "--help" || a === "-h") args.help = true;
    else positional.push(a);
  }
  if (!args.root && positional[0]) args.root = positional[0];
  return args;
}

const args = parseArgs(process.argv);
if (args.help || !args.root) {
  console.log("Usage: node check-links.mjs --root <mirrored-dir> [--json] [--no-fail]");
  process.exit(args.help ? 0 : 1);
}

const ROOT = path.resolve(args.root);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

function cleanRef(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || /^(#|data:|mailto:|tel:|javascript:|blob:|\/\/)/i.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  const clean = s.split("#")[0].split("?")[0];
  return clean || null;
}

const files = await walk(ROOT);
const missing = new Map();
const refRe = /(?:src|href|poster|action)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const srcsetRe = /srcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;
const importRe = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')/gi;
let checked = 0;

for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  if (![".html", ".css"].includes(ext)) continue;
  const text = await readFile(f, "utf8");
  const refs = [];
  if (ext === ".html") {
    for (const m of text.matchAll(refRe)) refs.push(m[1] ?? m[2]);
    for (const m of text.matchAll(srcsetRe)) {
      for (const part of (m[1] ?? m[2] ?? "").split(",")) refs.push(part.trim().split(/\s+/)[0]);
    }
  }
  for (const m of text.matchAll(urlRe)) refs.push(m[1] ?? m[2] ?? m[3]);
  for (const m of text.matchAll(importRe)) refs.push(m[1] ?? m[2]);

  for (const raw of refs) {
    const clean = cleanRef(raw);
    if (!clean) continue;
    const target = clean.startsWith("/")
      ? path.resolve(ROOT, "." + clean)
      : path.resolve(path.dirname(f), clean);
    checked++;
    try {
      await stat(target);
    } catch {
      const key = `${path.relative(ROOT, f)} -> ${raw}`;
      missing.set(key, (missing.get(key) || 0) + 1);
    }
  }
}

const payload = {
  root: ROOT,
  files: files.length,
  checked,
  missing: [...missing.entries()].sort((a, b) => b[1] - a[1]).map(([ref, count]) => ({ ref, count })),
};

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`checked ${checked} local refs across ${files.length} files`);
  if (missing.size === 0) console.log("NO MISSING FILES ✅");
  else {
    console.log("MISSING:");
    for (const item of payload.missing) console.log(`  ${item.count}x ${item.ref}`);
  }
}

if (args.fail && missing.size > 0) process.exitCode = 2;
