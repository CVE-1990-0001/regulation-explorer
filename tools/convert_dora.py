#!/usr/bin/env python3
"""Convert the extracted DORA / RTS / ITS data (from ../../../dora_gap/data)
into the regulation-explorer act JSON format and wire it into the DORA folder.

Run from anywhere:  python3 tools/convert_dora.py
"""
import json
import os
import re
import html

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)                      # regulation-explorer/
GAP = os.path.abspath(os.path.join(APP, "..", "..", "dora_gap", "data"))

SRC_DORA = os.path.join(GAP, "dora_articles.json")
SRC_RTSITS = os.path.join(GAP, "dora_rts_its_articles.json")

OUT_REL = "regulations-data/dora"                # relative to app root (used in paths)
OUT_DIR = os.path.join(APP, OUT_REL)
INDEX = os.path.join(APP, "data", "index.json")
BUNDLE = os.path.join(APP, "data", "bundles", "dora.json")


def esc(text):
    """Source text is plain text; it is injected via innerHTML, so escape it."""
    return html.escape((text or "").strip())


def _pad4(number):
    return re.sub(r"\D", "", number).zfill(4)


def _legal_link(display, celex, preview_label):
    href = f"https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:{celex}"
    preview = html.escape(f"{preview_label} \u2013 opens on EUR-Lex")
    return (
        f'<a href="{href}" class="legal-link" target="_blank" '
        f'rel="noopener noreferrer" data-preview="{preview}">{display}</a>'
    )


def link_external(text):
    """Wrap citations of other Directives/Regulations as EUR-Lex legal links."""
    # Directive (EU) 2022/2556  (post-2015 style: year/number)
    text = re.sub(
        r"\bDirective\s*\((EU)\)\s*(\d{4})/(\d{1,4})\b",
        lambda m: _legal_link(m.group(0), f"3{m.group(2)}L{_pad4(m.group(3))}",
                              f"Directive (EU) {m.group(2)}/{m.group(3)}"),
        text,
    )
    # Directive 2014/65/EU  (pre-2015 style: year/number/region)
    text = re.sub(
        r"\bDirective\s+(\d{4})/(\d{2,4})/(EU|EC)\b",
        lambda m: _legal_link(m.group(0), f"3{m.group(1)}L{_pad4(m.group(2))}",
                              f"Directive {m.group(1)}/{m.group(2)}/{m.group(3)}"),
        text,
    )
    # Regulation (EU) No 648/2012  (pre-2015 style: No number/year)
    text = re.sub(
        r"\bRegulation\s*\((EU|EC)\)\s*No\s*(\d{1,4})/(\d{4})\b",
        lambda m: _legal_link(m.group(0), f"3{m.group(3)}R{_pad4(m.group(2))}",
                              f"Regulation ({m.group(1)}) No {m.group(2)}/{m.group(3)}"),
        text,
    )
    # Regulation (EU) 2016/679  (post-2015 style: year/number)
    text = re.sub(
        r"\bRegulation\s*\((EU|EC)\)\s*(\d{4})/(\d{1,4})\b",
        lambda m: _legal_link(m.group(0), f"3{m.group(2)}R{_pad4(m.group(3))}",
                              f"Regulation ({m.group(1)}) {m.group(2)}/{m.group(3)}"),
        text,
    )
    return text


def _internal_link(display, token, act_id, number_map):
    art_id = number_map.get(token.strip().lower())
    if not art_id:
        return display
    return (
        f'<a href="#a:{act_id}:{art_id}" class="internal-article-link" '
        f'target="_blank" rel="noopener">{display}</a>'
    )


