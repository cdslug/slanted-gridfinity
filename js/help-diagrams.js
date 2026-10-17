/**
 * help-diagrams.js — Small drawings shown under a parameter's help text.
 *
 * Each is a function (ctx) → array of SVG nodes, drawn in one shared frame
 * (DIAGRAM_W × DIAGRAM_H) as the same side view through the bin, so they read
 * as a set: bin and end bin in the panel colours, the thing being explained
 * in the accent. Annotate only the parameter being described, and label it in
 * words, not only colour. `ctx` is the current readParams(); a setting the
 * drawing depends on (the base) is drawn in its current state.
 *
 * Colours come from the dg-* classes in css/styles.css, so they follow the
 * theme. Nodes are built with createElementNS; never innerHTML.
 */

export const DIAGRAM_W = 268;
export const DIAGRAM_H = 116;

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

const poly = (cls, pts) => el('polygon', { class: cls, points: pts.map(p => p.join(',')).join(' ') });
const label = (x, y, text, anchor = 'start') => el('text', { class: 'dg-label', x, y, 'text-anchor': anchor }, text);
const caption = (text) => el('text', { class: 'dg-caption', x: 8, y: 112 }, text);
const guide = (x1, y1, x2, y2) => el('line', { class: 'dg-guide', x1, y1, x2, y2 });

// Dimension lines with ticks at both ends.
function hdim(x1, x2, y) {
  return el('path', { class: 'dg-dim', d: `M${x1} ${y}H${x2}M${x1} ${y - 4}v8M${x2} ${y - 4}v8` });
}
function vdim(x, y1, y2) {
  return el('path', { class: 'dg-dim', d: `M${x} ${y1}V${y2}M${x - 4} ${y1}h8M${x - 4} ${y2}h8` });
}

// The side view, along the offset axis. Proportions are schematic: walls,
// gap and base are drawn thicker than scale so they can be seen at all.
const PLATE = 98;  // build plate
const U = 35;      // one grid unit across
const L0 = 26;     // the bin's left edge at its base
const R0 = L0 + 2 * U;
const DX = 2 * U;  // the offset: 2 units
const L1 = L0 + DX, R1 = R0 + DX;
const T = 9;       // wall thickness
const GAP = 3;     // bin to end bin
const SLAB = 3;    // floor slab under the walls
const RISE = 62;   // floor to top of the walls
const E0 = R0 + GAP, E1 = E0 + DX;

function frame(ctx = {}) {
  const base = ctx.includeBase !== false;
  const floor = PLATE - SLAB - (base ? 9 : 0);
  const top = floor - RISE;
  return { base, floor, top };
}

// Stepped feet under each grid unit from x0, `units` wide.
function feet(cls, x0, units, floor) {
  const y0 = floor + SLAB;
  const out = [];
  for (let i = 0; i < units; i++) {
    const x = x0 + i * U;
    out.push(poly(cls, [
      [x + 1, y0], [x + U - 1, y0], [x + U - 1, y0 + 3],
      [x + U - 5, PLATE], [x + 5, PLATE], [x + 1, y0 + 3],
    ]));
  }
  return out;
}

// The bin, the end bin, the plate; `hi` names the part drawn in the accent.
function scene(ctx, hi) {
  const { base, floor, top } = frame(ctx);
  const bin = poly('dg-part', [
    [L0, floor + SLAB], [L0, floor], [L1, top], [L1 + T, top], [L0 + T, floor],
    [R0 - T, floor], [R1 - T, top], [R1, top], [R0, floor], [R0, floor + SLAB],
  ]);
  const end = poly(hi === 'end' ? 'dg-hi' : 'dg-end', [
    [E0, floor + SLAB], [E0, floor], [E1, top], [E1, floor + SLAB],
  ]);
  const nodes = [el('line', { class: 'dg-plate', x1: 8, y1: PLATE, x2: 260, y2: PLATE }), bin, end];
  if (base) {
    const footCls = hi === 'base' ? 'dg-hi' : 'dg-part';
    nodes.push(...feet(footCls, L0, 2, floor), ...feet(hi === 'base' ? 'dg-hi' : 'dg-end', E0, 2, floor));
  }
  return { nodes, floor, top };
}

// Where the bin's left wall's outer face is at height y.
const leftWallAt = (y, floor, top) => L0 + (floor - y) / (floor - top) * DX;

export const DIAGRAMS = {
  height(ctx) {
    const { nodes, top } = scene(ctx);
    return [
      ...nodes,
      guide(14, top, L1, top),
      vdim(14, PLATE, top),
      label(20, top + 22, 'height'),
      caption('side view · 7 mm per unit, measured straight up'),
    ];
  },

  offset(ctx) {
    const { nodes, floor, top } = scene(ctx);
    return [
      ...nodes,
      guide(L0, floor, L0, top - 10),
      hdim(L0, L1, top - 6),
      label((L0 + L1) / 2, top - 11, 'offset', 'middle'),
      caption('side view · the top shifts; the base stays on the grid'),
    ];
  },

  wall(ctx) {
    const { nodes, floor, top } = scene(ctx);
    const at = [floor - 14, top + 16];
    const out = [...nodes];
    for (const y of at) {
      const x = leftWallAt(y, floor, top);
      out.push(hdim(x, x + T, y));
    }
    const x = leftWallAt(at[1], floor, top) + T + 6;
    out.push(label(x, at[1] + 3, 'same level width'), label(x, at[1] + 14, 'at every height'));
    out.push(caption('side view · measured level, not square to the wall'));
    return out;
  },

  base(ctx) {
    const { nodes, floor } = scene({ ...ctx, includeBase: true }, 'base');
    return [
      ...nodes,
      el('line', { class: 'dg-dim', x1: E1 - 6, y1: floor + 8, x2: 196, y2: floor - 10 }),
      label(199, floor - 12, 'feet'),
      caption('side view · off: a flat 2.25 mm floor instead'),
    ];
  },

  endBin(ctx) {
    const { nodes, floor, top } = scene(ctx, 'end');
    const midY = (floor + top) / 2;
    const gapX = R0 + DX / 2 + GAP / 2;
    return [
      ...nodes,
      label(E1 + 6, floor - 4, 'end bin'),
      el('line', { class: 'dg-dim', x1: gapX, y1: midY, x2: gapX - 40, y2: top - 10 + 4 }),
      label(gapX - 42, top - 10, '0.5 mm gap', 'end'),
      caption('side view · a solid wedge under the overhang'),
    ];
  },

  maxPen(ctx) {
    const { nodes, floor, top } = scene(ctx);
    const x1 = L0 + T + 2, y1 = floor - 2, x2 = R1 - T - 2, y2 = top + 2;
    return [
      ...nodes,
      el('line', { class: 'dg-pen', x1, y1, x2, y2 }),
      el('circle', { class: 'dg-pen-end', cx: x1, cy: y1, r: 2.5 }),
      el('circle', { class: 'dg-pen-end', cx: x2, cy: y2, r: 2.5 }),
      label(E1 + 6, top + 10, 'max pen'),
      label(E1 + 6, top + 21, 'length'),
      caption('side view · the read-out also counts the depth across'),
    ];
  },
};

export function drawDiagram(key, ctx) {
  const draw = DIAGRAMS[key];
  if (!draw) return null;
  const svg = el('svg', {
    class: 'param-tip__diagram', viewBox: `0 0 ${DIAGRAM_W} ${DIAGRAM_H}`,
    width: DIAGRAM_W, height: DIAGRAM_H, 'aria-hidden': 'true',
  });
  svg.append(...draw(ctx));
  return svg;
}
