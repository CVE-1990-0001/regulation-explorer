#!/usr/bin/env python3
"""Extract per-act term definitions into ``data/definitions.json`` for tooltips.

Scans every act registered in ``data/index.json`` for definition articles/sections
(headings matching ``Definitions`` or ``Begriffsbestimmungen``) and extracts
structured glossary entries with pre-expanded surface forms. Acts without a
definitions section are omitted so the browser does nothing for them.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "data" / "index.json"
OUTPUT_PATH = ROOT / "data" / "definitions.json"

DEFINITION_HEADING_RE = re.compile(
    r"\b(?:definitions?|begriffsbestimmungen)\b", re.IGNORECASE
)
GERMAN_HEADING_RE = re.compile(r"\bbegriffsbestimmungen\b", re.IGNORECASE)

# Splits numbered items inside a single paragraph or at paragraph start:
#   "(1) ‘term’ ...", "1. ‘term’ ...", "1. „Begriff“ ...", and the EUR-Lex
#   missing-opening-quote typo "(41) open interoperability specification’ means ..."
INLINE_ITEM_RE = re.compile(
    r"(?:^|(?<=[:;.])\s+)(?:\((\d+[a-z]?)\)|(\d+[a-z]?)\.)\s+"
    r"(?=[‘'“\"„]|[A-Za-z][^;:\n]{1,65}?[’'”\"]\s+means\b)"
)
SUBPOINT_PARA_RE = re.compile(r"^\([a-z]+\)\s+")
STRONG_DEF_RE = re.compile(
    r"^\s*<strong>([^<]+)</strong>\s*<br\s*/?>\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)
QUOTED_TERM_RE = re.compile(r"[‘'“\"„]([^’'”\"“\n]{1,120})[’'”\"“]")
MISSING_OPEN_QUOTE_RE = re.compile(
    r"^([A-Za-z][^’'”\"\n]{1,80})[’'”\"]\s+means\b"
)
INLINE_PAREN_ALIAS_RE = re.compile(
    r"\(\s*[‘'“\"]([A-Za-z][^’'”\"\n]{1,60})[’'”\"]\s*\)"
)
LEADING_DE_HEADWORDS_RE = re.compile(
    r"^(?:[‘'“\"„][^’'”\"“\n]{1,120}[’'”\"“](?:\s*(?:,|oder|or)\s*)?)+"
)

# Unquoted German statutory definitions (e.g. Börsengesetz § 2, § 44)
PROSE_IM_SINNE_RE = re.compile(
    r"(?:^|(?<=\.\s))(?:(?:Ein|Eine|Der|Die|Das)\s+)?"
    r"([A-ZÄÖÜa-zäöüß][^\n,.()]{1,65}?)\s+im Sinne dieses Gesetzes\s+(?:ist|sind)\b"
)
PROSE_COPULA_RE = re.compile(
    r"^(?:(?:Der|Die|Das)\s+)?([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,60})\s+"
    r"(?:ist\s+(?:ein|eine|jeder|jede)\b|sind\s+[a-zäöüß]+\s+[A-ZÄÖÜ]|umfasst\s+)"
)
PARA_NUM_RE = re.compile(r"^\((\d+[a-z]?)\)\s*(.+)$", re.DOTALL)

DE_UMLAUT_STEMS = (
    ("vorfall", ("vorfälle", "vorfällen")),
    ("markt", ("märkte", "märkten")),
    ("platz", ("plätze", "plätzen")),
    ("zugang", ("zugänge", "zugängen")),
    ("bestand", ("bestände", "beständen")),
    ("vertrag", ("verträge", "verträgen")),
    ("grundsatz", ("grundsätze", "grundsätzen")),
)
DE_ADJ_SUFFIX_RE = re.compile(r"^([A-Za-zÄÖÜäöüß]{3,}?)(?:e|en|er|es|em)$")


SAFE_ANCHOR_RE = re.compile(r"<a\b([^>]*)>(.*?)</a>", re.IGNORECASE | re.DOTALL)
SAFE_ATTR_RE = re.compile(
    r'\b(href|class|data-ref|data-article|data-paragraph|target|rel)="([^"]*)"'
)
DELEGATION_CUE_RE = re.compile(
    r"\b(?:as defined in|within the meaning of|nach\s+(?:<a[^>]*>)?Artikel|im Sinne\s+(?:des|der))\b",
    re.IGNORECASE,
)
NEGATED_DELEGATION_RE = re.compile(r"\bother than\b|\baußer\b", re.IGNORECASE)
DATA_REF_RE = re.compile(r'data-ref="([^"]+)"')
POINT_NUM_PATTERNS = (
    # "point (15) of Article 4(1)", "point 1 of Article 6"
    re.compile(r"\bpoints?\s*\(?(\d+[a-z]?)\)?\s+of\s+Article\b", re.IGNORECASE),
    # "Article 4(1), point (15)", "Article 6, point 1", "Article 4, point (1)"
    re.compile(
        r"\bArticle\s+\d+[a-z]?(?:\(\d+[a-z]?\))?\s*,?\s*points?\s*\(?(\d+[a-z]?)\)?",
        re.IGNORECASE,
    ),
    # "Artikel 2 Nummer 8", "Artikel 2 Absatz 1 Nummer 8"
    re.compile(
        r"\bArtikel\s+\d+[a-z]?(?:\s+Absatz\s+\d+[a-z]?)?\s*,?\s*(?:Nummer|Nr\.|Ziffer)\s*(\d+[a-z]?)",
        re.IGNORECASE,
    ),
    # "Article 4(1)(15)" (two parentheticals: paragraph + point)
    re.compile(r"\bArticle\s+\d+[a-z]?\(\d+[a-z]?\)\((\d+[a-z]?)\)", re.IGNORECASE),
    # "Article 2(1)" (single parenthetical point when article has no numbered para)
    re.compile(r"\bArticle\s+\d+[a-z]?\((\d+[a-z]?)\)", re.IGNORECASE),
)
SOURCE_POINT_RE = re.compile(r"(?:\((\d+[a-z]?)\)|Nr\.\s*(\d+[a-z]?))$")


def html_to_text(raw: str) -> str:
    """Convert paragraph HTML into clean readable plain text."""
    text = re.sub(r"<br\s*/?>", "\n", raw or "", flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\x84", "„").replace("\x93", "“").replace("\x94", "”")
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def protect_ref_anchors(raw: str) -> tuple[str, list[str]]:
    """Tokenize safe ``<a class="ref">`` anchors and strip all other HTML tags."""
    anchors: list[str] = []

    def save_anchor(match: re.Match) -> str:
        attrs_str, inner = match.group(1), match.group(2)
        attrs = dict(SAFE_ATTR_RE.findall(attrs_str))
        if "ref" not in attrs.get("class", "").split():
            return inner
        inner_clean = html.escape(html_to_text(inner))
        attr_out = " ".join(f'{k}="{html.escape(v, quote=True)}"' for k, v in attrs.items())
        token = f"@@REF{len(anchors)}@@"
        anchors.append(f"<a {attr_out}>{inner_clean}</a>")
        return token

    text = re.sub(r"<br\s*/?>", "\n", raw or "", flags=re.IGNORECASE)
    text = SAFE_ANCHOR_RE.sub(save_anchor, text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\x84", "„").replace("\x93", "“").replace("\x94", "”")
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip(), anchors


def restore_ref_anchors_as_html(protected_text: str, anchors: list[str]) -> str:
    """Escape plain text and restore tokenized ``<a class="ref">`` anchors."""
    cleaned = clean_definition_body(protected_text)
    escaped = html.escape(cleaned, quote=False)
    for idx, anchor_html in enumerate(anchors):
        escaped = escaped.replace(f"@@REF{idx}@@", anchor_html)
    return escaped


def untokenize_to_plain(protected_text: str, anchors: list[str]) -> str:
    """Convert anchor-tokenized text back into plain text."""
    restored = protected_text
    for idx, anchor_html in enumerate(anchors):
        restored = restored.replace(f"@@REF{idx}@@", html_to_text(anchor_html))
    return clean_definition_body(restored)


def build_source_hash(act_id: str | None, article_id: str | None, paragraph_id: str | None) -> str:
    """Build an in-app ``#a:<actId>:<target>`` hash pointing to the definition."""
    target = paragraph_id or article_id or ""
    if not target:
        return ""
    return f"a:{act_id}:{target}" if act_id else target


