/**
 * gridfinity-geometry.js — Slanted Gridfinity bin mesh generation.
 *
 * Generates watertight triangle meshes for:
 *   1. A slanted bin (top cross-section offset from bottom)
 *   2. An optional end bin (wedge that fills the gap under the slant)
 *
 * Key constraint: wall thickness in the XY plane is maintained at every Z level
 * (matches 3D printer layer-line width requirement).
 *
 * Coordinate convention (matches kennetek/gridfinity-rebuilt-openscad):
 *   - Interior floor at Z = 0
 *   - Base extends below to Z = -BASE_HEIGHT_MM (-7.0 mm)
 *   - Z-up, XY is the grid plane
 *   - Main bin centered at XY origin (at the base)
 */

// ---------------------------------------------------------------------------
// Gridfinity spec constants (from kennetek/gridfinity-rebuilt-openscad)
// ---------------------------------------------------------------------------

export const GRID_MM = 42.0;
export const TOLERANCE_MM = 0.5;
export const SPEC_WALL_MM = 0.95;
export const BASE_HEIGHT_MM = 7.0;
export const HEIGHT_UNIT_MM = 7.0;
export const BASE_CORNER_RADIUS = 3.75;
export const XY_CLEARANCE_MM = 0.25;
export const UNIT_BASE_TOP_MM = 41.5;

// Base profile: [height_from_base_bottom, inset_from_unit_base_top]
const BASE_UNIT_PROFILE_LEVELS = [
  { dz: 0.0,  inset: 2.95 },
  { dz: 0.8,  inset: 2.15 },
  { dz: 2.6,  inset: 2.15 },
  { dz: 4.75, inset: 0.0  },
];

const BRIDGE_Z_BOTTOM = -BASE_HEIGHT_MM + 4.75; // = -2.25

// ---------------------------------------------------------------------------
// Dimension helpers
// ---------------------------------------------------------------------------

export function binOuterMM(units) {
  return GRID_MM * units - TOLERANCE_MM;
}

export function interiorHeightMM(hUnits) {
  return HEIGHT_UNIT_MM * hUnits - BASE_HEIGHT_MM;
}

export function interiorWidthMM(units, wallT) {
  return binOuterMM(units) - 2 * wallT;
}

// ---------------------------------------------------------------------------
// Rounded rectangle perimeter (CCW winding from +Z)
// ---------------------------------------------------------------------------

function roundedRectPoints(width, height, radius, segments = 8) {
  const pts = [];
  const hw = width / 2, hh = height / 2;
  const r = Math.max(0.01, Math.min(radius, hw, hh));

  const corners = [
    { cx:  (hw - r), cy: -(hh - r), a0: -Math.PI / 2, a1: 0 },
    { cx:  (hw - r), cy:  (hh - r), a0: 0,             a1: Math.PI / 2 },
    { cx: -(hw - r), cy:  (hh - r), a0: Math.PI / 2,   a1: Math.PI },
    { cx: -(hw - r), cy: -(hh - r), a0: Math.PI,       a1: 3 * Math.PI / 2 },
  ];

  for (const { cx, cy, a0, a1 } of corners) {
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const a = a0 + t * (a1 - a0);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }

  return pts;
}

// ---------------------------------------------------------------------------
// Triangle helpers
// ---------------------------------------------------------------------------

function triNormal(v1, v2, v3) {
  const ax = v2[0] - v1[0], ay = v2[1] - v1[1], az = v2[2] - v1[2];
  const bx = v3[0] - v1[0], by = v3[1] - v1[1], bz = v3[2] - v1[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// ---------------------------------------------------------------------------
// Shared mesh builder helpers
// ---------------------------------------------------------------------------

function makeRing(z, w, h, r, offset, cornerSegments) {
  const pts2d = roundedRectPoints(w, h, r, cornerSegments);
  return pts2d.map(([x, y]) => [x + offset[0], y + offset[1], z]);
}

function addStrip(tris, ring1, ring2, flip = false) {
  const n = ring1.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!flip) {
      tris.push({ v1: ring1[i], v2: ring1[j], v3: ring2[j] });
      tris.push({ v1: ring1[i], v2: ring2[j], v3: ring2[i] });
    } else {
      tris.push({ v1: ring1[i], v2: ring2[j], v3: ring1[j] });
      tris.push({ v1: ring1[i], v2: ring2[i], v3: ring2[j] });
    }
  }
}