def link_internal(text, act_id, number_map):
    """Wrap 'Article N' / 'Articles N, M' references as in-app links."""
    # Lists: 'Articles 9, 10 and 11' -> link each number token.
    def repl_list(m):
        return re.sub(
            r"\d+[a-z]?",
            lambda mm: _internal_link(mm.group(0), mm.group(0), act_id, number_map),
            m.group(0),
        )

    text = re.sub(
        r"\bArticles\s+\d+[a-z]?(?:\s*(?:,|and|or|to|\u2013|-)\s*\d+[a-z]?)*",
        repl_list, text, flags=re.I,
    )
    # Singles: 'Article 9' -> link the whole reference.
    text = re.sub(
        r"\bArticle\s+(\d+[a-z]?)\b",
        lambda m: _internal_link(m.group(0), m.group(1), act_id, number_map),
        text, flags=re.I,
    )
    return text


def linkify(escaped_text, act_id, number_map):
    """Add internal-article and external-legal reference links to escaped text."""
    return link_external(link_internal(escaped_text, act_id, number_map))


def flatten_paragraphs(article, art_id, act_id, number_map):
    """Turn nested paragraphs/subpoints into flat {id,text,class} rows.

    De-dupes an extraction glitch where sub-points are also emitted as flat
    sibling points within the same paragraph, and adds reference links.
    """
    rows = []
    counter = [0]

    def add(text, cls):
        raw = (text or "").strip()
        if not raw:
            return
        linked = linkify(html.escape(raw), act_id, number_map)
        counter[0] += 1
        rows.append({"id": f"{art_id}__{counter[0]}", "text": linked, "class": cls})

    paragraphs = article.get("paragraphs") or []
    if not paragraphs:
        # Fall back to the raw article text, split on newlines.
        for line in (article.get("full_text") or "").split("\n"):
            add(line, "")
        return rows

    for p in paragraphs:
        seen = set()
        num = p.get("number")
        main = p.get("text") or ""
        prefix = f"{num}. " if num else ""
        add((prefix + main).strip(), "")

        for pt in p.get("points") or []:
            key = (pt.get("label"), pt.get("text"))
            if key in seen:
                continue
            seen.add(key)
            add(f"{pt.get('label','') or ''} {pt.get('text','') or ''}".strip(), "list-item-l1")
            for sp in pt.get("subpoints") or []:
                skey = (sp.get("label"), sp.get("text"))
                if skey in seen:
                    continue
                seen.add(skey)
                add(f"{sp.get('label','') or ''} {sp.get('text','') or ''}".strip(), "list-item-l2")
    return rows


def build_articles(doc, act_id):
    articles = doc.get("articles", [])

    def art_id_of(number):
        return "art_" + re.sub(r"[^0-9A-Za-z]+", "_", number).strip("_").lower()

    number_map = {}
    for art in articles:
        number = str(art.get("number") or "").strip()
        if number:
            number_map[number.lower()] = art_id_of(number)

    out = []
    for art in articles:
        number = str(art.get("number") or "").strip()
        art_id = art_id_of(number) if number else "art_" + re.sub(r"[^0-9A-Za-z]+", "_", (art.get("title") or "x")).strip("_").lower()
        out.append({
            "id": art_id,
            "title": f"Article {number}" if number else (art.get("title") or "Article"),
            "heading": (art.get("title") or "").strip(),
            "paragraphs": flatten_paragraphs(art, art_id, act_id, number_map),
        })
    return out


