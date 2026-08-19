import importlib.util
import json
import logging.handlers
import os

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
        "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02016R0679",
        "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679",
    ]
    assert parser_name == "auto"
    assert encoding == "utf-8"


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
