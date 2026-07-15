"""Integrity tests for the data corpus + registry.

WHAT THIS COVERS
    Whole-corpus invariants that are cheap to check and catch regressions no
    matter which act changed: the id naming convention, the registry <-> files
    consistency, that bundle references and internal links resolve, that no
    anchor corruption slipped in, and that the linker output is stable
    (idempotent) against the committed data.

WHY IT MATTERS
    These guard the *data*, which the app trusts blindly at runtime. A broken id
    or a dangling ref won't crash the linker but will silently break navigation.
"""
import glob
import importlib.util
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load(rel):
    with open(os.path.join(ROOT, rel)) as f:
        return json.load(f)


INDEX = _load("data/index.json")
ACT_IDS = {e["id"] for e in INDEX["acts"]}


def _articles(doc):
    return doc if isinstance(doc, list) else doc.get("articles", [])


def _iter_paragraph_texts():
    for e in INDEX["acts"]:
        for art in _articles(_load(e["path"])):
            for p in art.get("paragraphs", []):
                yield e, art, p.get("text", "")


# --------------------------------------------------------------------------- #
# Naming convention
# --------------------------------------------------------------------------- #
ID_PATTERN = re.compile(r"^act_[a-z]{2}_[a-z0-9_]+_\d{4}(_\d{4})?$")


def test_ids_match_convention():
    bad = [e["id"] for e in INDEX["acts"] if not ID_PATTERN.match(e["id"])]
    assert not bad, f"ids not matching act_<jur>_<mnemonic>[_type]_<year>[_num]: {bad}"


def test_ids_unique():
    ids = [e["id"] for e in INDEX["acts"]]
    assert len(ids) == len(set(ids))


# --------------------------------------------------------------------------- #
# Registry <-> act files
# --------------------------------------------------------------------------- #
def test_object_file_id_matches_registry():
    for e in INDEX["acts"]:
        doc = _load(e["path"])
        if isinstance(doc, dict):  # array acts carry no internal id
            assert doc.get("id") == e["id"], (e["path"], doc.get("id"), e["id"])


def test_authid_is_scheme_qualified():
    for e in INDEX["acts"]:
        auth = e.get("authId")
        if auth is not None:
            assert re.match(r"^[a-z]+:.+", auth), f"{e['id']} authId not scheme:id -> {auth}"


# --------------------------------------------------------------------------- #
# Bundles resolve
# --------------------------------------------------------------------------- #
def _bundle_refs(members):
    for m in members:
        if m.get("type") == "bundle":
            yield from _bundle_refs(m.get("members", []))
        elif "ref" in m:
            yield m["ref"]


def test_bundle_refs_resolve():
    for b in glob.glob(os.path.join(ROOT, "data/bundles/*.json")):
        with open(b) as f:
            bundle = json.load(f)
        unresolved = [r for r in _bundle_refs(bundle["members"]) if r not in ACT_IDS]
        assert not unresolved, f"{b}: unresolved refs {unresolved}"


# --------------------------------------------------------------------------- #
# Reference anchors are well-formed
# --------------------------------------------------------------------------- #
def test_no_anchor_corruption():
    for e, art, text in _iter_paragraph_texts():
        assert not re.search(r"<a\b[^>]*>[^<]*<a\b", text), f"nested anchor in {e['id']} {art.get('id')}"
        assert 'data-preview="<a' not in text, f"anchor injected into attribute in {e['id']}"
        assert "legal-reference" not in text, f"leftover legacy span in {e['id']}"


def test_same_act_links_target_existing_articles():
    for e in INDEX["acts"]:
        doc = _load(e["path"])
        art_ids = {a["id"] for a in _articles(doc) if a.get("id")}
        for art in _articles(doc):
            for p in art.get("paragraphs", []):
                for target in re.findall(r'href="#a:([^:]+):([^"]+)"', p.get("text", "")):
                    act_id, art_id = target
                    assert act_id == e["id"], f"self-link with foreign act id in {e['id']}"
                    assert art_id in art_ids, f"dangling self-link {art_id} in {e['id']}"


# --------------------------------------------------------------------------- #
# Linker is idempotent against the committed data
# --------------------------------------------------------------------------- #
def test_linker_idempotent_on_corpus():
    spec = importlib.util.spec_from_file_location(
        "link_references", os.path.join(ROOT, "tools", "link_references.py")
    )
    lr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lr)
    for e in INDEX["acts"]:
        doc = _load(e["path"])
        ids = lr.self_article_ids(_articles(doc))
        for art in _articles(doc):
            for p in art.get("paragraphs", []):
                t = p.get("text", "")
                assert lr.link_text(t, e["id"], ids) == t, (
                    f"re-linking changed committed text in {e['id']} {art.get('id')}"
                )
