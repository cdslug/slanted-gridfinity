/**
 * gridfinity-geometry.js — Slanted Gridfinity bin mesh generation.
 *
 * Generates closed, outward-facing triangle meshes for:
 *   1. A slanted bin (top cross-section offset from bottom)
 *   2. An optional end bin (wedge that fills the gap under the slant)
 *
 * The slanted bin can also be built for a wall: the same bin turned so its
 * base faces the wall (-X), its opening faces out (+X) and the slant runs up
 * (+Z). Its base then carries the chosen wall system's mating surface
 * (wall-mounts.js) instead of plain Gridfinity feet.
 *
 * Each mesh is a set of closed shells (the body, plus one per base foot,
 * touching the body's underside): every edge is shared by exactly two
 * triangles with opposite winding, so back faces never need drawing.
 *
 * Key constraint: wall thickness in the XY plane is maintained at every Z level
 * (matches 3D printer layer-line width requirement).
 *
 * Coordinate convention:
 *   - Built like kennetek/gridfinity-rebuilt-openscad (interior floor at Z = 0,
 *     base extending below to Z = -BASE_HEIGHT_MM), then lifted so the
 *     bottom-most surface rests on Z = 0 — the build plate. With the base the
 *     interior floor ends up at Z = BASE_HEIGHT_MM (dimensions.floorZ);
 *     without it, on top of the 2.25mm bridge slab that stays as the floor.
 *   - Z-up, XY is the grid plane
 *   - Main bin centered at XY origin (at the base)
 */

import { roundedRectPoints, circlePoints, loft, writeCap, writeHoleWall } from './mesh-shapes.js';
import {
  planWallMount, WALL_SYSTEMS, DEFAULT_WALL_SYSTEM,
} from './wall-mounts.js';

// ---------------------------------------------------------------------------
// Gridfinity spec constants (from kennetek/gridfinity-rebuilt-openscad)
// ---------------------------------------------------------------------------

export const GRID_MM = 42.0;
export const TOLERANCE_MM = 0.5;
export const SPEC_WALL_MM = 0.95;
export const BASE_HEIGHT_MM = 7.0;
export const CORNER_SEGMENTS = 8;   // arc segments per rounded corner (0.02mm max chord error)
export const HEIGHT_UNIT_MM = 7.0;
export const BASE_CORNER_RADIUS = 3.75;
export const XY_CLEARANCE_MM = 0.25;

// Base profile: [height_from_base_bottom, inset_from_unit_base_top]
const BASE_UNIT_PROFILE_LEVELS = [
  { dz: 0.0,  inset: 2.95 },
  { dz: 0.8,  inset: 2.15 },
  { dz: 2.6,  inset: 2.15 },
  { dz: 4.75, inset: 0.0  },
];

const BRIDGE_Z_BOTTOM = -BASE_HEIGHT_MM + 4.75; // = -2.25

// Magnet holes for a magnetic (e.g. wall-mounted) baseplate: 6 x 2mm magnets
// in 6.5 x 2.4mm holes, open on the foot's underside, centred 8mm in from
// the grid lines of each cell, matching the baseplate's own magnets.
const MAGNET_RADIUS = 3.25;
const MAGNET_DEPTH = 2.4;
const MAGNET_FROM_GRID_LINE = 8;
const MAGNET_SEGMENTS = 24;

// Fit clearance: extra mm per side on every mating surface, for nozzles and
// printers that print holes small and pegs fat (positive = looser). Feet
// shrink, holes grow; 0 keeps the published fits. Same bounds as the input.
export const FIT_CLEARANCE_MIN = -0.2;
export const FIT_CLEARANCE_MAX = 0.6;
const clampFit = (c) => (Number.isFinite(c) ? Math.min(FIT_CLEARANCE_MAX, Math.max(FIT_CLEARANCE_MIN, c)) : 0);
// A foot profile level's inset, moved in by the clearance but never out past
// the bin's own outline at the top
const footInset = (inset, fit) => Math.max(0, inset + fit);

// ---------------------------------------------------------------------------
// Drawer systems: what a floor bin stands on, and the grid its units follow.
// `feet` gives it Gridfinity feet (otherwise the flat floor slab); `spacing`
// is the grid pitch in mm, or absent to use the Unit size setting. Bins are
// units x spacing less TOLERANCE_MM, as on a Gridfinity baseplate.
//   Sortimo  inset boxes for L-BOXX and i-BOXX cases: 52 mm modules (1x1 is
//            52 x 52, 1x2 is 52 x 104)
//   Multiboard  community drawer bins and containers on Multiboard's 25 mm grid
// ---------------------------------------------------------------------------

export const DRAWER_SYSTEMS = {
  gridfinity: { label: 'Gridfinity', feet: true },
  flat:       { label: 'Flat bottom', feet: false },
  sortimo:    { label: 'Sortimo inset box', feet: false, spacing: 52 },
  multiboard: { label: 'Multiboard bin', feet: false, spacing: 25 },
};

export const DEFAULT_DRAWER_SYSTEM = 'gridfinity';

// ---------------------------------------------------------------------------
// Dimension helpers
// ---------------------------------------------------------------------------

