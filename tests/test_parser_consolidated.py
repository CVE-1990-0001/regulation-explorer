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
    assert [(p["text"], p["class"]) for p in article["paragraphs"]] == [
        ("1. The following are prohibited:", ""),
        ("(a) first point;", "list-item-l1"),
        ("(i) nested point.", "list-item-l2"),
        ("(b) second point.", "list-item-l1"),
    ]