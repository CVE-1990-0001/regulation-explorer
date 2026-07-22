#!/usr/bin/env python3
"""Parse EUR-Lex "eli-subdivision" HTML into richly cross-linked act-article JSON.

Python port of the former parser.js (cheerio -> BeautifulSoup/lxml). Emits the
same article/paragraph structure with internal-article anchors, external EUR-Lex
/ Springlex legal links, and hover-preview tooltip spans backed by snippet files
in ``<app>/data/<celex>.json``.

Usage: python3 parser.py <input.html> [output.json]
"""
import copy
import json
import os
import re
import sys

from bs4 import BeautifulSoup, NavigableString, Tag
from bs4.formatter import HTMLFormatter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "data"))


class _UnsortedFormatter(HTMLFormatter):
    """Serialize tags keeping their original attribute order (no alphabetising)."""

    def attributes(self, tag):
        return list(tag.attrs.items())


_UNSORTED = _UnsortedFormatter()

MAX_SNIPPET_LENGTH = 450

BULLET_SPACING_PATTERN = re.compile(r"^(\([a-z0-9ivxlcdm]+\))(\S)", re.I)

SPRINGLEX_MAPPINGS = {
    "Regulation (EU) 2022/2554": {
        "baseUrl": "https://www.springlex.eu/en/packages/dora/dora-regulation/",
        "articlePath": lambda article_slug: f"article-{article_slug}/",
        "label": "Digital Operational Resilience Act (DORA)",
    },
}

ARTICLE_IDENTIFIER_PATTERN_SOURCE = r"[0-9][0-9a-z]*(?:\([^)]+\))*"
PLURAL_INTERNAL_ARTICLE_PATTERN = re.compile(
    r"\bArticles\s+((?:" + ARTICLE_IDENTIFIER_PATTERN_SOURCE + r")"
    r"(?:\s*(?:,|and|or|to|-)\s*(?:" + ARTICLE_IDENTIFIER_PATTERN_SOURCE + r"))*)",
    re.I,
)
SINGULAR_INTERNAL_ARTICLE_PATTERN = re.compile(
    r"\bArticle\s+(" + ARTICLE_IDENTIFIER_PATTERN_SOURCE + r")", re.I
)
INTERNAL_ARTICLE_IDENTIFIER_PATTERN = re.compile(ARTICLE_IDENTIFIER_PATTERN_SOURCE, re.I)

IDENTIFIER_SEGMENT_PATTERN = re.compile(r"[0-9ivxlcdm]+|\([^)]+\)", re.I)

