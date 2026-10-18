/**
 * wall-mounts.js — The mating surface on the back of a wall-mounted bin, one
 * builder per wall system.
 *
 * Wall frame: the bin's back face is the plane d = 0, centred on u = v = 0;
 * u runs across it (world Y), v up the wall (world Z), d from the back face
 * toward the wall (world -X). The back face is W wide and H tall with
 * corners of radius R. Every part is its own closed shell touching the back
 * face, as the Gridfinity feet touch the floor slab.
 *
 * Dimensions are the systems' published interfaces, re-implemented here (no
 * code is copied from the sources named below):
 *   Multiconnect   slot by David D (CC BY): back-slot drawing and v2 files
 *   SKÅDIS         IKEA pegboard: 5 × 15 mm slots, 40 mm apart; hook after
 *                  skadisgen's "Normal" peg (Apache-2.0)
 *   HSW            Honeycomb Storage Wall by RostaP: the peg that presses
 *                  into his printed insert, measured from his screwless box
 *   GOEWS          by MrExo3D (CC BY): the accessory hanger, as in
 *                  jimfunk's goews-rebuilt-openscad
 *   French cleat   45° hook for 19 mm (3/4") plywood cleats, as in
 *                  atiretoo's french_cleats
 */

import { loft, circlePoints, stadiumPoints, hexPoints } from './mesh-shapes.js';

// (u, v, d) in the wall frame → world
const wallPoint = (u, v, d) => [-d, u, v];

// `n` positions `pitch` apart, centred on 0.
function centred(n, pitch) {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
}

function arc(pts, cx, cy, r, a0, a1, segments) {
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (i / segments) * (a1 - a0);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
}

// ---------------------------------------------------------------------------
// Multiconnect (openGrid, Multiboard): a plate with dovetail slots, open at
// the bottom, closed by a round end at the stop. The bin lowers onto
// connectors in the board and slides down until the dot clicks into them.
// ---------------------------------------------------------------------------

const MC = {
  neckHalf: 7.65,       // half the slot opening at the board face
  headHalf: 10.15,      // half the slot width under the dovetail
  lipDepth: 0.4379,     // straight lip before the 45° dovetail
  dovetailEnd: 2.9379,  // depth where the dovetail reaches headHalf
  depth: 4.15,          // slot depth = plate thickness; the floor slab backs it
  stopBelowTop: 13,     // centre of the round end, below the back's top edge
  dotRadius: 1.0,       // detent dot on the slot floor at the stop
  dotHeight: 1.0,
  endSegments: 16,
};

// The plate's section at slot half-width w: the back's outline with a notch
// up from the bottom edge to a round end at each slot. CCW.
function notchedOutline({ W, H, R }, centres, w, stopV) {
  const hw = W / 2, hh = H / 2, cs = 8;
  const pts = [];
  arc(pts, -hw + R, -hh + R, R, Math.PI, 1.5 * Math.PI, cs);
  for (const uc of centres) {
    pts.push([uc - w, -hh]);
    arc(pts, uc, stopV, w, Math.PI, 0, MC.endSegments);
    pts.push([uc + w, -hh]);
  }
  arc(pts, hw - R, -hh + R, R, 1.5 * Math.PI, 2 * Math.PI, cs);
  arc(pts, hw - R, hh - R, R, 0, 0.5 * Math.PI, cs);
  arc(pts, -hw + R, hh - R, R, 0.5 * Math.PI, Math.PI, cs);
  return pts;
}

function multiconnect(sink, back, pitch) {
  const { W, H, R } = back;
  const n = Math.floor((W - 2 * R - 2 * MC.headHalf) / pitch) + 1;
  if (n < 1 || H < MC.stopBelowTop + 2) {
    return { fits: false, text: `needs a back at least ${(2 * (R + MC.headHalf)).toFixed(0)} mm wide` };
  }
  const centres = centred(n, pitch);
  const stopV = H / 2 - MC.stopBelowTop;
  const section = (d, w) => ({ t: d, contour: notchedOutline(back, centres, w, stopV) });
  // From the board face (d = depth) in to the slot floor on the back (d = 0)
  loft(sink, [
    section(MC.depth, MC.neckHalf),
    section(MC.depth - MC.lipDepth, MC.neckHalf),
    section(MC.depth - MC.dovetailEnd, MC.headHalf),
    section(0, MC.headHalf),
  ], wallPoint);
  for (const uc of centres) {
    loft(sink, [
      { t: 0, contour: circlePoints(uc, stopV, MC.dotRadius, 16) },
      { t: MC.dotHeight, contour: circlePoints(uc, stopV, 0.05, 16) },
    ], wallPoint);
  }
  return { fits: true, text: `${n} slot${n > 1 ? 's' : ''}, ${pitch} mm apart` };
}

