/**
 * param-help.js — Hover help for every parameter title, and the one tooltip
 * that shows it.
 *
 * A title opts in with data-help="<id>"; add data-help-click when clicking
 * the title does nothing else, so a click or tap opens the help too. A label
 * wrapping or naming a checkbox must not get data-help-click: its click
 * still ticks the box, and on touch its help opens on a long press instead.
 * Give a title no native title= attribute, or two tooltips appear.
 *
 * Timing: hover a title for OPEN_DELAY_MS and its tip opens. Once a tip has
 * been shown, another title within WARM_MS opens at once, so reading down
 * the sidebar doesn't cost the full delay per row. The pointer may cross the
 * title's row to reach a tip placed beside the sidebar; anywhere else closes
 * it. GRACE_MS covers a pointer that leaves and stops. A tip opened by touch
 * stays pinned until the next tap. Keyboard focus on a control opens its
 * title's tip.
 */

import { drawDiagram, DIAGRAMS } from './help-diagrams.js';

// ---------------------------------------------------------------------------
// Registry: the one place the help words live.
//
// Keyed by a stable id ('<section>.<param>'), never by label text.
//   title    the parameter's name, as on the page but without the live value
//   meta     units · default · range: the facts, in one mono line
//   what     what it does, leading with the effect; never restates the title
//   why      when you'd change it: what raising / lowering it buys and costs
//   note     optional: an interaction, a limit, a reason it may be disabled
//   diagram  optional: a key into DIAGRAMS in help-diagrams.js. Add one when a
//            picture explains the parameter faster than words (geometry,
//            heights, clearances)
//
// Writing rules: second person, present tense, sentence case, no em dashes.
// Units always. what + why stay under ~60 words, since the tip is 300 px
// wide. Facts come from the code (input min/max/value, gridfinity-geometry.js),
// not from older docs. checkParamHelp() below reports drift to the console.
// ---------------------------------------------------------------------------