def write_act(act_id, title, heading, celex, doc):
    act = {
        "type": "act",
        "id": act_id,
        "title": title,
        "heading": heading,
        "source": {"uri": "", "label": "EUR-Lex"},
        "meta": {"jurisdiction": "EU", "celex": celex},
        "articles": build_articles(doc, act_id),
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    fname = f"{act_id}.json"
    with open(os.path.join(OUT_DIR, fname), "w", encoding="utf-8") as fh:
        json.dump(act, fh, ensure_ascii=False, indent=2)
    return f"{OUT_REL}/{fname}"


def short_num(short_name):
    m = re.search(r"(\d+)", short_name or "")
    return int(m.group(1)) if m else 0


def celex_citation(celex, prefix):
    """'32024R1774' + 'Delegated Regulation' -> 'Delegated Regulation (EU) 2024/1774'."""
    m = re.match(r"3(\d{4})[A-Z](\d+)", celex or "")
    if not m:
        return ""
    return f"{prefix} (EU) {m.group(1)}/{int(m.group(2))}"


def main():
    dora = json.load(open(SRC_DORA, encoding="utf-8"))
    rtsits = json.load(open(SRC_RTSITS, encoding="utf-8"))

    registry_acts = []     # entries for data/index.json
    core_ref = None
    directive_ref = None
    rts_refs = []
    its_refs = []

    # --- DORA core regulation (2022/2554) and amending directive (2022/2556) ---
    for doc in dora["documents"]:
        if doc.get("celex") == "32022R2554":
            act_id = "act_dora_core"
            path = write_act(
                act_id,
                "DORA Regulation",
                "Regulation (EU) 2022/2554",
                doc.get("celex"),
                doc,
            )
            registry_acts.append({"id": act_id, "path": path, "label": "DORA Regulation"})
            core_ref = {"ref": act_id, "label": "DORA Regulation"}
        elif doc.get("celex") == "32022L2556":
            act_id = "act_dora_2556"
            path = write_act(
                act_id,
                "DORA Directive",
                "Directive (EU) 2022/2556",
                doc.get("celex"),
                doc,
            )
            registry_acts.append({"id": act_id, "path": path, "label": "DORA Directive"})
            directive_ref = {"ref": act_id, "label": "DORA Directive"}

    # --- RTS / ITS ---
    rts_docs = sorted(
        [d for d in rtsits["documents"] if d.get("type") == "delegated_regulation"],
        key=lambda d: short_num(d.get("short_name")),
    )
    its_docs = sorted(
        [d for d in rtsits["documents"] if d.get("type") == "implementing_regulation"],
        key=lambda d: short_num(d.get("short_name")),
    )

    for doc in rts_docs:
        sn = doc.get("short_name") or "RTS"
        n = short_num(sn)
        act_id = f"act_dora_rts{n}"
        heading = celex_citation(doc.get("celex"), "Delegated Regulation")
        path = write_act(act_id, sn, heading, doc.get("celex"), doc)
        registry_acts.append({"id": act_id, "path": path, "label": sn})
        rts_refs.append({"ref": act_id, "label": sn})

    for doc in its_docs:
        sn = doc.get("short_name") or "ITS"
        n = short_num(sn)
        act_id = f"act_dora_its{n}"
        heading = celex_citation(doc.get("celex"), "Implementing Regulation")
        path = write_act(act_id, sn, heading, doc.get("celex"), doc)
        registry_acts.append({"id": act_id, "path": path, "label": sn})
        its_refs.append({"ref": act_id, "label": sn})

    # --- Update data/index.json (append acts, de-dupe by id) ---
    index = json.load(open(INDEX, encoding="utf-8"))
    existing_ids = {a["id"] for a in index.get("acts", [])}
    for entry in registry_acts:
        if entry["id"] not in existing_ids:
            index["acts"].append(entry)
    with open(INDEX, "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)

    # --- Rewrite data/bundles/dora.json with populated members ---
    bundle = {
        "type": "bundle",
        "id": "bundle_dora",
        "title": "DORA",
        "description": "Digital Operational Resilience Act (DORA) and its technical standards.",
        "members": [
            core_ref,
            directive_ref,
            {
                "type": "bundle",
                "id": "bundle_dora_rts",
                "title": "RTS",
                "description": "Regulatory Technical Standards under DORA.",
                "members": rts_refs,
            },
            {
                "type": "bundle",
                "id": "bundle_dora_its",
                "title": "ITS",
                "description": "Implementing Technical Standards under DORA.",
                "members": its_refs,
            },
        ],
        "meta": {"tags": ["dora"], "updated": "2026-07-06"},
    }
    with open(BUNDLE, "w", encoding="utf-8") as fh:
        json.dump(bundle, fh, ensure_ascii=False, indent=2)

    print(f"Wrote {len(registry_acts)} acts to {OUT_REL}/")
    print(f"  core: {'yes' if core_ref else 'no'} | RTS: {len(rts_refs)} | ITS: {len(its_refs)}")


if __name__ == "__main__":
    main()
