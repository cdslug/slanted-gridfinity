/**
 * mesh-shapes.js — Closed solids from stacked 2D sections.
 *
 * loft() joins sections that share one topology (an outline plus holes,
 * each with the same vertex count in every section) into a closed shell:
 * side walls between neighbouring sections, and a cap at each end. Notches
 * and holes are just part of the outline, so the sockets, slots and pegs of
 * the wall mounts need no boolean operations.
 *
 * Each shell is collected whole and its winding checked by signed volume
 * before it is written, so a section frame mapped to the world by a
 * reflection still comes out facing outward.
 */

import { ShapeUtils, Vector2 } from 'three';

const vec = (pts) => pts.map(([x, y]) => new Vector2(x, y));

// ---------------------------------------------------------------------------
// 2D outlines (CCW)
// ---------------------------------------------------------------------------

export function roundedRectPoints(width, height, radius, segments = 8, cx = 0, cy = 0) {
  const pts = [];
  const hw = width / 2, hh = height / 2;
  const r = Math.max(0.01, Math.min(radius, hw, hh));

  const corners = [
    { x:  (hw - r), y: -(hh - r), a0: -Math.PI / 2, a1: 0 },
    { x:  (hw - r), y:  (hh - r), a0: 0,             a1: Math.PI / 2 },
    { x: -(hw - r), y:  (hh - r), a0: Math.PI / 2,   a1: Math.PI },
    { x: -(hw - r), y: -(hh - r), a0: Math.PI,       a1: 3 * Math.PI / 2 },
  ];

  for (const { x, y, a0, a1 } of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = a0 + (i / segments) * (a1 - a0);
      pts.push([cx + x + r * Math.cos(a), cy + y + r * Math.sin(a)]);
    }
  }
  return pts;
}

export function circlePoints(cx, cy, r, segments = 24) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// A vertical stadium: half-width r, from y0 to y1 including its round ends.
export function stadiumPoints(cx, y0, y1, r, segments = 8) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI + (i / segments) * Math.PI;  // bottom end, left to right
    pts.push([cx + r * Math.cos(a), y0 + r + r * Math.sin(a)]);
  }
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI;            // top end, right to left
    pts.push([cx + r * Math.cos(a), y1 - r + r * Math.sin(a)]);
  }
  return pts;
}

// Regular hexagon with flats top and bottom, `apothem` from centre to a flat.
export function hexPoints(cx, cy, apothem) {
  const R = apothem * 2 / Math.sqrt(3);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 2 * Math.PI;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// Collects one closed shell, then writes it to `sink.tri` facing outward.
export class Shell {
  constructor() {
    this.tris = [];
  }

  tri(a, b, c) {
    if (samePoint(a, b) || samePoint(b, c) || samePoint(c, a)) return;
    this.tris.push([a, b, c]);
  }

  // Signed volume (divergence theorem); negative means the shell faces inward.
  volume() {
    let v = 0;
    for (const [a, b, c] of this.tris) {
      v += a[0] * (b[1] * c[2] - b[2] * c[1])
         - a[1] * (b[0] * c[2] - b[2] * c[0])
         + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    return v / 6;
  }

  writeTo(sink) {
    const flip = this.volume() < 0;
    for (const [a, b, c] of this.tris) {
      if (flip) sink.tri(a, c, b);
      else sink.tri(a, b, c);
    }
  }
}

const area2 = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);

function cap(shell, contour, holes, toWorld, t, upward) {
  const flat = contour.concat(...holes);
  const faces = ShapeUtils.triangulateShape(vec(contour), holes.map(vec));
  for (const [i, j, k] of faces) {
    const ccw = area2(flat[i], flat[j], flat[k]) > 0;
    const [a, b, c] = ccw === upward ? [i, j, k] : [i, k, j];
    shell.tri(toWorld(...flat[a], t), toWorld(...flat[b], t), toWorld(...flat[c], t));
  }
}

function strip(shell, ring0, ring1, toWorld, t0, t1) {
  const n = ring0.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = toWorld(...ring0[i], t0), b = toWorld(...ring0[j], t0);
    const c = toWorld(...ring1[j], t1), d = toWorld(...ring1[i], t1);
    shell.tri(a, b, c);
    shell.tri(a, c, d);
  }
}

/**
 * Write one closed solid to `sink`.
 *   sections  [{ t, contour: [[a, b], ...], holes?: [[[a, b], ...], ...] }],
 *             t strictly monotonic; every section has the same vertex counts
 *   toWorld   (a, b, t) => [x, y, z]
 */
export function loft(sink, sections, toWorld) {
  // Orient by the first section: outline CCW, holes CW (reversing keeps the
  // vertex correspondence, since every section is reversed alike).
  const first = sections[0];
  const flipContour = ShapeUtils.isClockWise(vec(first.contour));
  const flipHole = (first.holes ?? []).map(h => !ShapeUtils.isClockWise(vec(h)));
  const norm = sections.map(({ t, contour, holes = [] }) => ({
    t,
    contour: flipContour ? contour.slice().reverse() : contour,
    holes: holes.map((h, i) => (flipHole[i] ? h.slice().reverse() : h)),
  }));

  const shell = new Shell();
  for (let k = 0; k < norm.length - 1; k++) {
    const s0 = norm[k], s1 = norm[k + 1];
    strip(shell, s0.contour, s1.contour, toWorld, s0.t, s1.t);
    s0.holes.forEach((h, i) => strip(shell, h, s1.holes[i], toWorld, s0.t, s1.t));
  }
  const last = norm[norm.length - 1];
  cap(shell, norm[0].contour, norm[0].holes, toWorld, norm[0].t, false);
  cap(shell, last.contour, last.holes, toWorld, last.t, true);
  shell.writeTo(sink);
}