export const PARAM_HELP = {
  // ── Grid size ────────────────────────────────────────────────────────────
  'grid.unit': {
    title: 'Unit size',
    meta: 'mm per grid unit · default 42 (standard) · 20 to 100',
    what: 'The pitch of the baseplate the bin sits in. A bin is this many millimetres per unit, less 0.5 mm so neighbouring bins fit side by side. The feet and the preview grid follow it.',
    why: 'Leave it at 42 mm for standard Gridfinity. Change it only for a baseplate with a different pitch.',
  },
  'grid.divisions': {
    title: 'Divisions',
    meta: 'Whole · Half · default Whole',
    what: 'The step that bin sizes snap to. Half allows sizes in 0.5-unit steps and puts a foot under every half unit, 21 mm across at the standard pitch.',
    why: 'Choose Half to fill a gap narrower than a whole unit. The half-size feet still seat in a standard baseplate.',
    note: 'Changing it snaps every size to the new step.',
  },
  'grid.size': {
    title: 'Bin size',
    meta: 'grid units, X × Y · default 2 × 2 · 1 to 20 (0.5 to 20 with Half)',
    what: 'The footprint of the bin at its base. At the standard pitch a 2 × 2 bin is 83.5 mm square outside.',
    why: 'Size it to what you store. The top shifts by the offset, so along the offset axis the bin and its end bin take this size plus the offset in drawer length.',
    note: 'Mounted vertically, X is the width across the wall and Y the height up it.',
  },

  // ── Mounting ────────────────────────────────────────────────────────────
  'mount.orientation': {
    title: 'Orientation',
    meta: 'Horizontal · Vertical · default Horizontal',
    what: 'Horizontal stands the bin in a drawer on Gridfinity feet. Vertical turns it to hang on a wall: the base faces the wall, the opening faces you and the slant rises up the wall.',
    why: 'Choose Vertical to keep pens on a wall board. The offset axis, base and end bin don\'t apply there, so they hide.',
    note: 'The STL keeps this orientation; turn it in your slicer for printing.',
  },
  'mount.system': {
    title: 'Wall system',
    meta: '7 systems · default openGrid',
    what: 'Sets what the bin\'s back carries to suit your board: Multiconnect slots (openGrid 28 mm, Multiboard 25 mm), SKÅDIS hooks, HSW pegs, GOEWS hangers, a French cleat hook, or Gridfinity feet with magnet holes.',
    why: 'Pick the board you have. Only the bin side is made; use the board\'s own connectors or HSW inserts. The line below says what fits.',
    note: 'Mounts sit at the board\'s pitch, centred on the back. A back too small for one gets none.',
  },

  // ── Height ──────────────────────────────────────────────────────────────
  'height.units': {
    title: 'Height units',
    meta: '7 mm each · default 12 · 1 to 100',
    what: 'The bin\'s height, measured straight up. The inside is 7 mm less than the height: 77 mm at the default 12.',
    why: 'Set it to what the drawer leaves room for. A taller bin holds longer items at a steeper angle; the max pen length under the label shows the result.',
    diagram: 'height',
  },

  // ── Slant offset ────────────────────────────────────────────────────────
  'offset.units': {
    title: 'Offset',
    meta: 'grid units · default 2 · 0 to 20 in steps of 0.5',
    what: 'How far the top of the bin shifts sideways from its base. The walls lean by that much over the bin\'s height.',
    why: 'A larger offset lays long items at a lower angle, so they fit a shallow drawer. It also needs more drawer length, since the end bin under the overhang grows with it. At 0 the bin is straight and has no end bin.',
    diagram: 'offset',
  },
  'offset.axis': {
    title: 'Offset axis',
    meta: 'X · Y · default X',
    what: 'The direction the top shifts in, along the bin\'s X or Y size. The end bin goes on that side.',
    why: 'Pick the direction where the drawer has room for the overhang and the end bin.',
  },

  // ── Walls ───────────────────────────────────────────────────────────────
  'walls.thickness': {
    title: 'Wall thickness',
    meta: 'mm · default 0.82 · 0.40 to 2.00',
    what: 'Measured horizontally and kept the same at every height, so each printed layer has the same wall width even where the wall leans.',
    why: 'Match a whole number of your slicer\'s line widths: the default 0.82 mm is one line from a 0.8 mm nozzle, which prints fast. Thicker walls are stiffer but take twice their thickness off the inside in each direction.',
    diagram: 'wall',
  },

  // ── Base ────────────────────────────────────────────────────────────────
  'base.include': {
    title: 'Include gridfinity base profile',
    meta: 'on / off · default on',
    what: 'Adds the stepped feet, 7 mm tall, that lock into a Gridfinity baseplate, under both the bin and the end bin.',
    why: 'Turn it off for a drawer with no baseplate. The bin then sits on a flat 2.25 mm floor and is 4.75 mm shorter.',
    diagram: 'base',
  },

  // ── End bin ─────────────────────────────────────────────────────────────
  'end.size': {
    title: 'End bin size (X / Y units)',
    meta: 'grid units · default 2 × 2 · 1 to 20 (0.5 to 20 with Half)',
    what: 'The footprint of the end bin: a solid wedge that fills the space under the overhang, 0.5 mm clear of the leaning wall.',
    why: 'Changing the offset sets its length along the offset axis to the offset, rounded down, so you mostly set the other axis. Matching the bin keeps the pair a rectangle.',
    note: 'There is no end bin while the offset is 0.',
    diagram: 'endBin',
  },

  // ── Downloads ───────────────────────────────────────────────────────────
  'download.bin': {
    title: 'Slanted bin',
    meta: 'on / off · default on',
    what: 'Export STL saves the slanted bin as its own file, ending _bin.stl.',
    why: 'Turn it off to export only the end bin, after changing its size, say.',
  },
  'download.endBin': {
    title: 'End bin (support wedge)',
    meta: 'on / off · default on · unavailable at offset 0',
    what: 'Export STL saves the end bin as a separate file, ending _support-wedge.stl.',
    why: 'Turn it off when something else already fills the space under the overhang.',
  },

  // ── Dimensions read-out ─────────────────────────────────────────────────
  'dims.maxPen': {
    title: 'Max pen length',
    meta: 'mm · read-out',
    what: 'The longest straight item that fits inside: the diagonal from a bottom inside corner to the opposite top inside corner, following the slant.',
    why: 'Check a pen, tool or brush against it before you print. More height, more offset or a larger bin raises it.',
    note: 'It treats the item as a line, so a thick item fits a little less.',
    diagram: 'maxPen',
  },
};

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export const OPEN_DELAY_MS = 2000;
export const WARM_MS = 500;
export const GRACE_MS = 100;
export const LONG_PRESS_MS = 500;

const TIP_ID = 'param-tip';
const GAP = 6;      // between the title (or sidebar) and the tip
const MARGIN = 8;   // from the viewport edge

let tipEl = null;
let tip = null;       // { anchor: Element, pinned: bool } | null
let pending = null;   // anchor waiting out OPEN_DELAY_MS
let openTimer = null;
let closeTimer = null;
let lastClosedAt = -Infinity;
let corridor = null;  // the title's row, from title to tip, when placed beside the sidebar
let press = null;     // touch long press on a non-clickable title: { anchor, x, y, timer, fired }
let keyboardFocus = false;
let getContext = () => ({});

