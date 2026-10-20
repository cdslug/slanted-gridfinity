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

- Two settings modes: **Core** (the default) shows only orientation, bin
  size, height and the slant, building a Gridfinity drawer bin with its
  slant as a grid offset, or an openGrid wall bin with its slant in degrees
  (30° by default); **Full** shows every setting below
- Bin size in grid units (1 to 20 on each axis) or as an outside size in
  mm, cm or inches; height from 1 to 100 units
- Custom grid unit size (42mm by default) for non-standard baseplates
- Optional half-unit sizes (e.g. 0.5 x 1); the base gets half-size feet
  that still seat in a standard baseplate
- Slant along X or Y, set by an offset in half grid units (the opening lands
  on the grid) or by an angle from 0 to 90 degrees
- Adjustable wall thickness and corner resolution
- Drawer system picker: Gridfinity feet, a flat bottom, Sortimo inset boxes
  (52 mm modules) or Multiboard bins (25 mm grid), with grid units sized to
  the system's grid (see [Drawer systems](#drawer-systems))
- Optional end bin: a support wedge that fills the space at the end of a row,
  sized to match the bin and its offset, hollow by default (a sealed cavity
  with the bin's wall thickness, so the slicer adds no infill inside)
- Vertical mounting: the same bin turned to hang on a wall, base to the wall
  and slant rising, for one of seven wall systems, printing without supports
  (see [Vertical mounting](#vertical-mounting))
- Print fit: a clearance setting, with nozzle presets from 0.2 to 0.8 mm,
  for drawer and wall bins alike
- Compartments: equal cells along X and Y, divided by walls that lean with
  the slant; by default each cell is its own ring, so it prints as one loop
  (see [Compartments](#compartments))
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

## Drawer systems

In **Horizontal** orientation, **Drawer system** (under **Mounting**, where a
wall bin picks its wall system) sets what the bin stands on and the grid its
units follow. A bin is that many units less 0.5 mm, so neighbours fit side by
side, and the end bin follows the same grid.

| System | Bottom | One grid unit |
| --- | --- | --- |
| Gridfinity | Stepped feet, 7 mm tall, for a Gridfinity baseplate | Unit size (42 mm by default) |
| Flat bottom | Flat 2.25 mm floor, 4.75 mm shorter | Unit size (42 mm by default) |
| Sortimo | Flat floor, sized like Sortimo inset boxes for L-BOXX and i-BOXX cases | 52 mm (1x1 is 52 x 52, 1x2 is 52 x 104) |
| Multiboard | Flat floor, on the 25 mm grid of Multiboard drawer bins | 25 mm |

Height units stay 7 mm for every system. A 63 mm Sortimo box is 9 units.

## Vertical mounting

A vertical bin is the same slanted bin turned to hang on a wall. Its base
goes against the wall board, its opening faces you, and the slant runs up,
so the opening sits higher than the base and pens lean back toward the wall.
The base carries the mating surface for the wall system you choose instead
of plain Gridfinity feet.

### Making one

1. Under **Mounting**, set **Orientation** to **Vertical**. In **Core**
   settings that is all you need for an openGrid bin; skip to step 3.
   Switch **Settings** to **Full** for the other wall systems. The drawer system
   control hides, and there is no end bin, since those only apply to drawer
   bins.
2. Pick the **Wall system**. Some systems also have an **Attachment** choice
   (below); the line under each picker says what fits on this bin and what
   you need to print or buy.
3. Set **Bin size**. On a wall the first number is the width across the wall
   and the second the height up it. In grid units, a unit is the board's own
   spacing (see the table below), so bins side by side land on the board's
   holes; **Unit size** shows it in place of its input. With **Size in** set
   to mm, cm or in you give the bin's outside size instead. **Depth units**
   (Height units on a drawer bin) sets how far the bin reaches out from the
   wall. Under **Slant**, **Slant degrees** gives the lean from level, 30° by
   default; a wall has no grid for the opening to line up with. In **Full**
   settings, switch **Set by** to **Grid** to give a **Slant offset** in units
   of the board's spacing up it instead.
4. In **Full** settings, under **Print fit**, pick your **Nozzle**, and adjust **Fit clearance**
   after a test print if parts are too tight or too loose.
5. **Export STL** saves the bin and, when the attachment uses one, the
   separate part. The download row says how many of that part to print.

### Printing

The bin exports in its hanging orientation; lay it on its back in your
slicer, the same way a drawer bin prints on its base. Every system's default
attachment prints that way with no supports: anything that would stand out
of the back is a separate part instead, and the back only gets slots,
channels or holes. Those are dovetails that narrow toward the bed, so each
layer rests on the one below, and their ceilings are short bridges. The
separate parts export lying in their own print orientation, chosen so their
layers run along the hook where the load is.

The moulded attachments stay available, but the hooks, pegs or hangers on
the back need supports, and their layers run across the load.

### Wall systems

Only the bin side is generated; use each board's own connectors or inserts.
A grid unit on the wall is the board's pitch, and a bin is that many units
less 0.5 mm, so neighbours have room between them. Mounts are spaced at the
board's pitch and centred on the back. A back too small for any mount gets
none, and the sidebar says why. The Gridfinity plate and French cleat have no
pitch of their own here, so their units follow the **Unit size** setting.

| System | What the back gets | Board pitch (one grid unit) |
| --- | --- | --- |
| Gridfinity plate | Standard feet with 6.5 x 2.4 mm magnet holes, for a magnetic baseplate mounted on the wall | 42 mm |
| openGrid | [Multiconnect](https://www.printables.com/model/987877) dovetail slots, open at the bottom | 28 mm |
| Multiboard | Multiconnect dovetail slots | 25 mm |
| IKEA SKÅDIS | One of five attachments | 40 mm |
| Honeycomb Storage Wall | Channels for printed peg connectors, or moulded pegs | 40.9 mm across, 23.6 mm up |
| GOEWS | Slots for printed hangers, or moulded hangers | 42 mm across, 36.4 mm up (hex tiles stagger alternate rows by 21 mm) |
| French cleat | A channel for a printed cleat bar, or a moulded hook, for 19 mm (3/4") plywood cleats | any (Unit size, 42 mm by default) |

### Attachments

| System | Attachment | On the bin | You print or buy |
| --- | --- | --- | --- |
| SKÅDIS | **Dovetail pegs** (default) | Dovetail channels across the back, after [dtphantom's peg system](https://www.printables.com/model/283732) | Pegs, exported, printed flat |
| SKÅDIS | Multiconnect | Multiconnect slots 40 mm apart | David D's [Multiconnect SKÅDIS plugs](https://www.printables.com/model/1111567) |
| SKÅDIS | T-nut screws | M2.5 screw holes, one per slot | [6d6178's Skadis T-Nuts](https://www.printables.com/model/228663), M2.5 screws and nuts; alignment washers are exported |
| SKÅDIS | Universal Hook | 5 x 10 and 5 x 5 mm holes, 25 mm apart, through a 5 mm back | CSD_Salzburg's Universal Hook |
| SKÅDIS | Moulded hooks | Hooks on the back, after [skadisgen](https://github.com/tohaimate/skadisgen)'s peg | Nothing; needs supports |
| HSW | **Slide-on pegs** (default) | A horizontal dovetail channel per row of pegs | Connectors, exported, printed standing on the peg's tip, plus RostaP's HSW inserts |
| HSW | Moulded pegs | Hex pegs on the back | HSW inserts; needs supports |
| GOEWS | **Slide-on hangers** (default) | Vertical dovetail slots, open at the bottom | Hangers, exported, printed standing |
| GOEWS | Moulded hangers | Hangers on the back | Nothing; needs supports |
| French cleat | **Slide-in cleat bar** (default) | Horizontal dovetail channels | Cleat bar, plus a spacer bar on tall bins, exported in one file |
| French cleat | Moulded hook | The hook and spacer on the back | Nothing; needs supports |

### Hanging it

- **Multiconnect** (openGrid, Multiboard, SKÅDIS plugs): fit the connectors
  to the board, lower the bin onto them and slide it down until it clicks.
- **SKÅDIS dovetail pegs:** slide a peg into the channel for each board slot,
  40 mm apart, push them through the slots, then drop the bin so the pegs'
  heads hook behind the board.
- **SKÅDIS T-nuts:** push a T-nut through each slot, add the washer, and
  screw through the bin's back from inside; the nut turns and locks.
- **HSW:** click the inserts into the board. Slide a connector into the
  channels for each peg, space them 40.9 mm apart (one cell), and press the
  bin onto the inserts so every peg goes in at once.
- **GOEWS:** seat a hanger in each tile window and slide it down onto the
  cleats, then lower the bin onto the hangers until it rests on them.
- **French cleat:** slide the cleat bar (and spacer) into the channels from
  the side, then drop the bin over the wall cleat.
- **Gridfinity plate:** put 6 x 2 mm magnets in the feet; the bin seats in a
  magnetic baseplate screwed to the wall.

### Compartments

**Compartments** (in **Full** settings) splits the inside into equal cells, a count
along X and along Y; 1 × 1 is the plain bin. Dividers across the slant lean
with it, like the end walls, so every layer keeps the same wall width.

**Walls** sets how the cells are built. With a single-line wall (0.82 mm from
a 0.8 mm nozzle), the first two give the slicer one unbroken loop per cell
instead of lines to join at every T:

- **Loop each** (default): every cell is its own ring, one wall thick, and
  the rings make the bin's outside, so the cells look like separate tubes
  on a shared floor.
- **Loops + outer**: the same rings inside an outer ring of their own, for a
  smooth outside at the cost of more material and room.
- **Shared**: one-thickness dividers joined to the outer wall, which keeps
  the most room inside.

**Loop gap** (0.15 mm by default) is the space between the rings. Above 0
each ring is separate, joined only by the floor, so the slicer prints it as a
single line and can't merge or split it. At 0 the rings merge into solid
dividers two lines wide. Slicers close gaps under about
0.1 mm (PrusaSlicer, Orca and Bambu's slice closing radius is 0.049 mm), so a
smaller gap prints as if it were 0.

Cells stay at least 5 mm across. On a wall, X runs across and Y up, and a
mount's holes through the floor never land under a divider: if they would,
that axis keeps fewer cells.

### Print fit

Both settings are under **Print fit**, in **Full** settings. Clearances follow each
system's published fit, which assumes a 0.4 mm nozzle. **Fit clearance** adds room on every mating surface, in mm per side
(-0.2 to 0.6): feet, pegs, hooks and hangers shrink, and slots, channels and
holes grow. **Nozzle** fills in a starting value: -0.1, 0, +0.1 or +0.2 mm for
0.2, 0.4, 0.6 or 0.8 mm nozzles, since wider lines print holes smaller and
pegs fatter. That rule of thumb is a starting point; tune it after a test
print. Fit clearance also applies to drawer bins' Gridfinity feet. French
cleat hooks mate with wood and ignore it.

### Not yet tested in print

The mounts follow each system's published or measured dimensions and every
generated part is a closed, support-free solid, but none has been test
printed yet. In particular:

- The HSW connector and the GOEWS hanger are designs of this project on the
  boards' published dimensions. The HSW connector's peg prints with its
  layers across its length.
- The Universal Hook option matches CSD_Salzburg's published hole pattern;
  their hook itself wasn't available to check against.
- The detent dot in Multiconnect slots hangs from the slot ceiling, so its
  1 mm tip starts in mid-air when the bin prints on its back.

Reports from real prints are welcome as issues.

### Credits

The geometry is written here from each system's published dimensions; no
code is copied from these projects. Thanks to their authors:
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

The app makes no network requests. When you export, it fires a `tool-action`
event on `document` with `detail: { action: 'export', detail: 'both:2x2:h12:o2x' }`
(which files, grid size, height units, slant offset and axis), so a site that
hosts it can count exports with its own script. A size given as a length
reads like `100mmx80mm`, and a slant set by angle like `a30degx`. On a wall
the axis is `up`, and `-part` follows the files when a mount part is
exported. Nothing listens unless the host page adds a listener.

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
