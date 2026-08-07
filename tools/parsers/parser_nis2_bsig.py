#!/usr/bin/env python3
"""Parse the German BSI-Gesetz (BSIG) from the NIS-2 Umsetzungsgesetz PDF.

The NIS-2-Umsetzungsgesetz (Bundesgesetzblatt 2025 Teil I Nr. 301) is an omnibus
act (Mantelgesetz). Its Artikel 1 enacts the new BSI-Gesetz (BSIG) -- the
substantive NIS-2 transposition, structured as German sections (§§ 1-65) plus two
annexes (Anlage 1, Anlage 2). Artikel 2-30 are only amendments to other laws and
are not parsed.

The parser extracts §§ 1-65 (each as an act "article") and the two annexes into
the act-article JSON shape consumed by the regulation browser. Text is emitted as
plain (HTML-escaped) content; cross-references are added afterwards by
``tools/link_references.py``.

Usage: python3 parser_nis2_bsig.py <input.pdf> [output.json]
"""
import html
import json
import os
import re
import sys

import pdfplumber

RUNNING_HEADER = re.compile(r"^Bundesgesetzblatt Jahrgang ")
SECTION_HEAD = re.compile(r"^§ (\d+[a-z]?)$")
ARTIKEL_HEAD = re.compile(r"^Artikel (\d+)$")
STRUCT_MARKER = re.compile(r"^(?:Teil|Kapitel|Abschnitt|Unterabschnitt)\s+[\dIVXLC]+$")
ABSATZ = re.compile(r"^\((\d+[a-z]?)\)\s")
NUM_ITEM = re.compile(r"^(\d+[a-z]?)\.\s")
ANLAGE_HEAD = re.compile(r"^Anlage (\d+)$")


def norm(value):
    return re.sub(r"\s+", " ", (value or "").replace("\u00a0", " ")).strip()


