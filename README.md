# Regulation Browser (CISO RegBro)

## Local Development

Because this app loads JSON using `fetch()`, opening `index.html` directly with the `file://` protocol will fail in most browsers due to security restrictions (CORS / fetch blocking). Run a local HTTP server so the browser can fetch JSON files correctly.

Recommended (VS Code Live Server):
- Install the **Live Server** extension in VS Code.
- In the Explorer, right-click `index.html` and choose **Open with Live Server**.

Alternative (Python built-in HTTP server):

```bash
# from the project root
python -m http.server 5500
# then open in your browser:
http://localhost:5500
```

(You can use any simple static file server; the key is to serve files over `http://`.)

## Data Model

- `type = "act"`
  - Represents a legal act. Top-level fields commonly include `id`, `title`, `heading`, `source`, `meta` and either an `articles` array (for multi-article acts like EMIR) or a `paragraphs` array (for single-article acts).
  - Example shapes used by the app:
    - `articles`: an array of article objects (each with `id`, `title`, `paragraphs`, etc.) — used for the EMIR consolidated file.
    - `paragraphs`: an array of paragraph objects (each with `id`, `text`, `class`).

- `type = "bundle"`
  - A collection of related acts. Contains `id`, `title`, `description`, `members` (each member has `ref` and `label`), and `meta`.

- Registry: `/data/index.json`
  - A small registry that lists available acts and bundles. Each entry contains an `id`, the `path` to the JSON file (relative to the served root), and a `label`.
  - The app loads this registry first, then fetches the referenced act and bundle files.

- Hash routing
  - `#act:<ACT_ID>` — load the act-level view for the given act id.
  - `#bundle:<BUNDLE_ID>` — load the bundle view for the given bundle id.
  - Legacy article/paragraph hashes (e.g. `#art_1` or paragraph ids like `art_1__p1`) are still supported and will open the corresponding article/paragraph in the sidebar-driven UI.

## Act identifiers (`id`)

Every act has a stable `id`. The `id` is the app's **internal routing handle** — it is used in the registry, in bundle `ref`s, and in URL hashes. It is deliberately **not** the same thing as the act's official legal identifier (see *Cross-references* below); it only has to be unique, readable, and permanent.

### Format

```
act_<jurisdiction>_<mnemonic>[_<type>]_<year>[_<number>]
```

| Component | Required | Rule |
|---|---|---|
| `act_` | yes | Fixed prefix for every act. |
| `<jurisdiction>` | yes | Lowercase jurisdiction code: `eu`, `de`, `fr`, `us`, … (aligns with `meta.jurisdiction`). Namespaces the id so corpora from different jurisdictions never collide. |
| `<mnemonic>` | yes | Short, lowercase, widely-used short title/acronym of the act. Words separated by `_`; digits allowed. E.g. `gdpr`, `emir`, `mifid2`, `nis2`, `data_act`, `dora`, `boersg`. |
| `<type>` | only within a family | Instrument type, included **only** to disambiguate several acts that share a `<mnemonic>` (e.g. the DORA family). One of `reg` (regulation), `dir` (directive), `rts` (regulatory technical standard), `its` (implementing technical standard), `del` (delegated act). |
| `<year>` | yes | 4-digit year of the act's official number (for un-numbered national law, the year of the in-scope consolidated version). |
| `<number>` | when one exists | The act's official sequential number, zero-padded to 4 digits (for EU acts this is the numeric tail of the CELEX). Omitted only for acts that have no such number — typically national law. |

### Design rules

- **Always identity-bound, never positional.** The `id` encodes the act's own official number, not our display ordering. `RTS 1`/`RTS 3` etc. are *labels* only; the id `act_eu_dora_rts_2024_1774` is fixed to that specific delegated regulation. **An id is permanent — never rename an id to point at a different act.**
- **Stable under additions.** Because EU ids carry the full `year_number`, adding a sibling act to a family never forces an existing id to change.
- **Jurisdiction-first for extensibility.** The `<jurisdiction>` segment lets French, US, or any other corpus be added without collision, and makes an act's provenance obvious from its id alone.
- **`id` ≠ legal identifier ≠ filename.** The id is a readable routing slug. The canonical legal identifier is stored separately in the registry as a **scheme-qualified `authId`** (e.g. `celex:32022R2554`, later `cfr:…`, `eli:…`), and the on-disk filename (`path`) is just a storage location — none of the three need to match.

