import importlib.util
import os


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "parser_marisk",
    os.path.join(ROOT, "tools", "parsers", "parser_marisk.py"),
)
parser = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(parser)

# Trimmed from the bafin.de markup: inconsistent heading levels, a list2 wrapper,
# nested <ol>, inline "a) ... b)" lines split by <br/> and a <ul>.
SOURCE = """<html><body>
<nav><h2>Inhaltsverzeichnis</h2><ol><li>AT 1 Vorbemerkung</li></ol></nav>
<div class="l-article__content">
<h2><abbr title="Allgemeiner Teil ">AT</abbr> 4 Allgemeine Anforderungen</h2>
<h3><abbr title="Allgemeiner Teil ">AT</abbr> 4.1 Risikotragf\u00e4higkeit</h3>
<ol><li>Erste Textziffer mit &lt;Sonderzeichen&gt; &amp; Verweis.<br/>
<br/>
</li><li><p>Handelsgesch\u00e4fte sind Abschl\u00fcsse in Form eines</p>
<p>a) Geldmarktgesch\u00e4fts,<br/>
b) Wertpapiergesch\u00e4fts,<br/></p>
<p>sowie weitere Gesch\u00e4fte.</p></li></ol>
<h3><abbr title="Allgemeiner Teil ">AT</abbr> 9 Auslagerung</h3>
<div class="list2"><ol><li><p>Die Richtlinien beinhalten:</p>
<ol><li>Regelungen zur Aufbauorganisation,</li><li>Regelungen zur Internen Revision.</li></ol>
</li><li>Das interne Kontrollsystem umfasst insbesondere
<ul><li>Regelungen zur Ablauforganisation,</li><li>Prozesse zur Risikosteuerung.</li></ul>
</li></ol></div>
</div>
<div class="l-article__related"><h2>Weitere Informationen</h2><ol><li>PDF</li></ol></div>
</body></html>"""


def test_modules_become_articles_with_textziffern():
    articles = parser.parse(SOURCE)

    assert [(a["id"], a["title"], a["heading"]) for a in articles] == [
        ("art_at_4_1", "AT 4.1", "Risikotragf\u00e4higkeit"),
        ("art_at_9", "AT 9", "Auslagerung"),
    ]

    at_4_1 = {p["id"]: p for p in articles[0]["paragraphs"]}
    assert at_4_1["art_at_4_1__1"]["text"] == (
        "1. Erste Textziffer mit &lt;Sonderzeichen&gt; &amp; Verweis."
    )
    assert at_4_1["art_at_4_1__2"]["text"].startswith("2. Handelsgesch\u00e4fte")
    assert at_4_1["art_at_4_1__2_a"] == {
        "id": "art_at_4_1__2_a",
        "text": "a) Geldmarktgesch\u00e4fts,",
        "class": "list-item-l1",
    }
    assert "art_at_4_1__2_b" in at_4_1
    assert at_4_1["art_at_4_1__2_s2"]["text"] == "sowie weitere Gesch\u00e4fte."

    at_9 = [(p["id"], p["text"]) for p in articles[1]["paragraphs"]]
    assert at_9 == [
        ("art_at_9__1", "1. Die Richtlinien beinhalten:"),
        ("art_at_9__1_a", "a) Regelungen zur Aufbauorganisation,"),
        ("art_at_9__1_b", "b) Regelungen zur Internen Revision."),
        ("art_at_9__2", "2. Das interne Kontrollsystem umfasst insbesondere"),
        ("art_at_9__2_dash", "\u2013 Regelungen zur Ablauforganisation,"),
        ("art_at_9__2_dash_2", "\u2013 Prozesse zur Risikosteuerung."),
    ]


def test_page_without_circular_body_yields_no_articles():
    assert parser.parse("<html><body><h2>AT 1 Vorbemerkung</h2></body></html>") == []
