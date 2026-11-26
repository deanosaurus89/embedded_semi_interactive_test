# Milkyway – Merkmale

Static German viewer for a PolyWorks|DataLoop dashboard widget. It shows the Milkyway reference model, annotation flags (Beschriftungsfähnchen) with SPC sparklines, and a part-count filter. There is no backend, no API, and no token.

The page is meant to be pasted into a DataLoop widget of type **Microsoft embedded object** as an `<iframe src="…">`.

## GitHub Pages

After this lands on `main` and Pages is enabled, the site is:

**https://deanosaurus89.github.io/embedded_semi_interactive_test/**

The repository owner has to turn Pages on once. In the GitHub repo:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Leave Actions enabled for the repository (the default on a public repo).
3. Merge to `main`. The workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes the repository root.
4. If GitHub asks to approve the `github-pages` environment the first time, approve it.

Do not also set Source to “Deploy from a branch”. Only one source is active. The workflow is the one this repo is set up for. `.nojekyll` is in the root only so a later switch to branch deploy (`main` / `/`) would not run Jekyll.

The repository is public, which GitHub Pages requires on a free plan.

### Embed snippet

Paste this into the DataLoop **Embed code** field:

```html
<iframe src="https://deanosaurus89.github.io/embedded_semi_interactive_test/" title="Milkyway Merkmale"></iframe>
```

The page fills whatever size the iframe gets. It does not try to leave the frame.

## What the page does

- Orbit, zoom, and pan the model (left drag, wheel, right drag).
- Six example characteristics, each with nominal, USL, LSL, and per-piece actuals. The sparkline draws the values, a dashed nominal line, a dotted mean line, and red USL/LSL lines. Points outside the limits are highlighted.
- **Teile** keeps the last 10, 25, 50, or all measurements (oldest first in the file, so “letzte” is the tail).
- **Ansicht** locks the flags so the model can be turned without moving them. **Bearbeiten** lets you drag a flag and, with that flag selected, click the surface to set its anchor (Fußpunkt). The leader line stays attached while the view turns.
- Positions and anchors are stored in `localStorage` on the Pages origin. **Export** downloads `merkmale-layout.json`. **Import** reads that file back. **Zurücksetzen** (second click confirms) drops the saved layout.
- To bake a layout into the site, replace [`data/layout.json`](data/layout.json) with an export and redeploy.

The amber **Beispieldaten** badge is shown while `source` in the measurements file is `"example"`.

## Local preview

ES modules need HTTP. From the repository root:

```bash
python3 -m http.server 4173
```

Open http://127.0.0.1:4173/ . `file://` will not load the modules.

## Dropping in real measurements

Replace [`data/example-measurements.json`](data/example-measurements.json) with the same shape and set `"source"` to something other than `"example"` so the badge disappears. No other code change is required.

```json
{
  "schemaVersion": 1,
  "source": "example",
  "part": { "id": "milkyway", "name": "Milkyway" },
  "characteristics": [
    {
      "id": "zyl-a-dm",
      "name": "Bezug Zylinder A – Durchmesser",
      "unit": "mm",
      "nominal": 48.0,
      "usl": 48.04,
      "lsl": 47.96,
      "defaultAnchor": { "x": 37.573, "y": 60.893, "z": 68.75 },
      "measurements": [
        { "pieceId": "MW-1001", "value": 48.012, "timestamp": "2026-09-27T06:30:00Z" }
      ]
    }
  ]
}
```

`measurements` is oldest first. `timestamp` and `defaultAnchor` are optional. `defaultAnchor` and layout anchors use the original OBJ coordinates, in millimetres, with the model left where the file places it.

A baked layout ([`data/layout.json`](data/layout.json)) overrides those anchors. Its `flag.x` / `flag.y` values are the card’s top-left as a fraction of the viewer stage. `flag.pinned: true` keeps that fraction when the iframe is resized; without a pinned flag the page stacks cards along the top and bottom.

## Model

[`models/milkyway.obj`](models/milkyway.obj) is the supplied Wavefront file (39 989 vertices, 67 749 triangles, vertex normals). The referenced MTL is not shipped; the viewer uses one neutral grey `MeshStandardMaterial`. The `mtllib` line was removed so the page does not request a missing file.

three.js r170 is loaded as ES modules from jsDelivr. There is no build step.