// `units` may be fractional (e.g. 0.5 for a half-width bin); `gridMM` is the
// baseplate pitch, 42mm in the spec.
export function binOuterMM(units, gridMM = GRID_MM) {
  return gridMM * units - TOLERANCE_MM;
}

export function interiorHeightMM(hUnits) {
  return HEIGHT_UNIT_MM * hUnits - BASE_HEIGHT_MM;
}

export function interiorWidthMM(units, wallT, gridMM = GRID_MM) {
  return binOuterMM(units, gridMM) - 2 * wallT;
}

// ---------------------------------------------------------------------------
// Compartments: the bin split into nx x ny equal cells by walls along both
// axes; 1 x 1 is the plain bin. How the cells are walled (DIVIDER_WALLS):
//   loops   each cell is one ring, one wall thick; the rings make the bin's
//           outside too, `gap` apart, on the shared floor. A slicer printing
//           one line per wall draws one unbroken loop per cell. At gap 0 they
//           touch: an outer wall of one thickness, dividers of two.
//   double  the same rings inside an outer wall ring of their own, `gap`
//           apart; at gap 0 a solid wall two thicknesses wide everywhere.
//   single  dividers one wall thickness, joined to the outer wall.
// Slicers close gaps under ~0.1 mm (the slice closing radius), so a smaller
// gap prints as touching loops.
// ---------------------------------------------------------------------------

export const DIVIDER_WALLS = ['loops', 'double', 'single'];

export const COMPARTMENTS_MAX = 10;
export const LOOP_GAP_MAX = 0.5;
const MIN_COMPARTMENT_MM = 5;   // fewer cells along an axis rather than narrower

// Cell counts, wall widths and the cell size inside an outerW x outerD bin.
// Counts drop until each cell is at least MIN_COMPARTMENT_MM across.
// `wall` and `divider` run from the bin's outside to a cell's inside and
// between cells' insides, gap included; `gap` is 0 for single dividers and
// an undivided bin.
export function compartmentLayout(outerW, outerD, t, nx = 1, ny = 1, mode = 'loops', gap = 0) {
  const count = (n) => Math.min(COMPARTMENTS_MAX, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1)));
  const want = [count(nx), count(ny)];
  if (!DIVIDER_WALLS.includes(mode)) mode = 'loops';
  const g = mode !== 'single' && Number.isFinite(gap) ? Math.min(LOOP_GAP_MAX, Math.max(0, gap)) : 0;
  let [cx, cy] = want;
  for (;;) {
    const split = cx > 1 || cy > 1;
    const wall = split && mode === 'double' ? 2 * t + g : t;
    const divider = mode === 'single' ? t : 2 * t + g;
    const cellW = (outerW - 2 * wall - (cx - 1) * divider) / cx;
    const cellD = (outerD - 2 * wall - (cy - 1) * divider) / cy;
    const shrinkX = cx > 1 && cellW < MIN_COMPARTMENT_MM;
    const shrinkY = cy > 1 && cellD < MIN_COMPARTMENT_MM;
    if (!shrinkX && !shrinkY) {
      return { nx: cx, ny: cy, mode, wall, divider, gap: split ? g : 0, cellW, cellD, capped: cx < want[0] || cy < want[1] };
    }
    if (shrinkX) cx--;
    if (shrinkY) cy--;
  }
}

// Each cell's rectangle, centred on the bin at the origin
function compartmentRects({ nx, ny, wall, divider, cellW, cellD }, outerW, outerD) {
  const rects = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x0 = -outerW / 2 + wall + i * (cellW + divider);
      const y0 = -outerD / 2 + wall + j * (cellD + divider);
      rects.push({ x0, y0, x1: x0 + cellW, y1: y0 + cellD, i, j });
    }
  }
  return rects;
}

// A cell's outline, CCW from its +X -Y corner: rounded like the bin's inner
// wall where it meets the bin's corner, square where dividers meet. `grow`
// widens it on every side, for the outside of a cell's own ring.
function compartmentOutline(rect, { nx, ny, wall }, cornerSegments, grow = 0) {
  const { i, j } = rect;
  const x0 = rect.x0 - grow, y0 = rect.y0 - grow, x1 = rect.x1 + grow, y1 = rect.y1 + grow;
  const halfAngle = Math.PI / (4 * cornerSegments);
  let R = Math.min(BASE_CORNER_RADIUS - (wall - grow) / Math.cos(halfAngle), (x1 - x0) / 2, (y1 - y0) / 2);
  if (R < 0.01) R = 0;
  const left = i === 0, right = i === nx - 1, bottom = j === 0, top = j === ny - 1;
  const corners = [
    { r: right && bottom ? R : 0, sx: -1, sy: 1, x: x1, y: y0, a0: -Math.PI / 2 },
    { r: right && top ? R : 0, sx: -1, sy: -1, x: x1, y: y1, a0: 0 },
    { r: left && top ? R : 0, sx: 1, sy: -1, x: x0, y: y1, a0: Math.PI / 2 },
    { r: left && bottom ? R : 0, sx: 1, sy: 1, x: x0, y: y0, a0: Math.PI },
  ];
  const pts = [];
  for (const { r, sx, sy, x, y, a0 } of corners) {
    if (r === 0) { pts.push([x, y]); continue; }
    const ox = x + sx * r, oy = y + sy * r;
    for (let k = 0; k <= cornerSegments; k++) {
      const a = a0 + (k / cornerSegments) * (Math.PI / 2);
      pts.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]);
    }
  }
  return pts;
}