function addFan(tris, ring, center, flip = false) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!flip) {
      tris.push({ v1: center, v2: ring[i], v3: ring[j] });
    } else {
      tris.push({ v1: center, v2: ring[j], v3: ring[i] });
    }
  }
}

function addRingFace(tris, outerRing, innerRing, flip = false) {
  const n = outerRing.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!flip) {
      tris.push({ v1: outerRing[i], v2: outerRing[j], v3: innerRing[j] });
      tris.push({ v1: outerRing[i], v2: innerRing[j], v3: innerRing[i] });
    } else {
      tris.push({ v1: outerRing[i], v2: innerRing[j], v3: outerRing[j] });
      tris.push({ v1: outerRing[i], v2: innerRing[i], v3: innerRing[j] });
    }
  }
}

// Flatten tris array to Float32Arrays
function flattenTris(tris) {
  const numTris = tris.length;
  const positions = new Float32Array(numTris * 9);
  const normals = new Float32Array(numTris * 9);

  for (let i = 0; i < numTris; i++) {
    const { v1, v2, v3 } = tris[i];
    const n = triNormal(v1, v2, v3);
    const idx = i * 9;
    positions[idx]     = v1[0]; positions[idx + 1] = v1[1]; positions[idx + 2] = v1[2];
    positions[idx + 3] = v2[0]; positions[idx + 4] = v2[1]; positions[idx + 5] = v2[2];
    positions[idx + 6] = v3[0]; positions[idx + 7] = v3[1]; positions[idx + 8] = v3[2];
    for (let j = 0; j < 3; j++) {
      normals[idx + j * 3]     = n[0];
      normals[idx + j * 3 + 1] = n[1];
      normals[idx + j * 3 + 2] = n[2];
    }
  }

  return { positions, normals, triangleCount: numTris };
}

// ---------------------------------------------------------------------------
// Shared gridfinity base generation (per-unit feet + bridge)
// ---------------------------------------------------------------------------

function generateBase(tris, gridX, gridY, outerW, outerD, centerOffset, cornerSegments) {
  const [cox, coy] = centerOffset;

  // Per-unit base feet
  for (let ix = 0; ix < gridX; ix++) {
    for (let iy = 0; iy < gridY; iy++) {
      const cx = cox + (ix - (gridX - 1) / 2) * GRID_MM;
      const cy = coy + (iy - (gridY - 1) / 2) * GRID_MM;

      const unitRings = [];
      for (const { dz, inset } of BASE_UNIT_PROFILE_LEVELS) {
        const z = -BASE_HEIGHT_MM + dz;
        const w = UNIT_BASE_TOP_MM - 2 * inset;
        const h = UNIT_BASE_TOP_MM - 2 * inset;
        const r = Math.max(0.01, BASE_CORNER_RADIUS - inset);
        unitRings.push(makeRing(z, w, h, r, [cx, cy], cornerSegments));
      }

      addFan(tris, unitRings[0], [cx, cy, -BASE_HEIGHT_MM], true);

      for (let i = 0; i < unitRings.length - 1; i++) {
        addStrip(tris, unitRings[i], unitRings[i + 1]);
      }

      const topZ = -BASE_HEIGHT_MM + 4.75;
      addFan(tris, unitRings[unitRings.length - 1], [cx, cy, topZ], false);
    }
  }

  // Bridge section
  const bridgeBottom = makeRing(
    BRIDGE_Z_BOTTOM, outerW, outerD, BASE_CORNER_RADIUS, centerOffset, cornerSegments
  );
  addFan(tris, bridgeBottom, [cox, coy, BRIDGE_Z_BOTTOM], true);

  return bridgeBottom; // caller uses this to connect bridge walls to z=0
}

// ---------------------------------------------------------------------------
// Main slanted bin generator
// ---------------------------------------------------------------------------

