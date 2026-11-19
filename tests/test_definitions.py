"""Unit and corpus tests for term-definition extraction (tools/build_definitions.py)."""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "build_definitions", ROOT / "tools" / "build_definitions.py"
)
bd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bd)


def test_eu_multi_paragraph_with_aliases_and_subpoints():
    articles = [
        {
            "id": "art_2",
            "title": "Article 2",
            "heading": "Definitions",
            "paragraphs": [
                {"text": "For the purposes of this Regulation, the following definitions apply:"},
                {"text": "(1) ‘CCP’ means a central counterparty;"},
                {
                    "text": "(2) ‘derivative’ or ‘derivative contract’ means a financial instrument that:"
                },
                {"text": "(a) is settled at a future date;"},
                {"text": "(b) depends on an underlying value;"},
                {"text": "2. The Commission is empowered to adopt delegated acts."},
            ],
        }
    ]
    result = bd.extract_act_definitions(articles)
    assert result is not None
    assert result["definitionArticleIds"] == ["art_2"]

    by_term = {entry["term"]: entry for entry in result["entries"]}
    assert set(by_term) == {"CCP", "derivative", "derivative contract"}

    assert by_term["CCP"]["caseSensitive"] is True
    assert "CCPs" in by_term["CCP"]["forms"]
    assert by_term["CCP"]["source"] == "Article 2(1)"

    deriv = by_term["derivative"]
    assert deriv["caseSensitive"] is False
    assert "derivatives" in deriv["forms"]
    assert "(a) is settled at a future date;" in deriv["definition"]
    assert "(b) depends on an underlying value." in deriv["definition"]
    assert "Commission is empowered" not in deriv["definition"]


def test_eu_single_paragraph_parenthetical_alias_and_missing_quote_typo():
    articles = [
        {
            "id": "art_4",
            "title": "Article 4",
            "heading": "Definitions",
            "paragraphs": [
                {
                    "text": (
                        "For the purposes of this Regulation: "
                        "(1) ‘personal data’ means any information relating to a natural person (‘data subject’); "
                        "(2) open interoperability specification’ means a technical specification."
                    )
                }
            ],
        }
    ]
    result = bd.extract_act_definitions(articles)
    assert result is not None
    by_term = {entry["term"]: entry for entry in result["entries"]}
    assert {"personal data", "data subject", "open interoperability specification"} <= set(by_term)
    # Uncountable "data" must not generate "personal datas"
    assert "personal datas" not in by_term["personal data"]["forms"]
    assert "data subjects" in by_term["data subject"]["forms"]
    assert by_term["data subject"]["source"] == "Article 4(1)"


def test_bsi_c3a_strong_definitions():
    articles = [
        {
            "id": "art_1_5",
            "title": "1.5",
            "heading": "Definitions",
            "paragraphs": [
                {"text": "Definitions used in this document:"},
                {"text": "<strong>Cloud service</strong><br>IT service offered via cloud computing."},
            ],
        }
    ]
    result = bd.extract_act_definitions(articles)
    assert result is not None
    assert result["definitionArticleIds"] == ["art_1_5"]
    [entry] = result["entries"]
    assert entry["term"] == "Cloud service"
    assert "Cloud services" in entry["forms"]
    assert entry["source"] == "Section 1.5"
    assert entry["definition"] == "IT service offered via cloud computing."


def test_german_bsig_and_boersg_prose_definitions():
    bsig_articles = [
        {
            "id": "art_2",
            "title": "§ 2",
            "heading": "Begriffsbestimmungen",
            "paragraphs": [
                {"text": "Im Sinne dieses Gesetzes ist oder sind"},
                {"text": "1. „Content Delivery Network“ oder „CDN“ eine Gruppe von Servern;"},
            ],
        }
    ]
    bsig = bd.extract_act_definitions(bsig_articles)
    assert bsig is not None
    by_term = {entry["term"]: entry for entry in bsig["entries"]}
    assert set(by_term) == {"Content Delivery Network", "CDN"}
    assert by_term["CDN"]["caseSensitive"] is True
    assert by_term["CDN"]["source"] == "§ 2 Nr. 1"

    boersg_articles = [
        {
            "id": "art_2",
            "title": "§ 2",
            "heading": "Börsen und weitere Begriffsbestimmungen",
            "paragraphs": [
                {"text": "(1) Börsen sind teilrechtsfähige Anstalten des öffentlichen Rechts."},
                {"text": "(2) Ein multilaterales Handelssystem im Sinne dieses Gesetzes ist ein System."},
                {"text": "(3) In verwaltungsgerichtlichen Verfahren kann die Börse klagen."},
            ],
        }
    ]
    boersg = bd.extract_act_definitions(boersg_articles)
    assert boersg is not None
    boersg_terms = {entry["term"]: entry for entry in boersg["entries"]}
    assert set(boersg_terms) == {"Börsen", "multilaterales Handelssystem"}
    assert "Börse" in boersg_terms["Börsen"]["forms"]
    assert "multilateralen Handelssystemen" in boersg_terms["multilaterales Handelssystem"]["forms"]


