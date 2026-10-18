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

function addFeet(mesh, gridX, gridY, centerOffset, cornerSegments, gridMM, divisions, magnets = false, fit = 0) {
  const [cox, coy] = centerOffset;
  const pitch = gridMM / divisions;
  const footTop = pitch - TOLERANCE_MM;
  const feetX = Math.max(1, Math.round(gridX * divisions));
  const feetY = Math.max(1, Math.round(gridY * divisions));

  for (let ix = 0; ix < feetX; ix++) {
    for (let iy = 0; iy < feetY; iy++) {
      const cx = cox + (ix - (feetX - 1) / 2) * pitch;
      const cy = coy + (iy - (feetY - 1) / 2) * pitch;

      if (magnets) {
        // Holes that sit fully on the foot's flat underside
        const reach = footTop / 2 - footInset(BASE_UNIT_PROFILE_LEVELS[0].inset, fit) - (MAGNET_RADIUS + fit) - 0.4;
        const holes = [];
        for (const mx of magnetPositions(gridX, gridMM)) {
          for (const my of magnetPositions(gridY, gridMM)) {
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

export function generateSlantedBin({
  gridX = 2,
  gridY = 2,
  heightUnits = 12,
  offsetUnits = 2,
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
} = {}) {
  const mesh = new MeshBuilder();
  const fit = clampFit(fitClearance);

  // On a wall the bin is built as usual with its slant along local X, then
  // turned: local X (the slant) goes up, local Z (the height) out from the
  // wall. gridX is then the width across the wall and gridY the height up it.
  const vertical = orientation === 'vertical';
  if (vertical) {
    if (!WALL_SYSTEMS[wallSystem]) wallSystem = DEFAULT_WALL_SYSTEM;
    [gridX, gridY] = [gridY, gridX];
    offsetAxis = 'x';
    includeBase = wallSystem === 'gridfinity';
  }

  const outerW = binOuterMM(gridX, gridMM);
  const outerD = binOuterMM(gridY, gridMM);
  const wallH = interiorHeightMM(heightUnits);
  const totalOffset = offsetUnits * gridMM;
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

  // One closed shell: floor slab (z=-2.25 to 0), outer wall, rim, inner
  // wall, and the interior floor inside the inner wall at z=0
  if (floorHoles.length) {
    const flat = (ring) => ring.map(([x, y]) => [x, y]);
    const at = (x, y, z) => [x, y, z];
    const bottom = makeRing(BRIDGE_Z_BOTTOM, outerW, outerD, BASE_CORNER_RADIUS, [0, 0], cornerSegments);
    writeCap(mesh, flat(bottom), floorHoles, at, BRIDGE_Z_BOTTOM, false);
    addStrip(mesh, bottom, wallOuterBottom);
    for (const hole of floorHoles) writeHoleWall(mesh, hole, at, BRIDGE_Z_BOTTOM, 0);
  } else {
    addBridge(mesh, outerW, outerD, [0, 0], cornerSegments, wallOuterBottom);
  }
  addStrip(mesh, wallOuterBottom, wallOuterTop);
  addRingFace(mesh, wallOuterTop, wallInnerTop);
  addStrip(mesh, wallInnerBottom, wallInnerTop, true);
  if (floorHoles.length) {
    writeCap(mesh, wallInnerBottom.map(([x, y]) => [x, y]), floorHoles, (x, y, z) => [x, y, z], 0, true);
  } else {
    const floorCenter = [getOffset(0)[0], getOffset(0)[1], 0];
    addFan(mesh, wallInnerBottom, floorCenter, false);
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
  const spanOffset = totalOffset + (offsetAxis === 'x' ? innerW : innerD);
  const spanCross = offsetAxis === 'x' ? innerD : innerW;
  const maxPenLength = Math.sqrt(
    spanOffset * spanOffset + spanCross * spanCross + wallH * wallH
  );

  return {
    ...result,
    dimensions: {
      outerWidth: outerW,
      outerDepth: outerD,
      innerWidth: innerW,
      innerDepth: innerD,
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
  wallSystem = DEFAULT_WALL_SYSTEM,
  mountMethod = null,
  fitClearance = 0,
} = {}) {
  // The same back face as the vertical bin: gridX across the wall, gridY up it
  const back = { W: binOuterMM(gridX, gridMM), H: binOuterMM(gridY, gridMM), R: BASE_CORNER_RADIUS };
  const plan = planWallMount(wallSystem, back,
    { method: mountMethod, slabMM: -BRIDGE_Z_BOTTOM, fit: clampFit(fitClearance) });
  if (!plan.fits || !plan.part) return null;
  const mesh = new MeshBuilder(512);
  plan.part.build(mesh);
  return { ...mesh.finish(-mesh.minZ()), name: plan.part.name, count: plan.part.count };
}

// ---------------------------------------------------------------------------
// End bin generator — solid wedge that fills the gap under the slanted bin.
//
// This is a SOLID volume (not hollow). The slicer handles infill.
// Surfaces: gridfinity base, the bridge slab under z=0, vertical outer
// walls trimmed by the slant plane, and a solid angled top cap.
//
// The slant plane rises from z=0 at the main bin's base edge to z=wallH
// at the far end of the offset.
// ---------------------------------------------------------------------------

export function generateEndBin({
  gridX = 2,
  gridY = 2,
  heightUnits = 12,
  offsetUnits = 2,
  offsetAxis = 'x',
  includeBase = true,
  cornerSegments = CORNER_SEGMENTS,
  endGridX = 2,
  endGridY = 2,
  fitClearance = 0,
  gridMM = GRID_MM,
  divisions = 1,
} = {}) {
  const mesh = new MeshBuilder();
  const fit = clampFit(fitClearance);

  const mainOuterW = binOuterMM(gridX, gridMM);
  const mainOuterD = binOuterMM(gridY, gridMM);
  const wallH = interiorHeightMM(heightUnits);
  const totalOffset = offsetUnits * gridMM;

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

  return mesh.finish(plateShift(includeBase));
}
