import importlib.util
import os


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "parser_boersengesetz",
    os.path.join(ROOT, "tools", "parsers", "parser_boersengesetz.py"),
)
parser = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(parser)


def test_structured_xml_is_parsed_as_articles():
    source = """<?xml version="1.0" encoding="UTF-8"?>
    <dokumente>
      <norm>
        <metadaten><enbez>§ 3a</enbez><titel>Aufgaben</titel></metadaten>
        <textdaten><text><Content>
          <P>(1) Die Behörde nimmt ihre Aufgaben wahr.</P>
          <P>(2) Sie arbeitet nach § 3.</P>
        </Content></text></textdaten>
      </norm>
    </dokumente>
    """

    assert parser.parse(source) == [
        {
            "id": "art_3a",
            "title": "§ 3a",
            "heading": "Aufgaben",
            "paragraphs": [
                {
                    "id": "art_3a__1",
                    "text": "(1) Die Behörde nimmt ihre Aufgaben wahr.",
                    "class": "list-item-l1",
                },
                {
                    "id": "art_3a__2",
                    "text": "(2) Sie arbeitet nach § 3.",
                    "class": "list-item-l1",
                },
            ],
        }
    ]