def test_act_without_definitions_returns_none():
    articles = [
        {
            "id": "art_1",
            "title": "Article 1",
            "heading": "Subject matter and scope",
            "paragraphs": [{"text": "This Regulation lays down technical standards."}],
        }
    ]
    assert bd.extract_act_definitions(articles) is None


def test_preserves_ref_anchors_and_resolves_cross_act_pointers():
    source_articles = [
        {
            "id": "art_2",
            "title": "Article 2",
            "heading": "Definitions",
            "paragraphs": [
                {
                    "id": "art_2__1",
                    "text": (
                        "(1) ‘personal data’ means personal data as defined in "
                        '<a href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679" '
                        'class="ref" data-ref="celex:32016R0679" data-article="4" '
                        'target="_blank" rel="noopener">Article 4</a>, point (1), of '
                        '<a href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679" '
                        'class="ref" data-ref="celex:32016R0679" target="_blank" rel="noopener">'
                        "Regulation (EU) 2016/679</a>;"
                    ),
                },
                {
                    "id": "art_2__2",
                    "text": (
                        "(2) ‘non-personal data’ means data other than personal data as defined in "
                        '<a href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679" '
                        'class="ref" data-ref="celex:32016R0679" data-article="4" '
                        'target="_blank" rel="noopener">Article 4</a>, point (1), of '
                        '<a href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679" '
                        'class="ref" data-ref="celex:32016R0679" target="_blank" rel="noopener">'
                        "Regulation (EU) 2016/679</a>;"
                    ),
                },
            ],
        }
    ]
    target_articles = [
        {
            "id": "art_4",
            "title": "Article 4",
            "heading": "Definitions",
            "paragraphs": [
                {
                    "text": "(1) ‘personal data’ means any information relating to an identified natural person."
                }
            ],
        }
    ]

    defs = {
        "act_eu_data_act_2023_2854": bd.extract_act_definitions(
            source_articles, act_id="act_eu_data_act_2023_2854"
        ),
        "act_eu_gdpr_2016_0679": bd.extract_act_definitions(
            target_articles, act_id="act_eu_gdpr_2016_0679"
        ),
    }
    bd.resolve_cross_act_pointers(
        defs,
        {"celex:32016R0679": "act_eu_gdpr_2016_0679"},
        {"act_eu_gdpr_2016_0679": "GDPR"},
    )

    by_term = {e["term"]: e for e in defs["act_eu_data_act_2023_2854"]["entries"]}
    pd = by_term["personal data"]
    assert 'class="ref"' in pd["definitionHtml"]
    assert pd["sourceHash"] == "a:act_eu_data_act_2023_2854:art_2__1"
    assert pd["resolved"]["actLabel"] == "GDPR"
    assert pd["resolved"]["source"] == "Article 4(1)"
    assert "identified natural person" in pd["resolved"]["definition"]
    assert pd["resolved"]["sourceHash"] == "a:act_eu_gdpr_2016_0679:art_4"

    # Negated definition ("other than personal data as defined in ...") must NOT resolve to personal data
    assert "resolved" not in by_term["non-personal data"]


def test_parent_act_inheritance_collection():
    registry = {
        "acts": [
            {"id": "act_parent"},
            {"id": "act_self", "parentAct": "act_self"},
            {"id": "act_child_rts", "parentAct": "act_parent"},
        ],
    }
    parents = bd.collect_parent_acts(registry)
    assert "act_parent" not in parents
    assert "act_self" not in parents
    assert parents == {"act_child_rts": "act_parent"}


def test_committed_definitions_json_is_in_sync():
    committed = json.loads((ROOT / "data" / "definitions.json").read_text(encoding="utf-8"))
    generated = bd.build_all_definitions()
    assert committed == generated
    assert "act_eu_dora_reg_2022_2554" in committed
    assert "act_eu_gdpr_2016_0679" in committed
    assert "act_de_bsi_c3a_2026" in committed
    # Secondary acts in DORA inherit definitions from DORA Regulation (without self-inheriting on DORA itself)
    assert "inheritedFrom" not in committed["act_eu_dora_reg_2022_2554"]
    assert committed["act_eu_dora_rts_2024_1774"]["entries"] == []
    assert committed["act_eu_dora_rts_2024_1774"]["inheritedFrom"] == {
        "actId": "act_eu_dora_reg_2022_2554",
        "actLabel": "DORA Regulation",
        "definitionArticleIds": ["art_3"],
    }
    # RTS 4 keeps its 19 local definitions AND inherits DORA Regulation definitions
    assert len(committed["act_eu_dora_rts_2025_1190"]["entries"]) == 19
    assert committed["act_eu_dora_rts_2025_1190"]["inheritedFrom"]["actId"] == "act_eu_dora_reg_2022_2554"
