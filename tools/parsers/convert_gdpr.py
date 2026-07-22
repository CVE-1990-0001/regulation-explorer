#!/usr/bin/env python3
"""Parse the EUR-Lex GDPR HTML into an explorer act and register it top-level.

Reuses the existing EUR-Lex parser (dora_gap/parse_dora.parse_document) and the
paragraph-flattening logic from convert_dora.py.

Run:  python3 tools/parsers/convert_gdpr.py
"""
import json
import os
import sys
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(os.path.dirname(HERE))
GAP = os.path.abspath(os.path.join(APP, "..", "..", "dora_gap"))
sys.path.insert(0, GAP)
sys.path.insert(0, HERE)

import parse_dora        # noqa: E402  (EUR-Lex HTML parser)
import convert_dora      # noqa: E402  (build_articles / flatten_paragraphs)

SRC = os.path.join(APP, "regulations-data", "CELEX_32016R0679_EN_TXT.html")
OUT_REL = "regulations-data/gdpr.json"
OUT = os.path.join(APP, OUT_REL)
INDEX = os.path.join(APP, "data", "index.json")


def main():
    doc = parse_dora.parse_document(Path(SRC))
    act = {
        "type": "act",
        "id": "act_gdpr_2016",
        "title": "GDPR",
        "heading": "Regulation (EU) 2016/679",
        "source": {"uri": "", "label": "EUR-Lex"},
        "meta": {"jurisdiction": "EU", "celex": doc.get("celex")},
        "articles": convert_dora.build_articles(doc, "act_gdpr_2016"),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(act, fh, ensure_ascii=False, indent=2)

    index = json.load(open(INDEX, encoding="utf-8"))
    ids = {a["id"] for a in index["acts"]}
    if "act_gdpr_2016" not in ids:
        index["acts"].append({
            "id": "act_gdpr_2016",
            "path": OUT_REL,
            "label": "GDPR (Regulation (EU) 2016/679)",
        })
        with open(INDEX, "w", encoding="utf-8") as fh:
            json.dump(index, fh, ensure_ascii=False, indent=2)

    print(f"Wrote {OUT_REL} with {len(act['articles'])} articles")


if __name__ == "__main__":
    main()