def clean_definition_body(text: str) -> str:
    """Normalise trailing semicolon punctuation on extracted definitions."""
    cleaned = text.strip()
    if cleaned.endswith(";"):
        cleaned = f"{cleaned[:-1].rstrip()}."
    return cleaned


def is_acronym(term: str) -> bool:
    """True for short all-uppercase acronyms (CCP, CSD, CDN, TLPT, ...)."""
    letters = [ch for ch in term if ch.isalpha()]
    return bool(letters) and len(term) <= 8 and all(ch.isupper() for ch in letters)


UNCOUNTABLE_EN_NOUNS = frozenset(
    {
        "authenticity",
        "availability",
        "clearing",
        "confidentiality",
        "cybersecurity",
        "data",
        "hardware",
        "information",
        "integrity",
        "interoperability",
        "metadata",
        "processing",
        "profiling",
        "pseudonymisation",
        "resilience",
        "settlement",
        "software",
    }
)


def inflect_english_word(word: str) -> list[str]:
    """Return singular/plural variants for an English head noun."""
    variants = [word]
    lower = word.lower()
    if len(word) <= 1 or lower in UNCOUNTABLE_EN_NOUNS:
        return variants

    if lower.endswith("ies") and len(word) > 4:
        variants.append(f"{word[:-3]}y")
    elif (
        lower.endswith("y")
        and len(word) > 2
        and lower[-2] not in "aeiou"
    ):
        variants.append(f"{word[:-1]}ies")
    elif lower.endswith(("ss", "x", "z", "ch", "sh")):
        variants.append(f"{word}es")
    elif lower.endswith("s") and not lower.endswith(("ss", "us", "is")):
        variants.append(word[:-1])
        if lower.endswith("ses") and len(word) > 4:
            variants.append(word[:-2])
    else:
        variants.append(f"{word}s")
    return list(dict.fromkeys(variants))