const holeInRect = (hole, { x0, y0, x1, y1 }) =>
  hole.every(([x, y]) => x > x0 + 1e-6 && x < x1 - 1e-6 && y > y0 + 1e-6 && y < y1 - 1e-6);

// ---------------------------------------------------------------------------
// Mesh builder — writes triangles straight into a growable Float32Array
// (9 floats per triangle: three xyz vertices, CCW seen from outside).
// ---------------------------------------------------------------------------

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

class MeshBuilder {
  constructor(capacityTris = 4096) {
    this.positions = new Float32Array(capacityTris * 9);
    this.length = 0;
  }

  tri(a, b, c) {
    // Zero-area triangles (e.g. where the end bin's wedge height clamps to 0)
    // are skipped: their edges cancel out, so the neighbours still pair up.
    if (samePoint(a, b) || samePoint(b, c) || samePoint(c, a)) return;
    if (this.length + 9 > this.positions.length) {
      const grown = new Float32Array(this.positions.length * 2);
      grown.set(this.positions);
      this.positions = grown;
    }
    const p = this.positions;
    const i = this.length;
    p[i]     = a[0]; p[i + 1] = a[1]; p[i + 2] = a[2];
    p[i + 3] = b[0]; p[i + 4] = b[1]; p[i + 5] = b[2];
    p[i + 6] = c[0]; p[i + 7] = c[1]; p[i + 8] = c[2];
    this.length = i + 9;
  }

  // Move every vertex written so far through `fn([x, y, z]) → [x, y, z]`.
  // `fn` must be a rotation plus a shift, so faces keep facing outward.
  mapPoints(fn) {
    const p = this.positions;
    for (let i = 0; i < this.length; i += 3) {
      const [x, y, z] = fn([p[i], p[i + 1], p[i + 2]]);
      p[i] = x; p[i + 1] = y; p[i + 2] = z;
    }
  }

  minZ() {
    let m = Infinity;
    for (let i = 2; i < this.length; i += 3) m = Math.min(m, this.positions[i]);
    return Number.isFinite(m) ? m : 0;
  }

  // Trim to size and shift up by `dz` so the bottom-most surface rests on Z = 0.
  finish(dz = 0) {
    const positions = this.positions.slice(0, this.length);
    if (dz) {
      for (let i = 2; i < positions.length; i += 3) positions[i] += dz;
    }
    return { positions, triangleCount: this.length / 9 };
  }
}

// ---------------------------------------------------------------------------
// Shared mesh builder helpers
// ---------------------------------------------------------------------------

function makeRing(z, w, h, r, offset, cornerSegments) {
  const pts2d = roundedRectPoints(w, h, r, cornerSegments);
  return pts2d.map(([x, y]) => [x + offset[0], y + offset[1], z]);
}

function addStrip(mesh, ring1, ring2, flip = false) {
  const n = ring1.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!flip) {
      mesh.tri(ring1[i], ring1[j], ring2[j]);
      mesh.tri(ring1[i], ring2[j], ring2[i]);
    } else {
      mesh.tri(ring1[i], ring2[j], ring1[j]);
      mesh.tri(ring1[i], ring2[i], ring2[j]);
    }
  }
}

function addFan(mesh, ring, center, flip = false) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!flip) {
      mesh.tri(center, ring[i], ring[j]);
    } else {
      mesh.tri(center, ring[j], ring[i]);
    }
  }
}

function addRingFace(mesh, outerRing, innerRing) {
  const n = outerRing.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mesh.tri(outerRing[i], outerRing[j], innerRing[j]);
    mesh.tri(outerRing[i], innerRing[j], innerRing[i]);
  }
}

// ---------------------------------------------------------------------------
// Shared gridfinity base generation
//
// Each foot is its own closed shell; its top face sits flush against the
// bottom of the bridge (see addBridge). Slicers merge touching shells, and
// keeping each shell closed means the mesh has no open or 3-way edges.
//
// With `divisions` > 1 each grid unit gets divisions x divisions smaller feet
// (like kennetek's half_grid), so fractional-width bins still seat in a
// standard baseplate.
//
// With `magnets`, each foot gets a hole under every baseplate magnet it
// covers: four in a whole foot, one in each half-size foot. The foot is then
// two shells: the bottom MAGNET_DEPTH with the holes through it, and the rest
// on top, whose underside is the holes' ceiling.
// ---------------------------------------------------------------------------

// Baseplate magnet positions along one axis of a bin `units` wide, its first
// grid line at -units * gridMM / 2.
function magnetPositions(units, gridMM) {
  const out = [];
  const start = -units * gridMM / 2;
  for (let k = 0; k < Math.ceil(units - 1e-9); k++) {
    out.push(start + k * gridMM + MAGNET_FROM_GRID_LINE, start + (k + 1) * gridMM - MAGNET_FROM_GRID_LINE);
  }
  return out;
}

