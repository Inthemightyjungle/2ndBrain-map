# 2nd Brain

2nd Brain is an interactive 2D / 3D neural map of the team's inspiration posts, projects, horizon scans and calendar.
It runs as a single self-contained HTML page (a Claude artifact) and reads its notes from the artifact's
database at runtime, so **this repo holds code only — no notes, posts, people or client data**.

## Demo

`docs/index.html` is a public demo: the same map filled with **made-up sample data** (`demo/make_data.py`),
with an in-page stand-in for the Claude runtime so it works anywhere. Nothing you change in the demo is saved.
It is served by GitHub Pages from the `docs/` folder on `main`.

Rebuild it after changing the map:

```bash
bash tools/splice.sh && python3 demo/make_data.py && python3 demo/build_page.py
```

## Layout

| Path | What it is |
| --- | --- |
| `src/engine.js` | Graph engine: canvas renderer, 2D/3D camera, physics, layouts (free, pillars, grid, explode), search lens, timeline, hand gestures |
| `src/app.js` | App shell: data loading, library, flow view, note drawer, import, search. The engine is spliced into it between the `graph engine` and `views` markers |
| `src/style.css` | Styles |
| `src/shell3.html` | Page markup |
| `tools/splice.sh` | Splices the engine into the app, syntax-checks, and builds |
| `tools/build.py` | Inlines CSS + JS into `dist/inspirations-map.html` |
| `dist/inspirations-map.html` | The built page (needs the Claude runtime for data) |
| `demo/` | Sample-data generator and demo page builder |
| `docs/` | The built demo, served by GitHub Pages |

## Build

```bash
bash tools/splice.sh
```

Needs Python 3 and Node. Edit `src/engine.js` for anything graph-related; `splice.sh` copies it into `src/app.js`.

## Data

The page expects the artifact runtime (`window.claude.use("db")`, `"user"`, `"sample"`). Notes live under
`authors/{uid}/notes`; categories under `settings/categories`. Outside that runtime the map loads empty.
Keep exports of team data out of this repo (see `.gitignore`).
