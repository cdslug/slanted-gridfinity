# Slanted Gridfinity

A browser tool that generates Gridfinity bins tilted along one axis, so tall
items fit in drawers that are too shallow for an upright bin. Set the grid
size, height and slant offset, preview the bin in 3D, and export an STL.

Live version: [formfitprint.com/misc/slanted-gridfinity](https://formfitprint.com/misc/slanted-gridfinity)

## Why

The top drawer of an IKEA Alex is only about 12 units tall in Gridfinity
terms. That's fine for most organizers, but standard pens and markers are too
tall to stand upright. Laid flat they fit, but they pile on top of each other
and the one you want is always at the bottom.

These bins keep a flat, Gridfinity-compatible base while the walls slope, so
pens lean diagonally. Each bin rests against its neighbour, and a small
bookend (the end bin option) supports the last one in the row. You can still
lift any single bin out without taking the row apart.

What the design aims for:

- **Fast printing.** The walls are a single extrusion line rather than thick,
  heavy walls. The default 0.82 mm is one line from a 0.8 mm nozzle.
- **Shallow drawers.** The diagonal layout makes better use of limited height.
- **Easy access.** Pens aren't buried in a pile, so you can see and grab the
  one you want.
- **Removable bins.** Neighbouring bins hold each other up; nothing is glued
  or locked together.
- **Simple geometry.** No inserts or assembly beyond the end bookend.

## Similar projects

Angled bins aren't a new idea. These take related approaches and may suit you
better:

- **[Movable Diagonal Dividing Bins](https://makerworld.com/en/models/2393657-gridfinity-diagonal-dividing-bins)**: removable diagonal dividers for tools
  in shallow drawers. The closest physical design; here the bin walls
  themselves do the work.
- **[Gridfinity Layout Tool](https://gridfinitylayouttool.com/designer)**: a general design tool with adjustable diagonal
  dividers.
- **[Creative3DP Gridfinity Generator](https://tools.creative3dp.com/tools/gridfinity-generator/)**: custom dividers with adjustable tilt.
- **[Binforge](https://binforge.app/)**: a browser-based bin designer with tilted cutout inserts.
- **[TiltFinity](https://makerworld.com/en/models/1837846-tiltfinity)**: tilts a conventional bin to fit tall objects; here the base
  stays flat on the grid.
- **[Angled Gridfinity plate](https://makerworld.com/en/models/1613047-angled-gridfinity-base-plate)**: tilts the whole mounting surface instead of the
  contents.
- **[Gridfinity Desktop Tool Bins](https://makerworld.com/en/models/1479743-gridfinity-desktop-tool-bins)**: a predefined slanted tool-storage design.
- **[Gridfinity Extended](https://makerworld.com/en/models/481168-gridfinity-extended-official)**: general-purpose generator with angled wall cutouts
  and much more.

This project is the narrow combination of simple geometry, quick prints,
removable bins and a shallow drawer. If you've solved the same problem
differently, or know a better existing design, please open an issue.

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

Any other static server works too, such as
`python3 -m http.server --bind 127.0.0.1`. Bind it to localhost: served from
the repo root, it would also hand `.git/` to anyone who can reach it.

## Features

- Grid size from 1 to 20 units on each axis, height from 1 to 100 units
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
repo as a git submodule and copies it to `/misc/slanted-gridfinity/` at build time.

## Contributing

This project was built with AI coding tools by someone without a web
development background. The code is all here, so please inspect it, point out
problems, or suggest improvements through issues and pull requests. Feedback
on the bin design itself is just as welcome.

The tool is free and will stay free. Use it, remix it, or fold the design into
other tools.

## License

MIT. The bundled three.js is MIT licensed and the fonts are under the SIL
Open Font License; their license files sit beside them. Gridfinity is an open modular storage system by
[Zack Freedman](https://github.com/zackfreedman/gridfinity), also released
under the MIT license.