function addMagnetFoot(mesh, cx, cy, footTop, holes, cornerSegments, fit) {
  const ring = (profileInset) => {
    const inset = footInset(profileInset, fit);
    return roundedRectPoints(
      footTop - 2 * inset, footTop - 2 * inset, Math.max(0.01, BASE_CORNER_RADIUS - inset), cornerSegments, cx, cy,
    );
  };
  const insetAt = (dz) => {
    const L = BASE_UNIT_PROFILE_LEVELS;
    for (let i = 0; i < L.length - 1; i++) {
      if (dz <= L[i + 1].dz) {
        const f = (dz - L[i].dz) / (L[i + 1].dz - L[i].dz);
        return L[i].inset + f * (L[i + 1].inset - L[i].inset);
      }
    }
    return L[L.length - 1].inset;
  };
  const toWorld = (x, y, dz) => [x, y, -BASE_HEIGHT_MM + dz];
  const circles = holes.map(([hx, hy]) => circlePoints(hx, hy, MAGNET_RADIUS + fit, MAGNET_SEGMENTS));

  // Profile levels below and above the hole ceiling
  const levels = BASE_UNIT_PROFILE_LEVELS.map(l => l.dz);
  const lower = [...levels.filter(dz => dz < MAGNET_DEPTH), MAGNET_DEPTH];
  const upper = [MAGNET_DEPTH, ...levels.filter(dz => dz > MAGNET_DEPTH)];
  loft(mesh, lower.map(dz => ({ t: dz, contour: ring(insetAt(dz)), holes: circles })), toWorld);
  loft(mesh, upper.map(dz => ({ t: dz, contour: ring(insetAt(dz)) })), toWorld);
}

// Feet that fit under a bin `units` wide: whole steps only, so a size set in
// millimetres gets the feet that fit inside it, centred.
export function footCount(units, divisions = 1) {
  return Math.max(1, Math.floor(units * divisions + 1e-6));
}

function addFeet(mesh, gridX, gridY, centerOffset, cornerSegments, gridMM, divisions, magnets = false, fit = 0) {
  const [cox, coy] = centerOffset;
  const pitch = gridMM / divisions;
  const footTop = pitch - TOLERANCE_MM;
  const feetX = footCount(gridX, divisions);
  const feetY = footCount(gridY, divisions);

  for (let ix = 0; ix < feetX; ix++) {
    for (let iy = 0; iy < feetY; iy++) {
      const cx = cox + (ix - (feetX - 1) / 2) * pitch;
      const cy = coy + (iy - (feetY - 1) / 2) * pitch;

      if (magnets) {
        // Holes that sit fully on the foot's flat underside
        const reach = footTop / 2 - footInset(BASE_UNIT_PROFILE_LEVELS[0].inset, fit) - (MAGNET_RADIUS + fit) - 0.4;
        const holes = [];
        // On the grid the feet span, which a size in millimetres may overhang
        for (const mx of magnetPositions(feetX / divisions, gridMM)) {
          for (const my of magnetPositions(feetY / divisions, gridMM)) {
            if (Math.abs(mx + cox - cx) <= reach && Math.abs(my + coy - cy) <= reach) holes.push([mx + cox, my + coy]);
          }
        }
        addMagnetFoot(mesh, cx, cy, footTop, holes, cornerSegments, fit);
        continue;
      }

      const unitRings = [];
      for (const level of BASE_UNIT_PROFILE_LEVELS) {
        const z = -BASE_HEIGHT_MM + level.dz;
        const inset = footInset(level.inset, fit);
        const w = footTop - 2 * inset;
        const r = Math.max(0.01, BASE_CORNER_RADIUS - inset);
        unitRings.push(makeRing(z, w, w, r, [cx, cy], cornerSegments));
      }

      addFan(mesh, unitRings[0], [cx, cy, -BASE_HEIGHT_MM], true);
      for (let i = 0; i < unitRings.length - 1; i++) {
        addStrip(mesh, unitRings[i], unitRings[i + 1]);
      }
      addFan(mesh, unitRings[unitRings.length - 1], [cx, cy, BRIDGE_Z_BOTTOM], false);
    }
  }
}

// Bridge: the solid floor slab from z = BRIDGE_Z_BOTTOM up to `topRing` at
// z = 0 — bottom face plus vertical sides. The caller closes the top by
// continuing the outer surface up from `topRing`.
function addBridge(mesh, w, d, center, cornerSegments, topRing) {
  const bottom = makeRing(BRIDGE_Z_BOTTOM, w, d, BASE_CORNER_RADIUS, center, cornerSegments);
  addFan(mesh, bottom, [center[0], center[1], BRIDGE_Z_BOTTOM], true);
  addStrip(mesh, bottom, topRing);
}

// Height of the bottom-most surface below the interior floor (z = 0): the
// full base with feet, or just the bridge slab as a flat floor without them.
function plateShift(includeBase) {
  return includeBase ? BASE_HEIGHT_MM : -BRIDGE_Z_BOTTOM;
}