def expand_english_forms(term: str) -> list[str]:
    """Generate clean surface forms for an English term or acronym."""
    if is_acronym(term):
        return [term, f"{term}s"]

    forms = [term]
    of_match = re.match(r"^(.+?)\s+(of\s+.+)$", term)
    if of_match:
        head_phrase, tail = of_match.group(1), of_match.group(2)
        words = head_phrase.split(" ")
        for variant in inflect_english_word(words[-1]):
            forms.append(" ".join([*words[:-1], variant, tail]))
        return list(dict.fromkeys(forms))

    words = term.split(" ")
    for variant in inflect_english_word(words[-1]):
        forms.append(" ".join([*words[:-1], variant]))
    return list(dict.fromkeys(forms))


def inflect_german_noun(noun: str) -> list[str]:
    """Return common German singular/plural/case forms for a head noun."""
    variants = [noun]
    lower = noun.lower()

    if lower.endswith("börsen"):
        base = noun[:-1]  # ...börse
        variants.extend([base])
        return list(dict.fromkeys(variants))
    if lower.endswith("plätze"):
        stem = noun[:-6]
        variants.extend([f"{stem}platz", f"{stem}platzes", f"{noun}n"])
        return list(dict.fromkeys(variants))

    for sing_tail, plurals in DE_UMLAUT_STEMS:
        if lower.endswith(sing_tail):
            prefix = noun[: len(noun) - len(sing_tail)]
            cap = noun[len(prefix)].isupper()
            for pl in plurals:
                pl_cased = pl.capitalize() if cap else pl
                variants.append(f"{prefix}{pl_cased}")
            break

    if lower.endswith(("ung", "keit", "heit", "schaft", "tät", "ion")):
        variants.append(f"{noun}en")
    elif lower.endswith("e"):
        variants.append(f"{noun}n")
    elif lower.endswith(("er", "el", "en")):
        variants.append(f"{noun}s")
        if not lower.endswith("n"):
            variants.append(f"{noun}n")
    elif lower.endswith("or"):
        variants.extend([f"{noun}s", f"{noun}en"])
    else:
        variants.extend([f"{noun}e", f"{noun}en", f"{noun}es", f"{noun}s"])

    return list(dict.fromkeys(variants))


