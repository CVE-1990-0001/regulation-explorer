# Regulation Explorer

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
