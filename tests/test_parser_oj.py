import importlib.util
import os


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "parser_oj",
    os.path.join(ROOT, "tools", "parsers", "parser_oj.py"),
)
parser = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(parser)


def test_nested_quoted_article_heading_is_not_a_top_level_article():
    html = """
    <div class="eli-subdivision" id="art_3">
      <p class="oj-ti-art">Article 3</p>
      <p class="oj-normal">Directive 2009/65/EC is amended as follows:</p>
      <div><p class="oj-ti-art">‘Article 18</p></div>
    </div>
    <div class="eli-subdivision" id="art_4">
      <p class="oj-ti-art">Article 4</p>
      <p class="oj-normal">This Directive enters into force.</p>
    </div>
    """

    articles = parser.parse(html)
    assert [article["id"] for article in articles] == ["art_3", "art_4"]


def test_oj_nested_tables_and_closing_subparagraph_produce_structural_ids():
    html = """
    <div class="eli-subdivision" id="art_6">
      <p class="oj-ti-art">Article 6</p>
      <div class="eli-title"><p class="oj-sti-art">Lawfulness of processing</p></div>
      <div id="006.001">
        <p class="oj-normal">1. Processing shall be lawful if:</p>
        <table><tbody><tr>
          <td><p class="oj-normal">(a)</p></td>
          <td>
            <p class="oj-normal">consent is given for:</p>
            <table><tbody><tr>
              <td><p class="oj-normal">(i)</p></td>
              <td><p class="oj-normal">specific purposes;</p></td>
            </tr></tbody></table>
          </td>
        </tr></tbody></table>
        <table><tbody><tr>
          <td><p class="oj-normal">(b)</p></td>
          <td><p class="oj-normal">a contract applies.</p></td>
        </tr></tbody></table>
        <p class="oj-normal">Point (b) shall not apply to public authorities.</p>
      </div>
    </div>
    """

    [article] = parser.parse(html)
    assert [(p["id"], p["class"], p["text"]) for p in article["paragraphs"]] == [
        ("art_6__1", "", "1. Processing shall be lawful if:"),
        ("art_6__1_a", "list-item-l1", "(a) consent is given for:"),
        ("art_6__1_a_i", "list-item-l2", "(i) specific purposes;"),
        ("art_6__1_b", "list-item-l1", "(b) a contract applies."),
        ("art_6__1_s2", "subparagraph", "Point (b) shall not apply to public authorities."),
    ]


def test_oj_amending_directive_footnotes_and_quoted_headings():
    html = """
    <div class="eli-subdivision" id="art_1">
      <p class="oj-ti-art">Article 1</p>
      <div class="eli-title"><p class="oj-sti-art">Amendments</p></div>
      <p class="oj-normal">Article 12 is amended as follows:</p>
      <table><tbody><tr>
        <td><p class="oj-normal">(1)</p></td>
        <td>
          <p class="oj-normal">point (a) is replaced by:</p>
          <table><tbody><tr>
            <td><p class="oj-normal">‘(a)</p></td>
            <td><p class="oj-normal">has sound procedures (<span class="oj-super">*1</span>);</p></td>
          </tr></tbody></table>
          <p class="oj-note">(<span class="oj-super">*1</span>) Regulation (EU) 2022/2554.’;"</p>
        </td>
      </tr></tbody></table>
      <div>
        <p class="oj-ti-art">‘Article 18</p>
        <p class="oj-sti-art">General principles</p>
      </div>
    </div>
    """
    [article] = parser.parse(html)
    classes = [(p["class"], p["text"]) for p in article["paragraphs"]]
    assert ("list-item-l2 quoted-amendment", "‘(a) has sound procedures (*1);") in classes
    assert any(
        cls == "list-item-l1 legal-footnote" and "(*1)" in txt and not txt.endswith('"')
        for cls, txt in classes
    )
    assert ("quoted-amendment-heading", "‘Article 18 — General principles") in classes