def expand_german_forms(term: str) -> list[str]:
    """Generate German inflected surface forms (including adjective phrases)."""
    if is_acronym(term):
        return [term, f"{term}s"]

    words = term.split(" ")
    if len(words) == 1:
        return inflect_german_noun(term)

    # Multi-word phrase: inflect leading attributive adjectives and final noun,
    # keeping connectors like "und" fixed (e.g. "Kleine und mittlere Unternehmen").
    word_options: list[list[str]] = []
    for idx, w in enumerate(words[:-1]):
        if w.lower() in {"und", "oder", "für", "von", "zur", "zum", "der", "des"}:
            word_options.append([w])
            continue
        adj_match = DE_ADJ_SUFFIX_RE.match(w)
        if adj_match:
            stem = adj_match.group(1)
            forms = [w] + [f"{stem}{suf}" for suf in ("e", "en", "er", "es", "em")]
            word_options.append(list(dict.fromkeys(forms)))
        else:
            word_options.append([w])

    noun_forms = inflect_german_noun(words[-1])

    # Combine deterministically while bounding combinatorial growth: either all
    # adjectives share the same ending or use the original phrase + noun forms.
    combined = [term]
    for nf in noun_forms:
        combined.append(" ".join([*words[:-1], nf]))

    for suf in ("e", "en", "er", "es", "em"):
        adj_words = []
        changed = False
        for opts, orig in zip(word_options, words[:-1]):
            candidate = next((o for o in opts if o.endswith(suf) and o != orig), orig)
            if candidate != orig:
                changed = True
            adj_words.append(candidate)
        if changed:
            for nf in noun_forms:
                combined.append(" ".join([*adj_words, nf]))

    return list(dict.fromkeys(combined))


def format_source_label(article: dict, point: str | None, is_german: bool) -> str:
    """Build a concise human-readable source citation for the tooltip header."""
    title = (article.get("title") or article.get("id") or "").strip()
    if re.fullmatch(r"\d+(?:\.\d+)+", title):
        title = f"Section {title}"
    if not point:
        return title
    if is_german and title.startswith("§"):
        return f"{title}({point})" if re.match(r"^\d+[a-z]?$", point) else f"{title} {point}"
    return f"{title}({point})"


def _extract_strong_definitions(article: dict, act_id: str | None = None) -> list[dict]:
    """Extract ``<strong>Term</strong><br>Definition`` entries (e.g. BSI C3A)."""
    entries = []
    article_id = article.get("id")
    source = format_source_label(article, None, is_german=False)
    for para in article.get("paragraphs", []):
        raw = para if isinstance(para, str) else para.get("text", "")
        para_id = para.get("id") if isinstance(para, dict) else None
        match = STRONG_DEF_RE.match(raw)
        if not match:
            continue
        term = html_to_text(match.group(1))
        prot_body, anchors = protect_ref_anchors(match.group(2))
        body = untokenize_to_plain(prot_body, anchors)
        body_html = restore_ref_anchors_as_html(prot_body, anchors)
        if not term or not body:
            continue
        entry = {
            "term": term,
            "forms": expand_english_forms(term),
            "caseSensitive": is_acronym(term),
            "source": source,
            "definition": body,
            "definitionHtml": body_html,
        }
        source_hash = build_source_hash(act_id, article_id, para_id)
        if source_hash:
            entry["sourceHash"] = source_hash
        entries.append(entry)
    return entries


