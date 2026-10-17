# Slanted Gridfinity

A browser tool that generates Gridfinity bins tilted along one axis, so tall
items fit in drawers that are too shallow for an upright bin. Set the grid
size, height and slant offset, preview the bin in 3D, and export an STL.

Live version: [formfitprint.com/misc/angled-bins](https://formfitprint.com/misc/angled-bins)

## Run it locally

There is no build step. The page is plain HTML and ES modules, with three.js
(r162) and the fonts checked in under `vendor/` and `fonts/`, so it runs
offline and makes no requests to other sites.

Browsers block ES modules on `file://` URLs, so the page has to be served over
HTTP. The included launcher does that and opens a browser tab:

```bash
git clone https://github.com/cdslug/slanted-gridfinity.git
cd slanted-gridfinity
pip install -r requirements.txt   # nothing to install; standard library only
python src/app.py
```

It needs Python 3.11 or newer and serves on <http://127.0.0.1:8000>, or the
next free port if 8000 is taken. Options: `--port 9000`, `--no-browser`, and
`--host 0.0.0.0` to reach it from other devices on your network. Only use that
on a network you trust: anyone on it can load the app. The launcher serves just
the web app files, never `.git/` or the rest of the repo.

Any other static server works too (`python3 -m http.server`, `npx serve`,
`php -S localhost:8000`, and so on).

## Features

- Grid size from 1 to 6 units on each axis, height from 1 to 14 units
- Custom grid unit size (42mm by default) for non-standard baseplates
- Optional half-unit sizes (e.g. 0.5 x 1); the base gets half-size feet
  that still seat in a standard baseplate
- Slant offset along X or Y, in half grid units
- Adjustable wall thickness and corner resolution
- Optional Gridfinity base profile
- Optional end bin: a support wedge that fills the space at the end of a row
- Wireframe and cross-section views, preset camera views on keys 0–6 (F fits the model)
- Binary STL export
- Light and dark themes

## Files

| Path | Contents |
| --- | --- |
| `index.html` | Page layout and controls |
| `js/main.js` | Scene, UI wiring and app state |
| `js/gridfinity-geometry.js` | Bin and end-bin mesh generation |
| `js/camera-controls.js` | Orbit, pan, zoom and preset views |
| `js/stl-export.js` | Binary STL writer and download |
| `css/styles.css` | Theme tokens and layout |
| `src/app.py` | Local launcher: static server plus browser tab |
| `vendor/three/` | three.js r162 and OrbitControls (MIT) |
| `fonts/` | Space Grotesk and Space Mono (SIL OFL) |

## Embedding

The app uses only relative paths, so you can copy the folder into any static
site under any path. [Form Fit Print](https://formfitprint.com) includes this
repo as a git submodule and copies it to `/misc/angled-bins/` at build time.

## License

MIT. The bundled three.js is MIT licensed and the fonts are under the SIL
Open Font License; their license files sit beside them. Gridfinity is an open modular storage system by
[Zack Freedman](https://github.com/zackfreedman/gridfinity), also released
under the MIT license.