CITATION_REGEX = re.compile(
    r"((?:Article|Articles)[^,;]*?\s+of\s+)?"
    r"(Regulation|Directive|Decision)\s*"
    r"(\((?:EU|EC|EEC|EURATOM)\))?\s*"
    r"(No\s*)?(\d{1,4})/(\d{2,4})(?:/([A-Z]{2,}))?",
    re.I,
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def escape_attribute(value):
    return (
        f"{value or ''}"
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def escape_html(value):
    return (
        f"{value or ''}"
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def parse_int(value):
    """Mimic JS parseInt(value, 10): parse a leading integer, else None (NaN)."""
    match = re.match(r"\s*([+-]?\d+)", f"{value}")
    return int(match.group(1)) if match else None


def pad_document_number(number_string):
    clean = re.sub(r"\D", "", f"{number_string or ''}")
    if not clean:
        return ""
    return clean.zfill(4)


def normalise_year(value):
    numeric = parse_int(value)
    if numeric is None:
        return None
    if numeric > 1900:
        return numeric
    if numeric >= 100:
        return 1900 + (numeric % 100)
    return 1900 + numeric if numeric >= 50 else 2000 + numeric


def celex_letter_for_type(type_):
    if not type_:
        return "R"
    lower = type_.lower()
    if "directive" in lower:
        return "L"
    if "decision" in lower:
        return "D"
    return "R"


def build_eurlex_url(doc_type, year, doc_number):
    letter = celex_letter_for_type(doc_type)
    padded_number = pad_document_number(doc_number)
    if not year or not padded_number:
        return None
    return (
        "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:"
        f"3{year}{letter}{padded_number}"
    )


def build_celex_id(doc_type, year, doc_number):
    letter = celex_letter_for_type(doc_type)
    padded_number = pad_document_number(doc_number)
    if not year or not padded_number:
        return None
    return f"3{year}{letter}{padded_number}"


def normalise_article_identifier(value):
    if not value:
        return None
    no_ws = re.sub(r"\s+", "", value)
    return re.sub(r"[A-Z]+", lambda m: m.group(0).lower(), no_ws)


def truncate_snippet(value, max_length=MAX_SNIPPET_LENGTH):
    if not value or len(value) <= max_length:
        return value
    truncated = value[:max_length]
    safe = re.sub(r"\s+\S*$", "", truncated)
    return f"{safe}..."


def article_slug_from_reference(article_number):
    if not article_number:
        return None
    slug = f"{article_number}".lower()
    slug = re.sub(r"[^a-z0-9()/\s-]+", "", slug)
    slug = re.sub(r"[()]", "-", slug)
    slug = re.sub(r"\s+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    slug = re.sub(r"^-+|-+$", "", slug)
    slug = re.sub(r"^-", "", slug)
    slug = re.sub(r"-$", "", slug)
    return slug or None


def get_springlex_url(key, article_number):
    mapping = SPRINGLEX_MAPPINGS.get(key)
    if not mapping:
        return None
    if article_number:
        article_slug = article_slug_from_reference(article_number)
        if article_slug:
            return f"{mapping['baseUrl']}{mapping['articlePath'](article_slug)}"
    return mapping["baseUrl"]


def split_identifier_segments(value):
    if not value:
        return []
    return IDENTIFIER_SEGMENT_PATTERN.findall(f"{value}")


def create_hierarchy_tracker():
    return {"stack": [], "levels": []}


def detect_leading_token(text):
    if not text:
        return None

    number_dot_match = re.match(r"^([0-9]+)\.", text)
    if number_dot_match:
        return {"segment": f"({number_dot_match.group(1)})", "level": 0}

    number_standalone_match = re.match(r"^([0-9]+)\b", text)
    if number_standalone_match:
        return {"segment": f"({number_standalone_match.group(1)})", "level": 0}

    paren_match = re.match(r"^\(([0-9a-zivxlcdm]+)\)", text, re.I)
    if paren_match:
        raw = paren_match.group(1)
        if re.match(r"^[0-9]+$", raw):
            return {"segment": f"({raw})", "level": 0}
        if re.match(r"^[ivxlcdm]+$", raw, re.I):
            return {"segment": f"({raw.lower()})", "level": 2}
        return {"segment": f"({raw.lower()})", "level": 1}

    return None


def update_hierarchy_tracker(tracker, text):
    if not tracker:
        return []
    token = detect_leading_token(text)
    if not token:
        return []
    level = token["level"]
    segment = token["segment"]
    while tracker["levels"] and tracker["levels"][-1] >= level:
        tracker["levels"].pop()
        tracker["stack"].pop()
    tracker["levels"].append(level)
    tracker["stack"].append(segment)
    return list(tracker["stack"])


def build_paragraph_anchor_id(article_id, segments, fallback_index=None):
    if not article_id:
        return None

    if not segments:
        if fallback_index is None:
            return None
        return f"{article_id}__p{fallback_index + 1}"

    parts = []
    for segment in segments:
        cleaned = re.sub(r"[()]", "", f"{segment}")
        cleaned = re.sub(r"[^a-z0-9]+", "-", cleaned, flags=re.I)
        cleaned = re.sub(r"^-+|-+$", "", cleaned)
        if cleaned:
            parts.append(cleaned)
    slug = "_".join(parts).lower()

    base = slug or (f"p{fallback_index + 1}" if fallback_index is not None else None)
    if not base:
        return None
    return f"{article_id}__{base}"


def is_skippable_hierarchy_segment(segment):
    if not segment:
        return False
    return bool(re.match(r"^\([0-9ivxlcdm]+\)$", segment, re.I))


def hierarchy_segments_match(target_segments, candidate_segments):
    if not target_segments or not candidate_segments:
        return False

    target_index = 0
    for candidate in candidate_segments:
        candidate_segment = candidate.lower()
        current_target = (
            target_segments[target_index] if target_index < len(target_segments) else None
        )

        if current_target and candidate_segment == current_target:
            target_index += 1
            continue

        if is_skippable_hierarchy_segment(candidate_segment):
            continue

        return False

    return target_index == len(target_segments)


def find_closest_identifier_key(store_keys, identifier):
    if not store_keys or not identifier:
        return None

    target_segments_raw = split_identifier_segments(identifier)
    if not target_segments_raw:
        return None

    target_segments = [segment.lower() for segment in target_segments_raw]
    best_match = None

    for candidate_key in store_keys:
        candidate_segments_raw = split_identifier_segments(candidate_key)
        if not candidate_segments_raw:
            continue
        if candidate_segments_raw[0].lower() != target_segments[0]:
            continue
        if not hierarchy_segments_match(target_segments, candidate_segments_raw):
            continue

        length = len(candidate_segments_raw)
        if (
            best_match is None
            or length < best_match["length"]
            or (length == best_match["length"] and candidate_key < best_match["key"])
        ):
            best_match = {"key": candidate_key, "length": length}

    return best_match["key"] if best_match else None


def normalize_whitespace(text):
    if not isinstance(text, str):
        return ""
    return re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()


def ensure_bullet_spacing(text):
    if BULLET_SPACING_PATTERN.match(text):
        return BULLET_SPACING_PATTERN.sub(r"\1 \2", text, count=1)
    return text


def classify_paragraph(text):
    if re.match(r"^\([ivx]+\)", text, re.I):
        return "list-item-l2"
    if re.match(r"^\([a-z]{1,2}\)", text):
        return "list-item-l1"
    if re.match(r"^\([0-9]+\)", text):
        return "list-item-l1"
    return ""


def strip_html_tags(value):
    if not isinstance(value, str):
        return ""
    return re.sub(r"<[^>]*>", " ", value)


def dedupe_consecutive_paragraphs(paragraphs):
    if not isinstance(paragraphs, list) or len(paragraphs) < 2:
        return paragraphs

    output = []
    last_key = None
    recent_keys = []
    recent_limit = 10

    for paragraph in paragraphs:
        if not paragraph or not isinstance(paragraph.get("text"), str):
            continue

        normalised_for_key = normalize_whitespace(
            strip_html_tags(paragraph["text"])
        ).lower()
        key = f"{paragraph.get('class') or ''}:::{normalised_for_key}"

        if key and key == last_key:
            continue
        if key and key in recent_keys:
            continue

        output.append(paragraph)
        last_key = key

        if key:
            recent_keys.append(key)
            if len(recent_keys) > recent_limit:
                recent_keys.pop(0)

    return output


def class_list(node):
    if not isinstance(node, Tag):
        return []
    cls = node.get("class")
    if not cls:
        return []
    return cls if isinstance(cls, list) else str(cls).split()


def has_class(node, name):
    return name in class_list(node)


# ---------------------------------------------------------------------------
# Stateful parser
# ---------------------------------------------------------------------------

class Parser:
    def __init__(self, soup):
        self.soup = soup
        self.internal_article_ids = {}
        self.snippet_cache = {}
        self.processed_tables = set()

    # -- internal article registry --------------------------------------

    def register_internal_article(self, article_label, article_id):
        if not article_label or not article_id:
            return
        match = re.search(r"Article\s+([0-9]+[a-z]*)", f"{article_label}", re.I)
        if not match:
            return
        key = match.group(1).lower()
        if key not in self.internal_article_ids:
            self.internal_article_ids[key] = article_id

    def build_internal_article_link(self, display_text, identifier):
        if not display_text or not identifier:
            return None

        segments = split_identifier_segments(identifier)
        if not segments:
            return None

        article_key = f"{segments[0]}".lower()
        article_id = self.internal_article_ids.get(article_key)
        if not article_id:
            return None

        href = f"#{article_id}"

        if len(segments) > 1:
            paragraph_id = build_paragraph_anchor_id(article_id, segments[1:])
            if paragraph_id:
                href = f"#{paragraph_id}"

        safe_href = escape_attribute(href)
        safe_display = escape_html(display_text)
        return (
            f'<a href="{safe_href}" class="internal-article-link" '
            f'target="_blank" rel="noopener">{safe_display}</a>'
        )

    # -- internal reference text transforms -----------------------------

    def should_skip_internal_link(self, source, offset, match_length, additional_remainder=""):
        if not (isinstance(source, str) and isinstance(offset, int) and isinstance(match_length, int)):
            return False

        remainder_within_node = source[offset + match_length:]
        remainder = f"{remainder_within_node}{additional_remainder or ''}"
        if not remainder:
            return False

        trimmed = remainder.lstrip().lower()
        if not trimmed:
            return False

        sanitised = trimmed
        leading_pattern = re.compile(r"^(?:[,;\s]*(?:and|or|to|-)\s*|\([^)]+\)\s*)")
        while leading_pattern.match(sanitised):
            sanitised = leading_pattern.sub("", sanitised, count=1).lstrip()

        allow_patterns = [
            re.compile(r"^of\s+this\s+regulation\b"),
            re.compile(r"^of\s+the\s+regulation\b"),
        ]
        if any(p.match(trimmed) or p.match(sanitised) for p in allow_patterns):
            return False

        external_instrument_pattern = re.compile(
            r"^of\s+(?:the\s+)?(?:[a-z]+\s+){0,6}"
            r"(directive|regulation|decision|treaty)(?=\s|[0-9(,.;:])"
        )
        if external_instrument_pattern.match(trimmed) or external_instrument_pattern.match(sanitised):
            return True

        skip_patterns = [
            re.compile(r"^of\s+(this|that)\s+directive\b"),
            re.compile(r"^of\s+the\s+directive\b"),
            re.compile(r"^of\s+directive\b"),
            re.compile(r"^of\s+(this|that)\s+decision\b"),
            re.compile(r"^of\s+decision\b"),
            re.compile(r"^of\s+(this|that)\s+regulation\b"),
            re.compile(r"^of\s+that\s+regulation\b"),
            re.compile(r"^of\s+regulation\b"),
            re.compile(r"^(thereof|thereto|therein)\b"),
        ]
        return any(p.match(trimmed) or p.match(sanitised) for p in skip_patterns)

    def transform_internal_reference_text(self, input_text, context_provider=None):
        if not input_text or not self.internal_article_ids:
            return input_text

        output = input_text

        def plural_repl(match):
            list_part = match.group(1)
            source = match.string
            offset = match.start()
            extra_context = (
                context_provider(offset + len(match.group(0)), match.group(0), source)
                if context_provider
                else ""
            )
            if self.should_skip_internal_link(source, offset, len(match.group(0)), extra_context):
                return match.group(0)
            if not list_part:
                return match.group(0)

            def ident_repl(im):
                linked = self.build_internal_article_link(im.group(0), im.group(0))
                return linked or im.group(0)

            transformed_list = INTERNAL_ARTICLE_IDENTIFIER_PATTERN.sub(ident_repl, list_part)
            if transformed_list == list_part:
                return match.group(0)
            return match.group(0).replace(list_part, transformed_list, 1)

        output = PLURAL_INTERNAL_ARTICLE_PATTERN.sub(plural_repl, output)

        def singular_repl(match):
            identifier = match.group(1)
            source = match.string
            offset = match.start()
            extra_context = (
                context_provider(offset + len(match.group(0)), match.group(0), source)
                if context_provider
                else ""
            )
            if self.should_skip_internal_link(source, offset, len(match.group(0)), extra_context):
                return match.group(0)
            linked = self.build_internal_article_link(match.group(0), identifier)
            return linked or match.group(0)

        output = SINGULAR_INTERNAL_ARTICLE_PATTERN.sub(singular_repl, output)

        return output

    def linkify_internal_article_references(self, content):
        if not content or not isinstance(content, str):
            return content
        if not self.internal_article_ids:
            return content

        fragment = BeautifulSoup(
            f'<span data-internal-wrapper="true">{content}</span>', "html.parser"
        )
        wrapper = fragment.find("span", attrs={"data-internal-wrapper": "true"})
        if wrapper is None:
            return content

        def is_link_like(node):
            return isinstance(node, Tag) and (
                node.name == "a" or has_class(node, "legal-reference")
            )

        def collect_following_plain_text(start_node, max_length=120):
            text = ""
            for current in start_node.next_siblings:
                if len(text) >= max_length:
                    break
                if isinstance(current, NavigableString):
                    text += str(current)
                elif isinstance(current, Tag):
                    text += current.get_text()
                if len(text) >= max_length:
                    break
            if len(text) > max_length:
                return text[:max_length]
            return text

        replacements = []

        def traverse(node):
            if isinstance(node, Tag):
                if is_link_like(node):
                    return
                for child in list(node.children):
                    traverse(child)
                return

            if isinstance(node, NavigableString):
                parent = node.parent
                if parent is not None and is_link_like(parent):
                    return

                original = str(node)
                cached = {}

                def trailing_supplier(*_args):
                    if "value" not in cached:
                        cached["value"] = collect_following_plain_text(node)
                    return cached["value"]

                transformed = self.transform_internal_reference_text(
                    original, lambda *_a: trailing_supplier()
                )
                if transformed != original:
                    replacements.append((node, transformed))

        for child in list(wrapper.children):
            traverse(child)

        for nav_string, transformed in replacements:
            new_nodes = BeautifulSoup(transformed, "html.parser")
            nav_string.replace_with(new_nodes)

        return wrapper.decode_contents(formatter=_UNSORTED)

    # -- snippet store --------------------------------------------------

    def get_directive_snippet(self, celex_id, article_identifier):
        if not celex_id or not article_identifier:
            return None

        if celex_id in self.snippet_cache:
            store = self.snippet_cache[celex_id]
        else:
            snippet_path = os.path.join(DATA_DIR, f"{celex_id}.json")
            if os.path.exists(snippet_path):
                try:
                    with open(snippet_path, encoding="utf-8") as fh:
                        store = json.load(fh)
                except Exception as error:  # noqa: BLE001
                    print(
                        f"Failed to load snippet file for {celex_id}: {error}",
                        file=sys.stderr,
                    )
                    store = None
            else:
                store = None
            self.snippet_cache[celex_id] = store

        if not store:
            return None

        key = normalise_article_identifier(article_identifier)
        if not key:
            return None

        store_keys = list(store.keys())

        if key in store:
            resolved_key = key
        else:
            resolved_key = find_closest_identifier_key(store_keys, key)

        if resolved_key:
            base_text = store.get(resolved_key) or ""
            child_keys = sorted(k for k in store_keys if k.startswith(f"{resolved_key}("))

            if not child_keys:
                if not base_text:
                    return None
                return {"text": base_text, "allowTruncate": True}

            child_text = "\n\n".join(
                t for t in (store[k] for k in child_keys) if t
            ).strip()
            combined = "\n\n".join(t for t in (base_text, child_text) if t)
            if not combined:
                return None
            return {"text": combined, "allowTruncate": False}

        if "(" in key:
            return None

        candidate_keys = sorted(k for k in store_keys if k.startswith(f"{key}("))
        if not candidate_keys:
            return None

        aggregated_text = "\n\n".join(
            t for t in (store[k] for k in candidate_keys) if t
        ).strip()
        if not aggregated_text:
            return None

        return {"text": aggregated_text, "allowTruncate": False}

    # -- article reference decoration -----------------------------------

    def decorate_article_references(self, article_part, celex_id, doc_label, source_label):
        if not article_part:
            return {"html": "", "references": []}

        tokens = []
        reference_tokens = []
        article_word_tokens = []
        state = {"current_article_word_token": None, "last_hierarchy": None}

        def classify_segment(segment):
            if not segment:
                return "other"
            inner = segment[1:-1]
            if re.match(r"^[0-9]+$", inner, re.I):
                return "numeric"
            if re.match(r"^[ivxlcdm]+$", inner, re.I):
                return "roman"
            if re.match(r"^[a-z]+$", inner, re.I):
                return "letter"
            return "other"

        def split_reference(reference_text):
            if not reference_text:
                return []
            head_match = re.match(r"^[0-9ivxlcdm]+", reference_text, re.I)
            if not head_match:
                return []
            segments = [head_match.group(0)]
            parens = re.findall(r"\([^)]+\)", reference_text)
            segments.extend(parens)
            return segments

        def build_reference_preview(identifier, snippet_text):
            article_label = f"Article {identifier}" if identifier else "Article"
            if snippet_text:
                return f"{doc_label} \u2013 {article_label}\n{snippet_text}\nSource: {source_label}"
            return f"{doc_label} \u2013 {article_label}\nOpens on {source_label}"

        def build_aggregate_section(identifier, snippet_text):
            article_label = f"Article {identifier}"
            if snippet_text:
                return f"{article_label}\n{snippet_text}"
            return f"{article_label}\nOpens on {source_label}"

        def create_tooltip_span(text, preview):
            safe_preview = escape_attribute(
                preview or f"{doc_label} \u2013 opens on {source_label}"
            )
            return (
                f'<span class="legal-reference" data-preview="{safe_preview}">'
                f"{escape_html(text)}</span>"
            )

        def append_reference_token(display_text, hierarchy):
            if not hierarchy:
                tokens.append({"type": "text", "text": display_text})
                return None
            identifier = "".join(hierarchy)
            snippet_info = self.get_directive_snippet(celex_id, identifier)
            if snippet_info:
                snippet_text = (
                    truncate_snippet(snippet_info["text"])
                    if snippet_info["allowTruncate"]
                    else snippet_info["text"]
                )
            else:
                snippet_text = None
            reference_token = {
                "type": "reference",
                "text": display_text,
                "identifier": identifier,
                "snippetText": snippet_text,
                "preview": build_reference_preview(identifier, snippet_text),
                "aggregateSection": build_aggregate_section(identifier, snippet_text),
            }
            tokens.append(reference_token)
            reference_tokens.append(reference_token)

            current_word = state["current_article_word_token"]
            if current_word is not None:
                current_word.setdefault("referenceIndices", [])
                current_word["referenceIndices"].append(len(reference_tokens) - 1)

            state["last_hierarchy"] = hierarchy
            return reference_token

        def push_article_word_token(word):
            token = {
                "type": "article-word",
                "text": word,
                "referenceIndices": [],
                "preview": None,
            }
            tokens.append(token)
            article_word_tokens.append(token)
            state["current_article_word_token"] = token

        def push_text_token(text):
            if text:
                tokens.append({"type": "text", "text": text})

        def derive_sibling_hierarchy(parenthesis_text):
            last_hierarchy = state["last_hierarchy"]
            if not last_hierarchy:
                return None

            new_type = classify_segment(parenthesis_text)
            hierarchy = list(last_hierarchy)

            if len(hierarchy) == 1:
                hierarchy.append(parenthesis_text)
                return hierarchy

            last_segment = hierarchy[-1]
            last_type = classify_segment(last_segment)

            if last_type == new_type:
                hierarchy[-1] = parenthesis_text
            else:
                hierarchy.append(parenthesis_text)

            return hierarchy

        index = 0
        length = len(article_part)
        while index < length:
            remainder = article_part[index:]
            previous_char = article_part[index - 1] if index > 0 else ""
            can_start_reference = index == 0 or bool(
                re.match(r"[^0-9a-z]", previous_char, re.I)
            )

            articles_match = re.match(r"Articles\b", remainder, re.I)
            if articles_match:
                push_article_word_token(articles_match.group(0))
                index += len(articles_match.group(0))
                continue

            article_match = re.match(r"Article\b", remainder, re.I)
            if article_match:
                push_article_word_token(article_match.group(0))
                index += len(article_match.group(0))
                continue

            numeric_match = (
                re.match(r"[0-9ivxlcdm]+(?:\([0-9a-zivxlcdm]+\))*", remainder, re.I)
                if can_start_reference
                else None
            )
            if numeric_match:
                reference_text = numeric_match.group(0)
                hierarchy = split_reference(reference_text)
                append_reference_token(reference_text, hierarchy)
                index += len(reference_text)
                continue

            paren_match = (
                re.match(r"\([0-9a-zivxlcdm]+\)", remainder, re.I)
                if can_start_reference
                else None
            )
            if paren_match:
                paren_text = paren_match.group(0)
                hierarchy = derive_sibling_hierarchy(paren_text)
                if hierarchy:
                    append_reference_token(paren_text, hierarchy)
                else:
                    push_text_token(paren_text)
                    state["last_hierarchy"] = None
                index += len(paren_text)
                continue

            current_char = article_part[index]
            push_text_token(current_char)
            index += 1

        for token in article_word_tokens:
            indices = token.get("referenceIndices") or []
            if not indices:
                token["preview"] = (
                    f"{doc_label} \u2013 {token['text'].strip()}\nOpens on {source_label}"
                )
                continue

            if len(indices) == 1:
                token["preview"] = reference_tokens[indices[0]]["preview"]
                continue

            refs = [reference_tokens[i] for i in indices]
            identifier_list = ", ".join(ref["identifier"] for ref in refs)
            sections = "\n\n".join(ref["aggregateSection"] for ref in refs)
            token["preview"] = (
                f"{doc_label} \u2013 {token['text'].strip()} {identifier_list}\n"
                f"{sections}\nSource: {source_label}"
            )

        html_parts = []
        for token in tokens:
            if token["type"] == "text":
                html_parts.append(escape_html(token["text"]))
            elif token["type"] == "reference":
                html_parts.append(create_tooltip_span(token["text"], token["preview"]))
            elif token["type"] == "article-word":
                safe_preview = escape_attribute(
                    token["preview"]
                    or f"{doc_label} \u2013 {token['text'].strip()}\nOpens on {source_label}"
                )
                html_parts.append(
                    f'<span class="legal-reference" data-preview="{safe_preview}">'
                    f"{escape_html(token['text'])}</span>"
                )

        return {"html": "".join(html_parts), "references": reference_tokens}

    # -- legal reference linkification ----------------------------------

    def linkify_legal_references(self, text):
        if not text or not isinstance(text, str):
            return text

        def repl(match):
            article_part = match.group(1)
            doc_type = match.group(2)
            legal_basis = match.group(3)
            no_token = match.group(4)
            number1 = match.group(5)
            number2 = match.group(6)
            suffix = match.group(7)

            article_reference_raw = article_part or ""
            article_number_for_link = None

            if article_reference_raw:
                article_match = re.search(
                    r"Article(?:s)?\s+([0-9ivxlcdm]+(?:\([0-9a-zivxlcdm]+\))*)",
                    article_reference_raw,
                    re.I,
                )
                if article_match:
                    article_number_for_link = article_match.group(1)

            cleaned_legal_basis = re.sub(r"[()]", "", legal_basis or "") or None
            has_no = bool(no_token)

            if has_no:
                document_number = number1
                year = normalise_year(number2)
            elif (suffix and len(suffix)) or (
                not suffix and len(number1) == 4 and (parse_int(number1) or 0) > 1900
            ):
                year = normalise_year(number1)
                document_number = number2
            elif not suffix and (parse_int(number2) or 0) > 1900:
                year = normalise_year(number2)
                document_number = number1
            else:
                year = normalise_year(number1)
                document_number = number2

            if not year or not document_number:
                return match.group(0)

            doc_label = (
                f"{doc_type}"
                f"{(' ' + legal_basis) if legal_basis else ''} "
                f"{no_token or ''}{number1}/{number2}"
                f"{('/' + suffix) if suffix else ''}"
            ).strip()
            mapping_key = (
                f"{doc_type} ({cleaned_legal_basis or 'EU'}) "
                f"{year}/{parse_int(document_number)}"
            )
            celex_id = build_celex_id(doc_type, year, document_number)

            url = get_springlex_url(mapping_key, article_number_for_link)
            source_label = "Springlex"

            if not url:
                url = build_eurlex_url(doc_type, year, document_number)
                source_label = "EUR-Lex"

            if not url:
                return match.group(0)

            if article_reference_raw:
                decorated = self.decorate_article_references(
                    article_reference_raw, celex_id, doc_label, source_label
                )
            else:
                decorated = {"html": article_reference_raw, "references": []}

            first_reference = (
                decorated["references"][0] if decorated["references"] else None
            )

            if not article_number_for_link and first_reference:
                article_number_for_link = first_reference["identifier"]

            anchor_preview = f"{doc_label} \u2013 opens on {source_label}"
            escaped_preview = escape_attribute(anchor_preview)
            escaped_url = escape_attribute(url)

            article_prefix = decorated["html"] or article_reference_raw or ""
            doc_anchor = (
                f'<a href="{escaped_url}" class="legal-link" target="_blank" '
                f'rel="noopener noreferrer" data-preview="{escaped_preview}">{doc_label}</a>'
            )

            return f"{article_prefix}{doc_anchor}"

        return CITATION_REGEX.sub(repl, text)

    # -- DOM extraction -------------------------------------------------

    def add_paragraph(self, article, context, raw_text):
        if not context:
            return

        normalized = ensure_bullet_spacing(normalize_whitespace(raw_text))
        if not normalized:
            return

        hierarchy_segments = update_hierarchy_tracker(context["hierarchy"], normalized)
        anchor_id = build_paragraph_anchor_id(
            article["id"], hierarchy_segments, context["paragraphCounter"]
        )
        paragraph_id = anchor_id or f"{article['id']}__p{context['paragraphCounter'] + 1}"

        enriched = self.linkify_legal_references(normalized)
        hyperlinked = self.linkify_internal_article_references(enriched)

        article["paragraphs"].append({
            "id": paragraph_id,
            "text": hyperlinked,
            "class": classify_paragraph(normalized),
        })

        context["paragraphCounter"] += 1

    def process_table(self, table, article, context):
        if table is None:
            return
        if id(table) in self.processed_tables:
            return
        self.processed_tables.add(id(table))

        for row in table.find_all("tr"):
            cells = row.find_all("td", recursive=False)
            if not cells:
                continue

            enumerator = extract_cell_text([cells[0]])
            body_text = extract_cell_text(cells[1:])

            combined = " ".join(t for t in (enumerator, body_text) if t)

            if combined and combined.strip():
                self.add_paragraph(article, context, combined)

            for cell in cells:
                for nested in cell.find_all("table"):
                    self.process_table(nested, article, context)

    def process_node(self, node, article, context):
        if not isinstance(node, Tag):
            return

        if (node.name == "div" and has_class(node, "eli-title")) or (
            node.name == "p" and has_class(node, "oj-ti-art")
        ):
            return

        if node.name == "table":
            self.process_table(node, article, context)
            return

        if node.name == "p" and has_class(node, "oj-normal"):
            self.add_paragraph(article, context, node.get_text())
            return

        for child in node.find_all(True, recursive=False):
            self.process_node(child, article, context)

    def run(self):
        article_elements = self.soup.select('div.eli-subdivision[id^="art_"]')

        for el in article_elements:
            article_id = el.get("id")
            title_node = el.select_one("p.oj-ti-art")
            article_number = normalize_whitespace(
                title_node.get_text() if title_node else ""
            )
            self.register_internal_article(article_number, article_id)

        articles = []
        for el in article_elements:
            article_id = el.get("id")
            title_node = el.select_one("p.oj-ti-art")
            article_number = normalize_whitespace(
                title_node.get_text() if title_node else ""
            )
            heading_node = el.select_one("div.eli-title p.oj-sti-art")
            article_heading = normalize_whitespace(
                heading_node.get_text() if heading_node else ""
            )

            article = {
                "id": article_id,
                "title": article_number or article_id,
                "heading": article_heading,
                "paragraphs": [],
            }

            context = {
                "hierarchy": create_hierarchy_tracker(),
                "paragraphCounter": 0,
            }

            for child in el.find_all(True, recursive=False):
                self.process_node(child, article, context)

            article["paragraphs"] = dedupe_consecutive_paragraphs(article["paragraphs"])

            articles.append(article)

        return articles


def extract_cell_text(cells):
    if not cells:
        return ""
    parts = []
    for cell in cells:
        clone = copy.copy(cell)
        for table in clone.find_all("table"):
            table.decompose()
        parts.append(clone.get_text())
    return "".join(parts)


def parse(html):
    soup = BeautifulSoup(html, "lxml")
    return Parser(soup).run()


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 parser.py <input.html> [output.json]", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]
    if not os.path.exists(input_file):
        print(f"File not found: {input_file}", file=sys.stderr)
        sys.exit(1)

    output_file = sys.argv[2] if len(sys.argv) > 2 else re.sub(
        r"\.html$", ".json", input_file, flags=re.I
    )

    with open(input_file, encoding="utf-8") as fh:
        html = fh.read()

    articles = parse(html)

    with open(output_file, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(articles, ensure_ascii=False, indent=2))

    print(f"Found {len(articles)} articles.")


if __name__ == "__main__":
    main()