def _extract_quoted_numbered_definitions(
    article: dict, is_german: bool, act_id: str | None = None
) -> list[dict]:
    """Extract numbered quoted definitions (EU regulations/directives + BSIG)."""
    blocks: list[tuple[str, str, list[str], bool, str | None]] = []
    open_block = False
    article_id = article.get("id")

    for para in article.get("paragraphs", []):
        raw = para if isinstance(para, str) else para.get("text", "")
        para_id = para.get("id") if isinstance(para, dict) else None
        prot_text, anchors = protect_ref_anchors(raw)
        if not prot_text:
            continue

        matches = list(INLINE_ITEM_RE.finditer(prot_text))
        if matches:
            # Only link directly to paragraph id when the paragraph holds one item;
            # merged single-paragraph articles jump cleanly to the article id.
            target_para_id = para_id if len(matches) == 1 else None
            for idx, match in enumerate(matches):
                point = match.group(1) or match.group(2)
                is_dotted = bool(match.group(2))
                start = match.end()
                end = matches[idx + 1].start() if idx + 1 < len(matches) else len(prot_text)
                blocks.append(
                    (point, prot_text[start:end].strip(), anchors, is_dotted, target_para_id)
                )
            open_block = True
        elif open_block and SUBPOINT_PARA_RE.match(prot_text):
            point, prev_prot, prev_anchors, is_dotted, target_para_id = blocks[-1]
            # Offset anchor tokens from continuation paragraph so indices stay unique
            offset = len(prev_anchors)
            shifted_prot = re.sub(
                r"@@REF(\d+)@@",
                lambda m: f"@@REF{int(m.group(1)) + offset}@@",
                prot_text,
            )
            blocks[-1] = (
                point,
                f"{prev_prot}\n{shifted_prot}",
                [*prev_anchors, *anchors],
                is_dotted,
                target_para_id,
            )
        else:
            open_block = False

    entries: list[dict] = []
    expand = expand_german_forms if is_german else expand_english_forms

    for point, prot_block, anchors, is_dotted, target_para_id in blocks:
        block_text = untokenize_to_plain(prot_block, anchors)
        means_match = re.search(r"\bmeans\b", block_text)
        if means_match and means_match.start() < 220:
            head_region = block_text[: means_match.start()]
        else:
            lead_match = LEADING_DE_HEADWORDS_RE.match(block_text)
            head_region = lead_match.group(0) if lead_match else ""

        terms = [t.strip() for t in QUOTED_TERM_RE.findall(head_region) if t.strip()]
        if not terms:
            typo_match = MISSING_OPEN_QUOTE_RE.match(block_text)
            if typo_match:
                terms = [typo_match.group(1).strip()]

        if means_match:
            for alias_match in INLINE_PAREN_ALIAS_RE.finditer(block_text):
                alias = alias_match.group(1).strip()
                if alias and alias not in terms:
                    terms.append(alias)

        if not terms:
            continue

        if is_german and is_dotted and (article.get("title") or "").strip().startswith("§"):
            source = f"{(article.get('title') or '').strip()} Nr. {point}"
        else:
            source = format_source_label(article, point, is_german=is_german)

        definition = clean_definition_body(block_text)
        definition_html = restore_ref_anchors_as_html(prot_block, anchors)
        source_hash = build_source_hash(act_id, article_id, target_para_id)

        for term in terms:
            entry = {
                "term": term,
                "forms": expand(term),
                "caseSensitive": is_acronym(term),
                "source": source,
                "definition": definition,
                "definitionHtml": definition_html,
            }
            if source_hash:
                entry["sourceHash"] = source_hash
            entries.append(entry)

    return entries