export function generateSlantedBin({
  gridX = 2,
  gridY = 2,
  heightUnits = 7,
  offsetUnits = 2,
  offsetAxis = 'x',
  wallThickness = 0.82,
  includeBase = true,
  cornerSegments = 8,
} = {}) {
  const tris = [];

  const outerW = binOuterMM(gridX);
  const outerD = binOuterMM(gridY);
  const wallH = interiorHeightMM(heightUnits);
  const totalOffset = offsetUnits * GRID_MM;
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
    generateBase(tris, gridX, gridY, outerW, outerD, [0, 0], cornerSegments);
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

  // Bridge walls from z=-2.25 to z=0
  if (includeBase) {
    const bridgeBottom = makeRing(
      BRIDGE_Z_BOTTOM, outerW, outerD, BASE_CORNER_RADIUS, [0, 0], cornerSegments
    );
    addStrip(tris, bridgeBottom, wallOuterBottom);
  }

  addStrip(tris, wallOuterBottom, wallOuterTop);
  addStrip(tris, wallInnerBottom, wallInnerTop, true);

  // Solid floor at z=0
  const floorCenter = [getOffset(0)[0], getOffset(0)[1], 0];
  addFan(tris, wallOuterBottom, floorCenter, false);

  // Top rim
  addRingFace(tris, wallOuterTop, wallInnerTop, false);

  // --- Flatten & dimensions ---
  const result = flattenTris(tris);

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
      totalHeight: BASE_HEIGHT_MM + wallH,
      interiorHeight: wallH,
      baseHeight: BASE_HEIGHT_MM,
      totalOffset,
      slantAngleDeg,
      slantDiagonal,
      maxPenLength,
      wallThickness: t,
    },
  };
}

// ---------------------------------------------------------------------------
// End bin generator — solid wedge that fills the gap under the slanted bin.
//
// This is a SOLID volume (not hollow). The slicer handles infill.
// Surfaces: gridfinity base, solid floor at z=0, vertical outer walls
// trimmed by the slant plane, and a solid angled top cap.
//
// The slant plane rises from z=0 at the main bin's base edge to z=wallH
// at the far end of the offset.
// ---------------------------------------------------------------------------

export function generateEndBin({
  gridX = 2,
  gridY = 2,
  heightUnits = 7,
  offsetUnits = 2,
  offsetAxis = 'x',
  wallThickness = 0.82,
  includeBase = true,
  cornerSegments = 8,
  endGridX = 2,
  endGridY = 2,
} = {}) {
  const tris = [];

  const mainOuterW = binOuterMM(gridX);
  const mainOuterD = binOuterMM(gridY);
  const wallH = interiorHeightMM(heightUnits);
  const totalOffset = offsetUnits * GRID_MM;

  const endOuterW = binOuterMM(endGridX);
  const endOuterD = binOuterMM(endGridY);

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
    generateBase(tris, endGridX, endGridY, endOuterW, endOuterD, endCenter, cornerSegments);
  }

  // --- SOLID WEDGE (z=0 to slant plane) ---

  // Bottom ring at z=0
  const outerBottom = makeRing(
    0, endOuterW, endOuterD, BASE_CORNER_RADIUS, endCenter, cornerSegments
  );

  // Top ring: each vertex projected up to the slant plane
  const outerTop = outerBottom.map(([x, y]) => [x, y, Math.max(0, slantZ(x, y))]);

  // Bridge walls from z=-2.25 to z=0
  if (includeBase) {
    const bridgeBottom = makeRing(
      BRIDGE_Z_BOTTOM, endOuterW, endOuterD, BASE_CORNER_RADIUS, endCenter, cornerSegments
    );
    addStrip(tris, bridgeBottom, outerBottom);
  }

  // Outer walls (vertical sides, top edge follows slant)
  addStrip(tris, outerBottom, outerTop);

  // Solid floor at z=0 (normal +z)
  addFan(tris, outerBottom, [endCenterX, endCenterY, 0], false);

  // Solid angled top cap (normal facing up/outward along slant)
  // Fan from the centroid of the top ring
  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of outerTop) { cx += x; cy += y; cz += z; }
  const n = outerTop.length;
  const topCenter = [cx / n, cy / n, cz / n];
  addFan(tris, outerTop, topCenter, false);

  return flattenTris(tris);
}
