import html
import importlib.util
from pathlib import Path
import re
from types import SimpleNamespace
from unittest.mock import MagicMock

import pdfplumber
import pytest

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "regulations-data" / "bsi_c3a.pdf"
spec = importlib.util.spec_from_file_location(
    "parser_bsi_c3a", ROOT / "tools" / "parsers" / "parser_bsi_c3a.py"
)
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


@pytest.fixture(scope="module")
def document():
    return parser.parse_document(SOURCE)


def plain(text):
    return html.unescape(re.sub(r"<[^>]+>", " ", text))


def test_official_pdf_preserves_every_criterion_and_page_continuation(document):
    with pdfplumber.open(SOURCE) as pdf:
        source_text = "\n".join(page.extract_text() for page in pdf.pages)
    expected = re.findall(
        r"^(SOV-\d+-\d+-(?:AC|C|SI)\d*)\s+"
        r"(?:Criterion|Additional criterion|Supplementary information)$",
        source_text, re.M,
    )
    groups = [a for a in document["articles"] if a["id"].startswith("art_sov_")]
    paragraphs = [p for a in groups for p in a["paragraphs"]]
    actual = [plain(p["text"]).strip().split()[0] for p in paragraphs]
    assert len(groups) == 30
    assert len(expected) == 74
    assert actual == expected

    # Every body line in the criteria pages must survive extraction, including
    # continuations after page headers and footers.
    rendered = " ".join(" ".join(plain(p["text"]).split()) for p in paragraphs)
    body = source_text[source_text.index("2.1.1 SOV-1 Jurisdiction"):]
    for line in body.splitlines():
        if (
            not line
            or re.match(r"^2\.\d+(?:\.\d+)?\s", line)
            or line.startswith("Federal Office for Information Security")
            or line == "Criteria, Additional Criteria and Supplementary Information"
        ):
            continue
        assert " ".join(line.split()) in rendered, line


def test_introduction_definitions_and_wrapped_headings(document):
    articles = {a["id"]: a for a in document["articles"]}
    assert articles["art_1_2"]["heading"].endswith("as the C3A foundation")
    assert "not binding in itself" in plain(articles["art_1_1"]["paragraphs"][0]["text"])
    definitions = " ".join(plain(p["text"]) for p in articles["art_1_5"]["paragraphs"])
    assert "Account data" in definitions
    assert "Cloud service customer data" in definitions
    assert "unintentional or erroneous alteration" in definitions
    assert document["meta"]["version"] == "1.0"
    assert document["meta"]["releaseDate"] == "2026-04-27"


def test_definition_terms_are_bold_and_separated_into_paragraphs(document):
    definitions = next(a for a in document["articles"] if a["id"] == "art_1_5")
    paragraphs = definitions["paragraphs"]
    assert len(paragraphs) == 13
    terms = [
        re.match(r"<strong>([^<]+)</strong><br>(.+)", p["text"])
        for p in paragraphs[1:]
    ]
    assert all(terms)
    assert [term[1] for term in terms] == [
        "Account data", "Authenticity", "Availability", "Cloud computing",
        "Cloud service", "Cloud service provider", "Cloud service customer",
        "Cloud service customer data", "Cloud service derived data",
        "Cloud service provider data", "Confidentiality", "Integrity",
    ]
    assert all("<br>" not in term[2] for term in terms)


def test_only_substantive_sections_are_loaded_and_all_body_text_is_preserved(document):
    articles = document["articles"]
    assert len(articles) == 35
    assert all(a["paragraphs"] for a in articles)
    assert all(plain(p["text"]).strip() for a in articles for p in a["paragraphs"])
    assert not any(a["id"] == "art_document_history" for a in articles)
    assert [a["title"] for a in articles[:5]] == ["1.1", "1.2", "1.3", "1.4", "1.5"]

    rendered = " ".join(
        " ".join(plain(text).split())
        for a in articles
        for text in [a["heading"], *(p["text"] for p in a["paragraphs"])]
    )
    with pdfplumber.open(SOURCE) as pdf:
        body = "\n".join(page.extract_text() for page in pdf.pages[3:])
    for line in body.splitlines():
        if (
            not line
            or re.match(r"^[12](?:\.\d+)*\s", line)
            or line.startswith("Federal Office for Information Security")
            or line in parser.RUNNING_HEADERS
        ):
            continue
        assert " ".join(line.split()) in rendered, line


def mock_pdf(monkeypatch, text):
    pdf = MagicMock()
    pdf.__enter__.return_value.pages = [
        SimpleNamespace(extract_text=lambda: text, extract_text_lines=lambda: [])
    ]
    monkeypatch.setattr(parser.pdfplumber, "open", lambda _: pdf)


def test_latest_history_version_is_not_download_revision(monkeypatch):
    mock_pdf(monkeypatch, """Document history
v1.0 27.04.2026
v1.2 01.08.2026
1 Introduction
1.1 Purpose
Use <cloud> & autonomy.
2 Criteria
2.1 SOV-1 Strategic Sovereignty
2.1.1 SOV-1 Jurisdiction
SOV-1-01-C1 Criterion
New requirements.
""")
    document = parser.parse_document("unused.pdf")
    assert document["meta"]["version"] == "1.2"
    assert document["meta"]["releaseDate"] == "2026-08-01"
    paragraph = document["articles"][0]["paragraphs"][0]
    assert paragraph["text"] == "Use &lt;cloud&gt; &amp; autonomy."
    assert [a["title"] for a in document["articles"]] == ["1.1", "SOV-1-01"]


@pytest.mark.parametrize("text, message", [
    ("Not a C3A document", "no document version"),
    ("v1.0 27.04.2026", "no introduction body"),
    ("v1.0 27.04.2026\n1 Introduction\nNo criteria", "missing criterion content"),
    (
        "v1.0 27.04.2026\n1 Introduction\n2.1.1 SOV-1 Jurisdiction\n"
        "SOV-1-01-C1 Criterion",
        "criterion has no content",
    ),
    (
        "v1.0 27.04.2026\n1 Introduction\n2.1.1 SOV-1 Jurisdiction\n"
        "SOV-1-01-UNKNOWN Something\nText",
        "Unrecognized C3A criterion",
    ),
])
def test_invalid_or_empty_documents_are_rejected(monkeypatch, text, message):
    mock_pdf(monkeypatch, text)
    with pytest.raises(ValueError, match=message):
        parser.parse_document("unused.pdf")
