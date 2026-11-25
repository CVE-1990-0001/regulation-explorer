# Regulation Browser (CISO RegBro)

A static, client-side browser for legal acts. No build step: `index.html` +
`app.js` + `styles.css` reading JSON via `fetch()`.

## Local development

Install the Python tooling and parser dependencies:

```bash
python3 -m pip install -r requirements.txt
```

`fetch()` is blocked on `file://`, so serve over HTTP:

```bash
python -m http.server 5500   # then open http://localhost:5500
```

(Any static server works — VS Code **Live Server** is fine too.)

## Data model

- **Act** (`type:"act"`) — a legal act: `id`, `title`, `heading`, `meta`, and
  either an `articles` array (multi-article) or a `paragraphs` array
  (single-article). Paragraphs are `{ id, text, class }`; `text` is HTML.
- **Bundle** (`type:"bundle"`) — a folder of related acts: `id`, `title`,
  `members` (each `{ ref, label }`), and may nest other bundles.
- **Registry** — [`data/index.json`](data/index.json): lists every act/bundle with
  its `id`, `path`, `label`, `jurisdiction`, and (for citable acts) `authId`. The
  app loads this first, then fetches each `path`.
- **Hash routing** — `#act:<id>`, `#bundle:<id>`, and article hashes like
  `#a:<act>:art_N`.

## Act identifiers (`id`)

The `id` is the app's **internal routing handle** (used in the registry, bundle
`ref`s, and URL hashes). It only has to be unique, readable, and permanent — it is
**not** the act's legal identifier (that's `authId`, below).

```
act_<jurisdiction>_<mnemonic>[_<type>]_<year>[_<number>]
```

| Component | Rule |
|---|---|
| `<jurisdiction>` | Lowercase code: `eu`, `de`, `fr`, `us`, … Namespaces ids so jurisdictions never collide. |
| `<mnemonic>` | Short acronym/short-title: `gdpr`, `emir`, `mifid2`, `nis2`, `data_act`, `dora`, `boersg`. |
| `<type>` | Only to disambiguate acts sharing a mnemonic (e.g. DORA): `reg`, `dir`, `rts`, `its`, `del`. |
| `<year>` | 4-digit year of the official number (or enactment year for un-numbered national law). |
| `<number>` | Official number, 4-digit zero-padded (the CELEX tail for EU acts). Omitted when none exists. |

**Rules of thumb:** ids are identity-bound, never positional (`RTS 1` is a *label*;
the id `act_eu_dora_rts_2024_1774` is fixed to that regulation) — **never reuse an
id for a different act.** Carrying the full `year_number` keeps ids stable when
siblings are added. `id` ≠ `authId` ≠ filename (`path`).

Examples: `act_eu_gdpr_2016_0679`, `act_eu_mifid2_2014_0065`,
`act_eu_dora_reg_2022_2554`, `act_eu_dora_rts_2024_1774`, `act_de_boersg_2007`,
`act_fr_cmf_2000` *(future)*, `act_us_glba_1999` *(future)*.

## References (internal & cross-act)

Links are written **once at convert time** and injected into each paragraph's HTML;
the runtime only decides where each one goes (it never re-parses text).

**Convert time** — `python3 tools/link_references.py` (idempotent). Scans each
paragraph and writes `<a class="ref">` anchors:

- **same-act** (`Article N`, German `§ N`, or `Artikel N` in acts with German
  article headings) → `href="#a:<thisAct>:art_N"`, no id
- **cross-act** (`Article N of Regulation (EU) 2022/2554`, incl. compound lists) →
  `data-ref="celex:32022R2554"` (+ `data-article="N"`), plus an EUR-Lex `href` fallback

The identifier is **scheme-qualified** (`celex:…`, later `cfr:…`, `eli:…`), computed
straight from the citation text — no registry lookup here.

**Run time** — `app.js` builds `authToActId = { "celex:…" → act id }` from the
registry once, then on click/hover of an `a.ref`:

