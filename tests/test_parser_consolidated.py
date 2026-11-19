import importlib.util
import os


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "parser_consolidated",
    os.path.join(ROOT, "tools", "parsers", "parser_consolidated.py"),
)
parser = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(parser)


def test_nested_grid_lists_become_separate_paragraphs():
    html = """
    <p class="title-article-norm">Article 5</p>
    <div class="eli-title"><p>Prohibited practices</p></div>
    <div class="norm">
      <span class="no-parag">1.</span>
      <div class="norm inline-element">
        <p class="norm inline-element">The following are prohibited:</p>
        <div class="grid-container grid-list">
          <div class="list grid-list-column-1"><span>(a)</span></div>
          <div class="grid-list-column-2">
            <p class="norm">first point;</p>
            <div class="grid-container grid-list">
              <div class="list grid-list-column-1"><span>(i)</span></div>
              <div class="grid-list-column-2"><p class="norm">nested point.</p></div>
            </div>
          </div>
        </div>
        <div class="grid-container grid-list">
          <div class="list grid-list-column-1"><span>(b)</span></div>
          <div class="grid-list-column-2"><p class="norm">second point.</p></div>
        </div>
      </div>
    </div>
    """

    [article] = parser.parse(html)
    assert [(p["id"], p["text"], p["class"]) for p in article["paragraphs"]] == [
        ("art_5__1", "1. The following are prohibited:", ""),
        ("art_5__1_a", "(a) first point;", "list-item-l1"),
        ("art_5__1_a_i", "(i) nested point.", "list-item-l2"),
        ("art_5__1_b", "(b) second point.", "list-item-l1"),
    ]


def test_closing_subparagraph_stays_after_list_points():
    html = """
    <p class="title-article-norm">Article 6</p>
    <div class="eli-title"><p>Lawfulness</p></div>
    <div class="norm">
      <span class="no-parag">1.</span>
      <div class="norm inline-element">
        <p class="norm inline-element">Processing is lawful if:</p>
        <div class="grid-container grid-list">
          <div class="list grid-list-column-1"><span>(a)</span></div>
          <div class="grid-list-column-2"><p class="norm">consent is given;</p></div>
        </div>
        <div class="grid-container grid-list">
          <div class="list grid-list-column-1"><span>(f)</span></div>
          <div class="grid-list-column-2"><p class="norm">legitimate interests apply.</p></div>
        </div>
        <p class="norm">Point (f) shall not apply to public authorities.</p>
      </div>
    </div>
    """

    [article] = parser.parse(html)
    assert [(p["id"], p["class"], p["text"]) for p in article["paragraphs"]] == [
        ("art_6__1", "", "1. Processing is lawful if:"),
        ("art_6__1_a", "list-item-l1", "(a) consent is given;"),
        ("art_6__1_f", "list-item-l1", "(f) legitimate interests apply."),
        ("art_6__1_s2", "subparagraph", "Point (f) shall not apply to public authorities."),
    ]


def test_unmatched_trailing_quote_in_article_heading_is_stripped():
    html = """
    <p class="title-article-norm">Article 1</p>
    <div class="eli-title"><p class="stitle-article-norm">Subject matter'</p></div>
    <p class="norm">1. The purpose of this Regulation is to improve the internal market.</p>
    """
    [article] = parser.parse(html)
    assert article["heading"] == "Subject matter"