// ---------------------------------------------------------------------------
// IKEA SKÅDIS: hooks that go through the board's slots and drop to lock.
// ---------------------------------------------------------------------------

const SKADIS = {
  pitch: 40,         // slot centres along a row; the same column repeats every 40
  halfWidth: 2.15,   // hook is 4.3 across the 5 mm slot, with round top and bottom
  shaftLength: 5.2,  // through the 5 mm board
  headLength: 5.0,   // behind the board
  shaftHeight: 7.25,
  headDrop: 6.36,    // how far the head hangs below the shaft
  margin: 2,         // from the back's top and bottom edges
};

function skadis(sink, { W, H, R }) {
  const k = SKADIS;
  const n = Math.floor((W - 2 * R - 2 * k.halfWidth) / k.pitch) + 1;
  const rows = [];
  for (let vb = H / 2 - k.margin - k.shaftHeight; vb - k.headDrop >= -H / 2 + k.margin; vb -= k.pitch) {
    rows.push(vb);
  }
  if (n < 1 || rows.length < 1) return { fits: false, text: 'back too small for a hook' };
  for (const vb of rows) {
    for (const uc of centred(n, k.pitch)) {
      const shaft = stadiumPoints(uc, vb, vb + k.shaftHeight, k.halfWidth);
      const head = stadiumPoints(uc, vb - k.headDrop, vb + k.shaftHeight, k.halfWidth);
      loft(sink, [{ t: 0, contour: shaft }, { t: k.shaftLength, contour: shaft }], wallPoint);
      loft(sink, [
        { t: k.shaftLength, contour: head },
        { t: k.shaftLength + k.headLength, contour: head },
      ], wallPoint);
    }
  }
  const count = n * rows.length;
  return { fits: true, text: `${count} hook${count > 1 ? 's' : ''}, ${k.pitch} mm apart` };
}

// ---------------------------------------------------------------------------
// Honeycomb Storage Wall: tapered hex pegs that press into RostaP's printed
// inserts, which click into the board's cells.
// ---------------------------------------------------------------------------

const HSW = {
  pitchAcross: 40.877,  // between cells at the same height (every other column)
  pitchUp: 47.2,        // two cells up the same column (23.6 each)
  // [distance from the back, apothem]: straight, a light taper, a tip chamfer
  profile: [[0, 6.725], [2.9, 6.725], [4.9, 6.65], [6.9, 6.57], [7.5, 6.545], [8.0, 6.13]],
  cornerHalf: 7.765,    // half the peg across its corners
};

function hsw(sink, { W, H, R }) {
  const k = HSW;
  const apothem = k.profile[0][1];
  const n = Math.floor((W - 2 * R - 2 * k.cornerHalf) / k.pitchAcross) + 1;
  const rows = [];
  for (let vc = H / 2 - R - apothem; vc >= -H / 2 + R + apothem; vc -= k.pitchUp) rows.push(vc);
  if (n < 1 || rows.length < 1) return { fits: false, text: 'back too small for a peg' };
  for (const vc of rows) {
    for (const uc of centred(n, k.pitchAcross)) {
      loft(sink, k.profile.map(([d, a]) => ({ t: d, contour: hexPoints(uc, vc, a) })), wallPoint);
    }
  }
  const count = n * rows.length;
  return { fits: true, text: `${count} peg${count > 1 ? 's' : ''} for HSW inserts` };
}

// ---------------------------------------------------------------------------
// GOEWS: a tab per 42 mm unit with V-pointed sides. It drops into a tile's
// window and slides down until the tile's 45° cleats capture its edges.
// ---------------------------------------------------------------------------

const GOEWS = {
  pitch: 42,
  topBelowBackTop: 11.24,  // hanger top, below the back's top edge
  height: 13.15,
  tolerance: 0.15,         // the hanger starts this far behind the back
  bodyDepth: 5,
  // Half-width at the back face, the V point, and the tile's back face
  halfBody: 15.1,
  halfPoint: 17.6,
  notchRadius: 9.5,        // top notch that clears the tile's bolt boss
  notchCentreAbove: 16,    // notch centre, above the hanger bottom
};

