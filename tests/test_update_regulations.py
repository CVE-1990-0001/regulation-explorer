import importlib.util
import json
import logging.handlers
import os
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "update_regulations", os.path.join(ROOT, "tools", "update_regulations.py")
)
updater = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(updater)


def test_only_in_force_entries_are_selected():
    index = {
        "acts": [
            {"id": "active", "path": "active.json"},
            {"id": "explicit", "path": "explicit.json", "status": "In Force"},
            {"id": "repealed", "path": "old.json", "status": "Repealed"},
            {"id": "pending", "path": "new.json", "status": "Pending"},
        ]
    }
    assert [entry["id"] for entry in updater.selected_entries(index, [])] == [
        "active",
        "explicit",
    ]


def test_eurlex_checks_consolidated_before_original():
    entry = {"authId": "celex:32016R0679"}
    urls, parser_name, encoding = updater.update_config(entry)
    assert urls == [
        "https://publications.europa.eu/resource/celex/02016R0679",
        "https://publications.europa.eu/resource/celex/32016R0679",
        "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02016R0679",
        "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679",
    ]
    assert parser_name == "auto"
    assert encoding == "utf-8"


def test_cellar_download_url_requests_english_html():
    url = updater.cellar_download_url(
        "http://publications.europa.eu/resource/cellar/example-uuid"
    )
    assert url == (
        "https://op.europa.eu/o/opportal-service/download-handler?"
        "identifier=example-uuid&format=HTML&language=en&"
        "productionSystem=cellar&part="
    )


def test_explicit_update_configuration_and_disable_switch():
    configured = {
        "update": {
            "url": ["https://example.test/current.html"],
            "parser": "boersengesetz",
            "encoding": "latin-1",
        }
    }
    assert updater.update_config(configured) == (
        ["https://example.test/current.html"],
        "boersengesetz",
        "latin-1",
    )
    assert updater.update_config({"update": False})[0] == []


def test_german_acts_have_update_configuration():
    index = updater.read_json(updater.INDEX_PATH)
    entries = {entry["id"]: entry for entry in index["acts"]}

    assert updater.update_config(entries["act_de_boersg_2007"]) == (
        [
            "https://www.gesetze-im-internet.de/b_rsg_2007/BJNR135100007.html",
            "https://raw.githubusercontent.com/QuantLaw/gesetze-im-internet/"
            "data/data/items/b_rsg_2007/BJNR135100007.xml",
        ],
        "boersengesetz",
        "latin-1",
    )
    assert updater.update_config(entries["act_de_bsig_2025"]) == (
        [
            "https://www.recht.bund.de/bgbl/1/2025/301/"
            "regelungstext.pdf?__blob=publicationFile&v=2"
        ],
        "nis2_bsig",
        "utf-8",
    )


def test_decode_html_honors_xml_encoding_declaration():
    content = '<?xml version="1.0" encoding="UTF-8"?><P>Börse</P>'.encode()
    assert "Börse" in updater.decode_html(content, "latin-1")


def test_c3a_uses_latest_download_even_when_configured_with_revision():
    entry = {
        "update": {
            "url": "https://www.bsi.bund.de/C3A.pdf?__blob=publicationFile&v=10",
            "parser": "bsi_c3a",
        }
    }
    assert updater.update_config(entry) == (
        ["https://www.bsi.bund.de/C3A.pdf?__blob=publicationFile"],
        "bsi_c3a",
        "utf-8",
    )
    # Other sources can still require a pinned revision.
    entry["update"]["parser"] = "nis2_bsig"
    assert updater.update_config(entry)[0][0].endswith("&v=10")


def test_c3a_refresh_is_reproducible_from_saved_pdf():
    index = updater.read_json(updater.INDEX_PATH)
    entry = next(e for e in index["acts"] if e["id"] == "act_de_bsi_c3a_2026")
    pdf = (Path(ROOT) / "regulations-data" / "bsi_c3a.pdf").read_bytes()
    urls = []

    def fetch(url, timeout):
        urls.append(url)
        return pdf

    result, document, _ = updater.refresh_entry(entry, fetch, 30)
    assert result == "unchanged"
    assert document["meta"]["version"] == "1.0"
    assert urls[0].endswith("?__blob=publicationFile")


