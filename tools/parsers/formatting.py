"""Shared structural formatting, paragraph-ID builder, and corpus quality gate.

Provides one consistent pipeline for regulation parsers and the updater:
  1. ``ParagraphEmitter`` turns hierarchical paragraph/list blocks into flat
     ``{id, text, class, ...}`` rows with deterministic, identity-bound sub-IDs
     (e.g. ``art_6__1``, ``art_6__1_b``, ``art_5__1_a_i``, ``art_6__1_s2``) that
     ``app.js``'s ``formatParagraphDescriptor`` renders as legal citations
     (``Article 6, paragraph 1 (b)``).
  2. ``validate_parsed_articles`` enforces structural invariants before
     ``update_regulations.py`` overwrites any regulation JSON on disk, preventing
     silent regressions such as collapsed lists or dropped articles.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass

LEVEL_CLASSES = {
    0: "",
    1: "list-item-l1",
    2: "list-item-l2",
    3: "list-item-l3",
}

# Leading paragraph number in body text: "1. Processing...", "1a. For the purposes..."
LEADING_PARA_NUM_RE = re.compile(r"^(\d+[a-z]?)\.\s+", re.IGNORECASE)

# Leading parenthetical or dotted list label: "(a)", "(1)", "(ii)", "1.", "3.1.", "—", "-"
LABEL_TOKEN_RE = re.compile(
    r"^(?:\(([0-9a-z]+)\)|([0-9]+(?:\.[0-9]+)*[a-z]?)\.|([a-z])\)|([\-\u2013\u2014]))$",
    re.IGNORECASE,
)

# Detects collapsed multi-point lists inside a single paragraph's plain text, e.g.:
# ": (a) ...; (b) ...; (c) ..." or ": (1) ...; (2) ...; (3) ..."
COLLAPSED_ALPHA_LIST_RE = re.compile(
    r":\s*\(a\)\s+.{15,}?;\s*\(b\)\s+.{15,}?;\s*\(c\)\s+",
    re.DOTALL,
)
COLLAPSED_NUM_LIST_RE = re.compile(
    r":\s*\(1\)\s+.{15,}?;\s*\(2\)\s+.{15,}?;\s*\(3\)\s+",
    re.DOTALL,
)


def normalise_ws(value: str) -> str:
    text = re.sub(r"\s+", " ", f"{value or ''}".replace("\u00a0", " ")).strip()
    # Collapse spaces introduced by get_text(" ") around superscript footnote tags: "( *1 )" -> "(*1)"
    text = re.sub(r"\(\s*(\*\d+)\s*\)", r"(\1)", text)
    # Strip stray trailing double-quote artifact in EUR-Lex OJ footnote HTML: ").’;"" -> ").’;"
    text = re.sub(r"([’'][\.;])\"$", r"\1", text)
    return text


def clean_heading_text(value: str) -> str:
    """Clean article headings, stripping unmatched trailing EUR-Lex OCR/typo quotes."""
    cleaned = normalise_ws(value)
    if not cleaned:
        return ""
    for open_q, close_q in (("‘", "’"), ("“", "”"), ("'", "'"), ('"', '"')):
        if not cleaned.endswith(close_q):
            continue
        is_unmatched = (
            (cleaned.count(close_q) % 2 == 1)
            if open_q == close_q
            else (cleaned.count(open_q) < cleaned.count(close_q))
        )
        if is_unmatched:
            # Keep legitimate English plural possessives like "authorities’"
            if close_q in {"'", "’"} and re.search(r"s['’]$", cleaned):
                continue
            cleaned = cleaned[: -len(close_q)].rstrip()
    return cleaned


def slugify_label(label: str) -> str:
    """Turn a printed list/paragraph label into a clean ID token."""
    cleaned = (label or "").strip().strip("‘'“\"„")
    match = LABEL_TOKEN_RE.match(cleaned)
    if match:
        if match.group(1):
            return match.group(1).lower()
        if match.group(2):
            return match.group(2).replace(".", "_").lower()
        if match.group(3):
            return match.group(3).lower()
        return "dash"
    slug = re.sub(r"[^0-9A-Za-z]+", "_", cleaned).strip("_").lower()
    return slug[:16]


class ParagraphEmitter:
    """Accumulates structured paragraphs for one article with unique structural IDs."""

    def __init__(self, article_id: str, linkify_fn=None) -> None:
        self.article_id = article_id
        self.linkify_fn = linkify_fn or (lambda s: s)
        self.paragraphs: list[dict] = []
        self._used_ids: set[str] = set()
        self._current_para_token: str | None = None
        self._unnumbered_counter = 0
        self._subpara_counter = 0
        self._level_tokens: dict[int, str] = {}

    def _unique_id(self, candidate: str) -> str:
        if candidate not in self._used_ids:
            self._used_ids.add(candidate)
            return candidate
        suffix = 2
        while f"{candidate}_{suffix}" in self._used_ids:
            suffix += 1
        unique = f"{candidate}_{suffix}"
        self._used_ids.add(unique)
        return unique

    def add(
        self,
        raw_text: str,
        *,
        level: int = 0,
        label: str = "",
        para_num: str | None = None,
        is_subparagraph: bool = False,
        extra_class: str = "",
        prelinked_html: str | None = None,
    ) -> None:
        """Emit one paragraph or list item in source order."""
        clean_label = normalise_ws(label)
        clean_body = normalise_ws(raw_text)

        if prelinked_html is None:
            combined_plain = (
                f"{clean_label} {clean_body}".strip() if clean_label else clean_body
            )
            if not combined_plain or not re.search(r"[0-9A-Za-z\u00C0-\u024F]", combined_plain):
                return
            rendered = self.linkify_fn(combined_plain)
        else:
            combined_plain = (
                f"{clean_label} {clean_body}".strip() if clean_label else clean_body
            )
            if not prelinked_html.strip():
                return
            rendered = prelinked_html

        clamped_level = max(0, min(level, 3))

        if clamped_level == 0:
            self._level_tokens.clear()
            detected_num = para_num
            if not detected_num and not is_subparagraph:
                m_num = LEADING_PARA_NUM_RE.match(combined_plain)
                if m_num:
                    detected_num = m_num.group(1).lower()
                else:
                    m_paren = re.match(r"^\((\d+[a-z]?)\)\s+", combined_plain, re.I)
                    if m_paren:
                        detected_num = m_paren.group(1).lower()

            if detected_num:
                self._current_para_token = slugify_label(detected_num) or detected_num.lower()
                self._subpara_counter = 1
                pid = self._unique_id(f"{self.article_id}__{self._current_para_token}")
            elif is_subparagraph and self._current_para_token:
                self._subpara_counter += 1
                pid = self._unique_id(
                    f"{self.article_id}__{self._current_para_token}_s{self._subpara_counter}"
                )
            else:
                self._unnumbered_counter += 1
                if self._current_para_token is None and self._unnumbered_counter == 1:
                    self._current_para_token = "1"
                    self._subpara_counter = 1
                    pid = self._unique_id(f"{self.article_id}__1")
                elif self._current_para_token and is_subparagraph:
                    self._subpara_counter += 1
                    pid = self._unique_id(
                        f"{self.article_id}__{self._current_para_token}_s{self._subpara_counter}"
                    )
                else:
                    pid = self._unique_id(f"{self.article_id}__p{self._unnumbered_counter}")
        else:
            # List item at level 1..3
            for deeper in list(self._level_tokens):
                if deeper >= clamped_level:
                    del self._level_tokens[deeper]

            token = slugify_label(clean_label)
            if not token:
                m_lead = re.match(
                    r"^(?:\(([0-9a-z]+)\)|([0-9]+(?:\.[0-9]+)*[a-z]?)\.|\u2014|-)\s+",
                    combined_plain,
                    re.I,
                )
                token = slugify_label(m_lead.group(0).strip()) if m_lead else f"i{len(self.paragraphs) + 1}"

            self._level_tokens[clamped_level] = token
            chain = []
            if self._current_para_token:
                chain.append(self._current_para_token)
            for lv in range(1, clamped_level + 1):
                if lv in self._level_tokens:
                    chain.append(self._level_tokens[lv])
            pid = self._unique_id(f"{self.article_id}__{'_'.join(chain)}")

        classes = [c for c in (LEVEL_CLASSES[clamped_level], extra_class) if c]
        if is_subparagraph and clamped_level == 0 and not extra_class:
            classes.append("subparagraph")

        row: dict = {
            "id": pid,
            "text": rendered,
            "class": " ".join(classes),
        }
        self.paragraphs.append(row)


def sanitize_eurlex_table(table_tag) -> str:
    """Render an EUR-Lex data/annex table as clean, safe HTML ``<table class="legal-table">``."""
    rows_html: list[str] = []
    for tr in table_tag.find_all("tr"):
        if tr.find_parent("table") is not table_tag:
            continue
        cells_html: list[str] = []
        for cell in tr.find_all(["th", "td"], recursive=False):
            tag = "th" if cell.name == "th" else "td"
            attrs = []
            for attr_name in ("colspan", "rowspan"):
                val = cell.get(attr_name)
                if val and str(val).isdigit() and int(val) > 1:
                    attrs.append(f'{attr_name}="{int(val)}"')
            attr_str = (" " + " ".join(attrs)) if attrs else ""
            cell_text = html.escape(normalise_ws(cell.get_text(" ")))
            cells_html.append(f"<{tag}{attr_str}>{cell_text}</{tag}>")
        if cells_html:
            rows_html.append(f"<tr>{''.join(cells_html)}</tr>")
    if not rows_html:
        return ""
    return f'<div class="legal-table-wrap"><table class="legal-table">{"".join(rows_html)}</table></div>'


@dataclass
class ValidationReport:
    ok: bool
    reasons: list[str]
    old_articles: int
    new_articles: int
    old_list_items: int
    new_list_items: int


def _strip_tags(raw: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", raw or ""))


def validate_parsed_articles(
    new_articles: list[dict],
    old_articles: list[dict] | None = None,
) -> ValidationReport:
    """Validate structural integrity of parsed articles and guard against regressions."""
    reasons: list[str] = []

    if not isinstance(new_articles, list) or not new_articles:
        return ValidationReport(False, ["no articles produced"], 0, 0, 0, 0)

    art_ids = [a.get("id") for a in new_articles]
    if any(not aid for aid in art_ids):
        reasons.append("article missing id")
    if len(art_ids) != len(set(art_ids)):
        reasons.append("duplicate article ids")

    new_list_items = 0
    collapsed_paragraphs = 0

    for art in new_articles:
        paras = art.get("paragraphs") or []
        para_ids: list[str] = []
        for p in paras:
            pid = p.get("id")
            if not pid:
                reasons.append(f"{art.get('id')}: paragraph missing id")
            else:
                para_ids.append(pid)
            cls = p.get("class") or ""
            if "list-item-" in cls:
                new_list_items += 1
            plain = normalise_ws(_strip_tags(p.get("text", "")))
            if not plain:
                reasons.append(f"{art.get('id')}: empty paragraph text")
            # Check for unsplit multi-item lists merged into one non-table paragraph
            if (
                len(plain) > 450
                and "<table" not in (p.get("text") or "")
                and (
                    COLLAPSED_ALPHA_LIST_RE.search(plain)
                    or COLLAPSED_NUM_LIST_RE.search(plain)
                )
            ):
                collapsed_paragraphs += 1
        if len(para_ids) != len(set(para_ids)):
            reasons.append(f"{art.get('id')}: duplicate paragraph ids")

    old_art_count = len(old_articles) if old_articles else 0
    old_list_items = (
        sum(
            1
            for a in (old_articles or [])
            for p in (a.get("paragraphs") or [])
            if "list-item-" in (p.get("class") or "")
        )
        if old_articles
        else 0
    )

    if old_articles:
        # Guard 1: catastrophic article drop (>15% and >2 articles lost)
        if len(new_articles) < old_art_count - 2 and len(new_articles) < old_art_count * 0.85:
            reasons.append(
                f"article count dropped sharply ({old_art_count} -> {len(new_articles)})"
            )
        # Guard 2: catastrophic list-item flattening (had >=15 list items and lost >55%)
        if old_list_items >= 15 and new_list_items < old_list_items * 0.45:
            reasons.append(
                f"list-item structure collapsed ({old_list_items} -> {new_list_items} list items)"
            )
        # Guard 3: newly introduced collapsed lists
        old_collapsed = sum(
            1
            for a in old_articles
            for p in (a.get("paragraphs") or [])
            if len(normalise_ws(_strip_tags(p.get("text", "")))) > 450
            and (
                COLLAPSED_ALPHA_LIST_RE.search(normalise_ws(_strip_tags(p.get("text", ""))))
                or COLLAPSED_NUM_LIST_RE.search(normalise_ws(_strip_tags(p.get("text", ""))))
            )
        )
        if collapsed_paragraphs > max(old_collapsed + 3, int(old_collapsed * 1.5) + 3):
            reasons.append(
                f"merged list paragraphs increased ({old_collapsed} -> {collapsed_paragraphs})"
            )

    return ValidationReport(
        ok=not reasons,
        reasons=reasons,
        old_articles=old_art_count,
        new_articles=len(new_articles),
        old_list_items=old_list_items,
        new_list_items=new_list_items,
    )