const triggerOf = (node) => (node instanceof Element ? node.closest('[data-help]') : null);
const isClickable = (anchor) => anchor.hasAttribute('data-help-click');

// The title for a control: the label naming it, else the title of its row.
function helpForControl(el) {
  if (el.id) {
    const label = document.querySelector(`[data-help][for="${CSS.escape(el.id)}"]`);
    if (label) return label;
  }
  return el.closest('.param-row, .control-group, .checkbox-group')?.querySelector('[data-help]') ?? null;
}

function clearOpen() {
  clearTimeout(openTimer);
  openTimer = null;
  pending = null;
}

function clearClose() {
  clearTimeout(closeTimer);
  closeTimer = null;
}

function render(entry) {
  const parts = [];
  const add = (tag, cls, text) => {
    if (!text) return;
    const el = document.createElement(tag);
    el.className = cls;
    el.textContent = text;
    parts.push(el);
  };
  add('div', 'param-tip__title', entry.title);
  add('div', 'param-tip__meta', entry.meta);
  add('p', 'param-tip__what', entry.what);
  add('p', 'param-tip__why', entry.why);
  add('p', 'param-tip__note', entry.note);
  if (entry.diagram) {
    let ctx = {};
    try { ctx = getContext() ?? {}; } catch { /* draw the defaults */ }
    const svg = drawDiagram(entry.diagram, ctx);
    if (svg) parts.push(svg);
  }
  tipEl.replaceChildren(...parts);
}

// Beside the sidebar, level with the title, so it never covers the next
// title down. Titles outside the sidebar, or with no room beside it (phones),
// get the tip under them, or above when there's no room below.
function place(anchor) {
  tipEl.style.visibility = 'hidden';
  tipEl.style.top = '0px';
  tipEl.style.left = '0px';
  tipEl.hidden = false;
  const a = anchor.getBoundingClientRect();
  const { width: w, height: h } = tipEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const panel = anchor.closest('.sidebar')?.getBoundingClientRect();
  let top, left;
  if (panel && panel.right + GAP + w <= vw - MARGIN) {
    left = panel.right + GAP;
    top = Math.max(MARGIN, Math.min(a.top - 10, vh - h - MARGIN));
    corridor = { left: a.left, right: left, top: a.top - 4, bottom: a.bottom + 4 };
  } else {
    top = a.bottom + GAP;
    if (top + h > vh - MARGIN && a.top - GAP - h >= MARGIN) top = a.top - GAP - h;
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    left = Math.max(MARGIN, Math.min(a.left, vw - w - MARGIN));
    corridor = null;
  }
  tipEl.style.top = `${Math.round(top)}px`;
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.visibility = '';
}

function openTip(anchor, pinned = false) {
  clearOpen();
  clearClose();
  const entry = PARAM_HELP[anchor.dataset.help];
  if (!entry || !anchor.isConnected) return;
  if (tip && tip.anchor !== anchor) tip.anchor.removeAttribute('aria-describedby');
  tip = { anchor, pinned };
  render(entry);
  place(anchor);
  anchor.setAttribute('aria-describedby', TIP_ID);
}

function hideTip() {
  clearOpen();
  clearClose();
  if (!tip) return;
  tip.anchor.removeAttribute('aria-describedby');
  tip = null;
  corridor = null;
  tipEl.hidden = true;
  lastClosedAt = performance.now();
}

// Start the delay for `anchor`, or open at once if a tip is warm.
function requestTip(anchor) {
  clearClose();
  if (tip?.anchor === anchor || pending === anchor) return;
  clearOpen();
  if (tip || performance.now() - lastClosedAt < WARM_MS) {
    openTip(anchor);
    return;
  }
  pending = anchor;
  openTimer = setTimeout(() => openTip(anchor), OPEN_DELAY_MS);
}

function scheduleClose() {
  clearClose();
  closeTimer = setTimeout(hideTip, GRACE_MS);
}

// Close now if this anchor owns the tip or its pending delay.
function dropAnchor(anchor) {
  if (pending === anchor) clearOpen();
  if (tip?.anchor === anchor) hideTip();
}

function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}

const inside = (r, x, y) => r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

