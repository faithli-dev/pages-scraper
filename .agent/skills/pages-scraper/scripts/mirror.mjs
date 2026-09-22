#!/usr/bin/env node
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { concurrency: 5, rewrite: true, maxResources: 5000 };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--max-resources") args.maxResources = Number(argv[++i]);
    else if (a === "--no-rewrite") args.rewrite = false;
    else if (a === "--help" || a === "-h") args.help = true;
    else positional.push(a);
  }
  if (!args.url && positional[0]) args.url = positional[0];
  if (!args.out && positional[1]) args.out = positional[1];
  return args;
}

const args = parseArgs(process.argv);
if (args.help || !args.url) {
  console.log(`Usage: node mirror.mjs --url https://example.com [--out ref/example] [--concurrency 5] [--max-resources 5000] [--no-rewrite]\n\nMirrors same-origin pages/assets and rewrites same-origin absolute/root-relative references for local viewing.`);
  process.exit(args.help ? 0 : 1);
}

const START_URL = new URL(args.url);
const ORIGIN = START_URL.origin;
const OUT = path.resolve(args.out || START_URL.hostname);
const CONCURRENCY = Number.isFinite(args.concurrency) && args.concurrency > 0 ? Math.floor(args.concurrency) : 5;
const MAX_RESOURCES = Number.isFinite(args.maxResources) && args.maxResources > 0 ? Math.floor(args.maxResources) : 5000;
const UA = "Mozilla/5.0 (compatible; pages-scraper/0.1; +https://github.com/faithli-dev/pages-scraper)";

const assetLike = /\.(html?|css|js|mjs|cjs|json|map|xml|txt|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|pdf|zip)$/i;
const isHtml = (ct) => /text\/html/i.test(ct);
const isCss = (ct) => /text\/css/i.test(ct);
const isText = (ct) => /(javascript|ecmascript|text\/plain|application\/json|image\/svg\+xml)/i.test(ct);

