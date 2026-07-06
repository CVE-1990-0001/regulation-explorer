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


def flatten_paragraphs(article, art_id):
    """Turn nested paragraphs/points/subpoints into flat {id,text,class} rows.

    De-dupes an extraction glitch where sub-points are also emitted as flat
    sibling points within the same paragraph.
    """
    rows = []
    counter = [0]

    def add(text, cls):
        text = esc(text)
        if not text:
            return
        counter[0] += 1
        rows.append({"id": f"{art_id}__{counter[0]}", "text": text, "class": cls})

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


def build_articles(doc):
    out = []
    for art in doc.get("articles", []):
        number = str(art.get("number") or "").strip()
        art_id = "art_" + re.sub(r"[^0-9A-Za-z]+", "_", number).strip("_").lower()
        out.append({
            "id": art_id,
            "title": f"Article {number}" if number else (art.get("title") or "Article"),
            "heading": (art.get("title") or "").strip(),
            "paragraphs": flatten_paragraphs(art, art_id),
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
        "articles": build_articles(doc),
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    fname = f"{act_id}.json"
    with open(os.path.join(OUT_DIR, fname), "w", encoding="utf-8") as fh:
        json.dump(act, fh, ensure_ascii=False, indent=2)
    return f"{OUT_REL}/{fname}"


def short_num(short_name):
    m = re.search(r"(\d+)", short_name or "")
    return int(m.group(1)) if m else 0


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
                "Regulation (EU) 2022/2554 - Digital Operational Resilience Act",
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
                "Directive (EU) 2022/2556 - amending directives for digital operational resilience",
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
        heading = (doc.get("title") or "").title()
        path = write_act(act_id, sn, heading, doc.get("celex"), doc)
        registry_acts.append({"id": act_id, "path": path, "label": sn})
        rts_refs.append({"ref": act_id, "label": sn})

    for doc in its_docs:
        sn = doc.get("short_name") or "ITS"
        n = short_num(sn)
        act_id = f"act_dora_its{n}"
        heading = (doc.get("title") or "").title()
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
