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


def test_html_keeps_two_letter_sections_and_annex_tables():
    source = """<html><body>
    <div class="jnnorm" title="Einzelnorm"><div class="jnheader">
      <h3><span class="jnenbez">&#167; 53c</span><span class="jnentitel">A</span></h3></div>
      <div class="jurAbsatz">(1) Siehe &#167; 53ca.</div></div>
    <div class="jnnorm" title="Einzelnorm"><div class="jnheader">
      <h3><span class="jnenbez">&#167; 53ca</span><span class="jnentitel">B</span></h3></div>
      <div class="jurAbsatz">(1) Text.</div></div>
    <div class="jnnorm" title="Einzelnorm"><div class="jnheader">
      <h3><span class="jnenbez">Anhang I</span><span class="jnentitel">Formular</span></h3></div>
      <div class="jurAbsatz"><table><tr><td>Obergrenze:</td><td>100 000 Euro</td></tr></table></div></div>
    </body></html>"""

    articles = parser.parse(source)

    assert [a["id"] for a in articles] == ["art_53c", "art_53ca", "art_anhang_i"]
    assert 'href="#art_53ca"' in articles[0]["paragraphs"][0]["text"]
    annex = articles[2]["paragraphs"]
    assert len(annex) == 1
    assert "<td>Obergrenze:</td><td>100 000 Euro</td>" in annex[0]["text"]


def test_xml_upper_case_lists_are_kept():
    # The gesetze-im-internet XML writes list markup as <DL><DT><DD><LA>.
    source = """<?xml version="1.0" encoding="UTF-8"?>
    <dokumente><norm>
      <metadaten><enbez>§ 2</enbez><titel>Begriffsbestimmungen</titel></metadaten>
      <textdaten><text><Content>
        <P>(2) Dienstleistungen sind <DL Type="arabic">
          <DT>1.</DT><DD><LA>das Finanzkommissionsgeschäft,</LA></DD>
          <DT>2.</DT><DD><LA>das Emissionsgeschäft.</LA></DD>
        </DL>Weitere Regeln bleiben unberührt.</P>
      </Content></text></textdaten>
    </norm></dokumente>"""

    paragraphs = parser.parse(source)[0]["paragraphs"]

    assert [(p["id"], p["text"]) for p in paragraphs] == [
        ("art_2__2", "(2) Dienstleistungen sind"),
        ("art_2__2_1", "1. das Finanzkommissionsgeschäft,"),
        ("art_2__2_2", "2. das Emissionsgeschäft."),
        ("art_2__2_s2", "Weitere Regeln bleiben unberührt."),
    ]


def test_xml_annex_table_is_kept():
    source = """<?xml version="1.0" encoding="UTF-8"?>
    <dokumente><norm>
      <metadaten><enbez>Anhang I</enbez><titel>Formular</titel></metadaten>
      <textdaten><text><Content>
        <P><table><tgroup cols="2"><tbody>
          <row><entry>Obergrenze:</entry><entry>100 000 Euro</entry></row>
        </tbody></tgroup></table></P>
      </Content></text></textdaten>
    </norm></dokumente>"""

    articles = parser.parse(source)

    assert [a["id"] for a in articles] == ["art_anhang_i"]
    assert "<td>Obergrenze:</td><td>100 000 Euro</td>" in articles[0]["paragraphs"][0]["text"]