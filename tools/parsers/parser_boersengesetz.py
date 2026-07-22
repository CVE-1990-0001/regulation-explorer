#!/usr/bin/env python3
"""Parse the German Boersengesetz (gesetze-im-internet) HTML into act-article JSON.

Python port of the former parser-boersengesetz.js (cheerio -> BeautifulSoup/lxml).

Usage: python3 parser_boersengesetz.py <input.html> [output.json]
"""
import json
import os
import re
import sys
import urllib.parse

from bs4 import BeautifulSoup


def normalise_whitespace(value):
    return re.sub(r"\s+", " ", f"{value or ''}".replace("\u00A0", " ")).strip()


def paragraph_class_from_text(text):
    if re.match(r"^\([0-9]+[a-z]?\)", text, re.I):
        return "list-item-l1"
    if re.match(r"^[0-9]+\.", text):
        return "list-item-l1"
    if re.match(r"^[a-z]\)", text, re.I):
        return "list-item-l1"
    if re.match(r"^[\-\u2013]\s", text):
        return "list-item-l1"
    return ""


def extract_article_token(raw_label):
    clean_label = re.sub(
        r"[^0-9a-zA-Z\s]",
        " ",
        re.sub(r"[\u00A7\uFFFD]", " ", normalise_whitespace(raw_label)),
    ).strip()

    match = re.search(r"\b([0-9]+[a-z]?)\b", clean_label, re.I)
    if not match:
        return None
    return match.group(1).lower()


# -- Linkification helpers ---------------------------------------------------

