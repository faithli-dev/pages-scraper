export default {
  // Exact text replacements. Prefix a key with ~ to use it as a RegExp.
  global: {
    "Original Brand": "New Brand",
    "Start a Project": "Book a Call",
    "~^A long source sentence": "Replacement copy for the matching text node.",
  },

  // Applied after global replacements, so these act as page-specific overrides.
  perFile: {
    "index.html": {
      "Old hero title": "New hero title",
      "Old CTA": ["Primary CTA", "Secondary CTA"],
    },
  },

  // Page metadata.
  meta: {
    "index.html": {
      title: "New Brand — Home",
      desc: "Short page description.",
    },
  },

  // Attribute values that should also be replaced using global/perFile maps.
  attributes: ["alt", "title", "aria-label"],

  // Literal or RegExp raw replacements for assets or markup that are not text nodes.
  raw: [
    { from: "assets/images/original-logo.svg", to: "assets/images/new-logo.svg" },
    { from: /data-old-brand="[^"]*"/g, to: 'data-old-brand="new-brand"' },
  ],

  // Region replacement is useful for rich-text blocks where piecemeal text replacement is fragile.
  // Each replacement must be the complete HTML that should replace one regex match.
  regions: [
    {
      name: "home-richtext",
      pattern: /<div class="richtext">[\s\S]*?<\/div>/g,
      files: {
        "index.html": [
          '<div class="richtext"><h2>New section</h2><p>New content.</p></div>',
        ],
      },
    },
  ],

  // Update href strings first, then rename matching directories.
  slugs: [
    ["works/original-project", "works/new-project"],
  ],

  // Tokens that should disappear from visible page text after retargeting.
  leftovers: ["Original Brand", "Original Project", "Lorem ipsum"],
};
