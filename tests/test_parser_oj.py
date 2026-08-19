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