def escape_html(raw):
    return (
        f"{raw or ''}"
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def pad_num4(n):
    return re.sub(r"\D", "", f"{n or ''}").zfill(4)


def eurlex_url(celex_id):
    quoted = urllib.parse.quote(celex_id, safe="-_.!~*'()")
    return f"https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:{quoted}"


def wrap_external_link(matched_text, celex_id, preview_label):
    href = eurlex_url(celex_id)
    safe_preview = escape_html(f"{preview_label} \u2013 opens on EUR-Lex")
    return (
        f'<a href="{href}" class="legal-link" target="_blank" '
        f'rel="noopener noreferrer" data-preview="{safe_preview}">{matched_text}</a>'
    )


def wrap_internal_link(matched_text, article_token, known_tokens):
    key = f"{article_token}".lower()
    if key not in known_tokens:
        return matched_text  # unknown token -> plain text (references another act)
    return (
        f'<a href="#art_{key}" class="internal-article-link" '
        f'rel="noopener">{matched_text}</a>'
    )


def is_external_law_ref(after_text):
    """Detect "des/der <CapitalLawName>" within a window after a section match."""
    stop = re.search(r"§|\.\s+[A-Z\u00C4\u00D6\u00DC]|[;!?]", after_text)
    if stop is not None:
        window = after_text[: min(stop.start(), 90)]
    else:
        window = after_text[:90]
    return bool(re.search(r"\b(?:des|der)\s+[A-Z\u00C4\u00D6\u00DC]", window))


def linkify_text(raw_text, known_tokens):
    # HTML-escape the entire text once; subsequent replacements insert trusted HTML.
    s = escape_html(raw_text)

    # 1. EU Regulations (German: "Verordnung (EU) [Nr.] N/YYYY" or "YYYY/N")
    def repl_verordnung(m):
        a, b = m.group(1), m.group(2)
        if len(a) == 4 and int(a) >= 2000:
            year, num = a, b  # YYYY/N format
        else:
            num, year = a, b  # N/YYYY format
        celex = f"3{year}R{pad_num4(num)}"
        return wrap_external_link(m.group(0), celex, f"Regulation (EU) {a}/{b}")

    s = re.sub(
        r"Verordnung\s+\(EU\)\s+(?:Nr\.\s*)?(\d+)/(\d+)\b",
        repl_verordnung,
        s,
    )

    # 2. EU Directives (German: "Richtlinie YYYY/N/EU" or "/EG")
    def repl_richtlinie(m):
        year, num, suffix = m.group(1), m.group(2), m.group(3)
        celex = f"3{year}L{pad_num4(num)}"
        return wrap_external_link(m.group(0), celex, f"Directive {year}/{num}/{suffix}")

    s = re.sub(
        r"Richtlinie\s+(\d{4})/(\d{1,4})/(EU|EG)\b",
        repl_richtlinie,
        s,
    )

    # 3. Double-section plural references (e.g. "§§ 22 bis 24", "§§ 4a und 4c")
    #    Processed BEFORE the single-section pattern.
    def repl_plural(m):
        num_part = m.group(1)
        if is_external_law_ref(m.string[m.end():]):
            return m.group(0)
        linked_nums = re.sub(
            r"\b(\d+[a-z]?)\b",
            lambda tm: (
                f'<a href="#art_{tm.group(1).lower()}" class="internal-article-link" '
                f'rel="noopener">{tm.group(1)}</a>'
                if tm.group(1).lower() in known_tokens
                else tm.group(1)
            ),
            num_part,
        )
        return "\u00a7\u00a7 " + linked_nums

    s = re.sub(
        r"\u00a7\u00a7\s*(\d+[a-z]?(?:\s+(?:bis|und|oder|,)\s+\d+[a-z]?)*)",
        repl_plural,
        s,
    )

    # 4. Single-section references (e.g. "§ 19", "§ 4a", "§ 25 Absatz 1")
    def repl_single(m):
        num = m.group(1)
        if is_external_law_ref(m.string[m.end():]):
            return m.group(0)
        return wrap_internal_link(m.group(0), num, known_tokens)

    s = re.sub(r"\u00a7\s*(\d+[a-z]?)", repl_single, s)

    return s


def parse(html):
    soup = BeautifulSoup(html, "lxml")

    # -- Pass 1: collect known article tokens --
    known_article_tokens = set()

    for node in soup.select('div.jnnorm[title="Einzelnorm"]'):
        label_node = node.select_one(".jnheader .jnenbez")
        raw_label = normalise_whitespace(label_node.get_text()) if label_node else ""
        token = extract_article_token(raw_label)
        if token:
            known_article_tokens.add(token.lower())

    # -- Pass 2: parse articles with linkification --
    articles = []

    for node in soup.select('div.jnnorm[title="Einzelnorm"]'):
        header = node.select_one(".jnheader")
        if header is None:
            continue
        label_node = header.select_one(".jnenbez")
        raw_label = normalise_whitespace(label_node.get_text()) if label_node else ""
        title_node = header.select_one(".jnentitel")
        heading = normalise_whitespace(title_node.get_text()) if title_node else ""

        article_token = extract_article_token(raw_label)
        if not article_token:
            continue

        article_id = f"art_{article_token}"
        title = raw_label or f"\u00a7 {article_token}"

        paragraph_counter = 0
        paragraphs = []

        for paragraph_node in node.select("div.jurAbsatz"):
            raw_text = normalise_whitespace(paragraph_node.get_text())
            if not raw_text or raw_text == "-":
                continue

            paragraph_counter += 1
            paragraphs.append({
                "id": f"{article_id}__{paragraph_counter}",
                "text": linkify_text(raw_text, known_article_tokens),
                "class": paragraph_class_from_text(raw_text),
            })

        if not paragraphs:
            continue

        articles.append({
            "id": article_id,
            "title": title,
            "heading": heading,
            "paragraphs": paragraphs,
        })

    return articles


def main():
    if len(sys.argv) < 2:
        print(
            "Usage: python3 parser_boersengesetz.py <input.html> [output.json]",
            file=sys.stderr,
        )
        sys.exit(1)

    input_file = sys.argv[1]
    if not os.path.exists(input_file):
        print(f"File not found: {input_file}", file=sys.stderr)
        sys.exit(1)

    output_file = sys.argv[2] if len(sys.argv) > 2 else re.sub(
        r"\.html$", ".json", input_file, flags=re.I
    )

    # Source is served as latin-1 (ISO-8859-1), matching the original parser.
    with open(input_file, encoding="latin-1") as fh:
        html = fh.read()

    articles = parse(html)

    with open(output_file, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(articles, ensure_ascii=False, indent=2) + "\n")

    print(f"Found {len(articles)} articles.")


if __name__ == "__main__":
    main()
