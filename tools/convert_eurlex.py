#!/usr/bin/env python3
"""Parse any EUR-Lex CELEX HTML into an explorer act and register it top-level.

Reuses dora_gap/parse_dora.parse_document + convert_dora paragraph flattening.

Example:
  python3 tools/convert_eurlex.py \
    --html regulations-data/CELEX_32019R0881_EN_TXT.html \
    --id act_csa_2019 --out regulations-data/cybersecurity_act.json \
    --title "Cybersecurity Act" \
    --heading "Regulation (EU) 2019/881 - EU Cybersecurity Act" \
    --label "Cybersecurity Act (Regulation (EU) 2019/881)"
"""
import argparse
import json
import os
import sys
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
GAP = os.path.abspath(os.path.join(APP, "..", "..", "dora_gap"))
sys.path.insert(0, GAP)
sys.path.insert(0, HERE)

import parse_dora        # noqa: E402
import convert_dora      # noqa: E402

INDEX = os.path.join(APP, "data", "index.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", required=True, help="app-relative path to the CELEX HTML")
    ap.add_argument("--id", required=True)
    ap.add_argument("--out", required=True, help="app-relative output JSON path")
    ap.add_argument("--title", required=True)
    ap.add_argument("--heading", required=True)
    ap.add_argument("--label", required=True)
    args = ap.parse_args()

    doc = parse_dora.parse_document(Path(os.path.join(APP, args.html)))
    act = {
        "type": "act",
        "id": args.id,
        "title": args.title,
        "heading": args.heading,
        "source": {"uri": "", "label": "EUR-Lex"},
        "meta": {"jurisdiction": "EU", "celex": doc.get("celex")},
        "articles": convert_dora.build_articles(doc, args.id),
    }
    with open(os.path.join(APP, args.out), "w", encoding="utf-8") as fh:
        json.dump(act, fh, ensure_ascii=False, indent=2)

    index = json.load(open(INDEX, encoding="utf-8"))
    if args.id not in {a["id"] for a in index["acts"]}:
        index["acts"].append({"id": args.id, "path": args.out, "label": args.label})
        with open(INDEX, "w", encoding="utf-8") as fh:
            json.dump(index, fh, ensure_ascii=False, indent=2)

    print(f"Wrote {args.out} with {len(act['articles'])} articles")


if __name__ == "__main__":
    main()
