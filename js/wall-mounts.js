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
 * A system's plan says what the bin needs: shells to add behind the back,
 * holes to cut through the back into the bin (for screws and hooks that
 * reach inside), and optionally a separate small part to print, such as a
 * peg printed flat so its layers run along the hook.
 *
 * `fit` is extra clearance in mm per side on every mating surface (positive
 * = looser): slots, channels and holes on the bin grow by it, and pegs,
 * hooks and hangers shrink by it, against the board or the bin. 0 keeps
 * each system's published fit. The French cleat mates with wood, so it
 * ignores it.
 *
 * Dimensions are the systems' published interfaces, re-implemented here (no
 * code is copied from the sources named below):
 *   Multiconnect   slot by David D (CC BY): back-slot drawing and v2 files
 *   SKÅDIS         IKEA pegboard: 5 × 15 mm slots, 40 mm apart. Moulded
 *                  hook after skadisgen's "Normal" peg (Apache-2.0);
 *                  dovetail channel and peg after dtphantom's Skadis
 *                  Dovetail Peg System (CC BY); screw holes for 6d6178's
 *                  Skadis T-Nuts (CC BY); hook holes on CSD_Salzburg's
 *                  Universal Hook pattern
 *   HSW            Honeycomb Storage Wall by RostaP: the peg that presses
 *                  into his printed insert, measured from his screwless box
 *
 * Anything that stands out of the back can't print with the back on the
 * bed without supports, and a hook printed that way has its layers across
 * its load. So each system that needs such a feature also offers it as a
 * separate part that prints flat and slides into a channel or slot cut into
 * the back (a dovetail narrowing toward the board face, which prints
 * back-down without supports). The moulded version stays as an option.
 *   GOEWS          by MrExo3D (CC BY): the accessory hanger, as in
 *                  jimfunk's goews-rebuilt-openscad
 *   French cleat   45° hook for 19 mm (3/4") plywood cleats, as in
 *                  atiretoo's french_cleats
 */

import { loft, circlePoints, stadiumPoints, hexPoints, rectPoints } from './mesh-shapes.js';

// (u, v, d) in the wall frame → world
const wallPoint = (u, v, d) => [-d, u, v];

// `n` positions `pitch` apart, centred on 0.
function centred(n, pitch) {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
}

// The back's outline: W x H with corners of radius R, centred on 0. CCW.
function backOutline({ W, H, R }, segments = 8) {
  const pts = [];
  arc(pts, W / 2 - R, -H / 2 + R, R, 1.5 * Math.PI, 2 * Math.PI, segments);
  arc(pts, W / 2 - R, H / 2 - R, R, 0, 0.5 * Math.PI, segments);
  arc(pts, -W / 2 + R, H / 2 - R, R, 0.5 * Math.PI, Math.PI, segments);
  arc(pts, -W / 2 + R, -H / 2 + R, R, Math.PI, 1.5 * Math.PI, segments);
  return pts;
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

function multiconnect(sink, back, pitch, fit = 0) {
  const { W, H, R } = back;
  const neck = MC.neckHalf + fit, head = MC.headHalf + fit;
  const n = Math.floor((W - 2 * R - 2 * head) / pitch) + 1;
  if (n < 1 || H < MC.stopBelowTop + 2) {
    return { fits: false, text: `needs a back at least ${(2 * (R + head)).toFixed(0)} mm wide` };
  }
  const centres = centred(n, pitch);
  const stopV = H / 2 - MC.stopBelowTop;
  const section = (d, w) => ({ t: d, contour: notchedOutline(back, centres, w, stopV) });
  // From the board face (d = depth) in to the slot floor on the back (d = 0)
  loft(sink, [
    section(MC.depth, neck),
    section(MC.depth - MC.lipDepth, neck),
    section(MC.depth - MC.dovetailEnd, head),
    section(0, head),
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
// IKEA SKÅDIS. The bin prints with its back on the bed, so anything standing
// out of the back needs supports and has its layers across the hook. The
// methods other than 'hooks' keep the back flat and put what enters the
// board in a separate part.
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


// Columns `pitch` apart that keep a part `width` wide clear of the corners.
function columns({ W, R }, width, pitch = SKADIS.pitch) {
  return Math.floor((W - 2 * R - width) / pitch) + 1;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function skadisHooks(sink, back, fit) {
  const { H } = back;
  const k = SKADIS;
  const half = k.halfWidth - fit, length = k.shaftLength + fit;  // thinner, and more room for the board
  const n = columns(back, 2 * half);
  const rows = [];
  for (let vb = H / 2 - k.margin - k.shaftHeight; vb - k.headDrop >= -H / 2 + k.margin; vb -= k.pitch) {
    rows.push(vb);
  }
  if (n < 1 || rows.length < 1) return { fits: false, text: 'back too small for a hook' };
  for (const vb of rows) {
    for (const uc of centred(n, k.pitch)) {
      const shaft = stadiumPoints(uc, vb + fit, vb + k.shaftHeight - fit, half);
      const head = stadiumPoints(uc, vb - k.headDrop + fit, vb + k.shaftHeight - fit, half);
      loft(sink, [{ t: 0, contour: shaft }, { t: length, contour: shaft }], wallPoint);
      loft(sink, [
        { t: length, contour: head },
        { t: length + k.headLength, contour: head },
      ], wallPoint);
    }
  }
  return { fits: true, text: `${plural(n * rows.length, 'hook')}; print with supports` };
}

// Dovetail channels across the back, open at both ends, one row per 40 mm.
// Pegs printed flat slide in from the side to wherever the board's slots are.
// The channel narrows toward the board face, so with the back on the bed
// each layer sits on the one below: no supports.
const DOVETAIL = {
  floorHalf: 5.5,   // channel 11 wide at its floor (the bin's back)
  faceHalf: 4.0,    // and 8 wide at the board face
  depth: 4,         // = plate thickness
  margin: 2,        // channel edge from the back's top and bottom corners
  // Peg (0.1 mm clear of the channel each side, 0.2 short of its floor)
  tenonFloorHalf: 5.4,
  tenonFaceHalf: 3.9,
  tenonDepth: 3.8,
  tenonLength: 10,
  shaftHalf: 3.7,   // shaft through the board, 7.4 tall
  boardDepth: 5,
  headDepth: 5,
  headDrop: 7.5,    // head reaches this far below the shaft, behind the board
  thickness: 5,     // across the slot; top and bottom rounded to the slot's r 2.5
};

// The channel takes the bin's share of the fit; the peg's tenon keeps its
// size, and the parts that go through the board shrink by `fit`.
function dovetailPeg(sink, fit) {
  const k = DOVETAIL;
  // Print orientation: the hook's side profile flat on the bed (x = depth,
  // y = height, z = across the slot), so its layers run along the hook.
  const flat = (d, v, u) => [d, v, u];
  loft(sink, [0, k.tenonLength].map(u => ({
    t: u,
    contour: [[-k.tenonDepth, -k.tenonFloorHalf], [0, -k.tenonFaceHalf], [0, k.tenonFaceHalf], [-k.tenonDepth, k.tenonFloorHalf]],
  })), flat);
  const thickness = k.thickness - 2 * fit, board = k.boardDepth + fit;
  const r = thickness / 2, steps = 8;
  const sections = [];
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * thickness;
    const e = r - Math.sqrt(Math.max(0, r * r - (u - r) ** 2)) + fit;  // round ends across the slot
    const top = k.shaftHalf - e, shaftBottom = -k.shaftHalf + e, headBottom = -k.shaftHalf - k.headDrop + e;
    const back = board + k.headDepth;
    sections.push({ t: u, contour: [
      [0, shaftBottom], [board, shaftBottom], [board, headBottom],
      [back, headBottom], [back, top], [0, top],
    ] });
  }
  loft(sink, sections, flat);
}

// Horizontal dovetail channels in a plate DOVETAIL.depth thick, open at both
// ends, so parts slide in from the side. The plate covers v0..v1 of the back
// (rounded where it meets the back's top or bottom corners); `channels` are
// channel centres from the top down. The plate is the bands between them,
// each lofted from the back (d = 0) to the board face as the edges close in.
function channelPlate(sink, { W, H, R }, v0, v1, channels, fit) {
  const k = DOVETAIL;
  const floorHalf = k.floorHalf + fit, faceHalf = k.faceHalf + fit;
  const half = (d) => floorHalf + (faceHalf - floorHalf) * (d / k.depth);
  const band = (lo, hi, d) => {
    const pts = [];
    if (lo === null && v0 <= -H / 2) {
      arc(pts, -W / 2 + R, -H / 2 + R, R, Math.PI, 1.5 * Math.PI, 8);
      arc(pts, W / 2 - R, -H / 2 + R, R, 1.5 * Math.PI, 2 * Math.PI, 8);
    } else {
      const y = lo === null ? v0 : lo(d);
      pts.push([-W / 2, y], [W / 2, y]);
    }
    if (hi === null && v1 >= H / 2) {
      arc(pts, W / 2 - R, H / 2 - R, R, 0, 0.5 * Math.PI, 8);
      arc(pts, -W / 2 + R, H / 2 - R, R, 0.5 * Math.PI, Math.PI, 8);
    } else {
      const y = hi === null ? v1 : hi(d);
      pts.push([W / 2, y], [-W / 2, y]);
    }
    return pts;
  };
  // Band edges from the top down: each channel's upper edge, then its lower
  const edges = [null, ...channels.flatMap(c => [(d) => c + half(d), (d) => c - half(d)]), null];
  for (let i = 0; i < edges.length; i += 2) {
    const hi = edges[i], lo = edges[i + 1];
    loft(sink, [0, k.depth].map(d => ({ t: d, contour: band(lo, hi, d) })), wallPoint);
  }
}

// A dovetail tenon that fits those channels and slots, in a part's own frame:
// (across, depth) section with depth -tenonDepth..0 below the part's face.
function tenonSection(cx = 0) {
  const k = DOVETAIL;
  return [[cx - k.tenonFloorHalf, -k.tenonDepth], [cx + k.tenonFloorHalf, -k.tenonDepth],
    [cx + k.tenonFaceHalf, 0], [cx - k.tenonFaceHalf, 0]];
}

function skadisDovetail(sink, back, fit) {
  const { H, R } = back;
  const k = DOVETAIL;
  const floorHalf = k.floorHalf + fit;
  const rows = [];
  for (let c = H / 2 - R - k.margin - floorHalf; c - floorHalf >= -H / 2 + R + k.margin; c -= SKADIS.pitch) rows.push(c);
  const n = columns(back, 2 * k.tenonLength);
  if (rows.length < 1 || n < 1) return { fits: false, text: 'back too small for a channel' };
  channelPlate(sink, back, -H / 2, H / 2, rows, fit);
  return {
    fits: true,
    text: `${plural(rows.length, 'channel')}; print up to ${n} pegs each`,
    part: { name: 'skadis-peg', count: n * rows.length, build: (s) => dovetailPeg(s, fit) },
  };
}

// Vertical dovetail slots, open at the bottom of the back and closed flat at
// `stopV`, one per column. Connectors sit in the board first; the bin lowers
// onto them and hangs on the slots' stops, as with Multiconnect.
function slotPlate(sink, back, centres, stopV, fit) {
  const { W, H, R } = back;
  const k = DOVETAIL;
  const outline = (w) => {
    const hw = W / 2, hh = H / 2, pts = [];
    arc(pts, -hw + R, -hh + R, R, Math.PI, 1.5 * Math.PI, 8);
    for (const uc of centres) pts.push([uc - w, -hh], [uc - w, stopV], [uc + w, stopV], [uc + w, -hh]);
    arc(pts, hw - R, -hh + R, R, 1.5 * Math.PI, 2 * Math.PI, 8);
    arc(pts, hw - R, hh - R, R, 0, 0.5 * Math.PI, 8);
    arc(pts, -hw + R, hh - R, R, 0.5 * Math.PI, Math.PI, 8);
    return pts;
  };
  loft(sink, [
    { t: 0, contour: outline(k.floorHalf + fit) },
    { t: k.depth, contour: outline(k.faceHalf + fit) },
  ], wallPoint);
}

// Multiconnect slots on the SKÅDIS slot spacing, for David D's SKÅDIS plug.
function skadisMulticonnect(sink, back, fit) {
  const res = multiconnect(sink, back, SKADIS.pitch, fit);
  return res.fits ? { ...res, text: `${res.text}, for SKÅDIS plugs` } : res;
}

// Screw holes for 6d6178's Skadis T-Nuts (M2.5): one per slot, a screw from
// inside the bin into a T-nut that turns to lock behind the board.
const TNUT = {
  holeRadius: 1.4,    // M2.5 + 0.3 clearance
  keepOut: 3.5,       // clear radius for the nut to turn
  // Alignment washer: sits in the slot between the bin and the T-nut
  guideHalfWidth: 2.35,
  guideHeight: 14.7,
  guideThickness: 1.0,
};

function tnutWasher(sink, fit) {
  const k = TNUT;
  const h = k.guideHeight / 2 - fit;
  const outline = stadiumPoints(0, -h, h, k.guideHalfWidth - fit);
  const hole = circlePoints(0, 0, Math.min(k.holeRadius + fit, k.guideHalfWidth - fit - 0.4), 16);
  loft(sink, [0, k.guideThickness].map(t => ({ t, contour: outline, holes: [hole] })), (a, b, t) => [a, b, t]);
}

function skadisTnut(sink, back, fit) {
  const { H, R } = back;
  const k = TNUT, slotHalf = 7.5;
  const n = columns(back, 2 * slotHalf);
  const rows = [];
  for (let v = H / 2 - R - slotHalf; v >= -H / 2 + R + slotHalf; v -= SKADIS.pitch) rows.push(v);
  if (n < 1 || rows.length < 1) return { fits: false, text: 'back too small for a screw' };
  const holes = [];
  for (const v of rows) {
    for (const u of centred(n, SKADIS.pitch)) holes.push(circlePoints(u, v, k.holeRadius + fit, 16));
  }
  const count = holes.length;
  return {
    fits: true,
    text: `${plural(count, 'M2.5 screw hole')} for T-nuts`,
    holes,
    part: { name: 'skadis-washer', count, build: (s) => tnutWasher(s, fit) },
  };
}

// Holes on CSD_Salzburg's Universal Hook pattern, through a 5 mm back: a
// 5 x 10 "uptick" hole above a 5 x 5 "peg" hole, 25 mm apart top to top.
// The hook prints flat; its uptick reaches through and hooks inside the bin.
const UNIVERSAL = {
  backThickness: 5,   // the floor slab is 2.25 of it; a plate adds the rest
  holeWidth: 5.2,     // 5 mm plus clearance; published fits are tight
  upTickHeight: 10.2,
  pegHeight: 5.2,
  topToTop: 25,
  fromTop: 6,         // uptick hole top, below the back's top edge
};

function skadisUniversal(sink, back, slabMM, fit) {
  const { H, R } = back;
  const k = UNIVERSAL;
  const n = columns(back, k.holeWidth);
  const top = H / 2 - k.fromTop;
  if (n < 1 || top - k.topToTop - k.pegHeight < -H / 2 + R) {
    return { fits: false, text: 'back too small for a hook' };
  }
  const holes = [];
  for (const u of centred(n, SKADIS.pitch)) {
    const x0 = u - k.holeWidth / 2 - fit, x1 = u + k.holeWidth / 2 + fit;
    holes.push(rectPoints(x0, top - k.upTickHeight - fit, x1, top + fit));
    holes.push(rectPoints(x0, top - k.topToTop - k.pegHeight - fit, x1, top - k.topToTop + fit));
  }
  const plate = k.backThickness - slabMM;
  loft(sink, [0, plate].map(d => ({ t: d, contour: backOutline(back), holes })), wallPoint);
  return { fits: true, text: `${plural(n, 'hook position')} for Universal Hooks`, holes };
}

function skadis(sink, back, opts) {
  const fit = opts.fit ?? 0;
  switch (opts.method) {
    case 'hooks': return skadisHooks(sink, back, fit);
    case 'multiconnect': return skadisMulticonnect(sink, back, fit);
    case 'tnut': return skadisTnut(sink, back, fit);
    case 'universal': return skadisUniversal(sink, back, opts.slabMM, fit);
    default: return skadisDovetail(sink, back, fit);
  }
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

function hswLayout({ W, H, R }, fit) {
  const k = HSW;
  const apothem = k.profile[0][1] - fit;
  const n = Math.floor((W - 2 * R - 2 * k.cornerHalf) / k.pitchAcross) + 1;
  const rows = [];
  for (let vc = H / 2 - R - apothem; vc >= -H / 2 + R + apothem; vc -= k.pitchUp) rows.push(vc);
  return { apothem, n, rows };
}

function hswMoulded(sink, back, fit) {
  const { n, rows } = hswLayout(back, fit);
  if (n < 1 || rows.length < 1) return { fits: false, text: 'back too small for a peg' };
  for (const vc of rows) {
    for (const uc of centred(n, HSW.pitchAcross)) {
      loft(sink, HSW.profile.map(([d, a]) => ({ t: d, contour: hexPoints(uc, vc, a - fit) })), wallPoint);
    }
  }
  return { fits: true, text: `${plural(n * rows.length, 'peg')}; print with supports` };
}

// Connector: the peg with a short tenon on its face that slides along a
// channel. Printed standing on the peg's tip (z = tip to tenon), the peg
// rises from the bed and the tenon sits inside its outline, widening at the
// dovetail's ~21°. The tenon is 9 long, so its wide end stays within the hex.
const HSW_TENON_HALF_LENGTH = 4.5;

function hswConnector(sink, fit) {
  const tip = HSW.profile[HSW.profile.length - 1][0];
  loft(sink, HSW.profile.map(([d, a]) => ({ t: d, contour: hexPoints(0, 0, a - fit) })),
    (a, b, t) => [a, b, tip - t]);
  loft(sink, [-HSW_TENON_HALF_LENGTH, HSW_TENON_HALF_LENGTH].map(t => ({ t, contour: tenonSection() })),
    (a, b, t) => [t, a, tip - b]);
}

// One channel per row of pegs, across the back and open at both ends. Slide
// a connector in for each peg, space them a cell apart (40.9 mm), and press
// the bin onto the inserts: every peg engages at once.
function hswSlide(sink, back, fit) {
  const { H } = back;
  const { n, rows } = hswLayout(back, fit);
  if (n < 1 || rows.length < 1) return { fits: false, text: 'back too small for a peg' };
  channelPlate(sink, back, -H / 2, H / 2, rows, fit);
  return {
    fits: true,
    text: `${plural(rows.length, 'channel')}; print ${n * rows.length} connectors`,
    part: { name: 'hsw-connector', count: n * rows.length, build: (s) => hswConnector(s, fit) },
  };
}

function hsw(sink, back, opts = {}) {
  const fit = opts.fit ?? 0;
  return opts.method === 'moulded' ? hswMoulded(sink, back, fit) : hswSlide(sink, back, fit);
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

function goewsSection(uc, vb, d, halfWidth, offset) {
  const k = GOEWS;
  const vMin = vb + Math.max(0, d - offset);   // 45° bevel on the wall side of the bottom
  const top = vb + k.height;
  const cy = vb + k.notchCentreAbove;
  const xi = Math.sqrt(k.notchRadius ** 2 - (top - cy) ** 2);
  const pts = [[uc - halfWidth, vMin], [uc + halfWidth, vMin], [uc + halfWidth, top]];
  const a0 = Math.atan2(top - cy, xi);
  arc(pts, uc, cy, k.notchRadius, a0, -Math.PI - a0, 16);
  pts.push([uc - halfWidth, top]);
  return pts;
}

// One hanger with its face (d = 0) at depth `d0`, bottom at `vb`.
function goewsHanger(sink, uc, vb, fit, toWorld, d0 = 0) {
  const k = GOEWS;
  const t = k.tolerance + fit, end = t + k.bodyDepth;
  const body = k.halfBody - fit, point = k.halfPoint - fit;
  loft(sink, [
    { t: d0, contour: goewsSection(uc, vb, 0, body, t) },
    { t: d0 + t, contour: goewsSection(uc, vb, t, body, t) },
    { t: d0 + t + (point - body), contour: goewsSection(uc, vb, t + (point - body), point, t) },
    { t: d0 + end, contour: goewsSection(uc, vb, end, body, t) },
  ], toWorld);
}

function goewsLayout({ W, H }) {
  const k = GOEWS;
  const n = Math.floor((W + 0.5) / k.pitch);
  const top = H / 2 - k.topBelowBackTop;
  return { n, top, fits: n >= 1 && top - k.height >= -H / 2 };
}

function goewsMoulded(sink, back, fit) {
  const { n, top, fits } = goewsLayout(back);
  if (!fits) return { fits: false, text: 'needs a back at least 41.5 mm wide' };
  for (const uc of centred(n, GOEWS.pitch)) goewsHanger(sink, uc, top - GOEWS.height, fit, wallPoint);
  return { fits: true, text: `${plural(n, 'hanger')}; print with supports` };
}

// Separate hanger: the tab on a tenon as tall as the tab. Printed standing
// (z = up the wall), the V edges lie in the layers and the bevel under the
// tab rises at 45°.
function goewsPart(sink, fit) {
  const k = GOEWS;
  loft(sink, [0, k.height].map(t => ({ t, contour: tenonSection() })), (a, b, t) => [a, b, t]);
  goewsHanger(sink, 0, 0, fit, (a, b, t) => [a, t, b]);
}

function goewsSlide(sink, back, fit) {
  const { n, top, fits } = goewsLayout(back);
  if (!fits) return { fits: false, text: 'needs a back at least 41.5 mm wide' };
  // The plate takes the back's place against the tile, so the tab sits as
  // the moulded one does, measured from the plate's face
  slotPlate(sink, back, centred(n, GOEWS.pitch), top, fit);
  return {
    fits: true,
    text: `${plural(n, 'slot')}; print ${plural(n, 'hanger')}`,
    part: { name: 'goews-hanger', count: n, build: (s) => goewsPart(s, fit) },
  };
}

function goews(sink, back, opts = {}) {
  const fit = opts.fit ?? 0;
  return opts.method === 'moulded' ? goewsMoulded(sink, back, fit) : goewsSlide(sink, back, fit);
}

// ---------------------------------------------------------------------------
// French cleat: a 45° hook across the top of the back that drops over a
// 19 mm wall cleat, and a spacer at the bottom so a tall bin hangs plumb.
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

// Where the hook and spacer go on a back { H }: the wall cleat's front-top
// edge, and the spacer's band (null when the back ends above the wall cleat).
function cleatLayout({ H }) {
  const k = CLEAT;
  const edge = H / 2 - k.above;
  const vb = -H / 2;
  const vt = Math.min(vb + k.spacerHeight, edge - k.wallCleatHeight - 1);
  return { edge, spacer: vt - vb >= k.spacerChamfer + 1 ? [vb, vt] : null };
}

// Section of the hook in (d, v), with its face against the bin at depth d0
// (the back, or a plate's face) and the wall 19 mm beyond it
function hookSection(edge, d0) {
  const k = CLEAT;
  return [
    [d0, edge], [d0 + k.thickness - k.tip, edge - k.drop], [d0 + k.thickness, edge - k.drop],
    [d0 + k.thickness, edge + k.above], [d0, edge + k.above],
  ];
}

function spacerSection([vb, vt], d0) {
  const k = CLEAT;
  return [
    [d0, vb], [d0 + k.thickness - k.spacerChamfer, vb], [d0 + k.thickness, vb + k.spacerChamfer],
    [d0 + k.thickness, vt], [d0, vt],
  ];
}

function cleatMoulded(sink, back) {
  const { W, R } = back;
  const { edge, spacer } = cleatLayout(back);
  const across = (a, b, t) => wallPoint(t, b, a);  // section in (d, v), swept along u
  const u0 = -W / 2 + R, u1 = W / 2 - R;
  loft(sink, [u0, u1].map(t => ({ t, contour: hookSection(edge, 0) })), across);
  if (spacer) loft(sink, [u0, u1].map(t => ({ t, contour: spacerSection(spacer, 0) })), across);
  return { fits: true, text: `hook${spacer ? ' and spacer' : ''}; print with supports` };
}

// Insert a tenon into a (d, v) section's face at depth d0, centred at v = c:
// the section's points run along d0 from the last point back to the first.
function withTenon(section, d0, c) {
  const k = DOVETAIL;
  return [...section,
    [d0, c + k.tenonFaceHalf], [d0 - k.tenonDepth, c + k.tenonFloorHalf],
    [d0 - k.tenonDepth, c - k.tenonFloorHalf], [d0, c - k.tenonFaceHalf]];
}

// Cleat bar (and spacer bar): the hook profile with a tenon on its face,
// sliding into a channel in a plate across the whole back. The plate's face
// takes the back's place against the wall cleat, so the bin still prints
// flat on it. Printed lying on its wall face, the 45° face rises from the
// bed and the tenon tops it.
function cleatParts(sink, back) {
  const { W, R } = back;
  const { edge, spacer } = cleatLayout(back);
  const p = DOVETAIL.depth;
  const len = W - 2 * R;
  const lying = (dy) => (a, b, t) => [t, b + dy, p + CLEAT.thickness - a];
  // The section's last point and first point both sit on the plate face d = p,
  // so the tenon goes between them, at the channel centre
  loft(sink, [0, len].map(t => ({ t, contour: withTenon(hookSection(edge, p), p, edge + CLEAT.above / 2) })), lying(0));
  if (spacer) {
    const c = (spacer[0] + spacer[1]) / 2;
    // Laid out 10 mm below the bar's tongue in the same file
    const dy = edge - CLEAT.drop - 10 - spacer[1];
    loft(sink, [0, len].map(t => ({ t, contour: withTenon(spacerSection(spacer, p), p, c) })), lying(dy));
  }
}

function cleatBar(sink, back, fit) {
  const { H } = back;
  const { edge, spacer } = cleatLayout(back);
  const channels = [edge + CLEAT.above / 2];
  if (spacer) channels.push((spacer[0] + spacer[1]) / 2);
  channelPlate(sink, back, -H / 2, H / 2, channels, fit);
  return {
    fits: true,
    text: `${spacer ? 'two channels' : 'a channel'}; print the cleat bar${spacer ? ' and spacer' : ''}`,
    part: { name: 'cleat-bar', count: 1, build: (s) => cleatParts(s, back) },
  };
}

function frenchCleat(sink, back, opts = {}) {
  if (back.H < CLEAT.above + CLEAT.drop) {
    return { fits: false, text: `needs a back at least ${CLEAT.above + CLEAT.drop} mm tall` };
  }
  return opts.method === 'moulded' ? cleatMoulded(sink, back) : cleatBar(sink, back, opts.fit ?? 0);
}

// ---------------------------------------------------------------------------
// Registry. 'gridfinity' keeps the base feet (with magnet holes), so it has
// no builder here. `methods` lists a system's attachments, default first:
// { key: { label, hint } }, the hint being what the user prints or buys.
// ---------------------------------------------------------------------------

export const WALL_SYSTEMS = {
  gridfinity: { label: 'Gridfinity wall plate' },
  opengrid:   { label: 'openGrid (Multiconnect)', build: (s, b, o) => multiconnect(s, b, 28, o.fit) },
  multiboard: { label: 'Multiboard (Multiconnect)', build: (s, b, o) => multiconnect(s, b, 25, o.fit) },
  skadis: {
    label: 'IKEA SKÅDIS',
    build: skadis,
    methods: {
      dovetail:     { label: 'Dovetail pegs', hint: 'no supports; print the pegs' },
      multiconnect: { label: 'Multiconnect', hint: 'no supports; print SKÅDIS plugs' },
      tnut:         { label: 'T-nut screws', hint: 'no supports; M2.5 screws, T-nuts' },
      universal:    { label: 'Universal Hook', hint: 'no supports; print Universal Hooks' },
      hooks:        { label: 'Moulded hooks', hint: 'hooks need supports' },
    },
  },
  hsw: {
    label: 'Honeycomb Storage Wall',
    build: hsw,
    methods: {
      slide:   { label: 'Slide-on pegs', hint: 'no supports; print the connectors' },
      moulded: { label: 'Moulded pegs', hint: 'pegs need supports' },
    },
  },
  goews: {
    label: 'GOEWS',
    build: goews,
    methods: {
      slide:   { label: 'Slide-on hangers', hint: 'no supports; print the hangers' },
      moulded: { label: 'Moulded hangers', hint: 'hangers need supports' },
    },
  },
  cleat: {
    label: 'French cleat',
    build: frenchCleat,
    methods: {
      bar:     { label: 'Slide-in cleat bar', hint: 'no supports; print the bar' },
      moulded: { label: 'Moulded hook', hint: 'hook needs supports' },
    },
  },
};

export const DEFAULT_WALL_SYSTEM = 'opengrid';

// A system's attachment choice, checked against its list (null when it has none)
export function resolveMethod(system, method) {
  const methods = WALL_SYSTEMS[system]?.methods;
  if (!methods) return null;
  return Object.hasOwn(methods, method) ? method : Object.keys(methods)[0];
}

/**
 * Plan the mount for `system` behind a back face { W, H, R }.
 *   opts  { method, slabMM, fit }: method from the system's `methods`;
 *         slabMM the floor slab's thickness; fit the extra clearance per
 *         side (see the top)
 * Returns { fits, text, holes, build, part }:
 *   holes  outlines in (u, v) to cut through the back into the bin
 *   build  (sink) => void, writes the mount's shells in world coordinates
 *   part   { name, count, build(sink) } for a separate part, or null
 */
export function planWallMount(system, back, opts = {}) {
  const entry = WALL_SYSTEMS[system];
  if (!entry?.build) return { fits: true, text: '', holes: [], build: () => {}, part: null };
  const tris = [];
  const method = resolveMethod(system, opts.method);
  const res = entry.build({ tri: (a, b, c) => tris.push([a, b, c]) }, back, { ...opts, method });
  return {
    fits: res.fits,
    text: res.text,
    holes: res.holes ?? [],
    part: res.part ?? null,
    build: (sink) => { for (const [a, b, c] of tris) sink.tri(a, b, c); },
  };
}