// ---------------------------------------------------------------------------
// Main slanted bin generator
// ---------------------------------------------------------------------------

// Sizes: `gridX` x `gridY` units of `pitchX` x `pitchY` mm (both the Unit size
// by default; a wall system's board spacing on a wall, where X runs across
// it and Y up it). The slant: `offsetMM` when given, else `offsetUnits` of
// the pitch along the offset axis.
export function generateSlantedBin({
  gridX = 2,
  gridY = 2,
  pitchX,
  pitchY,
  heightUnits = 12,
  offsetUnits = 2,
  offsetMM,
  offsetAxis = 'x',
  wallThickness = 0.82,
  includeBase = true,
  orientation = 'horizontal',
  wallSystem = DEFAULT_WALL_SYSTEM,
  mountMethod = null,
  fitClearance = 0,
  cornerSegments = CORNER_SEGMENTS,
  gridMM = GRID_MM,
  divisions = 1,
  compartmentsX = 1,
  compartmentsY = 1,
  dividerWalls = 'loops',
  loopGap = 0,
} = {}) {
  const mesh = new MeshBuilder();
  const fit = clampFit(fitClearance);

  // On a wall the bin is built as usual with its slant along local X, then
  // turned: local X (the slant) goes up, local Z (the height) out from the
  // wall. gridX is then the width across the wall and gridY the height up it.
  const vertical = orientation === 'vertical';
  pitchX ??= gridMM;
  pitchY ??= gridMM;
  // On a wall the slant runs up, along Y
  const totalOffset = Number.isFinite(offsetMM) ? Math.max(0, offsetMM)
    : offsetUnits * (vertical || offsetAxis === 'y' ? pitchY : pitchX);
  if (vertical) {
    if (!WALL_SYSTEMS[wallSystem]) wallSystem = DEFAULT_WALL_SYSTEM;
    [gridX, gridY] = [gridY, gridX];
    [pitchX, pitchY] = [pitchY, pitchX];
    [compartmentsX, compartmentsY] = [compartmentsY, compartmentsX];
    offsetAxis = 'x';
    includeBase = wallSystem === 'gridfinity';
  }

  const outerW = binOuterMM(gridX, pitchX);
  const outerD = binOuterMM(gridY, pitchY);
  const wallH = interiorHeightMM(heightUnits);
  const t = wallThickness;

  function getOffset(z) {
    if (z <= 0 || wallH <= 0) return [0, 0];
    const frac = Math.min(z / wallH, 1);
    return offsetAxis === 'x'
      ? [frac * totalOffset, 0]
      : [0, frac * totalOffset];
  }

  // --- BASE ---
  if (includeBase) {
    addFeet(mesh, gridX, gridY, [0, 0], cornerSegments, gridMM, divisions, vertical, fit);
  }

  // --- WALLS ---
  const halfAngle = Math.PI / (4 * cornerSegments);
  const innerR = Math.max(0.01, BASE_CORNER_RADIUS - t / Math.cos(halfAngle));
  const innerW = outerW - 2 * t;
  const innerD = outerD - 2 * t;

  const wallOuterBottom = makeRing(0, outerW, outerD, BASE_CORNER_RADIUS, getOffset(0), cornerSegments);
  const wallOuterTop = makeRing(wallH, outerW, outerD, BASE_CORNER_RADIUS, getOffset(wallH), cornerSegments);
  const wallInnerBottom = makeRing(0, innerW, innerD, innerR, getOffset(0), cornerSegments);
  const wallInnerTop = makeRing(wallH, innerW, innerD, innerR, getOffset(wallH), cornerSegments);

  // On a wall, plan the mount first: some cut holes through the back (the
  // floor slab and the interior floor) for screws or hooks to reach inside.
  // Wall (u, v) on the back is local (x, y) = (v, -u), before the turn below.
  const plan = vertical
    ? planWallMount(wallSystem, { W: outerD, H: outerW, R: BASE_CORNER_RADIUS },
      { method: mountMethod, slabMM: -BRIDGE_Z_BOTTOM, fit })
    : null;
  const floorHoles = (plan?.holes ?? []).map(pts => pts.map(([u, v]) => [v, -u]));

  // Compartments, fewer along an axis whose dividers would cross a hole
  // the mount cuts through the floor
  const holesFit = (l) => floorHoles.every(h => compartmentRects(l, outerW, outerD).some(r => holeInRect(h, r)));
  const layoutFor = (nx, ny) => compartmentLayout(outerW, outerD, t, nx, ny, dividerWalls, loopGap);
  const wanted = layoutFor(compartmentsX, compartmentsY);
  const layout = [[wanted.nx, wanted.ny], [wanted.nx, 1], [1, wanted.ny], [1, 1]]
    .map(([nx, ny]) => layoutFor(nx, ny))
    .find(holesFit) ?? layoutFor(1, 1);
  const divided = layout.nx * layout.ny > 1;

  const flat = (ring) => ring.map(([x, y]) => [x, y]);
  const at = (x, y, z) => [x, y, z];
  const lift = (pts, z) => { const [ox, oy] = getOffset(z); return pts.map(([x, y]) => [x + ox, y + oy, z]); };

  // One closed shell: floor slab (z=-2.25 to 0), outer wall, rim, inner
  // wall, and the interior floor inside the inner wall at z=0 (with
  // compartments: an inner wall and floor in each). Loops apart are the
  // exception: the slab alone, and a shell per cell's ring standing on it.
  if (floorHoles.length) {
    const bottom = makeRing(BRIDGE_Z_BOTTOM, outerW, outerD, BASE_CORNER_RADIUS, [0, 0], cornerSegments);
    writeCap(mesh, flat(bottom), floorHoles, at, BRIDGE_Z_BOTTOM, false);
    addStrip(mesh, bottom, wallOuterBottom);
    for (const hole of floorHoles) writeHoleWall(mesh, hole, at, BRIDGE_Z_BOTTOM, 0);
  } else {
    addBridge(mesh, outerW, outerD, [0, 0], cornerSegments, wallOuterBottom);
  }
  const separate = divided && layout.gap > 0 && layout.mode === 'loops';
  if (!separate) addStrip(mesh, wallOuterBottom, wallOuterTop);
  if (separate) {
    // The slab's top is the floor everywhere; each ring touches it, and
    // slicers merge touching shells (as with the feet)
    writeCap(mesh, flat(wallOuterBottom), floorHoles, at, 0, true);
    for (const r of compartmentRects(layout, outerW, outerD)) {
      const outside = compartmentOutline(r, layout, cornerSegments, t);
      const inside = compartmentOutline(r, layout, cornerSegments);
      const outsideTop = lift(outside, wallH), insideTop = lift(inside, wallH);
      addStrip(mesh, lift(outside, 0), outsideTop);
      writeCap(mesh, flat(outsideTop), [flat(insideTop)], at, wallH, true);
      addStrip(mesh, lift(inside, 0), insideTop, true);
      writeCap(mesh, outside, [inside], at, 0, false);
    }
  } else if (divided) {
    // Every cell gets its own inner wall and floor
    const rects = compartmentRects(layout, outerW, outerD);
    const outlines = rects.map(r => compartmentOutline(r, layout, cornerSegments));
    const tops = outlines.map(o => lift(o, wallH));
    if (layout.gap > 0) {
      // Double, apart: the outer wall is its own ring, and each cell's ring stands
      // on the floor inside it, with floor showing in the gaps between
      addRingFace(mesh, wallOuterTop, wallInnerTop);
      addStrip(mesh, wallInnerBottom, wallInnerTop, true);
      const rings = rects.map(r => compartmentOutline(r, layout, cornerSegments, t));
      writeCap(mesh, flat(wallInnerBottom), rings, at, 0, true);
      rings.forEach((ring, k) => {
        const ringTop = lift(ring, wallH);
        addStrip(mesh, lift(ring, 0), ringTop);
        writeCap(mesh, flat(ringTop), [flat(tops[k])], at, wallH, true);
      });
    } else {
      // Touching: the rim is the outer outline with every cell's opening cut out
      writeCap(mesh, flat(wallOuterTop), tops.map(flat), at, wallH, true);
    }
    outlines.forEach((o, k) => {
      const bottom = lift(o, 0);
      addStrip(mesh, bottom, tops[k], true);
      const own = floorHoles.filter(h => holeInRect(h, rects[k]));
      if (own.length) {
        writeCap(mesh, o, own, at, 0, true);
      } else {
        const { x0, y0, x1, y1 } = rects[k];
        addFan(mesh, bottom, [(x0 + x1) / 2, (y0 + y1) / 2, 0], false);
      }
    });
  } else {
    addRingFace(mesh, wallOuterTop, wallInnerTop);
    addStrip(mesh, wallInnerBottom, wallInnerTop, true);
    if (floorHoles.length) {
      writeCap(mesh, wallInnerBottom.map(([x, y]) => [x, y]), floorHoles, (x, y, z) => [x, y, z], 0, true);
    } else {
      const floorCenter = [getOffset(0)[0], getOffset(0)[1], 0];
      addFan(mesh, wallInnerBottom, floorCenter, false);
    }
  }

  // --- Place on the build plate (or the wall) & dimensions ---
  const floorZ = plateShift(includeBase);
  let mount = null;
  let result;
  if (vertical) {
    // Back face (the base's underside) on the wall plane X = 0, slant up +Z;
    // (x, y, z) -> (z, -y, x) is a rotation, so faces keep facing outward.
    mesh.mapPoints(([x, y, z]) => [z + floorZ, -y, x]);
    plan.build(mesh);
    mount = {
      system: wallSystem,
      label: WALL_SYSTEMS[wallSystem].label,
      fits: plan.fits,
      text: plan.text,
      part: plan.part ? { name: plan.part.name, count: plan.part.count } : null,
    };
    result = mesh.finish(-mesh.minZ());
  } else {
    result = mesh.finish(floorZ);
  }

  const slantAngleDeg = wallH > 0
    ? Math.atan2(totalOffset, wallH) * (180 / Math.PI) : 0;
  const slantDiagonal = Math.sqrt(totalOffset * totalOffset + wallH * wallH);
  // The longest item in one compartment (the whole interior when undivided)
  const spanOffset = totalOffset + (offsetAxis === 'x' ? layout.cellW : layout.cellD);
  const spanCross = offsetAxis === 'x' ? layout.cellD : layout.cellW;
  const maxPenLength = Math.sqrt(
    spanOffset * spanOffset + spanCross * spanCross + wallH * wallH
  );

  return {
    ...result,
    dimensions: {
      outerWidth: outerW,
      outerDepth: outerD,
      innerWidth: outerW - 2 * layout.wall,
      innerDepth: outerD - 2 * layout.wall,
      // Counts and sizes along local X and Y (turned on a wall, like the rest);
      // `blocked` when a mount's floor holes took dividers away
      compartments: {
        nx: layout.nx, ny: layout.ny, width: layout.cellW, depth: layout.cellD, gap: layout.gap,
        capped: wanted.capped, blocked: layout.nx * layout.ny < wanted.nx * wanted.ny,
      },
      totalHeight: floorZ + wallH,
      interiorHeight: wallH,
      baseHeight: floorZ,
      floorZ,
      totalOffset,
      slantAngleDeg,
      slantDiagonal,
      maxPenLength,
      wallThickness: t,
      gridMM,
      orientation: vertical ? 'vertical' : 'horizontal',
      mount,
    },
  };
}