def test_c3a_refresh_updates_version_even_if_criteria_are_unchanged(tmp_path, monkeypatch):
    current = {
        "type": "act", "id": "act_de_bsi_c3a_2026", "title": "BSI C3A",
        "meta": {"version": "1.0", "releaseDate": "2026-04-27", "custom": "keep"},
        "articles": [{"id": "art_1", "paragraphs": [{"id": "art_1__1", "text": "Criterion", "class": ""}]}],
    }
    path = tmp_path / "c3a.json"
    updater.write_json(path, current)
    parsed = {
        "meta": {"version": "1.1", "releaseDate": "2026-11-01"},
        "articles": current["articles"],
    }
    monkeypatch.setattr(updater, "parse_pdf_document", lambda *_: parsed)
    entry = {
        "id": current["id"], "path": str(path),
        "update": {"parser": "bsi_c3a", "url": "https://example.test/latest.pdf"},
    }
    result, updated, _ = updater.refresh_entry(entry, lambda *_: b"pdf", 30)
    assert result == "updated"
    assert updated["meta"] == {**parsed["meta"], "custom": "keep"}
    assert updated["title"] == current["title"]
    assert updater.read_json(path) == current


def test_quality_gate_rejects_collapsed_list_regression(tmp_path):
    old_paras = [
        {"id": "art_1__1", "text": "1. The following apply:", "class": ""},
        *[
            {"id": f"art_1__1_{chr(97 + i)}", "text": f"({chr(97 + i)}) item {i}", "class": "list-item-l1"}
            for i in range(20)
        ],
    ]
    current = {"type": "act", "id": "act_eu_test_2024_0001", "articles": [{"id": "art_1", "paragraphs": old_paras}]}
    path = tmp_path / "act.json"
    updater.write_json(path, current)

    collapsed_html = """
    <div class="eli-subdivision" id="art_1">
      <p class="oj-ti-art">Article 1</p>
      <p class="oj-normal">1. Flattened single paragraph losing all twenty list items.</p>
    </div>
    """
    entry = {
        "id": "act_eu_test_2024_0001",
        "path": str(path),
        "update": {"url": "https://example.test/act.html", "parser": "oj"},
    }
    result, payload, detail = updater.refresh_entry(entry, lambda *_: collapsed_html.encode(), 30)
    assert result == "rejected"
    assert payload is None
    assert "list-item structure collapsed" in detail

    # --force overrides the gate when explicitly requested
    forced_result, forced_payload, _ = updater.refresh_entry(
        entry, lambda *_: collapsed_html.encode(), 30, force=True
    )
    assert forced_result == "updated"
    assert forced_payload is not None


def test_replace_articles_preserves_act_metadata():
    document = {
        "type": "act",
        "id": "act_eu_example_2020_0001",
        "title": "Example",
        "meta": {"tags": ["test"]},
        "articles": [{"id": "art_1"}],
    }
    replacement = [{"id": "art_2", "paragraphs": []}]
    updated = updater.replace_articles(document, replacement)
    assert updated["articles"] == replacement
    assert updated["title"] == "Example"
    assert updated["meta"] == {"tags": ["test"]}
    assert document["articles"] == [{"id": "art_1"}]


def test_write_json_has_stable_format(tmp_path):
    output = tmp_path / "act.json"
    updater.write_json(output, [{"id": "art_1"}])
    assert json.loads(output.read_text()) == [{"id": "art_1"}]
    assert output.read_text().endswith("\n")


def test_logging_covers_functions_and_rotates_at_100_mb(tmp_path):
    log_path = tmp_path / "update.log"
    updater.configure_logging(log_path)
    assert updater.celex_from_entry({"authId": "celex:32016R0679"}) == "32016R0679"

    handler = updater.LOGGER.handlers[0]
    handler.flush()
    assert isinstance(handler, logging.handlers.RotatingFileHandler)
    assert handler.maxBytes == 100 * 1024 * 1024
    assert "Starting celex_from_entry" in log_path.read_text()
    assert "Completed celex_from_entry" in log_path.read_text()
