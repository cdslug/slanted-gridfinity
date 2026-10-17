# Slanted Gridfinity

A browser tool that generates Gridfinity bins tilted along one axis, so tall
items fit in drawers that are too shallow for an upright bin. Set the grid
size, height and slant offset, preview the bin in 3D, and export an STL.

Live version: [formfitprint.com/misc/angled-bins](https://formfitprint.com/misc/angled-bins)

## Run it locally

There is no build step. The page is plain HTML and ES modules, and three.js
loads from a CDN, so it needs a network connection the first time.

Browsers block ES modules on `file://` URLs, so serve the folder over HTTP:

```bash
git clone https://github.com/cdslug/slanted-gridfinity.git
cd slanted-gridfinity
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static server works
(`npx serve`, `php -S localhost:8000`, and so on).

## Features

- Grid size from 1 to 6 units on each axis, height from 1 to 14 units
- Slant offset along X or Y, in half grid units
- Adjustable wall thickness and corner resolution
- Optional Gridfinity base profile
- Optional end bin: a support wedge that fills the space at the end of a row
- Wireframe and cross-section views, preset camera views, mouse or trackpad input
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

## Embedding

The app uses only relative paths, so you can copy the folder into any static
site under any path. [Form Fit Print](https://formfitprint.com) includes this
repo as a git submodule and copies it to `/misc/angled-bins/` at build time.

## License

MIT. Gridfinity is an open modular storage system by
[Zack Freedman](https://github.com/zackfreedman/gridfinity), also released
under the MIT license.
