#!/usr/bin/env python3
"""Parse an EUR-Lex "Official Journal" (OJ) format HTML into act-article JSON.

Python port of the former parser-oj.js (cheerio -> BeautifulSoup/lxml).

Usage: python3 parser_oj.py <input.html> [output.json]
"""
import copy
import importlib.util
import json
import os
import re
import sys
import warnings

from bs4 import BeautifulSoup, NavigableString, Tag, XMLParsedAsHTMLWarning

_FMT_SPEC = importlib.util.spec_from_file_location(
    "parsers_formatting", os.path.join(os.path.dirname(os.path.abspath(__file__)), "formatting.py")
)
_fmt = sys.modules.get("parsers_formatting")
if _fmt is None:
    _fmt = importlib.util.module_from_spec(_FMT_SPEC)
    sys.modules["parsers_formatting"] = _fmt
    _FMT_SPEC.loader.exec_module(_fmt)


def normalise_whitespace(value):
    return re.sub(r"\s+", " ", f"{value or ''}".replace("\u00A0", " ")).strip()


def escape_html(value):
    return (
        f"{value or ''}"
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def pad_number(value):
    return re.sub(r"\D", "", f"{value or ''}").zfill(4)


def build_eurlex_url_from_celex(celex_id):
    return f"https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:{celex_id}"


def build_directive_celex(year, number):
    return f"3{year}L{pad_number(number)}"


def build_regulation_celex(year, number):
    return f"3{year}R{pad_number(number)}"


def wrap_legal_link(display_text, celex_id, preview_label):
    href = build_eurlex_url_from_celex(celex_id)
    safe_preview = escape_html(f"{preview_label} \u2013 opens on EUR-Lex")
    return (
        f'<a href="{href}" class="legal-link" target="_blank" '
        f'rel="noopener noreferrer" data-preview="{safe_preview}">{display_text}</a>'
    )


def link_external_legal_references(text):
    output = text

    output = re.sub(
        r"\bDirective\s+(\d{4})/(\d{2,4})/(EU|EC)\b",
        lambda m: wrap_legal_link(
            m.group(0),
            build_directive_celex(m.group(1), m.group(2)),
            f"Directive {m.group(1)}/{m.group(2)}/{m.group(3)}",
        ),
        output,
    )

    output = re.sub(
        r"\bRegulation\s*\((EU|EC)\)\s*(?:No\s*)?(\d{1,4})/(\d{4})\b",
        lambda m: wrap_legal_link(
            m.group(0),
            build_regulation_celex(m.group(3), m.group(2)),
            f"Regulation ({m.group(1)}) {m.group(2)}/{m.group(3)}",
        ),
        output,
    )

    # Handle Decision No X/YYYY/EC format
    output = re.sub(
        r"\bDecision\s+No\s+(\d+)/(\d{4})/E[CU]\b",
        lambda m: wrap_legal_link(
            m.group(0), f"3{m.group(2)}D{pad_number(m.group(1))}", m.group(0)
        ),
        output,
    )

    return output


class OjParser:
    def __init__(self, soup):
        self.soup = soup
        self.article_number_to_id = {}

    def get_article_id_from_title(self, title_text, fallback_index):
        match = re.match(r"^Article\s+([0-9]+[a-z]?)", normalise_whitespace(title_text), re.I)
        if not match:
            return f"art_{fallback_index + 1}"
        return f"art_{match.group(1).lower()}"

    def register_article_number(self, title_text, article_id):
        match = re.match(r"^Article\s+([0-9]+[a-z]?)", normalise_whitespace(title_text), re.I)
        if not match or not article_id:
            return
        self.article_number_to_id[match.group(1).lower()] = article_id

    def build_internal_link(self, display_text, article_number_token):
        key = f"{article_number_token or ''}".lower()
        article_id = self.article_number_to_id.get(key)
        if not article_id:
            return escape_html(display_text)
        safe_text = escape_html(display_text)
        return (
            f'<a href="#{article_id}" class="internal-article-link" '
            f'target="_blank" rel="noopener">{safe_text}</a>'
        )

    def link_internal_article_references(self, text):
        if not text:
            return ""

        escaped = escape_html(text)

        def replace_article_list(value):
            return re.sub(
                r"\b[0-9]+[a-z]?\b",
                lambda m: self.build_internal_link(m.group(0), m.group(0)),
                value,
                flags=re.I,
            )

        def articles_repl(full_match):
            list_part = full_match.group(1)
            replaced_list = replace_article_list(list_part)
            return full_match.group(0).replace(list_part, replaced_list, 1)

        linked = re.sub(
            r"\bArticles\s+([0-9a-z\s,\-\u2013toandor]+)",
            articles_repl,
            escaped,
            flags=re.I,
        )

        def article_repl(full_match):
            article_number = full_match.group(1)
            return full_match.group(0).replace(
                article_number, self.build_internal_link(article_number, article_number), 1
            )

        linked = re.sub(
            r"\bArticle\s+([0-9]+[a-z]?)(\([0-9]+\))?",
            article_repl,
            linked,
            flags=re.I,
        )

        return link_external_legal_references(linked)


def class_of(node):
    if not isinstance(node, Tag):
        return ""
    cls = node.get("class")
    if not cls:
        return ""
    return " ".join(cls) if isinstance(cls, list) else str(cls)


def should_capture_paragraph_node(node):
    if not isinstance(node, Tag):
        return False

    class_name = class_of(node)
    tag_name = node.name

    # In OJ format, paragraphs are typically in p tags with oj-normal
    if tag_name == "p" and (
        re.search(r"\boj-normal\b", class_name) or re.search(r"\beli-preamble-ind\b", class_name)
    ):
        return True

    # Also capture divs that contain paragraph content
    if tag_name == "div" and not class_name:
        for child in node.children:
            if isinstance(child, Tag) and child.name == "p":
                if re.search(r"\boj-normal\b", class_of(child)):
                    return True

    # Also capture tables that contain oj-normal paragraphs (e.g., definition lists)
    if tag_name == "table":
        for desc in node.find_all("p"):
            if re.search(r"\boj-normal\b", class_of(desc)):
                return True

    return False


def paragraph_class_from_node(node, paragraph_text):
    class_name = class_of(node)
    if re.search(r"\blist\b", class_name):
        return "list-item-l1"
    if re.match(r"^\([a-z0-9ivxlcdm]+\)", paragraph_text, re.I):
        return "list-item-l1"
    return ""


def _clean_node_text(node):
    clone = copy.copy(node)
    for modref in clone.select(".modref"):
        modref.decompose()
    return normalise_whitespace(clone.get_text(" "))


def _direct_table_rows(table_tag):
    rows = table_tag.find_all("tr", recursive=False)
    for section_name in ("thead", "tbody", "tfoot"):
        for section in table_tag.find_all(section_name, recursive=False):
            rows.extend(section.find_all("tr", recursive=False))
    return rows


_OJ_LIST_LABEL_RE = re.compile(
    r"^[‘'“\"„]?(?:\([0-9a-z]+\)|[0-9]+(?:\.[0-9]+)*[a-z]?\.|[a-z]\)|[\-\u2013\u2014])$",
    re.I,
)


def _classify_oj_table(table_tag):
    """Return ``('list', rows_data)`` for 2-col/indent+2-col list tables, else ``('data', None)``."""
    classes = class_of(table_tag)
    if re.search(r"\boj-table\b", classes):
        return "data", None

    rows = _direct_table_rows(table_tag)
    if not rows:
        return "empty", None

    parsed_rows = []
    for tr in rows:
        cells = tr.find_all(["td", "th"], recursive=False)
        if not cells:
            continue
        # Drop empty leading spacer cell used in indented OJ tables: <td></td><td>(a)</td><td>...</td>
        idx = 0
        while idx < len(cells) - 2 and not _clean_node_text(cells[idx]):
            idx += 1
        effective = cells[idx:]
        if len(effective) != 2:
            return "data", None
        label_txt = _clean_node_text(effective[0])
        if label_txt and not _OJ_LIST_LABEL_RE.match(label_txt) and len(label_txt) > 12:
            return "data", None
        parsed_rows.append((label_txt, effective[1]))

    if not parsed_rows:
        return "empty", None
    return "list", parsed_rows


def _emit_oj_list_cell(label_txt, body_td, emitter, level):
    text_buf: list[str] = []
    emitted_head = False

    def flush_buf():
        nonlocal emitted_head
        joined = normalise_whitespace(" ".join(t for t in text_buf if t))
        text_buf.clear()
        if not joined:
            return
        if not emitted_head:
            emitter.add(joined, level=level, label=label_txt)
            emitted_head = True
        else:
            emitter.add(joined, level=level)

    for child in body_td.children:
        if isinstance(child, NavigableString):
            s = normalise_whitespace(str(child))
            if s:
                text_buf.append(s)
            continue
        if not isinstance(child, Tag) or re.search(r"\bmodref\b", class_of(child)):
            continue

        if child.name == "table":
            kind, sub_rows = _classify_oj_table(child)
            if kind == "list":
                if not emitted_head and label_txt and not any(text_buf):
                    emitter.add("", level=level, label=label_txt)
                    emitted_head = True
                else:
                    flush_buf()
                for sub_label, sub_td in sub_rows:
                    _emit_oj_list_cell(sub_label, sub_td, emitter, level + 1)
            elif kind == "data":
                flush_buf()
                tbl_html = _fmt.sanitize_eurlex_table(child)
                if tbl_html:
                    emitter.add("table", level=0, is_subparagraph=True, prelinked_html=tbl_html)
        elif child.find("table"):
            flush_buf()
            _emit_oj_container(child, emitter, level_base=level)
            emitted_head = True
        else:
            txt = _clean_node_text(child)
            if txt:
                if emitted_head:
                    emitter.add(txt, level=level)
                else:
                    text_buf.append(txt)
                    if child.name in {"p", "div"}:
                        flush_buf()

    flush_buf()
    if not emitted_head and label_txt:
        emitter.add("", level=level, label=label_txt)


def _emit_oj_container(container, emitter, level_base=0):
    seen_primary = False
    for child in container.children:
        if not isinstance(child, Tag):
            continue
        cls = class_of(child)
        if re.search(r"\bmodref\b|\beli-title\b", cls):
            continue

        if child.name == "table":
            kind, rows = _classify_oj_table(child)
            if kind == "list":
                for lbl, td in rows:
                    _emit_oj_list_cell(lbl, td, emitter, level=level_base + 1)
                seen_primary = True
            elif kind == "data":
                tbl_html = _fmt.sanitize_eurlex_table(child)
                if tbl_html:
                    emitter.add("table", level=0, is_subparagraph=True, prelinked_html=tbl_html)
                    seen_primary = True
        elif child.name == "div":
            _emit_oj_container(child, emitter, level_base=level_base)
            seen_primary = True
        elif child.name == "p":
            txt = _clean_node_text(child)
            if not txt:
                continue
            is_numbered = bool(re.match(r"^\d+[a-z]?\.\s+", txt))
            emitter.add(
                txt,
                level=level_base,
                is_subparagraph=(level_base == 0 and seen_primary and not is_numbered),
            )
            seen_primary = True


def _is_top_level_article_div(div_tag):
    parent = div_tag.parent
    while isinstance(parent, Tag):
        pid = parent.get("id") or ""
        if parent.name == "div" and pid.startswith("art_"):
            return False
        parent = parent.parent
    return True


def parse(html):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        soup = BeautifulSoup(html, "lxml")
    parser = OjParser(soup)

    candidate_divs = [
        d for d in soup.select('div.eli-subdivision[id^="art_"]')
        if _is_top_level_article_div(d)
    ]
    article_pairs = []
    for div in candidate_divs:
        title_node = div.find("p", class_="oj-ti-art", recursive=False)
        if title_node is None:
            continue
        title_text = normalise_whitespace(title_node.get_text())
        if title_text.startswith(("‘", "'", "“", '"')):
            continue
        article_pairs.append((div, title_node, title_text))

    articles = []

    # First pass: register article numbers
    for index, (_, _, title_text) in enumerate(article_pairs):
        article_id = parser.get_article_id_from_title(title_text, index)
        parser.register_article_number(title_text, article_id)

    # Second pass: extract articles with their full hierarchical content
    for index, (art_div, title_node, title_text) in enumerate(article_pairs):
        article_id = parser.get_article_id_from_title(title_text, index)
        heading = ""
        emitter = _fmt.ParagraphEmitter(
            article_id, linkify_fn=parser.link_internal_article_references
        )

        has_prior = False
        for current in title_node.next_siblings:
            if not isinstance(current, Tag):
                continue
            class_name = class_of(current)
            if not heading and re.search(r"\beli-title\b", class_name):
                heading = _fmt.clean_heading_text(_clean_node_text(current))
                continue
            if re.search(r"\bmodref\b", class_name):
                continue

            before = len(emitter.paragraphs)
            if current.name == "table":
                kind, rows = _classify_oj_table(current)
                if kind == "list":
                    for lbl, td in rows:
                        _emit_oj_list_cell(lbl, td, emitter, level=1)
                elif kind == "data":
                    tbl_html = _fmt.sanitize_eurlex_table(current)
                    if tbl_html:
                        emitter.add("table", level=0, is_subparagraph=True, prelinked_html=tbl_html)
            elif current.name == "div":
                _emit_oj_container(current, emitter, level_base=0)
            elif current.name == "p" and should_capture_paragraph_node(current):
                txt = _clean_node_text(current)
                if txt:
                    is_numbered = bool(re.match(r"^\d+[a-z]?\.\s+", txt))
                    emitter.add(txt, level=0, is_subparagraph=(has_prior and not is_numbered))
            if len(emitter.paragraphs) > before:
                has_prior = True

        if emitter.paragraphs:
            articles.append({
                "id": article_id,
                "title": title_text or article_id,
                "heading": heading,
                "paragraphs": emitter.paragraphs,
            })

    return articles


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 parser_oj.py <input.html> [output.json]", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]
    if not os.path.exists(input_file):
        print(f"File not found: {input_file}", file=sys.stderr)
        sys.exit(1)

    output_file = sys.argv[2] if len(sys.argv) > 2 else re.sub(
        r"\.html$", ".json", input_file, flags=re.I
    )

    with open(input_file, encoding="utf-8") as fh:
        html = fh.read()

    articles = parse(html)

    with open(output_file, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(articles, ensure_ascii=False, indent=2) + "\n")

    print(f"Found {len(articles)} articles.")
    print(f"Wrote {len(articles)} articles to {output_file}")


if __name__ == "__main__":
    main()