- **no `data-ref`** → same-act: follow the `#a:<act>:art_N` hash
- **`data-ref`** → look it up: **hit** → in-app jump; **miss** → the `href` (EUR-Lex) opens

Navigation is in-memory (id → loaded object + hash); `path` is used only for the
initial fetch. Because the map is rebuilt each load, hosting a new act
auto-upgrades every existing link to it — no re-convert. Supporting a new
jurisdiction only needs a citation matcher in `link_references.py` (emitting
`data-ref="<scheme>:<id>"`) and an `authId` on its acts; the rest is scheme-agnostic.

## Adding a regulation (end to end)

1. **Produce the act JSON** — parse the source into the act shape
   (`articles[].paragraphs[]`) with a parser in [`tools/parsers/`](tools/parsers/),
   or hand-author it. Save under `regulations-data/`.
2. **Register it** in [`data/index.json`](data/index.json): `id`, `path`, `label`,
   `jurisdiction`, `tags` (one or more IDs from `tagCatalog`, adding a new catalog
   entry there only when a genuinely new regulatory domain is introduced),
   optional `parentAct` (for secondary acts such as RTS/ITS/companion directives
   that legally inherit definitions from a Level-1 parent regulation, e.g.
   `"parentAct": "act_eu_dora_reg_2022_2554"`), and — for citable acts — an
   `authId` (e.g. `celex:32016R0679`). The `authId` is what makes it a
   cross-reference target.
3. **Bundle it** (optional) — add its `ref` to a folder in [`data/bundles/`](data/bundles/).
4. **Link references** — `python3 tools/link_references.py --update-db` (re-links
   all acts so existing citations to the new act auto-upgrade to in-app, and syncs
   [`data/index.db`](data/index.db) + [`data/index_meta.json`](data/index_meta.json)).
5. **Build term definitions** — `python3 tools/build_definitions.py` (extracts any
   `Definitions` / `Begriffsbestimmungen` chapter into
   [`data/definitions.json`](data/definitions.json) and auto-resolves cross-act
   pointer definitions against the newly hosted act; run *after* step 4 so
   `<a class="ref">` links inside definitions are preserved).
6. **Rebuild applicability** (if applicable) —
   `python3 tools/build_legal_entity_applicability.py` when the act has matching
   rows in [`data/source/legal_entity_regulation_detail.csv`](data/source/legal_entity_regulation_detail.csv).
7. **Verify** — run `npm test` and serve locally to check the act loads,
   cross-references resolve, and defined-term tooltips appear (if the act has a
   definitions section).

No app-code changes are needed — the id scheme, `authToActId`, cross-reference
resolver, and defined-term tooltips are all data-driven. Only a new *citation
style* needs a matcher in `tools/link_references.py`, or an unfamiliar
*definitions layout* needs an extractor rule in `tools/build_definitions.py`.

## Index database

`data/index.db` is a generated SQLite index used by tooling/server-side workflows.
It mirrors the flat `data/index.json` registry and stores richer metadata
(acts, bundles, tags, and extracted cross-references).

Initialise/update it with:

```bash
python3 tools/build_index_db.py
```

First run creates `data/index.db` from `schema.sql` and seeds all rows.
Subsequent runs upsert current acts/bundles and re-sync tags, references, and
bundle membership (including removals from `data/index.json`).

`data/index.json` remains the browser app source of truth for loaded content.
The DB is a derived index for querying/integration, and the script also writes
`data/index_meta.json` (lightweight `id -> celex` metadata for runtime lookups).

## Tag filtering

`data/index.json` defines a canonical `tagCatalog` (`{ id, label }`) and assigns
curated topic `tags` to each act; jurisdiction facets (`EU`, `DE`, …) are derived
automatically from each act's jurisdiction. In the UI, the **Tags** popover in
the search bar filters regulations by Jurisdiction and Topics with live facet
counts, prunes folder trees (`DORA`) down to matching member acts when browsing,
and scopes keyword search strictly to acts matching the active tag filters.
`tools/build_index_db.py` mirrors registry tags into the SQLite `act_tag` table.

## Legal entity applicability