// `getContext` returns the current parameters, for diagrams that draw a
// setting they depend on (the base) in its current state.
export function initParamHelp({ getContext: get } = {}) {
  if (get) getContext = get;
  tipEl = document.createElement('div');
  tipEl.id = TIP_ID;
  tipEl.className = 'param-tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  tipEl.addEventListener('pointerenter', clearClose);
  tipEl.addEventListener('pointerleave', () => { if (tip && !tip.pinned) scheduleClose(); });
  document.body.append(tipEl);

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const anchor = triggerOf(e.target);
    if (anchor) requestTip(anchor);
  });

  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const anchor = triggerOf(e.target);
    if (!anchor || anchor.contains(e.relatedTarget)) return;
    if (pending === anchor) clearOpen();
    if (tip?.anchor === anchor && !tip.pinned) scheduleClose();
  });

  // Crossing from the title to a tip beside the sidebar passes over the
  // row's own controls; that doesn't count as leaving. Anywhere else does.
  document.addEventListener('pointermove', (e) => {
    if (press && !press.fired && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
    if (!tip || tip.pinned || e.pointerType === 'touch') return;
    const x = e.clientX, y = e.clientY;
    if (inside(tip.anchor.getBoundingClientRect(), x, y)
        || inside(tipEl.getBoundingClientRect(), x, y)
        || inside(corridor, x, y)) clearClose();
    else hideTip();
  }, true);

  document.addEventListener('pointerdown', (e) => {
    keyboardFocus = false;
    // A press anywhere but the tip or its own title dismisses it; the
    // title's own press is left to its click, which toggles.
    if (tip && !tipEl.contains(e.target) && !tip.anchor.contains(e.target)) hideTip();
    const anchor = triggerOf(e.target);
    if (!anchor || isClickable(anchor)) return;
    if (e.pointerType !== 'touch') {
      // Clicking a title (to tick its checkbox, say) is not asking for help.
      dropAnchor(anchor);
      return;
    }
    cancelPress();
    const p = { anchor, x: e.clientX, y: e.clientY, fired: false };
    p.timer = setTimeout(() => {
      p.fired = true;
      openTip(anchor, true);
    }, LONG_PRESS_MS);
    press = p;
  }, true);

  document.addEventListener('pointerup', () => { if (press && !press.fired) cancelPress(); }, true);
  document.addEventListener('pointercancel', cancelPress, true);

  document.addEventListener('click', (e) => {
    // A long press ends in a click, which would tick a labelled checkbox.
    if (press?.fired) {
      e.preventDefault();
      e.stopPropagation();
      press = null;
      return;
    }
    const anchor = triggerOf(e.target);
    if (!anchor || !isClickable(anchor)) return;
    if (tip?.anchor === anchor) hideTip();
    else openTip(anchor, e.pointerType === 'touch');
  }, true);

  document.addEventListener('contextmenu', (e) => { if (press) e.preventDefault(); });

  // Keyboard focus only: a click into a field already had its hover.
  document.addEventListener('focusin', (e) => {
    if (!keyboardFocus) return;
    const anchor = helpForControl(e.target);
    if (anchor) requestTip(anchor);
  });
  // A press on a label blurs the field it names; the press's own handlers
  // decide what happens to the tip then.
  document.addEventListener('focusout', (e) => {
    if (!keyboardFocus) return;
    const anchor = helpForControl(e.target);
    if (anchor) dropAnchor(anchor);
  });

  document.addEventListener('keydown', (e) => {
    keyboardFocus = true;
    if (e.key === 'Escape') hideTip();
  });

  // Anything that moves the page under the tip dismisses it.
  document.addEventListener('scroll', (e) => { if (!tipEl.contains(e.target)) hideTip(); }, true);
  window.addEventListener('resize', hideTip);
  window.addEventListener('blur', hideTip);

  checkParamHelp();
}

// Reports drift between the page and the registry: an unknown id, an entry
// missing title / what / why, an entry no title uses, or a sidebar control
// with no help. The page check (AGENTS.md §5) requires a clean console.
export function checkParamHelp() {
  const used = new Set();
  for (const el of document.querySelectorAll('[data-help]')) {
    used.add(el.dataset.help);
    if (!PARAM_HELP[el.dataset.help]) console.error(`param-help: unknown id '${el.dataset.help}'`);
    if (el.hasAttribute('title')) console.error(`param-help: '${el.dataset.help}' also has a native title`);
  }
  for (const [id, entry] of Object.entries(PARAM_HELP)) {
    for (const field of ['title', 'what', 'why']) {
      if (!entry[field]) console.error(`param-help: '${id}' has no ${field}`);
    }
    if (entry.diagram && !DIAGRAMS[entry.diagram]) console.error(`param-help: '${id}' names unknown diagram '${entry.diagram}'`);
    if (!used.has(id)) console.error(`param-help: '${id}' is not used on the page`);
  }
  for (const el of document.querySelectorAll('.sidebar input, .sidebar select')) {
    if (!helpForControl(el)) console.error(`param-help: #${el.id || el.name} has no help`);
  }
}