// ---------------------------------------------------------------------------
// Separate mount part — e.g. a SKÅDIS peg printed flat, which the wall plan
// asks for instead of moulding the hook onto the bin's back. Built in its
// print orientation, resting on Z = 0. Null when the plan needs none.
// ---------------------------------------------------------------------------

export function generateWallPart({
  gridX = 2,
  gridY = 2,
  gridMM = GRID_MM,
  pitchX = gridMM,
  pitchY = gridMM,
  wallSystem = DEFAULT_WALL_SYSTEM,
  mountMethod = null,
  fitClearance = 0,
} = {}) {
  // The same back face as the vertical bin: gridX across the wall, gridY up it
  const back = { W: binOuterMM(gridX, pitchX), H: binOuterMM(gridY, pitchY), R: BASE_CORNER_RADIUS };
  const plan = planWallMount(wallSystem, back,
    { method: mountMethod, slabMM: -BRIDGE_Z_BOTTOM, fit: clampFit(fitClearance) });
  if (!plan.fits || !plan.part) return null;
  const mesh = new MeshBuilder(512);
  plan.part.build(mesh);
  return { ...mesh.finish(-mesh.minZ()), name: plan.part.name, count: plan.part.count };
}

// ---------------------------------------------------------------------------
// End bin generator — wedge that fills the gap under the slanted bin.
//
// Surfaces: gridfinity base, the bridge slab under z=0, vertical outer
// walls trimmed by the slant plane, and an angled top cap.
//
// With `hollow`, a sealed cavity sits inside it: walls and the top cap keep
// `wallThickness` (the top measured square to the slant) and the floor is
// the bridge slab. The cavity is its own inward-facing shell, so the slicer
// leaves it empty instead of filling the wedge with infill. Where the wedge
// is too low for a cavity (its thin edge by the main bin) it stays solid.
//
// The slant plane rises from z=0 at the main bin's base edge to z=wallH
// at the far end of the offset.
// ---------------------------------------------------------------------------