def extract_lines(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join((page.extract_text() or "") for page in pdf.pages)
    return [ln for ln in text.split("\n") if not RUNNING_HEADER.match(ln.strip())]


def parse_toc_titles(lines, body_start):
    """Authoritative §-titles from the BSIG Inhaltsübersicht (before the body)."""
    titles = {}
    current = None
    for ln in lines[:body_start]:
        ln = norm(ln)
        if not ln:
            continue
        m = re.match(r"§ (\d+[a-z]?)\s+(.*)", ln)
        if m:
            current = m.group(1)
            titles[current] = m.group(2).strip()
        elif re.match(r"^(?:Teil|Kapitel|Abschnitt|Unterabschnitt|Anlage)\b", ln):
            current = None
        elif current:
            titles[current] += " " + ln
    return titles


def strip_title_prefix(body_lines, title):
    """Drop the section title that the body repeats (wrapped) before its content."""
    if not title:
        return body_lines
    target = norm(title)
    acc = ""
    idx = 0
    while idx < len(body_lines):
        trial = norm(acc + " " + body_lines[idx])
        if trial == target:
            return body_lines[idx + 1:]
        if target.startswith(trial):
            acc = trial
            idx += 1
        else:
            break
    return body_lines


def strip_trailing_structure(body_lines):
    """Remove trailing Teil/Kapitel/Abschnitt heading blocks that precede the next §."""
    cut = None
    for i, ln in enumerate(body_lines):
        if STRUCT_MARKER.match(norm(ln)):
            cut = i
            break
    return body_lines[:cut] if cut is not None else body_lines


def split_paragraphs(section_num, body_lines):
    """Split a section body into paragraphs at Absatz "(N)" or top-level "N." items."""
    lines = [norm(ln) for ln in body_lines if norm(ln)]
    has_absatz = any(ABSATZ.match(ln) for ln in lines)

    paragraphs = []
    if has_absatz:
        buf, key = [], None
        for ln in lines:
            m = ABSATZ.match(ln)
            if m:
                if key is None and buf:
                    _flush(paragraphs, section_num, "0", buf, "")
                    buf = []
                _flush(paragraphs, section_num, key, buf, "list-item-l1")
                buf, key = [ln], m.group(1)
            else:
                buf.append(ln)
        _flush(paragraphs, section_num, key, buf, "list-item-l1")
        return paragraphs

    has_items = any(NUM_ITEM.match(ln) for ln in lines)
    if has_items:
        buf, key = [], None
        for ln in lines:
            m = NUM_ITEM.match(ln)
            if m:
                if key is None and buf:
                    # lead-in text before the first numbered item
                    _flush(paragraphs, section_num, "0", buf, "")
                    buf = []
                _flush(paragraphs, section_num, key, buf, "list-item-l1")
                buf, key = [ln], m.group(1)
            else:
                buf.append(ln)
        _flush(paragraphs, section_num, key, buf, "list-item-l1")
        return paragraphs

    if lines:
        paragraphs.append({
            "id": f"art_{section_num}__1",
            "text": html.escape(" ".join(lines)),
            "class": "",
        })
    return paragraphs


def _flush(paragraphs, section_num, key, buf, cls):
    if not buf or key is None:
        return
    paragraphs.append({
        "id": f"art_{section_num}__{key}",
        "text": html.escape(" ".join(buf)),
        "class": cls,
    })


def parse_annexes(lines):
    """Anlage 1 / Anlage 2 sector tables -> articles (line-preserving <br> text)."""
    idxs = [i for i, ln in enumerate(lines) if ANLAGE_HEAD.match(norm(ln))]
    articles = []
    for pos, start in enumerate(idxs):
        num = ANLAGE_HEAD.match(norm(lines[start])).group(1)
        end = idxs[pos + 1] if pos + 1 < len(idxs) else len(lines)
        block = [norm(ln) for ln in lines[start + 1:end] if norm(ln)]
        # first content line is the annex heading (e.g. "(zu § 28 ...)")
        heading = block[0] if block else f"Anlage {num}"
        content = block[1:] if len(block) > 1 else []
        text = "<br>".join(html.escape(ln) for ln in content)
        articles.append({
            "id": f"art_anlage_{num}",
            "title": f"Anlage {num}",
            "heading": heading,
            "paragraphs": [{"id": f"art_anlage_{num}__1", "text": text, "class": ""}],
        })
    return articles


def parse(pdf_path):
    lines = extract_lines(pdf_path)

    # BSIG body = first bare "§ 1" line .. first bare "Artikel N" line after it.
    body_start = next(i for i, ln in enumerate(lines) if norm(ln) == "§ 1")
    body_end = next(
        i for i in range(body_start + 1, len(lines))
        if ARTIKEL_HEAD.match(norm(lines[i]))
    )

    titles = parse_toc_titles(lines, body_start)
    body = lines[body_start:body_end]

    # The annexes (Anlage 1/2) sit after § 65 but before Artikel 2: split them off
    # so they are not swept into the last section.
    annex_start = next(
        (i for i, ln in enumerate(body) if ANLAGE_HEAD.match(norm(ln))), len(body)
    )
    annex_lines = body[annex_start:]
    body = body[:annex_start]

    # Split the body into sections at bare "§ N" lines.
    heads = [i for i, ln in enumerate(body) if SECTION_HEAD.match(norm(ln))]
    articles = []
    for pos, hidx in enumerate(heads):
        num = SECTION_HEAD.match(norm(body[hidx])).group(1)
        seg_end = heads[pos + 1] if pos + 1 < len(heads) else len(body)
        seg = body[hidx + 1:seg_end]

        title = titles.get(num, "")
        seg = strip_title_prefix(seg, title)
        seg = strip_trailing_structure(seg)
        if not title and seg:
            title = norm(seg[0])
            seg = seg[1:]

        articles.append({
            "id": f"art_{num}",
            "title": f"§ {num}",
            "heading": title,
            "paragraphs": split_paragraphs(num, seg),
        })

    articles.extend(parse_annexes(annex_lines))
    return articles


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    pdf_path = argv[0]
    out_path = argv[1] if len(argv) > 1 else os.path.splitext(pdf_path)[0] + ".json"

    articles = parse(pdf_path)
    doc = {
        "type": "act",
        "id": "act_de_bsig_2025",
        "title": "BSIG",
        "heading": "German NIS-2 Implementation (BSI Act)",
        "source": {"uri": "", "label": "Bundesgesetzblatt"},
        "meta": {"jurisdiction": "DE"},
        "articles": articles,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")

    paras = sum(len(a["paragraphs"]) for a in articles)
    print(f"parsed {len(articles)} articles, {paras} paragraphs -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
