#!/usr/bin/env python3
"""Build and sync the SQLite index database from data/index.json.

`data/index.json` remains the browser source of truth for what to load.
This script mirrors that registry into `data/index.db` for tooling/query use,
and also writes `data/index_meta.json` (id -> CELEX) for lightweight browser lookup.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

APP = Path(__file__).resolve().parent.parent
DATA_DIR = APP / "data"
INDEX_PATH = DATA_DIR / "index.json"
SCHEMA_PATH = APP / "schema.sql"
DB_PATH = DATA_DIR / "index.db"
META_PATH = DATA_DIR / "index_meta.json"
INTERNAL_REF_PK_EXPR = "PRIMARY KEY (source_act_id, target_act_id, COALESCE(target_article, ''))"
INTERNAL_REF_PK_SQLITE = "PRIMARY KEY (source_act_id, target_act_id, target_article)"


@dataclass
class ActRow:
    act_id: str
    label: str
    heading: Optional[str]
    jurisdiction: str
    auth_id: Optional[str]
    auth_id_scheme: Optional[str]
    source_url: Optional[str]
    path: str


@dataclass
class BundleRow:
    bundle_id: str
    label: str
    description: Optional[str]
    parent_bundle: Optional[str]


class RefAnchorParser(HTMLParser):
    """Extract <a class="ref"> CELEX references from paragraph HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.refs: List[Tuple[str, Optional[str], Optional[str]]] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        if tag.lower() != "a":
            return
        attr = {k.lower(): (v or "") for k, v in attrs}
        classes = set(attr.get("class", "").split())
        if "ref" not in classes:
            return

        target_auth_id = ""
        data_ref = attr.get("data-ref", "")
        data_celex = attr.get("data-celex", "")
        if data_celex:
            target_auth_id = data_celex.strip()
        elif data_ref.lower().startswith("celex:"):
            target_auth_id = data_ref.split(":", 1)[1].strip()

        if not target_auth_id:
            return

        target_article = (attr.get("data-article") or "").strip() or None
        href = (attr.get("href") or "").strip() or None
        self.refs.append((target_auth_id, target_article, href))


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def infer_jurisdiction(act_id: str) -> str:
    parts = act_id.split("_")
    if len(parts) >= 2 and parts[1]:
        return parts[1].upper()
    return "OTHER"


