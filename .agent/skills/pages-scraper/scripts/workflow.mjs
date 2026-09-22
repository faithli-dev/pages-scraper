#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = { maxDepth: 8 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--recipe") args.recipe = argv[++i];
    else if (a === "--max-depth") args.maxDepth = Number(argv[++i]);
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv);
if (args.help || !args.url || !args.out) {
  console.log("Usage: node workflow.mjs --url https://example.com --out ref/example [--recipe recipe.mjs] [--max-depth 8]");
  process.exit(args.help ? 0 : 1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(args.out);
const stateDir = path.join(OUT, ".pages-scraper");
mkdirSync(stateDir, { recursive: true });

function run(bin, argv, opts = {}) {
  const res = spawnSync(bin, argv, { stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8" });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status ?? 1);
  return res.stdout || "";
}

console.log("\n[1/5] mirror");
run(process.execPath, [path.join(here, "mirror.mjs"), "--url", args.url, "--out", OUT]);

console.log("\n[2/5] baseline link QA");
run(process.execPath, [path.join(here, "check-links.mjs"), "--root", OUT]);

console.log("\n[3/5] outline index.html");
const indexFile = path.join(OUT, "index.html");
if (!existsSync(indexFile)) throw new Error(`Missing ${indexFile}`);
const outline = run("python3", [path.join(here, "outline-html.py"), indexFile, "--max-depth", String(args.maxDepth)], { capture: true });
writeFileSync(path.join(stateDir, "outline.txt"), outline);
console.log(`wrote ${path.join(stateDir, "outline.txt")}`);

if (args.recipe) {
  console.log("\n[4/5] retarget");
  run(process.execPath, [path.join(here, "retarget.mjs"), "--root", OUT, "--recipe", path.resolve(args.recipe)]);
} else {
  console.log("\n[4/5] retarget skipped (no --recipe)");
}

console.log("\n[5/5] final link QA");
run(process.execPath, [path.join(here, "check-links.mjs"), "--root", OUT]);
console.log("\nWorkflow complete.");