def _extract_german_prose_definitions(article: dict, act_id: str | None = None) -> list[dict]:
    """Extract unquoted German statutory definitions (e.g. Börsengesetz § 2, § 44)."""
    entries: list[dict] = []
    article_id = article.get("id")
    for para in article.get("paragraphs", []):
        raw = para if isinstance(para, str) else para.get("text", "")
        para_id = para.get("id") if isinstance(para, dict) else None
        prot_text, anchors = protect_ref_anchors(raw)
        if not prot_text:
            continue

        num_match = PARA_NUM_RE.match(prot_text)
        point, prot_body = (
            (num_match.group(1), num_match.group(2).strip())
            if num_match
            else (None, prot_text)
        )
        plain_body = untokenize_to_plain(prot_body, anchors)
        source = format_source_label(article, point, is_german=True)
        source_hash = build_source_hash(act_id, article_id, para_id)

        im_sinne_matches = list(PROSE_IM_SINNE_RE.finditer(prot_body))
        if im_sinne_matches:
            for idx, match in enumerate(im_sinne_matches):
                term = untokenize_to_plain(match.group(1).strip(), anchors).rstrip(".")
                seg_start = match.start() if len(im_sinne_matches) > 1 else 0
                seg_end = (
                    im_sinne_matches[idx + 1].start()
                    if len(im_sinne_matches) > 1 and idx + 1 < len(im_sinne_matches)
                    else len(prot_body)
                )
                seg_prot = prot_body[seg_start:seg_end]
                entry = {
                    "term": term,
                    "forms": expand_german_forms(term),
                    "caseSensitive": is_acronym(term),
                    "source": source,
                    "definition": untokenize_to_plain(seg_prot, anchors),
                    "definitionHtml": restore_ref_anchors_as_html(seg_prot, anchors),
                }
                if source_hash:
                    entry["sourceHash"] = source_hash
                entries.append(entry)
            continue

        copula_match = PROSE_COPULA_RE.match(plain_body)
        if copula_match:
            term = copula_match.group(1).strip()
            entry = {
                "term": term,
                "forms": expand_german_forms(term),
                "caseSensitive": is_acronym(term),
                "source": source,
                "definition": plain_body,
                "definitionHtml": restore_ref_anchors_as_html(prot_body, anchors),
            }
            if source_hash:
                entry["sourceHash"] = source_hash
            entries.append(entry)

    return entries


def is_definition_article(article: dict) -> bool:
    """Return True when an article's heading or title marks it as definitions."""
    combined = f"{article.get('heading') or ''} {article.get('title') or ''}".strip()
    return bool(DEFINITION_HEADING_RE.search(combined))


def extract_act_definitions(articles: list[dict], act_id: str | None = None) -> dict | None:
    """Extract all defined terms for a single act's articles, or None if absent."""
    def_articles = [art for art in (articles or []) if isinstance(art, dict) and is_definition_article(art)]
    if not def_articles:
        return None

    all_entries: list[dict] = []
    seen_keys: set[str] = set()

    for article in def_articles:
        combined_heading = f"{article.get('heading') or ''} {article.get('title') or ''}"
        is_german = bool(GERMAN_HEADING_RE.search(combined_heading))

        extracted = _extract_strong_definitions(article, act_id=act_id)
        if not extracted:
            extracted = _extract_quoted_numbered_definitions(
                article, is_german=is_german, act_id=act_id
            )
        if not extracted and is_german:
            extracted = _extract_german_prose_definitions(article, act_id=act_id)

        for item in extracted:
            dedup_key = item["term"] if item["caseSensitive"] else item["term"].lower()
            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)
            all_entries.append(item)

    if not all_entries:
        return None

    return {
        "definitionArticleIds": [art["id"] for art in def_articles if art.get("id")],
        "entries": all_entries,
    }


def _entry_point_number(entry: dict) -> str | None:
    match = SOURCE_POINT_RE.search(entry.get("source") or "")
    return (match.group(1) or match.group(2)) if match else None


def _extract_referenced_point(plain_text: str) -> str | None:
    for pattern in POINT_NUM_PATTERNS:
        match = pattern.search(plain_text)
        if match:
            return match.group(1)
    return None


