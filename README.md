# Slanted Gridfinity

A browser tool that generates Gridfinity bins tilted along one axis, so tall
items fit in drawers that are too shallow for an upright bin. Set the grid
size, height and slant offset, preview the bin in 3D, and export an STL.

Live version: [formfitprint.com/tools/slanted-gridfinity/app/](https://formfitprint.com/tools/slanted-gridfinity/app/)

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
- Vertical mounting: the same bin turned to hang on a wall, base to the wall
  and slant rising, with the mating surface for one of seven wall systems
  (see [Wall systems](#wall-systems))
- Wireframe and cross-section views, preset camera views on keys 0–6 (F fits the model)
- Binary STL export
- Light and dark themes

## Files

| Path | Contents |
| --- | --- |
| `index.html` | Page layout and controls |
| `js/main.js` | Scene, UI wiring and app state |
| `js/gridfinity-geometry.js` | Bin and end-bin mesh generation |
| `js/wall-mounts.js` | Mating surfaces for the wall systems |
| `js/mesh-shapes.js` | Lofted solids from 2D sections (slots, pegs, holes) |
| `js/camera-controls.js` | Orbit, pan, zoom and preset views |
| `js/stl-export.js` | Binary STL writer and download |
| `css/styles.css` | Theme tokens and layout |
| `src/app.py` | Local launcher: static server plus browser tab |
| `vendor/three/` | three.js r162 and OrbitControls (MIT) |
| `fonts/` | Space Grotesk and Space Mono (SIL OFL) |

## Wall systems

With Orientation set to Vertical, the bin's base faces the wall and carries
the mating surface for the board you pick. Only the bin side is generated;
use the board's own connectors or inserts. Each mount is spaced at the
board's pitch and centred on the back, and the sidebar says how many fit.

| System | What the back gets | Board pitch |
| --- | --- | --- |
| Gridfinity plate | Standard feet with 6.5 x 2.4 mm magnet holes, for a magnetic baseplate mounted on the wall | 42 mm |
| openGrid | [Multiconnect](https://www.printables.com/model/987877) dovetail slots, open at the bottom | 28 mm |
| Multiboard | Multiconnect dovetail slots | 25 mm |
| IKEA SKÅDIS | One of five attachments, below | 40 mm |
| Honeycomb Storage Wall | Tapered hex pegs that press into RostaP's printed HSW inserts | 40.9 mm across, 23.6 mm up |
| GOEWS | V-edged hangers that slide down between the tile's cleats | 42 mm |
| French cleat | A 45° hook block for 19 mm (3/4") plywood cleats, plus a spacer on tall bins | any |

SKÅDIS has a choice of attachment, because the bin prints with its back on
the bed and hooks moulded onto that face need supports and snap along their
layers. All but the last keep the back flat and print without supports:

| Attachment | On the bin | You print or buy |
| --- | --- | --- |
| Dovetail pegs (default) | Dovetail channels across the back, open at both ends, after [dtphantom's peg system](https://www.printables.com/model/283732) (CC BY) | Pegs, exported as their own STL and printed flat, so their layers run along the hook |
| Multiconnect | Multiconnect slots 40 mm apart | David D's [Multiconnect SKÅDIS plugs](https://www.printables.com/model/1111567) |
| T-nut screws | M2.5 screw holes, one per slot | [6d6178's Skadis T-Nuts](https://www.printables.com/model/228663), M2.5 screws and nuts; alignment washers are exported |
| Universal Hook | 5 x 10 and 5 x 5 mm holes, 25 mm apart, through a 5 mm back | CSD_Salzburg's Universal Hook, printed flat |
| Moulded hooks | Hooks on the back, after [skadisgen](https://github.com/tohaimate/skadisgen)'s peg | Nothing, but print with supports |

The geometry is written here from each system's published dimensions; no code
is copied from these projects. Thanks to their authors:
Multiconnect by David D (CC BY);
[openGrid](https://github.com/openGrid-3D);
Multiboard by Keep Making (compatible accessory, not affiliated);
[skadisgen](https://github.com/tohaimate/skadisgen) for the SKÅDIS hook profile (Apache-2.0);
dtphantom for the SKÅDIS dovetail channel and peg (CC BY);
6d6178 for the SKÅDIS T-nut screw pattern (CC BY);
CSD_Salzburg for the Universal Hook hole pattern;
Honeycomb Storage Wall by RostaP;
GOEWS by MrExo3D (CC BY) and [goews-rebuilt-openscad](https://github.com/jimfunk/goews-rebuilt-openscad);
[french_cleats](https://github.com/atiretoo/french_cleats) for the cleat profile;
[gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad) for the magnet holes.

## Embedding

The app uses only relative paths, so you can copy the folder into any static
site under any path. [Form Fit Print](https://formfitprint.com) includes this
repo as a git submodule and copies it to `/tools/slanted-gridfinity/app/` at build time.

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