// The cavity is left out where it would be lower than this
const MIN_CAVITY_MM = 1;

// Clip a CCW 2D polygon to lo <= p[k] <= hi; stays CCW (Sutherland-Hodgman)
function clipToSlab(poly, k, lo, hi) {
  const clip = (pts, keep, edge) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ina = keep(a[k]), inb = keep(b[k]);
      if (ina) out.push(a);
      if (ina !== inb) {
        const f = (edge - a[k]) / (b[k] - a[k]);
        out.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]);
      }
    }
    return out;
  };
  return clip(clip(poly, (c) => c >= lo, lo), (c) => c <= hi, hi);
}

export function generateEndBin({
  gridX = 2,
  gridY = 2,
  heightUnits = 12,
  offsetUnits = 2,
  offsetMM,
  offsetAxis = 'x',
  includeBase = true,
  cornerSegments = CORNER_SEGMENTS,
  endGridX = 2,
  endGridY = 2,
  hollow = true,
  wallThickness = 0.82,
  fitClearance = 0,
  gridMM = GRID_MM,
  divisions = 1,
} = {}) {
  const mesh = new MeshBuilder();
  const fit = clampFit(fitClearance);

  const mainOuterW = binOuterMM(gridX, gridMM);
  const mainOuterD = binOuterMM(gridY, gridMM);
  const wallH = interiorHeightMM(heightUnits);
  const totalOffset = Number.isFinite(offsetMM) ? Math.max(0, offsetMM) : offsetUnits * gridMM;

  const endOuterW = binOuterMM(endGridX, gridMM);
  const endOuterD = binOuterMM(endGridY, gridMM);

  // Position: end bin is one grid step away from the main bin, with
  // standard gridfinity spacing (TOLERANCE_MM = 0.5mm gap between bins).
  // The main bin outer edge is at mainOuter/2. The next grid cell starts
  // at mainOuter/2 + TOLERANCE_MM (the gap). The end bin is centered
  // within its grid cells starting from there.
  const gap = TOLERANCE_MM;
  let endCenterX = 0, endCenterY = 0;
  let mainEdge = 0;
  if (offsetAxis === 'x') {
    mainEdge = mainOuterW / 2;
    endCenterX = mainEdge + gap + endOuterW / 2;
  } else {
    mainEdge = mainOuterD / 2;
    endCenterY = mainEdge + gap + endOuterD / 2;
  }
  const endCenter = [endCenterX, endCenterY];

  // Slant plane for the wedge top surface.  The main bin's outer wall
  // plane goes from (mainEdge, z=0) to (mainEdge + totalOffset, z=wallH).
  // We shift the plane downward by exactly `gap` measured perpendicular
  // to the slant surface, so the wedge top maintains a uniform 0.5mm
  // clearance from the main bin's wall.
  //
  // Perpendicular offset of `gap` along the slant normal projects to
  // a Z reduction of  gap * slantLength / totalOffset.
  const slantLength = Math.sqrt(totalOffset * totalOffset + wallH * wallH);
  const zOffset = (totalOffset > 0) ? gap * slantLength / totalOffset : 0;

  function slantZ(x, y) {
    const coord = offsetAxis === 'x' ? x : y;
    return wallH * (coord - mainEdge) / totalOffset - zOffset;
  }

  // --- BASE ---
  if (includeBase) {
    addFeet(mesh, endGridX, endGridY, endCenter, cornerSegments, gridMM, divisions, false, fit);
  }

  // --- SOLID WEDGE (z=0 to slant plane) ---

  // Bottom ring at z=0
  const outerBottom = makeRing(
    0, endOuterW, endOuterD, BASE_CORNER_RADIUS, endCenter, cornerSegments
  );

  // Top ring: each vertex projected up to the slant plane
  // (capped at the wall top, where the slant ends, for end bins longer than the offset)
  const outerTop = outerBottom.map(([x, y]) => [x, y, Math.min(wallH, Math.max(0, slantZ(x, y)))]);

  // One closed shell: floor slab (z=-2.25 to 0), outer walls (vertical
  // sides, top edge follows slant) and the top cap below
  addBridge(mesh, endOuterW, endOuterD, endCenter, cornerSegments, outerBottom);
  addStrip(mesh, outerBottom, outerTop);

  // Solid angled top cap (normal facing up/outward along slant)
  // Fan from the centroid of the top ring
  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of outerTop) { cx += x; cy += y; cz += z; }
  const n = outerTop.length;
  const topCenter = [cx / n, cy / n, cz / n];
  addFan(mesh, outerTop, topCenter, false);

  if (hollow && totalOffset > 0) addEndBinCavity(mesh, {
    endOuterW, endOuterD, endCenter, wallH, cornerSegments, t: wallThickness,
    k: offsetAxis === 'x' ? 0 : 1,
    // The cavity ceiling: the slant plane, `t` lower measured square to it
    ceilingZ: (x, y) => slantZ(x, y) - wallThickness * slantLength / totalOffset,
    // Coordinate along the offset where that ceiling reaches height z
    coordAt: (z) => mainEdge + (z + zOffset + wallThickness * slantLength / totalOffset) * totalOffset / wallH,
  });

  return mesh.finish(plateShift(includeBase));
}