### Examples

| Act | `id` |
|---|---|
| GDPR — Regulation (EU) 2016/679 | `act_eu_gdpr_2016_0679` |
| MiFID II — Directive 2014/65/EU | `act_eu_mifid2_2014_0065` |
| NIS2 — Directive (EU) 2022/2555 | `act_eu_nis2_2022_2555` |
| DORA — Regulation (EU) 2022/2554 | `act_eu_dora_reg_2022_2554` |
| DORA amending Directive (EU) 2022/2556 | `act_eu_dora_dir_2022_2556` |
| DORA RTS — Delegated Regulation (EU) 2024/1774 | `act_eu_dora_rts_2024_1774` |
| DORA ITS — Implementing Regulation (EU) 2024/2956 | `act_eu_dora_its_2024_2956` |
| Börsengesetz (German, unnumbered) | `act_de_boersg_2007` |
| _(future)_ French Code monétaire et financier | `act_fr_cmf_2000` |
| _(future)_ US Gramm–Leach–Bliley Act | `act_us_glba_1999` |

## References (internal & cross-act)

Links are written **once at convert time**; the runtime only decides where each
one goes (it never re-parses text).

**Convert time** — `python3 tools/link_references.py` (idempotent, safe to re-run):
scans each paragraph and writes `<a class="ref">` anchors.

- **same-act** (`Article N`, or German `§ N`) → `href="#a:<thisAct>:art_N"`, no identifier
- **cross-act** (`Article N of Regulation (EU) 2022/2554`, including compound
  lists) → `data-ref="celex:32022R2554"` (+ `data-article="N"`), plus a working
  EUR-Lex `href` as a no-JS fallback

The identifier is **scheme-qualified** (`celex:…`, later `cfr:…`, `eli:…`) and
computed straight from the citation text — no registry lookup at this stage.

**Run time** — `app.js` builds `authToActId = { "celex:…" → act id }` from the
registry once at load, then on click/hover of an `a.ref`:

- **no `data-ref`** → same-act: follow the `#a:<act>:art_N` hash (no lookup)
- **`data-ref` present** → look it up: **hit** → in-app jump to the already-loaded
  act/article; **miss** → the anchor's external `href` opens

Navigation is in-memory (act id → loaded object + `#a:<id>:<art>` hash); the
registry `path` is used only for the initial fetch. Because the map is rebuilt on
every load, hosting a new act auto-upgrades every existing link to it — no re-convert.

To support a new jurisdiction, add its **citation matcher** in
`tools/link_references.py` (emitting `data-ref="<scheme>:<id>"`) and give its acts
an `authId` with that scheme. The plumbing (anchor, registry, runtime map) is
already scheme-agnostic.

## Adding a regulation (end to end)

1. **Get the source & produce the act JSON.** Parse the source HTML into the act
   shape (`articles[].paragraphs[]`) with the matching parser in
   [`tools/parsers/`](tools/parsers/) (e.g. `node tools/parsers/parser-consolidated.js in.html out.json`),
   or add a hand-authored JSON. Save it under `regulations-data/`.
2. **Register it** in [`data/index.json`](data/index.json): add an entry with
   `id` (see *Act identifiers*), `path`, `label`, `jurisdiction`, and — for acts
   that can be cited — an `authId` (scheme-qualified, e.g. `celex:32016R0679`).
   The `authId` is what makes it a cross-reference target.
3. **Bundle it** (optional) — add its `ref` to a folder in
   [`data/bundles/`](data/bundles/) if it belongs to a family (e.g. DORA).
4. **Link references** — run `python3 tools/link_references.py`. This re-links
   every act (idempotent), so the new act gets its outgoing links **and** every
   existing act's citations to it auto-upgrade from EUR-Lex to in-app.
5. **Verify** — serve locally and check the act loads, its sidebar entry, and a
   few cross-references resolve in-app.

No app code changes are needed: the id scheme, `authToActId`, and the runtime
resolver are all data-driven. Only the reference matcher needs extending for a
new *citation style* (e.g. adding a French/US pattern in `tools/link_references.py`).