function savePathFor(pathname, asPage) {
  let p = pathname;
  try { p = decodeURIComponent(p); } catch {}
  if (p.endsWith("/")) p = p.slice(0, -1);
  if (p === "") return "index.html";
  const base = p.split("/").pop();
  if (asPage) {
    if (/\.html?$/i.test(base)) return p.replace(/^\//, "");
    return p.replace(/^\//, "") + "/index.html";
  }
  return p.replace(/^\//, "");
}

function normalizeCandidate(raw, baseUrl) {
  if (!raw) return null;
  const s = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!s || /^(#|data:|mailto:|tel:|javascript:|blob:)/i.test(s)) return null;
  try {
    const u = new URL(s, baseUrl);
    if (u.origin !== ORIGIN) return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

function extractRefs(text, baseUrl) {
  const refs = new Set();
  const add = (raw) => {
    const u = normalizeCandidate(raw, baseUrl);
    if (u) refs.add(u.href);
  };

  const attrRe = /(?:src|href|poster|action)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const m of text.matchAll(attrRe)) add(m[1] ?? m[2]);

  const srcsetRe = /srcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const m of text.matchAll(srcsetRe)) {
    for (const part of (m[1] ?? m[2] ?? "").split(",")) add(part.trim().split(/\s+/)[0]);
  }

  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;
  for (const m of text.matchAll(urlRe)) add(m[1] ?? m[2] ?? m[3]);

  const importRe = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')/gi;
  for (const m of text.matchAll(importRe)) add(m[1] ?? m[2]);

  return refs;
}

function extractPatternRefs(text, baseUrl) {
  const refs = new Set();
  for (const m of text.matchAll(/["'`(](\/(?:assets|_astro|static|build)\/[^"'`)\s]+)["'`)]/g)) {
    const u = normalizeCandidate(m[1], baseUrl);
    if (u) refs.add(u.href);
  }
  return refs;
}

const queue = [];
const queued = new Set();
const results = new Map();

function keyOf(u) {
  let p = u.pathname;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return u.origin + p;
}

function enqueue(urlStr) {
  if (queued.size >= MAX_RESOURCES) return;
  const u = new URL(urlStr);
  if (u.origin !== ORIGIN) return;
  const key = keyOf(u);
  if (queued.has(key)) return;
  queued.add(key);
  queue.push(u);
}

async function fetchWithRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "*/*" } });
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function processOne(u) {
  const key = keyOf(u);
  let res;
  try {
    res = await fetchWithRetry(u);
  } catch (err) {
    console.log(`ERR  ${u.pathname} -> ${err.message}`);
    return;
  }

  const status = res.status;
  const ct = res.headers.get("content-type") || "";
  const asPage = isHtml(ct);
  if (status !== 200 && status !== 304) {
    console.log(`SKIP ${status} ${u.pathname}`);
    return;
  }

  const rel = savePathFor(u.pathname, asPage);
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  results.set(key, { url: u.href, file: rel, status, type: ct, bytes: buf.length });

  if (asPage || isCss(ct) || isText(ct)) {
    const text = buf.toString("utf8");
    const base = res.url || u.href;
    const refs = new Set([...extractRefs(text, base), ...extractPatternRefs(text, base)]);
    for (const r of refs) enqueue(r);
    console.log(`OK   ${status} ${u.pathname} -> ${rel} (${buf.length}b, ${refs.size} refs)`);
  } else {
    console.log(`OK   ${status} ${u.pathname} -> ${rel} (${buf.length}b)`);
  }
}

async function crawl() {
  enqueue(START_URL.href);
  while (queue.length) {
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(batch.map(processOne));
  }
}

function localize(raw, prefix, baseUrl) {
  if (!raw) return raw;
  const s = raw.trim();
  if (!s || /^(#|data:|mailto:|tel:|javascript:|blob:)/i.test(s)) return raw;

  let u;
  try { u = new URL(s, baseUrl); } catch { return raw; }
  if (u.origin !== ORIGIN) return raw;

  let pathname = u.pathname;
  const base = pathname.split("/").pop();
  const isFile = assetLike.test(base) || /\.[a-zA-Z0-9]{1,8}$/.test(base);
  const rel = pathname === "/"
    ? "index.html"
    : isFile
      ? pathname.replace(/^\//, "")
      : pathname.replace(/^\//, "").replace(/\/$/, "") + "/index.html";
  return prefix + rel + u.hash;
}

function rewriteHtml(html, prefix, baseUrl) {
  let out = html.replace(/((?:src|href|poster|action)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (m, lead, d, s) => {
    const v = d !== undefined ? d : s;
    const nv = localize(v, prefix, baseUrl);
    return lead + (d !== undefined ? `"${nv}"` : `'${nv}'`);
  });
  out = out.replace(/(srcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (m, lead, d, s) => {
    const v = d !== undefined ? d : s;
    const nv = v.split(",").map((part) => {
      const seg = part.trim();
      if (!seg) return seg;
      const sp = seg.split(/\s+/);
      sp[0] = localize(sp[0], prefix, baseUrl);
      return sp.join(" ");
    }).join(", ");
    return lead + (d !== undefined ? `"${nv}"` : `'${nv}'`);
  });
  return out;
}

function rewriteCss(css, prefix, baseUrl) {
  let out = css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi, (m, d, s, b) => {
    const v = d ?? s ?? b;
    const nv = localize(v, prefix, baseUrl);
    const q = d !== undefined ? '"' : s !== undefined ? "'" : "";
    return `url(${q}${nv}${q})`;
  });
  out = out.replace(/(@import\s+(?:url\(\s*)?)(?:"([^"]*)"|'([^']*)')/gi, (m, lead, d, s) => {
    const v = d ?? s;
    const nv = localize(v, prefix, baseUrl);
    return `${lead}${d !== undefined ? `"${nv}"` : `'${nv}'`}`;
  });
  return out;
}

async function rewriteAll() {
  let htmlCount = 0;
  let cssCount = 0;
  for (const r of results.values()) {
    const full = path.join(OUT, r.file);
    const dir = path.dirname(r.file);
    const depth = dir === "." ? 0 : dir.split(/[\\/]/).length;
    const prefix = "../".repeat(depth);
    if (isHtml(r.type)) {
      const html = await readFile(full, "utf8");
      await writeFile(full, rewriteHtml(html, prefix, r.url), "utf8");
      htmlCount++;
    } else if (isCss(r.type)) {
      const css = await readFile(full, "utf8");
      await writeFile(full, rewriteCss(css, prefix, r.url), "utf8");
      cssCount++;
    }
  }
  console.log(`\nRewrote ${htmlCount} HTML and ${cssCount} CSS files to local relative paths.`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Mirroring ${START_URL.href} -> ${OUT}`);
  console.log(`same-origin only · concurrency=${CONCURRENCY} · maxResources=${MAX_RESOURCES}\n`);
  await crawl();
  if (args.rewrite) await rewriteAll();

  const pages = [...results.values()].filter((r) => isHtml(r.type));
  const totalBytes = [...results.values()].reduce((a, r) => a + r.bytes, 0);
  console.log(`\nDone. ${results.size} resources (${(totalBytes / 1024 / 1024).toFixed(1)} MB), ${pages.length} pages.`);
  for (const p of pages.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`  /${p.file.replace(/index\.html$/, "")}`);
  }
  if (queued.size >= MAX_RESOURCES) console.log(`WARN reached --max-resources=${MAX_RESOURCES}; mirror may be incomplete.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