def parse_auth_id(entry: dict) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Return (auth_id, auth_scheme, celex_for_meta)."""
    celex = entry.get("celex")
    if isinstance(celex, str) and celex.strip():
        value = celex.strip()
        return value, "CELEX", value

    auth_id = entry.get("authId")
    if not isinstance(auth_id, str) or not auth_id.strip():
        return None, None, None

    raw = auth_id.strip()
    if ":" not in raw:
        return raw, None, None

    scheme, value = raw.split(":", 1)
    scheme_u = scheme.strip().upper()
    value = value.strip() or None
    if not value:
        return None, None, None
    if scheme_u == "CELEX":
        return value, "CELEX", value
    if scheme_u in {"CFR", "USC", "BGBL", "OTHER"}:
        return value, scheme_u, None
    return value, "OTHER", None


def extract_articles(payload) -> List[dict]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        articles = payload.get("articles")
        if isinstance(articles, list):
            return articles
    return []


def parse_reference_anchors(html: str) -> List[Tuple[str, Optional[str], Optional[str]]]:
    parser = RefAnchorParser()
    parser.feed(html)
    parser.close()
    return parser.refs


def collect_act_rows(index_data: dict) -> Tuple[List[ActRow], Dict[str, List[dict]], Dict[str, List[str]], Dict[str, str]]:
    act_rows: List[ActRow] = []
    act_articles: Dict[str, List[dict]] = {}
    act_tags: Dict[str, List[str]] = {}
    id_to_celex: Dict[str, str] = {}

    for entry in index_data.get("acts", []):
        act_id = entry.get("id")
        rel_path = entry.get("path")
        if not isinstance(act_id, str) or not isinstance(rel_path, str):
            continue

        payload = read_json(APP / rel_path)
        meta = payload.get("meta", {}) if isinstance(payload, dict) else {}
        source = payload.get("source", {}) if isinstance(payload, dict) else {}

        auth_id, auth_id_scheme, celex = parse_auth_id(entry)
        if celex:
            id_to_celex[act_id] = celex

        tags = meta.get("tags") if isinstance(meta, dict) else None
        clean_tags: List[str] = []
        if isinstance(tags, list):
            for tag in tags:
                if isinstance(tag, str):
                    trimmed = tag.strip()
                    if trimmed:
                        clean_tags.append(trimmed[:64])

        row = ActRow(
            act_id=act_id,
            label=entry.get("label") or (payload.get("title") if isinstance(payload, dict) else act_id) or act_id,
            heading=entry.get("heading") or (payload.get("heading") if isinstance(payload, dict) else None),
            jurisdiction=infer_jurisdiction(act_id),
            auth_id=auth_id,
            auth_id_scheme=auth_id_scheme,
            source_url=(source.get("uri") if isinstance(source, dict) else None) or None,
            path=rel_path,
        )
        act_rows.append(row)
        act_articles[act_id] = extract_articles(payload)
        act_tags[act_id] = clean_tags

    return act_rows, act_articles, act_tags, id_to_celex


def walk_bundle_tree(
    bundle: dict,
    parent_bundle: Optional[str],
    bundles: Dict[str, BundleRow],
    memberships: List[Tuple[str, str, Optional[str], int]],
    primary_bundle_by_act: Dict[str, str],
    root_label_override: Optional[str] = None,
) -> None:
    bundle_id = bundle.get("id")
    if not isinstance(bundle_id, str):
        return

    title = bundle.get("title") or bundle.get("label") or bundle_id
    if root_label_override:
        title = root_label_override

    bundles[bundle_id] = BundleRow(
        bundle_id=bundle_id,
        label=title,
        description=bundle.get("description"),
        parent_bundle=parent_bundle,
    )

    for idx, member in enumerate(bundle.get("members") or []):
        if not isinstance(member, dict):
            continue
        if member.get("type") == "bundle" or ("members" in member and "id" in member):
            walk_bundle_tree(
                member,
                bundle_id,
                bundles,
                memberships,
                primary_bundle_by_act,
                root_label_override=None,
            )
            continue

        act_id = member.get("ref")
        if not isinstance(act_id, str):
            continue
        label = member.get("label") if isinstance(member.get("label"), str) else None
        memberships.append((bundle_id, act_id, label, idx))
        primary_bundle_by_act.setdefault(act_id, bundle_id)


def collect_bundles(index_data: dict) -> Tuple[List[BundleRow], List[Tuple[str, str, Optional[str], int]], Dict[str, str]]:
    bundles: Dict[str, BundleRow] = {}
    memberships: List[Tuple[str, str, Optional[str], int]] = []
    primary_bundle_by_act: Dict[str, str] = {}

    for entry in index_data.get("bundles", []):
        rel_path = entry.get("path")
        if not isinstance(rel_path, str):
            continue
        payload = read_json(APP / rel_path)
        if not isinstance(payload, dict):
            continue
        walk_bundle_tree(
            payload,
            parent_bundle=None,
            bundles=bundles,
            memberships=memberships,
            primary_bundle_by_act=primary_bundle_by_act,
            root_label_override=entry.get("label") if isinstance(entry.get("label"), str) else None,
        )

    unique_memberships: Dict[Tuple[str, str], Tuple[str, str, Optional[str], int]] = {}
    for bundle_id, act_id, member_label, sort_order in memberships:
        unique_memberships.setdefault((bundle_id, act_id), (bundle_id, act_id, member_label, sort_order))

    return list(bundles.values()), list(unique_memberships.values()), primary_bundle_by_act


def build_celex_to_act(rows: Iterable[ActRow]) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for row in rows:
        if row.auth_id and row.auth_id_scheme == "CELEX":
            mapping[row.auth_id] = row.act_id
    return mapping


def collect_references(
    source_act_id: str,
    articles: List[dict],
    celex_to_act_id: Dict[str, str],
) -> Tuple[List[Tuple[str, str, str, Optional[str], int]], List[Tuple[str, str, Optional[str], int]]]:
    ext_counts: Counter[str] = Counter()
    ext_href: Dict[str, Optional[str]] = {}
    int_counts: Counter[Tuple[str, Optional[str]]] = Counter()

    for article in articles:
        for para in article.get("paragraphs", []) if isinstance(article, dict) else []:
            text = para.get("text", "") if isinstance(para, dict) else ""
            if not isinstance(text, str) or "class=\"ref\"" not in text:
                continue
            for target_auth_id, target_article, fallback_url in parse_reference_anchors(text):
                ext_counts[target_auth_id] += 1
                if target_auth_id not in ext_href or not ext_href[target_auth_id]:
                    ext_href[target_auth_id] = fallback_url

                target_act_id = celex_to_act_id.get(target_auth_id)
                if target_act_id:
                    int_counts[(target_act_id, target_article)] += 1

    external_rows = [
        (source_act_id, target_auth_id, "CELEX", ext_href.get(target_auth_id), count)
        for target_auth_id, count in sorted(ext_counts.items())
    ]
    internal_rows = [
        (source_act_id, target_act_id, target_article, count)
        for (target_act_id, target_article), count in sorted(
            int_counts.items(),
            key=lambda item: (item[0][0], item[0][1] or ""),
        )
    ]
    return external_rows, internal_rows


def write_index_meta(id_to_celex: Dict[str, str]) -> None:
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"idToCelex": dict(sorted(id_to_celex.items()))}
    with META_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def read_schema_sql() -> str:
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    # SQLite does not allow expressions inside PRIMARY KEY declarations.
    return schema.replace(INTERNAL_REF_PK_EXPR, INTERNAL_REF_PK_SQLITE)


def sync_database(index_data: dict, db_exists: bool) -> None:
    act_rows, act_articles, act_tags, id_to_celex = collect_act_rows(index_data)
    bundle_rows, memberships, primary_bundle_by_act = collect_bundles(index_data)
    celex_to_act_id = build_celex_to_act(act_rows)

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    with conn:
        conn.executescript(read_schema_sql())

        existing_act_ids = {row[0] for row in conn.execute("SELECT id FROM act")}
        current_act_ids = {row.act_id for row in act_rows}
        acts_inserted = len(current_act_ids - existing_act_ids)
        acts_updated = len(current_act_ids & existing_act_ids)
        acts_deleted = len(existing_act_ids - current_act_ids)

        for deleted_id in sorted(existing_act_ids - current_act_ids):
            conn.execute("DELETE FROM act WHERE id = ?", (deleted_id,))

        for row in act_rows:
            conn.execute(
                """
                INSERT INTO act (id, label, heading, jurisdiction, auth_id, auth_id_scheme, source_url, path, status, date_in_force, primary_bundle)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'In Force', NULL, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    label=excluded.label,
                    heading=excluded.heading,
                    jurisdiction=excluded.jurisdiction,
                    auth_id=excluded.auth_id,
                    auth_id_scheme=excluded.auth_id_scheme,
                    source_url=excluded.source_url,
                    path=excluded.path,
                    status=excluded.status,
                    date_in_force=excluded.date_in_force,
                    primary_bundle=excluded.primary_bundle
                """,
                (
                    row.act_id,
                    row.label,
                    row.heading,
                    row.jurisdiction,
                    row.auth_id,
                    row.auth_id_scheme,
                    row.source_url,
                    row.path,
                ),
            )

        existing_bundle_ids = {row[0] for row in conn.execute("SELECT id FROM bundle")}
        current_bundle_ids = {row.bundle_id for row in bundle_rows}
        bundles_inserted = len(current_bundle_ids - existing_bundle_ids)
        bundles_updated = len(current_bundle_ids & existing_bundle_ids)
        bundles_deleted = len(existing_bundle_ids - current_bundle_ids)

        for deleted_id in sorted(existing_bundle_ids - current_bundle_ids):
            conn.execute("DELETE FROM bundle WHERE id = ?", (deleted_id,))

        for row in bundle_rows:
            conn.execute(
                """
                INSERT INTO bundle (id, label, description, parent_bundle)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    label=excluded.label,
                    description=excluded.description,
                    parent_bundle=excluded.parent_bundle
                """,
                (row.bundle_id, row.label, row.description, row.parent_bundle),
            )

        conn.execute("DELETE FROM act_bundle_member")
        membership_rows = 0
        for bundle_id, act_id, member_label, sort_order in memberships:
            if act_id not in current_act_ids:
                continue
            conn.execute(
                """
                INSERT INTO act_bundle_member (bundle_id, act_id, member_label, sort_order)
                VALUES (?, ?, ?, ?)
                """,
                (bundle_id, act_id, member_label, sort_order),
            )
            membership_rows += 1

        conn.execute("UPDATE act SET primary_bundle = NULL")
        for act_id, primary_bundle in primary_bundle_by_act.items():
            if act_id in current_act_ids and primary_bundle in current_bundle_ids:
                conn.execute(
                    "UPDATE act SET primary_bundle = ? WHERE id = ?",
                    (primary_bundle, act_id),
                )

        tag_rows = 0
        ext_rows = 0
        ext_citations = 0
        int_rows = 0
        int_citations = 0

        for row in act_rows:
            conn.execute("DELETE FROM act_tag WHERE act_id = ?", (row.act_id,))
            for tag in sorted(set(act_tags.get(row.act_id, []))):
                conn.execute(
                    "INSERT INTO act_tag (act_id, tag) VALUES (?, ?)",
                    (row.act_id, tag),
                )
                tag_rows += 1

            conn.execute("DELETE FROM act_ref_external WHERE source_act_id = ?", (row.act_id,))
            conn.execute("DELETE FROM act_ref_internal WHERE source_act_id = ?", (row.act_id,))

            external_rows, internal_rows = collect_references(
                row.act_id,
                act_articles.get(row.act_id, []),
                celex_to_act_id,
            )

            for source_act_id, target_auth_id, target_auth_scheme, fallback_url, citation_count in external_rows:
                conn.execute(
                    """
                    INSERT INTO act_ref_external (source_act_id, target_auth_id, target_auth_scheme, fallback_url, citation_count)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (source_act_id, target_auth_id, target_auth_scheme, fallback_url, citation_count),
                )
                ext_rows += 1
                ext_citations += citation_count

            for source_act_id, target_act_id, target_article, citation_count in internal_rows:
                normalized_target_article = target_article or ""
                conn.execute(
                    """
                    INSERT INTO act_ref_internal (source_act_id, target_act_id, target_article, citation_count)
                    VALUES (?, ?, ?, ?)
                    """,
                    (source_act_id, target_act_id, normalized_target_article, citation_count),
                )
                int_rows += 1
                int_citations += citation_count

    conn.close()

    write_index_meta(id_to_celex)

    mode = "initialized" if not db_exists else "updated"
    print(f"index.db {mode}: {DB_PATH}")
    print(f"acts: inserted={acts_inserted} updated={acts_updated} deleted={acts_deleted}")
    print(f"bundles: inserted={bundles_inserted} updated={bundles_updated} deleted={bundles_deleted}")
    print(f"bundle memberships synced: {membership_rows}")
    print(f"tags synced: {tag_rows}")
    print(f"external refs synced: rows={ext_rows} citations={ext_citations}")
    print(f"internal refs synced: rows={int_rows} citations={int_citations}")
    print(f"index meta written: {META_PATH}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build/sync data/index.db from data/index.json")
    parser.add_argument("--db", default=str(DB_PATH), help="Path to SQLite DB (default: data/index.db)")
    parser.add_argument("--index", default=str(INDEX_PATH), help="Path to index.json (default: data/index.json)")
    parser.add_argument("--schema", default=str(SCHEMA_PATH), help="Path to schema.sql (default: schema.sql)")
    parser.add_argument("--meta", default=str(META_PATH), help="Path to index_meta.json (default: data/index_meta.json)")
    return parser.parse_args()


def main() -> int:
    global DB_PATH, INDEX_PATH, SCHEMA_PATH, META_PATH

    args = parse_args()
    DB_PATH = Path(args.db).resolve()
    INDEX_PATH = Path(args.index).resolve()
    SCHEMA_PATH = Path(args.schema).resolve()
    META_PATH = Path(args.meta).resolve()

    if not INDEX_PATH.exists():
        raise FileNotFoundError(f"index file not found: {INDEX_PATH}")
    if not SCHEMA_PATH.exists():
        raise FileNotFoundError(f"schema file not found: {SCHEMA_PATH}")

    index_data = read_json(INDEX_PATH)
    db_exists = DB_PATH.exists()
    sync_database(index_data, db_exists=db_exists)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
