#!/usr/bin/env python3
"""Build the regulation-to-legal-entity mapping used by the browser."""

import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "data" / "source" / "legal_entity_regulation_detail.csv"
REGISTRY_PATH = ROOT / "data" / "index.json"
OUTPUT_PATH = ROOT / "data" / "legal_entity_applicability.json"

ENTITY_SHORT_NAMES = {
    "Clearstream Europe AG": "CEAG",
    "Clearstream Holding AG": "CHAG",
    "Deutsche Boerse AG": "DBAG",
    "Eurex Clearing AG": "ECAG",
    "Eurex Repo GmbH": "ERG",
}

CELEX_PATTERN = re.compile(r"celex:3(?P<year>\d{4})[A-Z](?P<number>\d{4})$")


def citation_pattern(auth_id):
    match = CELEX_PATTERN.fullmatch(auth_id or "")
    if not match:
        return None

    year = match.group("year")
    number = str(int(match.group("number")))
    return re.compile(
        rf"(?<!\d)(?:{year}/{number}|{number}/{year})(?!\d)",
        re.IGNORECASE,
    )


def build_mapping(rows, registry):
    mapping = {}
    for act in registry.get("acts", []):
        pattern = citation_pattern(act.get("authId"))
        if not pattern:
            continue

        entity_names = {
            row["Legal Entity"].strip()
            for row in rows
            if pattern.search(row["Regulation Short Name"])
        }
        entities = [
            {"shortName": ENTITY_SHORT_NAMES[name], "name": name}
            for name in sorted(entity_names)
            if name in ENTITY_SHORT_NAMES
        ]
        if entities:
            mapping[act["id"]] = entities

    return mapping


def build_bundle_mapping(bundles, act_mapping):
    bundle_mapping = {}

    def collect_entities(bundle):
        entities_by_name = {}
        for member in bundle.get("members", []):
            if member.get("type") == "bundle":
                entities = collect_entities(member)
            else:
                entities = act_mapping.get(member.get("ref"), [])
            for entity in entities:
                entities_by_name[entity["name"]] = entity

        entities = [entities_by_name[name] for name in sorted(entities_by_name)]
        if entities:
            bundle_mapping[bundle["id"]] = entities
        return entities

    for bundle in bundles:
        collect_entities(bundle)
    return bundle_mapping


def build_family_mapping(bundles, bundle_mapping):
    family_mapping = {}

    def assign_family_scope(bundle, entities):
        family_mapping[bundle["id"]] = entities
        for member in bundle.get("members", []):
            if member.get("type") == "bundle":
                assign_family_scope(member, entities)
            elif member.get("ref"):
                family_mapping[member["ref"]] = entities

    for bundle in bundles:
        entities = bundle_mapping.get(bundle["id"], [])
        if entities:
            assign_family_scope(bundle, entities)
    return family_mapping


def main():
    with SOURCE_PATH.open(newline="", encoding="utf-8-sig") as source_file:
        rows = list(csv.DictReader(source_file))
    with REGISTRY_PATH.open(encoding="utf-8") as registry_file:
        registry = json.load(registry_file)

    act_mapping = build_mapping(rows, registry)
    bundles = []
    for bundle_entry in registry.get("bundles", []):
        bundle_path = ROOT / bundle_entry["path"]
        with bundle_path.open(encoding="utf-8") as bundle_file:
            bundles.append(json.load(bundle_file))
    bundle_mapping = build_bundle_mapping(bundles, act_mapping)
    family_mapping = build_family_mapping(bundles, bundle_mapping)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "actEntities": act_mapping,
                "bundleEntities": bundle_mapping,
                "familyEntities": family_mapping,
            },
            indent=2,
            ensure_ascii=True,
        ) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(act_mapping)} regulation, {len(bundle_mapping)} bundle, and "
        f"{len(family_mapping)} family mappings "
        f"to {OUTPUT_PATH.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()