#!/usr/bin/env python3
"""Parse BaFin's MaRisk circular (HTML edition on bafin.de) into act-article JSON.

Every AT/BT/BTO/BTR module that carries text becomes an article (id
``art_at_4_3_2``, title ``AT 4.3.2``). Each top-level list item is a
Textziffer (Tz.) and becomes a numbered paragraph; nested lists and inline
"a) ... b) ..." lines become sub-points. Section levels come from the module
code, not the HTML heading tag, because bafin.de nests h2/h3/h4 inconsistently.

The HTML edition carries the requirement text only; BaFin publishes the
Erläuterungen (explanatory notes) in the PDF edition.

Usage: python3 parser_marisk.py <input.html> [output.json]
"""
import html
import importlib.util
import json
import os
import re
import sys

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

_FMT_SPEC = importlib.util.spec_from_file_location(
    "parsers_formatting", os.path.join(os.path.dirname(os.path.abspath(__file__)), "formatting.py")
)
_fmt = sys.modules.get("parsers_formatting")
if _fmt is None:
    _fmt = importlib.util.module_from_spec(_FMT_SPEC)
    sys.modules["parsers_formatting"] = _fmt
    _FMT_SPEC.loader.exec_module(_fmt)

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
HEADING_RE = re.compile(r"^(AT|BTO|BTR|BT)(?:\s+(\d+(?:\.\d+)*))?\s+(\S.*)$")
LETTER_LINE_RE = re.compile(r"^([a-z]{1,2})\)\s+(\S.*)$")
# Placeholder for <br>; split on it before whitespace normalisation, because the
# source HTML also contains formatting newlines inside running text.
BR = "\x00"
ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"]


def module_article(heading_text):
    """Return (article_id, title, heading) for a MaRisk module heading, else None."""
    match = HEADING_RE.match(_fmt.normalise_ws(heading_text))
    if not match:
        return None
    code, number, heading = match.groups()
    title = f"{code} {number}" if number else code
    article_id = "art_" + "_".join([code.lower(), *(number.split(".") if number else [])])
    return article_id, title, heading


def _list_label(index, level):
    if level <= 1:
        return f"{chr(ord('a') + index)})" if index < 26 else f"{index + 1})"
    return f"{ROMAN[index]})" if index < len(ROMAN) else f"{index + 1})"


def _inline(node):
    if isinstance(node, Comment):
        return ""
    if isinstance(node, NavigableString):
        return str(node)
    if node.name == "br":
        return BR
    return "".join(_inline(child) for child in node.children)


def _lines(raw):
    return [line for line in (_fmt.normalise_ws(part) for part in raw.split(BR)) if line]


class _ItemWriter:
    """Emits one list item: its lead line, continuation lines and nested lists."""

    def __init__(self, emitter, level, label, para_num=None):
        self.emitter = emitter
        self.level = level
        self.label = label
        self.para_num = para_num
        self.head_done = False
        self.buffer = []

    def line(self, text):
        if not self.head_done:
            self.emitter.add(text, level=self.level, label=self.label, para_num=self.para_num)
            self.head_done = True
            return
        letter = LETTER_LINE_RE.match(text)
        if letter:
            self.emitter.add(letter.group(2), level=self.level + 1, label=f"{letter.group(1)})")
        else:
            self.emitter.add(text, level=self.level, is_subparagraph=self.level == 0)

    def flush(self):
        for text in _lines("".join(self.buffer)):
            self.line(text)
        self.buffer.clear()

    def walk(self, node):
        for child in node.children:
            if isinstance(child, Comment):
                continue
            if isinstance(child, NavigableString):
                self.buffer.append(str(child))
            elif child.name in {"p", "div"}:
                self.flush()
                self.walk(child)
                self.flush()
            elif child.name in {"ol", "ul"}:
                self.flush()
                if not self.head_done:
                    # A list as the very first content still needs its Tz anchor.
                    self.line(self.label or "")
                _emit_list(child, self.emitter, self.level + 1)
            else:
                self.buffer.append(_inline(child))
        self.flush()


def _emit_list(list_tag, emitter, level):
    items = list_tag.find_all("li", recursive=False)
    for index, item in enumerate(items):
        label = _list_label(index, level) if list_tag.name == "ol" else "\u2013"
        writer = _ItemWriter(emitter, level, label)
        writer.walk(item)


class _Article:
    def __init__(self, article_id, title, heading):
        self.article_id = article_id
        self.title = title
        self.heading = heading
        self.emitter = _fmt.ParagraphEmitter(
            article_id, linkify_fn=lambda text: html.escape(text, quote=False)
        )
        self.next_tz = 1

    def textziffern(self, ol):
        start = ol.get("start")
        if start and str(start).isdigit():
            self.next_tz = int(start)
        for item in ol.find_all("li", recursive=False):
            tz = str(self.next_tz)
            writer = _ItemWriter(self.emitter, 0, f"{tz}.", para_num=tz)
            writer.walk(item)
            self.next_tz += 1

    def free_text(self, node):
        for text in _lines(_inline(node)):
            self.emitter.add(text, level=0)

    def as_dict(self):
        return {
            "id": self.article_id,
            "title": self.title,
            "heading": self.heading,
            "paragraphs": self.emitter.paragraphs,
        }


def parse(source):
    soup = BeautifulSoup(source, "lxml")
    container = soup.select_one("div.l-article__content")
    if container is None:
        return []

    articles = []
    current = None

    def close():
        if current is not None and current.emitter.paragraphs:
            articles.append(current.as_dict())

    def walk(node):
        nonlocal current
        for child in node.children:
            if not isinstance(child, Tag):
                continue
            if child.name in HEADING_TAGS:
                close()
                found = module_article(_inline(child).replace(BR, " "))
                current = _Article(*found) if found else None
            elif child.name in {"div", "section", "article"}:
                walk(child)
            elif current is None:
                continue
            elif child.name == "ol":
                current.textziffern(child)
            elif child.name == "ul":
                _emit_list(child, current.emitter, 1)
            elif child.name == "p":
                current.free_text(child)

    walk(container)
    close()
    return articles


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 parser_marisk.py <input.html> [output.json]", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]
    if not os.path.exists(input_file):
        print(f"File not found: {input_file}", file=sys.stderr)
        sys.exit(1)

    output_file = sys.argv[2] if len(sys.argv) > 2 else re.sub(
        r"\.html?$", ".json", input_file, flags=re.I
    )

    with open(input_file, encoding="utf-8") as fh:
        articles = parse(fh.read())

    with open(output_file, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(articles, ensure_ascii=False, indent=2) + "\n")

    print(f"Found {len(articles)} articles.")


if __name__ == "__main__":
    main()
