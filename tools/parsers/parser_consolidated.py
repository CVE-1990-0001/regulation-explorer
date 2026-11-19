#!/usr/bin/env python3
"""Parse an EUR-Lex "consolidated" format HTML into act-article JSON.

Python port of the former parser-consolidated.js (cheerio -> BeautifulSoup/lxml).

Usage: python3 parser_consolidated.py <input.html> [output.json]
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

    return output


class ConsolidatedParser:
    def __init__(self):
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
    if not class_name:
        return False

    if re.search(r"\bmodref\b", class_name):
        return False

    if re.search(r"\beli-title\b", class_name):
        return False

    return bool(re.search(r"\bnorm\b", class_name) or re.search(r"\blist\b", class_name))


def paragraph_class_from_node(node, paragraph_text):
    class_name = class_of(node)
    if re.search(r"\blist\b", class_name):
        return "list-item-l1"
    if re.match(r"^\([a-z0-9ivxlcdm]+\)", paragraph_text, re.I):
        return "list-item-l1"
    return ""


def extract_paragraph_text(node):
    clone = copy.copy(node)
    for modref in clone.select(".modref"):
        modref.decompose()
    return normalise_whitespace(clone.get_text(" "))


def _has_class(node, token):
    return isinstance(node, Tag) and bool(re.search(rf"\b{re.escape(token)}\b", class_of(node)))


def _emit_grid_list(grid_node, emitter, level):
    col1 = None
    col2 = None
    for child in grid_node.children:
        if not isinstance(child, Tag):
            continue
        if _has_class(child, "grid-list-column-1"):
            col1 = child
        elif _has_class(child, "grid-list-column-2"):
            col2 = child

    label = extract_paragraph_text(col1) if col1 else ""
    if col2 is None:
        if label:
            emitter.add(label, level=level)
        return

    # Walk col2 children in exact source order so lead-in text, nested grid-lists,
    # and follow-on subparagraphs preserve their legal sequence.
    text_buf: list[str] = []
    emitted_head = False

    def flush_buf():
        nonlocal emitted_head
        joined = normalise_whitespace(" ".join(t for t in text_buf if t))
        text_buf.clear()
        if not joined:
            return
        if not emitted_head:
            emitter.add(joined, level=level, label=label)
            emitted_head = True
        else:
            # Follow-on sentence inside the same point (after nested sub-points or second <p>)
            emitter.add(joined, level=level)

    for child in col2.children:
        if isinstance(child, NavigableString):
            s = normalise_whitespace(str(child))
            if s:
                text_buf.append(s)
            continue
        if not isinstance(child, Tag) or _has_class(child, "modref"):
            continue

        if _has_class(child, "grid-list"):
            if not emitted_head and label and not any(text_buf):
                emitter.add("", level=level, label=label)
                emitted_head = True
            else:
                flush_buf()
            _emit_grid_list(child, emitter, level + 1)
        elif child.name == "table":
            flush_buf()
            tbl_html = _fmt.sanitize_eurlex_table(child)
            if tbl_html:
                emitter.add("table", level=0, is_subparagraph=True, prelinked_html=tbl_html)
        elif child.select_one(".grid-container.grid-list"):
            flush_buf()
            _emit_consolidated_node(child, emitter, para_prefix="", is_subpara=emitted_head)
            emitted_head = True
        else:
            txt = extract_paragraph_text(child)
            if txt:
                if emitted_head:
                    emitter.add(txt, level=level)
                else:
                    text_buf.append(txt)
                    if child.name == "p":
                        flush_buf()

    flush_buf()
    if not emitted_head and label:
        emitter.add("", level=level, label=label)


def _emit_consolidated_node(node, emitter, para_prefix="", is_subpara=False):
    if not isinstance(node, Tag) or _has_class(node, "modref") or _has_class(node, "eli-title"):
        return

    if node.name == "table":
        tbl_html = _fmt.sanitize_eurlex_table(node)
        if tbl_html:
            emitter.add("table", level=0, is_subparagraph=True, prelinked_html=tbl_html)
        return

    if _has_class(node, "grid-list"):
        _emit_grid_list(node, emitter, level=1)
        return

    # Top-level numbered wrapper: <div class="norm"><span class="no-parag">1.</span><div class="norm inline-element">...</div></div>
    direct_tags = [c for c in node.children if isinstance(c, Tag) and not _has_class(c, "modref")]
    if (
        node.name == "div"
        and _has_class(node, "norm")
        and len(direct_tags) >= 1
        and _has_class(direct_tags[0], "no-parag")
    ):
        num_label = extract_paragraph_text(direct_tags[0])  # e.g. "1."
        m_num = re.match(r"^(\d+[a-z]?)\.?$", num_label, re.I)
        p_token = m_num.group(1).lower() if m_num else None
        used_prefix = False
        for sibling in direct_tags[1:]:
            prefix = num_label if not used_prefix else ""
            _emit_consolidated_node(
                sibling,
                emitter,
                para_prefix=prefix,
                is_subpara=used_prefix,
            )
            used_prefix = True
        if not used_prefix and num_label:
            emitter.add(num_label, level=0, para_num=p_token)
        return

    # Container holding nested grid-lists or multiple block children
    if node.select_one(".grid-container.grid-list") or (
        node.name == "div" and any(isinstance(c, Tag) and c.name in {"p", "div", "table"} for c in node.children)
    ):
        inline_buf: list[str] = []
        used_prefix = False

        def flush_inline():
            nonlocal used_prefix
            txt = normalise_whitespace(" ".join(x for x in inline_buf if x))
            inline_buf.clear()
            if not txt:
                return
            full = f"{para_prefix} {txt}".strip() if (para_prefix and not used_prefix) else txt
            m_num = re.match(r"^(\d+[a-z]?)\.?$", para_prefix, re.I) if (para_prefix and not used_prefix) else None
            emitter.add(
                full,
                level=0,
                para_num=m_num.group(1).lower() if m_num else None,
                is_subparagraph=is_subpara or used_prefix,
            )
            used_prefix = True

        for child in node.children:
            if isinstance(child, NavigableString):
                s = normalise_whitespace(str(child))
                if s:
                    inline_buf.append(s)
                continue
            if not isinstance(child, Tag) or _has_class(child, "modref"):
                continue
            if _has_class(child, "grid-list"):
                flush_inline()
                _emit_grid_list(child, emitter, level=1)
            elif child.name in {"p", "div", "table"}:
                flush_inline()
                prefix = para_prefix if not used_prefix else ""
                _emit_consolidated_node(
                    child,
                    emitter,
                    para_prefix=prefix,
                    is_subpara=is_subpara or used_prefix,
                )
                used_prefix = True
            else:
                inline_buf.append(extract_paragraph_text(child))
        flush_inline()
        return

    # Simple leaf paragraph / list element
    text = extract_paragraph_text(node)
    if not text:
        return
    if _has_class(node, "list") and re.match(r"^(?:\([a-z0-9]+\)|[\-\u2013\u2014])\s+", text, re.I):
        emitter.add(text, level=1)
        return
    full = f"{para_prefix} {text}".strip() if para_prefix else text
    m_num = re.match(r"^(\d+[a-z]?)\.?$", para_prefix, re.I) if para_prefix else None
    emitter.add(
        full,
        level=0,
        para_num=m_num.group(1).lower() if m_num else None,
        is_subparagraph=is_subpara,
    )


def parse(html):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        soup = BeautifulSoup(html, "lxml")
    parser = ConsolidatedParser()

    # Exclude nested quoted article headings inside amending clauses
    all_title_nodes = soup.select("p.title-article-norm")
    article_title_nodes = [
        n for n in all_title_nodes
        if not normalise_whitespace(n.get_text()).startswith(("‘", "'", "“", '"'))
    ]
    articles = []

    for index, title_node in enumerate(article_title_nodes):
        title_text = normalise_whitespace(title_node.get_text())
        article_id = parser.get_article_id_from_title(title_text, index)
        parser.register_article_number(title_text, article_id)

    for index, title_node in enumerate(article_title_nodes):
        title_text = normalise_whitespace(title_node.get_text())
        article_id = parser.get_article_id_from_title(title_text, index)

        heading = ""
        emitter = _fmt.ParagraphEmitter(
            article_id, linkify_fn=parser.link_internal_article_references
        )

        next_article_node = (
            article_title_nodes[index + 1] if index + 1 < len(article_title_nodes) else None
        )

        # If title_node lives inside an eli-subdivision wrapper div, walk inside that wrapper;
        # otherwise walk siblings up to next_article_node.
        parent = title_node.parent
        siblings_iter = title_node.next_siblings

        has_prior_paragraph = False
        for current in siblings_iter:
            if current is next_article_node:
                break
            if isinstance(current, Tag) and next_article_node and next_article_node in current.descendants:
                break

            if isinstance(current, Tag):
                class_name = class_of(current)

                if not heading and re.search(r"\beli-title\b", class_name):
                    heading = _fmt.clean_heading_text(extract_paragraph_text(current))
                elif current.name == "table" or should_capture_paragraph_node(current):
                    before_len = len(emitter.paragraphs)
                    is_standalone_subpara = (
                        current.name == "p"
                        and has_prior_paragraph
                        and not re.match(r"^\d+[a-z]?\.\s+", extract_paragraph_text(current))
                    )
                    _emit_consolidated_node(
                        current, emitter, is_subpara=is_standalone_subpara
                    )
                    if len(emitter.paragraphs) > before_len:
                        has_prior_paragraph = True

        articles.append({
            "id": article_id,
            "title": title_text or article_id,
            "heading": heading,
            "paragraphs": emitter.paragraphs,
        })

    return articles


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 parser_consolidated.py <input.html> [output.json]", file=sys.stderr)
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


if __name__ == "__main__":
    main()
