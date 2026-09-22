# pages-scraper

A small, dependency-free website mirroring + retargeting toolkit packaged as an agent skill.

It is designed for authorized site migration, archival, template retargeting, and design-reference workflows where you want a deterministic local copy before changing content.

## What it does

1. **Mirror** — crawl a public same-origin site and download pages/assets.
2. **Validate** — check that local HTML/CSS references resolve.
3. **Outline** — reduce large generated HTML into a compact structure/text view for an agent or human.
4. **Retarget** — apply repeatable project-specific text, metadata, rich-text, asset-path, and slug changes from a recipe.
5. **Validate again** — fail fast on broken local references and scan for leftover source-brand copy.

## Requirements

- Node.js 20+ recommended (Node 18+ with built-in `fetch` should also work).
- Python 3.9+ for the HTML outline helper.
- No npm dependencies.

## Quick start

```bash
git clone https://github.com/faithli-dev/pages-scraper.git
cd pages-scraper

node .agent/skills/pages-scraper/scripts/workflow.mjs \
  --url https://example.com \
  --out ref/example
```

To retarget the mirrored site, copy the example recipe and edit it:

```bash
mkdir -p recipes
cp .agent/skills/pages-scraper/examples/recipe.example.mjs recipes/example.mjs

node .agent/skills/pages-scraper/scripts/retarget.mjs \
  --root ref/example \
  --recipe recipes/example.mjs \
  --dry-run

node .agent/skills/pages-scraper/scripts/retarget.mjs \
  --root ref/example \
  --recipe recipes/example.mjs

node .agent/skills/pages-scraper/scripts/check-links.mjs --root ref/example
```

## Agent skill

The full operating procedure is in:

```text
.agent/skills/pages-scraper/SKILL.md
```

Agents working on a mirror/clone/retarget task should read that file before editing the mirrored output.

## Recipe model

A recipe is a JavaScript module that default-exports an object. It can define:

- `global`: global exact/regex visible-text replacements;
- `perFile`: page-specific overrides;
- `meta`: title/description per page;
- `attributes`: attributes to retarget, such as `alt` and `aria-label`;
- `raw`: deliberate literal or regex replacements outside visible text nodes;
- `regions`: complete rich-text/markup block replacements;
- `slugs`: href + directory rename pairs;
- `leftovers`: old-brand/demo tokens that should not remain.

See `.agent/skills/pages-scraper/examples/recipe.example.mjs`.

## Safety and scope

This project does not bypass authentication, paywalls, CAPTCHA, or access controls. The mirror is same-origin by default. Use it only where you have the right or permission to copy/use the source material for the requested purpose.

## License

See [LICENSE](LICENSE).
