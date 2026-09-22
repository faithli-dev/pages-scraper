---
name: pages-scraper
description: "Mirror a public same-origin website into a local static copy, inspect its HTML structure, retarget the copy with a repeatable content recipe, and validate local asset/link integrity. Use for authorized site migration, archival, template retargeting, or design-reference capture where a deterministic local copy is needed."
---

# Pages Scraper

Use this skill when the job is to turn a public website into an inspectable local static copy and then systematically retarget that copy for another project.

The core pipeline is:

`mirror → baseline QA → outline → retarget → final QA`

The scripts live in `scripts/` and have no npm runtime dependencies.

## Preconditions

- Only mirror or reproduce websites/content the user owns, is authorized to copy, or is otherwise permitted to use for the requested purpose.
- Do not bypass login, paywalls, CAPTCHA, access controls, anti-bot protections, or private endpoints.
- Keep crawling same-origin unless the user explicitly provides separately authorized asset origins and the implementation is updated deliberately.
- Do not hotlink source assets in the final deliverable. Keep the mirrored copy self-contained where practical.
- If the target brand/content requirements are missing, do not invent product claims. Gather the missing brand name, positioning, pages, CTA, locale, and approved copy/source material before creating a production retarget recipe.

## Canonical workflow

### 1. Mirror the source

```bash
node .agent/skills/pages-scraper/scripts/mirror.mjs \
  --url https://example.com \
  --out ref/example
```

The mirror step:

- crawls same-origin page and asset references;
- follows discovered HTML/CSS/JS text references without crossing origin;
- stores pages as `path/index.html` where appropriate;
- retries transient fetch failures;
- rewrites same-origin absolute and root-relative HTML/CSS references to local relative paths.

For unusually large sites, set an explicit ceiling:

```bash
node .agent/skills/pages-scraper/scripts/mirror.mjs \
  --url https://example.com \
  --out ref/example \
  --max-resources 2000
```

### 2. Run baseline link QA

```bash
node .agent/skills/pages-scraper/scripts/check-links.mjs --root ref/example
```

Do not start retargeting on a broken baseline unless the missing resources are understood and documented.

### 3. Inspect structure before editing

Use the outline script instead of reading a large generated HTML file line by line:

```bash
python3 .agent/skills/pages-scraper/scripts/outline-html.py \
  ref/example/index.html \
  --max-depth 8
```

Run it on representative routes such as home, pricing, service, product/detail, blog/article, and contact pages. The outline intentionally omits noisy media/SVG nodes and script/style subtrees while retaining useful classes, selected attributes, and visible text.

### 4. Build a retarget recipe

Start from `examples/recipe.example.mjs`.

Keep project-specific content in the recipe, not in `retarget.mjs`.

Use the following order:

1. `global` exact/regex text replacements.
2. `perFile` overrides for specific routes.
3. `meta` title/description updates.
4. `attributes` for alt/title/ARIA text.
5. `raw` replacements for asset paths or non-text-node markup.
6. `regions` for large rich-text blocks that are safer to replace as a unit.
7. `slugs` for URL/directory renames.
8. `leftovers` to detect source-brand text that should no longer remain.

Prefer exact text replacements over broad regex. Use regex only when the source text is unstable but the intended match is still unambiguous.

Before a destructive run, use dry-run:

```bash
node .agent/skills/pages-scraper/scripts/retarget.mjs \
  --root ref/example \
  --recipe recipes/example.mjs \
  --dry-run
```

Then apply:

```bash
node .agent/skills/pages-scraper/scripts/retarget.mjs \
  --root ref/example \
  --recipe recipes/example.mjs
```

The report is written to `ref/example/.pages-scraper/retarget-report.txt` by default.

### 5. Validate after retargeting

```bash
node .agent/skills/pages-scraper/scripts/check-links.mjs --root ref/example
```

Also inspect the retarget report for:

- unused replacement keys;
- leftover source-brand strings;
- pages that received no changes unexpectedly.

If a browser/runtime preview is available, render representative pages at desktop and mobile sizes and compare them against the intended target before handoff.

## One-command orchestration

For a straightforward job:

```bash
node .agent/skills/pages-scraper/scripts/workflow.mjs \
  --url https://example.com \
  --out ref/example \
  --recipe recipes/example.mjs
```

This runs mirror, baseline link QA, writes an index-page outline to `ref/example/.pages-scraper/outline.txt`, applies the recipe, and runs final link QA.

Omit `--recipe` when the task is capture/inspection only.

## Retargeting rules

- Preserve layout/interaction structure unless the user explicitly asks for redesign.
- Never use blind global string replacement for brand names inside code, serialized data, or third-party script payloads; use the text-node/attribute/raw mechanisms deliberately.
- Use per-file overrides whenever the same source phrase needs different target copy on different pages.
- For repeated identical source strings on one page, an array value maps replacements by occurrence order.
- Replace structured rich-text regions as complete units when nested markup makes text-node edits fragile.
- Treat slug changes as a separate final pass so href rewriting happens before directory renames.
- Keep a leftover-token list for the old brand, old products, demo names, template names, and obvious placeholder copy.

## Failure handling

- If mirror output hits `--max-resources`, treat the result as incomplete until reviewed.
- If baseline link QA fails, distinguish intentionally remote/external resources from truly missing local assets before proceeding.
- If retarget reports many unused keys, regenerate outlines and verify that the source HTML has not changed.
- If a slug destination already exists, stop instead of overwriting it.
- If the source is client-rendered and the fetched HTML is only an app shell, this static crawler may be insufficient; switch to an authorized browser capture/render workflow rather than pretending the mirror is complete.

## Files

- `scripts/mirror.mjs` — same-origin crawler/downloader and local-path rewriter.
- `scripts/outline-html.py` — compact semantic/structural HTML outline.
- `scripts/retarget.mjs` — generic recipe-driven HTML retarget engine.
- `scripts/check-links.mjs` — local HTML/CSS reference validator.
- `scripts/workflow.mjs` — end-to-end orchestrator.
- `examples/recipe.example.mjs` — recipe schema and examples.