function goewsSection(uc, vb, d, halfWidth) {
  const k = GOEWS;
  const vMin = vb + Math.max(0, d - k.tolerance);   // 45° bevel on the wall side of the bottom
  const top = vb + k.height;
  const cy = vb + k.notchCentreAbove;
  const xi = Math.sqrt(k.notchRadius ** 2 - (top - cy) ** 2);
  const pts = [[uc - halfWidth, vMin], [uc + halfWidth, vMin], [uc + halfWidth, top]];
  const a0 = Math.atan2(top - cy, xi);
  arc(pts, uc, cy, k.notchRadius, a0, -Math.PI - a0, 16);
  pts.push([uc - halfWidth, top]);
  return pts;
}

function goews(sink, { W, H }) {
  const k = GOEWS;
  const n = Math.floor((W + 0.5) / k.pitch);
  const top = H / 2 - k.topBelowBackTop;
  if (n < 1 || top - k.height < -H / 2) return { fits: false, text: 'needs a back at least 41.5 mm wide' };
  const t = k.tolerance, end = t + k.bodyDepth;
  for (const uc of centred(n, k.pitch)) {
    const vb = top - k.height;
    loft(sink, [
      { t: 0, contour: goewsSection(uc, vb, 0, k.halfBody) },
      { t, contour: goewsSection(uc, vb, t, k.halfBody) },
      { t: t + (k.halfPoint - k.halfBody), contour: goewsSection(uc, vb, t + (k.halfPoint - k.halfBody), k.halfPoint) },
      { t: end, contour: goewsSection(uc, vb, end, k.halfBody) },
    ], wallPoint);
  }
  return { fits: true, text: `${n} hanger${n > 1 ? 's' : ''}, ${k.pitch} mm apart` };
}

// ---------------------------------------------------------------------------
// French cleat: a 45° hook block across the top of the back that drops over
// a 19 mm wall cleat, and a spacer at the bottom so a tall bin hangs plumb.
// ---------------------------------------------------------------------------

const CLEAT = {
  thickness: 19,     // wall cleat thickness = how far the back stands off the wall
  above: 20,         // hook top, above the wall cleat's front-top edge
  drop: 17,          // tongue depth below that edge, along the 45° face
  tip: 2,            // blunt tip at the tongue
  wallCleatHeight: 73,
  spacerHeight: 20,
  spacerChamfer: 5,
};

function frenchCleat(sink, { W, H, R }) {
  const k = CLEAT;
  if (H < k.above + k.drop) return { fits: false, text: `needs a back at least ${k.above + k.drop} mm tall` };
  const edge = H / 2 - k.above;
  const across = (a, b, t) => wallPoint(t, b, a);  // section in (d, v), swept along u
  const u0 = -W / 2 + R, u1 = W / 2 - R;
  const hook = [
    [0, edge], [k.thickness - k.tip, edge - k.drop], [k.thickness, edge - k.drop],
    [k.thickness, edge + k.above], [0, edge + k.above],
  ];
  loft(sink, [{ t: u0, contour: hook }, { t: u1, contour: hook }], across);

  // Spacer below the wall cleat, only when the back reaches past it
  const vb = -H / 2;
  const vt = Math.min(vb + k.spacerHeight, edge - k.wallCleatHeight - 1);
  let text = 'hook for a 19 mm cleat';
  if (vt - vb >= k.spacerChamfer + 1) {
    const spacer = [
      [0, vb], [k.thickness - k.spacerChamfer, vb], [k.thickness, vb + k.spacerChamfer],
      [k.thickness, vt], [0, vt],
    ];
    loft(sink, [{ t: u0, contour: spacer }, { t: u1, contour: spacer }], across);
    text += ' and a spacer';
  }
  return { fits: true, text };
}

// ---------------------------------------------------------------------------
// Registry. 'gridfinity' keeps the base feet (with magnet holes), so it has
// no builder here.
// ---------------------------------------------------------------------------

export const WALL_SYSTEMS = {
  gridfinity: { label: 'Gridfinity wall plate' },
  opengrid:   { label: 'openGrid (Multiconnect)', build: (s, b) => multiconnect(s, b, 28) },
  multiboard: { label: 'Multiboard (Multiconnect)', build: (s, b) => multiconnect(s, b, 25) },
  skadis:     { label: 'IKEA SKÅDIS', build: skadis },
  hsw:        { label: 'Honeycomb Storage Wall', build: hsw },
  goews:      { label: 'GOEWS', build: goews },
  cleat:      { label: 'French cleat', build: frenchCleat },
};

export const DEFAULT_WALL_SYSTEM = 'opengrid';

// Add the mount for `system` behind a back face { W, H, R }. Returns
// { fits, text } describing what was added (or why nothing fits).
export function addWallMount(sink, system, back) {
  const entry = WALL_SYSTEMS[system];
  if (!entry?.build) return { fits: true, text: '' };
  return entry.build(sink, back);
}
