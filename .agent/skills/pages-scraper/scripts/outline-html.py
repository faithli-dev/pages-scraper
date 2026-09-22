#!/usr/bin/env python3
import argparse
import html
import re
from html.parser import HTMLParser

IGNORE = {
    "img", "source", "path", "input", "br", "hr", "meta", "link", "embed", "area",
    "base", "col", "track", "wbr", "circle", "rect", "line", "polygon", "polyline",
    "g", "defs", "use", "clipPath", "stop", "linearGradient", "filter", "feColorMatrix",
    "feGaussianBlur", "video", "picture", "audio", "iframe",
}
SKIP_SUBTREES = {"script", "style", "svg"}
DEFAULT_ATTRS = ("href", "id", "data-navbar", "role", "aria-label")


class Outline(HTMLParser):
    def __init__(self, max_depth=99, text_limit=110, attrs=DEFAULT_ATTRS):
        super().__init__(convert_charrefs=False)
        self.depth = 0
        self.lines = []
        self.max_depth = max_depth
        self.text_limit = text_limit
        self.attrs_to_show = attrs
        self.skip_tag = None
        self.skip_depth = 0

    def _attrs(self, attrs):
        d = dict(attrs)
        classes = d.get("class", "") or ""
        classes = " ".join(
            c for c in classes.split() if not c.startswith(("reveal", "wf-", "js-"))
        )
        extra = ""
        for key in self.attrs_to_show:
            if key in d and d[key] is not None:
                extra += f" {key}={str(d[key])[:60]}"
        return classes, extra

    def handle_starttag(self, tag, attrs):
        if self.skip_tag:
            if tag == self.skip_tag:
                self.skip_depth += 1
            return
        if tag in SKIP_SUBTREES:
            self.skip_tag = tag
            self.skip_depth = 1
            return
        if tag in IGNORE:
            return
        classes, extra = self._attrs(attrs)
        cpart = " class=" + repr(classes) if classes else ""
        if self.depth <= self.max_depth:
            self.lines.append("  " * self.depth + f"<{tag}{cpart}{extra}>")
        self.depth += 1

    def handle_startendtag(self, tag, attrs):
        if self.skip_tag or tag in SKIP_SUBTREES or tag in IGNORE:
            return
        classes, extra = self._attrs(attrs)
        cpart = " class=" + repr(classes) if classes else ""
        if self.depth <= self.max_depth:
            self.lines.append("  " * self.depth + f"<{tag}{cpart}{extra} />")

    def handle_endtag(self, tag):
        if self.skip_tag:
            if tag == self.skip_tag:
                self.skip_depth -= 1
                if self.skip_depth <= 0:
                    self.skip_tag = None
                    self.skip_depth = 0
            return
        if tag in SKIP_SUBTREES or tag in IGNORE:
            return
        self.depth = max(0, self.depth - 1)

    def handle_data(self, data):
        if self.skip_tag:
            return
        text = html.unescape(data).strip()
        text = re.sub(r"\s+", " ", text)
        if text and self.depth <= self.max_depth:
            self.lines.append("  " * self.depth + '"' + text[: self.text_limit] + '"')


def main():
    parser = argparse.ArgumentParser(description="Print a compact structural/text outline of an HTML file.")
    parser.add_argument("file", help="HTML file to inspect")
    parser.add_argument("--max-depth", type=int, default=99)
    parser.add_argument("--text-limit", type=int, default=110)
    parser.add_argument("--attrs", default=",".join(DEFAULT_ATTRS), help="Comma-separated attributes to include")
    args = parser.parse_args()

    attrs = tuple(a.strip() for a in args.attrs.split(",") if a.strip())
    parser_ = Outline(max_depth=args.max_depth, text_limit=args.text_limit, attrs=attrs)
    with open(args.file, encoding="utf-8", errors="replace") as fh:
        parser_.feed(fh.read())
    print("\n".join(parser_.lines))


if __name__ == "__main__":
    main()