def resolve_cross_act_pointers(
    definitions_by_act: dict[str, dict],
    auth_to_act_id: dict[str, str],
    act_labels: dict[str, str],
) -> None:
    """Attach ``resolved`` target definitions for cross-act pointer entries."""
    # Index each act's entries by point number and by lowercase term/form
    by_point: dict[str, dict[str, dict]] = {}
    by_term: dict[str, dict[str, dict]] = {}
    for act_id, info in definitions_by_act.items():
        pt_map: dict[str, dict] = {}
        tm_map: dict[str, dict] = {}
        for entry in info.get("entries", []):
            pt = _entry_point_number(entry)
            if pt and pt not in pt_map:
                pt_map[pt] = entry
            for form in [entry["term"], *entry.get("forms", [])]:
                tm_map.setdefault(form.lower(), entry)
        by_point[act_id] = pt_map
        by_term[act_id] = tm_map

    def lookup_target(act_id: str, entry: dict) -> tuple[str, dict] | None:
        def_html = entry.get("definitionHtml") or ""
        plain = entry.get("definition") or ""
        if len(plain) > 360 or not DELEGATION_CUE_RE.search(def_html):
            return None
        # Skip inverted definitions like "'non-personal data' means data other than personal data as defined in ..."
        means_split = plain.split("means", 1)
        rhs = means_split[1] if len(means_split) == 2 else plain
        if NEGATED_DELEGATION_RE.search(rhs[:80]):
            return None

        refs = [r for r in dict.fromkeys(DATA_REF_RE.findall(def_html)) if r in auth_to_act_id]
        if len(refs) != 1:
            return None
        target_act_id = auth_to_act_id[refs[0]]
        if target_act_id == act_id or target_act_id not in definitions_by_act:
            return None

        ref_point = _extract_referenced_point(plain)
        target_entry = by_point.get(target_act_id, {}).get(ref_point or "")
        if not target_entry:
            target_entry = by_term.get(target_act_id, {}).get(entry["term"].lower())
        if not target_entry:
            return None
        return target_act_id, target_entry

    for act_id, info in definitions_by_act.items():
        for entry in info.get("entries", []):
            visited = {act_id}
            cur_act, cur_entry = act_id, entry
            resolved_target: tuple[str, dict] | None = None
            for _ in range(3):
                nxt = lookup_target(cur_act, cur_entry)
                if not nxt or nxt[0] in visited:
                    break
                visited.add(nxt[0])
                resolved_target = nxt
                cur_act, cur_entry = nxt

            if resolved_target:
                target_act_id, target_entry = resolved_target
                resolved_obj = {
                    "actId": target_act_id,
                    "actLabel": act_labels.get(target_act_id, target_act_id),
                    "term": target_entry["term"],
                    "source": target_entry["source"],
                    "definition": target_entry["definition"],
                    "definitionHtml": target_entry.get("definitionHtml", target_entry["definition"]),
                }
                if target_entry.get("sourceHash"):
                    resolved_obj["sourceHash"] = target_entry["sourceHash"]
                entry["resolved"] = resolved_obj


def build_all_definitions(registry_path: Path = REGISTRY_PATH, root: Path = ROOT) -> dict[str, dict]:
    """Build the ``{actId: {definitionArticleIds, entries}}`` map across the registry."""
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    output: dict[str, dict] = {}
    auth_to_act_id: dict[str, str] = {}
    act_labels: dict[str, str] = {}

    for act_entry in registry.get("acts", []):
        act_id = act_entry.get("id")
        rel_path = act_entry.get("path")
        if not act_id or not rel_path:
            continue
        auth_id = act_entry.get("authId")
        if isinstance(auth_id, str) and auth_id:
            auth_to_act_id[auth_id] = act_id

        doc = json.loads((root / rel_path).read_text(encoding="utf-8"))
        doc_title = doc.get("title") if isinstance(doc, dict) else None
        raw_label = doc_title or act_entry.get("label") or act_id
        # Strip parenthetical CELEX citation suffixes like "GDPR (Regulation (EU) 2016/679)" -> "GDPR"
        act_labels[act_id] = re.sub(r"\s*\((?:Regulation|Directive)\b.*\)$", "", raw_label).strip()

        articles = doc if isinstance(doc, list) else doc.get("articles", [])
        extracted = extract_act_definitions(articles, act_id=act_id)
        if extracted:
            output[act_id] = extracted

    resolve_cross_act_pointers(output, auth_to_act_id, act_labels)
    return output


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build data/definitions.json from regulation definition chapters."
    )
    parser.add_argument("--index", type=Path, default=REGISTRY_PATH, help="Registry JSON path")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH, help="Output JSON path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    definitions = build_all_definitions(args.index, args.index.parent.parent)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(definitions, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    total_terms = sum(len(item["entries"]) for item in definitions.values())
    print(f"wrote {total_terms} definitions across {len(definitions)} acts -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