// The end bin's cavity: the inner outline (the outer one `t` in) clipped to
// where the ceiling stands at least MIN_CAVITY_MM above the floor (z = 0) and
// stays a plane (below the flat top at wallH - t). Faces point into it.
function addEndBinCavity(mesh, { endOuterW, endOuterD, endCenter, wallH, cornerSegments, t, k, ceilingZ, coordAt }) {
  const innerW = endOuterW - 2 * t;
  const innerD = endOuterD - 2 * t;
  if (innerW <= 0 || innerD <= 0 || wallH - t <= MIN_CAVITY_MM) return;
  const halfAngle = Math.PI / (4 * cornerSegments);
  const innerR = Math.max(0.01, BASE_CORNER_RADIUS - t / Math.cos(halfAngle));
  const outline = clipToSlab(
    roundedRectPoints(innerW, innerD, innerR, cornerSegments, endCenter[0], endCenter[1]),
    k, coordAt(MIN_CAVITY_MM), coordAt(wallH - t),
  );
  if (outline.length < 3) return;

  const floor = outline.map(([x, y]) => [x, y, 0]);
  const ceiling = outline.map(([x, y]) => [x, y, ceilingZ(x, y)]);
  const centre = (ring) => ring.reduce((c, p) => [c[0] + p[0] / ring.length, c[1] + p[1] / ring.length, c[2] + p[2] / ring.length], [0, 0, 0]);
  addFan(mesh, floor, centre(floor), false);
  addStrip(mesh, floor, ceiling, true);
  addFan(mesh, ceiling, centre(ceiling), true);
}