The regulation root view displays shorthand labels for legal entities listed in
`data/source/legal_entity_regulation_detail.csv`. Regenerate the browser mapping
after the CSV or registry changes:

```bash
python3 tools/build_legal_entity_applicability.py
```

The generated `data/legal_entity_applicability.json` maps stable act ids to the
matching legal entities and bundle ids to the union of their descendant acts.
For regulation families such as DORA, the top-level bundle scope is displayed
consistently on every descendant act and folder. Standalone regulations with no
matching CSV row are marked as having no available applicability data.

## Defined-term tooltips

Acts with a definitions section (`Definitions` / `Begriffsbestimmungen`) display
hover/focus tooltips on defined terms across all other articles of that act.
Child regulations (such as RTS, ITS, and companion directives) inherit their
parent regulation's definitions when their entry in `data/index.json` sets
`"parentAct": "<parent_act_id>"` — local definitions take precedence, and
inherited tooltips display a clickable provenance badge (for example
`DORA Regulation · Article 3(5)`). Standalone acts with neither local nor
inherited definitions are left untouched. Regenerate the glossary sidecar after
adding or modifying an act:

```bash
python3 tools/build_definitions.py
```

This writes `data/definitions.json` without modifying paragraph HTML in the act
files; `app.js` wraps matched surface forms in `.defined-term` spans at render
time. Citations (`<a class="ref">`) inside definitions remain interactive, the
source badge jumps to the definition section, and definitions that delegate to
another hosted act (e.g. *“as defined in Article 4(1) of Directive 2014/65/EU”*)
automatically inline the resolved target definition underneath.
`tools/update_regulations.py` rebuilds `data/definitions.json` automatically as
part of its refresh pipeline.

## Updating all regulations

Run the complete RegBro data refresh with one command:

```bash
python3 tools/update_regulations.py
```

The updater visits every registry act whose `status` is `In Force` (the default),
checks EUR-Lex acts identified by `authId`, updates changed article content, then
re-links the complete corpus and rebuilds `data/definitions.json`, `data/index.db`,
and `data/index_meta.json`. Unsupported sources are reported and skipped. Use
`--check` to report pending changes without writing, or pass act ids/paths to
limit a run. Detailed function and update activity is written to
`logs/update_regulations.log`; logs rotate at 100 MB.

Non-EUR-Lex acts can define an `update` object in `data/index.json` with a
`url` and parser name (`consolidated`, `oj`, `boersengesetz`, `nis2_bsig`, or
`bsi_c3a`).
Set `status` to another schema-supported value (for example `Repealed`) to
exclude an act from automatic updates; `dateInForce` is also mirrored into the
generated database.

### BSI C3A

BSI's **Criteria enabling Cloud Computing Autonomy (C3A)** is included as a
non-binding framework, initially version **1.0 (27 April 2026)**. Its introduction,
definitions, six sovereignty domains, and all criteria, additional criteria and
supplementary information are parsed from the official PDF. Each criterion group
(for example `SOV-3-02`) is a navigable section.
Only sections with substantive content are loaded: five introductory sections
and 30 criterion groups. Document history is used only for version/date metadata;
the cover, table of contents, and empty structural headings are not articles.
Definitions retain the PDF's bold terms, with a separate paragraph per definition.

Reproduce the import from the saved source:

```bash
python3 tools/parsers/parser_bsi_c3a.py regulations-data/bsi_c3a.pdf regulations-data/bsi_c3a.json
python3 tools/link_references.py
```

The registry uses BSI's versionless `?__blob=publicationFile` download endpoint
to fetch the latest document. The C3A updater also removes any `v` query parameter
from configured download URLs: `v=10` is a BSI download revision and must not be
interpreted as version 10 or 1.0, or pin future checks to that revision. The
published version and release date come from the PDF's document history and are
refreshed alongside its content. The saved PDF is the initial import snapshot;
automatic updates refresh the JSON, not that snapshot.

```bash
python3 tools/update_regulations.py --check act_de_bsi_c3a_2026
```
