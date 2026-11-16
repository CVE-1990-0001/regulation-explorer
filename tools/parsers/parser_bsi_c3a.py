#!/usr/bin/env python3
"""Parse the official BSI C3A PDF, including introductory and supplementary text.

Usage: python3 tools/parsers/parser_bsi_c3a.py input.pdf output.json
"""

import argparse
from datetime import date
import html
import json
import re
from pathlib import Path

import pdfplumber

ACT_ID = "act_de_bsi_c3a_2026"
SOURCE_URL = (
    "https://www.bsi.bund.de/EN/Themen/Unternehmen-und-Organisationen/"
    "Informationen-und-Empfehlungen/Empfehlungen-nach-Angriffszielen/"
    "Cloud-Computing/C3A/C3A_node.html"
)
DOWNLOAD_URL = (
    "https://www.bsi.bund.de/SharedDocs/Downloads/EN/BSI/Publications/"
    "CloudComputing/C3A_Cloud_Computing_Autonomy.pdf?__blob=publicationFile"
)
SECTION = re.compile(r"^(1(?:\.\d+)?|2(?:\.\d+){0,2})\s+(.+)$")
CRITERION = re.compile(
    r"^(SOV-\d+-\d+-(?:AC|C|SI)\d*)\s+"
    r"(Criterion|Additional criterion|Supplementary information)$", re.I
)
RUNNING_HEADERS = {
    "Introduction",
    "Criteria, Additional Criteria and Supplementary Information",
}


def parse_document(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
        bold_lines = {
            line["text"].strip()
            for page in pdf.pages
            for line in page.extract_text_lines()
            if line["chars"]
            and all("bold" in char["fontname"].lower() for char in line["chars"])
        }
    text = "\n".join(pages)
    history = re.findall(r"^v(\d+(?:\.\d+)+)\s+(\d{2})\.(\d{2})\.(\d{4})\b", text, re.M)
    if not history:
        raise ValueError("C3A PDF has no document version and release date")
    version, day, month, year = max(
        history, key=lambda row: date(int(row[3]), int(row[2]), int(row[1]))
    )
    release_date = date(int(year), int(month), int(day)).isoformat()
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip() not in RUNNING_HEADERS
        and not re.fullmatch(r"Federal Office for Information Security\s+\d+", line.strip())
    ]
    try:
        start = lines.index("1 Introduction")
    except ValueError as exc:
        raise ValueError("C3A PDF has no introduction body") from exc

    # The TOC supplies unwrapped titles for headings spanning multiple lines.
    toc = {}
    for line in lines[:start]:
        match = re.match(r"^(\d+(?:\.\d+)?)\s+(.+?)\s*\.{2,}\s*\d+$", line)
        if match:
            toc[match[1]] = match[2].strip()

    articles = []
    article = None
    label = None
    body = []
    pending_heading = ""
    seen_sections = set()

    def flush():
        if not body:
            if label:
                raise ValueError(f"C3A criterion has no content: {label[0]}")
            return
        if article is None:
            raise ValueError("C3A content appears outside a section")
        paragraph_id = (
            label[0].lower().replace("-", "_") if label
            else str(len(article["paragraphs"]) + 1)
        )
        content = html.escape(" ".join(body)) if label else "<br>".join(map(html.escape, body))
        if label:
            content = f"<strong>{html.escape(' '.join(label))}</strong><br>{content}"
        elif article["id"] == "art_1_5":
            if body[0] in bold_lines:
                content = (
                    f"<strong>{html.escape(body[0])}</strong><br>"
                    + html.escape(" ".join(body[1:]))
                )
            else:
                content = html.escape(" ".join(body))
        article["paragraphs"].append({
            "id": f"{article['id']}__{paragraph_id}",
            "text": content,
            "class": "",
        })
        body.clear()

    for line in lines[start:]:
        if not line:
            continue
        if pending_heading:
            if not pending_heading.startswith(line):
                raise ValueError(f"Unexpected wrapped C3A heading: {line}")
            pending_heading = pending_heading[len(line):].strip()
            continue
        section = SECTION.fullmatch(line)
        if section:
            flush()
            label = None
            number, heading = section.groups()
            seen_sections.add(number)
            full_heading = toc.get(number, heading)
            if not full_heading.startswith(heading):
                raise ValueError(f"C3A heading differs from table of contents: {line}")
            pending_heading = full_heading[len(heading):].strip()
            group = re.fullmatch(r"2\.(\d+)\.(\d+)", number)
            if group:
                code = f"SOV-{group[1]}-{int(group[2]):02d}"
                article_id = f"art_{code.lower().replace('-', '_')}"
                title = code
                heading = re.sub(r"^SOV-\d+\s+", "", full_heading)
            else:
                article_id = f"art_{number.replace('.', '_')}"
                title, heading = number, full_heading
            article = {
                "id": article_id, "title": title, "heading": heading, "paragraphs": [],
            }
            articles.append(article)
        elif match := CRITERION.fullmatch(line):
            flush()
            if article is None or not match[1].startswith(article["title"] + "-"):
                raise ValueError(f"C3A criterion is outside its group: {line}")
            label = match.groups()
        else:
            if line.startswith("SOV-"):
                raise ValueError(f"Unrecognized C3A criterion heading: {line}")
            if article and article["id"] == "art_1_5" and line in bold_lines:
                flush()
            body.append(line)
    flush()
    if pending_heading:
        raise ValueError("Incomplete C3A section heading")
    if toc.keys() - seen_sections:
        raise ValueError("C3A PDF is missing sections listed in its table of contents")
    groups = [a for a in articles if a["id"].startswith("art_sov_")]
    if not groups or any(not a["paragraphs"] for a in groups):
        raise ValueError("C3A PDF has missing criterion content")
    if len({a["id"] for a in articles}) != len(articles):
        raise ValueError("C3A PDF has duplicate sections")
    paragraph_ids = [p["id"] for a in articles for p in a["paragraphs"]]
    if len(set(paragraph_ids)) != len(paragraph_ids):
        raise ValueError("C3A PDF has duplicate criteria")
    articles = [a for a in articles if a["paragraphs"]]
    return {
        "type": "act",
        "id": ACT_ID,
        "title": "BSI C3A",
        "heading": "Criteria enabling Cloud Computing Autonomy",
        "source": {"uri": SOURCE_URL, "label": "BSI", "download": DOWNLOAD_URL},
        "meta": {
            "jurisdiction": "DE",
            "version": version,
            "releaseDate": release_date,
            "subtitle": "Non-binding cloud autonomy framework",
            "tags": ["cloud", "digital sovereignty", "autonomy"],
        },
        "articles": articles,
    }


def parse(pdf_path):
    return parse_document(pdf_path)["articles"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    document = parse_document(args.input)
    args.output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {args.output} with {len(document['articles'])} sections")


if __name__ == "__main__":
    main()
