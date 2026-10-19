/**
 * main.js — Three.js scene, UI controls, and application logic.
 *
 * 3D preview:
 *   Camera: fov 50, Z-up, opens on a fitted iso view
 *   Colors: Form Fit Print "Filament" palette, light (default) or dark
 *           (SCENE_PALETTES below; theme set on <html data-theme>)
 *   Ambient 1.0, directional 1.8 + fill 0.7
 *   Grid on XY plane, section lines at the grid unit (42mm by default)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  generateSlantedBin,
  generateEndBin,
  generateWallPart,
  GRID_MM, HEIGHT_UNIT_MM, TOLERANCE_MM,
  interiorHeightMM, footCount,
} from './gridfinity-geometry.js';
import { WALL_SYSTEMS, DEFAULT_WALL_SYSTEM, resolveMethod, wallSpacing } from './wall-mounts.js';
import { generateBinarySTL, downloadSTL } from './stl-export.js';
import { setupCameraControls } from './camera-controls.js';
import { createModelToggleButton } from './model-toggle-button.js';
import { initParamHelp } from './param-help.js';

// ---------------------------------------------------------------------------
// Scene colors, one palette per theme
// ---------------------------------------------------------------------------

const SCENE_PALETTES = {
  light: {
    viewerBg:     '#e8e1d4',
    gridCell:     '#ddd3c2',
    gridSection:  '#cbbfa8',
    bin:          '#f5c242',  // brand gold; palette's deeper #cf9a10 shades to brown here
    endBin:       '#e08a2e',  // mesh.target orange; deeper #bd6f12 shades to brown here
    binChip:      '#cf9a10',  // mesh.result — legible chip text on cream
    endBinChip:   '#bd6f12',  // light mesh.target — legible chip text on cream
    part:         '#e08a2e',  // a wall mount's separate part; never shown with the end bin
    partChip:     '#bd6f12',
  },
  dark: {
    viewerBg:     '#0f0d0b',
    gridCell:     '#2e2a24',
    gridSection:  '#3a352d',
    bin:          '#f5c242',  // mesh.result (brand gold)
    endBin:       '#e08a2e',  // mesh.target (orange)
    binChip:      '#f5c242',
    endBinChip:   '#e08a2e',
    part:         '#e08a2e',
    partChip:     '#e08a2e',
  },
};

const THEME_STORAGE_KEY = 'slanted-gridfinity.theme';

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

let sceneColors = SCENE_PALETTES[currentTheme()];

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('three-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Past 2x the extra pixels cost GPU time without a visible difference.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth, canvas.clientHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(sceneColors.viewerBg);

const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 2000);
camera.up.set(0, 0, 1);
camera.position.set(80, -80, 60);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

const cameraNav = setupCameraControls({
  camera,
  controls,
  canvas,
  getFrameObjects: () => [binMesh, endBinMesh, partMesh],
  requestRender,
});
controls.addEventListener('change', requestRender);

// ---------------------------------------------------------------------------
// Lighting (three.js r155+ physical intensities, so brighter than legacy values)
// ---------------------------------------------------------------------------

scene.add(new THREE.AmbientLight(0xffffff, 1.0));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(50, -50, 80);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.7);
fillLight.position.set(-30, 30, -20);
scene.add(fillLight);

// ---------------------------------------------------------------------------
// Grid helper (XY plane, Z-up) — section lines at the gridfinity unit pitch
// ---------------------------------------------------------------------------

function createGrid(gridMM = GRID_MM) {
  const group = new THREE.Group();

  // Fine grid: 5mm cells over 250mm
  const fineGrid = new THREE.GridHelper(250, 50, sceneColors.gridCell, sceneColors.gridCell);
  fineGrid.rotation.x = Math.PI / 2;
  fineGrid.position.z = -0.02;
  group.add(fineGrid);

  // Section grid: 1 gridfinity unit per cell, 6 units across
  const sectionGrid = new THREE.GridHelper(gridMM * 6, 6, sceneColors.gridSection, sceneColors.gridSection);
  sectionGrid.rotation.x = Math.PI / 2;
  sectionGrid.position.z = -0.01;
  group.add(sectionGrid);

  return group;
}

let grid = createGrid();
let gridUnitMM = GRID_MM;
scene.add(grid);

function rebuildGrid() {
  scene.remove(grid);
  grid.traverse((obj) => { obj.geometry?.dispose(); obj.material?.dispose(); });
  grid = createGrid(gridUnitMM);
  scene.add(grid);
  requestRender();
}

// Axes helper (small, at origin)
const axes = new THREE.AxesHelper(15);
scene.add(axes);

// ---------------------------------------------------------------------------
// Bin mesh
// ---------------------------------------------------------------------------

// Meshes are closed and outward-facing (see gridfinity-geometry.js), so the
// default FrontSide is enough: back faces are culled instead of drawn.
let binMesh = null;
let endBinMesh = null;
// Parameters each mesh was last built from, to skip rebuilds that can't change it
let binKey = null;
let endBinKey = null;
// A wall mount's separate part (e.g. a SKÅDIS peg), shown beside the bin
let partMesh = null;
let partKey = null;
let partInfo = null;  // { name, count }

const binMaterial = new THREE.MeshStandardMaterial({
  color: sceneColors.bin,
  metalness: 0.1,
  roughness: 0.6,
  flatShading: true,  // face normals from screen-space derivatives; none stored
});

const endBinMaterial = new THREE.MeshStandardMaterial({
  color: sceneColors.endBin,
  metalness: 0.1,
  roughness: 0.6,
  flatShading: true,  // face normals from screen-space derivatives; none stored
});

const partMaterial = new THREE.MeshStandardMaterial({
  color: sceneColors.part,
  metalness: 0.1,
  roughness: 0.6,
  flatShading: true,  // face normals from screen-space derivatives; none stored
});

// What each separate part is called on the page
const PART_LABELS = {
  'skadis-peg': 'SKÅDIS peg',
  'skadis-washer': 'T-nut alignment washer',
  'hsw-connector': 'HSW connector',
  'goews-hanger': 'GOEWS hanger',
  'cleat-bar': 'Cleat bar',
};

// Viewer visibility/opacity per model, driven by the chips at the top of the viewport.
const modelView = {
  bin:    { label: 'Slanted bin', visible: true, opacity: 1, material: binMaterial,    mesh: () => binMesh },
  endBin: { label: 'End bin',     visible: true, opacity: 1, material: endBinMaterial, mesh: () => endBinMesh },
  part:   { label: 'Mount part',  visible: true, opacity: 1, material: partMaterial,   mesh: () => partMesh },
};

// Below full opacity a model turns transparent; below 0.9 it also stops
// writing depth, so the model behind it shows through.
function applyModelView(key) {
  const view = modelView[key];
  const { material } = view;
  const transparent = view.opacity < 1;
  if (material.transparent !== transparent) {
    // Switches shader variant; opacity and depthWrite alone don't need it
    material.transparent = transparent;
    material.needsUpdate = true;
  }
  material.opacity = view.opacity;
  material.depthWrite = view.opacity >= 0.9;
  const mesh = view.mesh();
  if (mesh) mesh.visible = view.visible;
  view.chip?.update({ active: view.visible, opacity: view.opacity });
  requestRender();
}

function createModelToggles() {
  const container = document.getElementById('model-toggles');
  for (const key of Object.keys(modelView)) {
    const view = modelView[key];
    view.chip = createModelToggleButton({
      label: view.label,
      active: view.visible,
      color: sceneColors[`${key}Chip`],
      opacity: view.opacity,
      onToggle: () => { view.visible = !view.visible; applyModelView(key); },
      onOpacityChange: (opacity) => { view.opacity = opacity; applyModelView(key); },
    });
    container.appendChild(view.chip.el);
    applyModelView(key);
  }
}

// Put `positions` into `mesh` (created on first use). Same-size updates — a
// wall-thickness change never alters the triangle count — overwrite the
// existing GPU buffer instead of allocating a new one.
function setMeshPositions(mesh, positions, material) {
  if (!mesh) {
    mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    scene.add(mesh);
  }
  const old = mesh.geometry;
  const attr = old.getAttribute('position');
  if (attr && attr.array.length === positions.length) {
    attr.array.set(positions);
    attr.needsUpdate = true;
  } else {
    mesh.geometry = new THREE.BufferGeometry();
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    old.dispose();
  }
  mesh.geometry.computeBoundingSphere();
  mesh.geometry.boundingBox = null;
  return mesh;
}

function updateBinMesh() {
  const params = readParams();

  // Main bin — doesn't depend on the end bin's size
  const { endGridX, endGridY, ui, ...binParams } = params;
  const key = JSON.stringify(binParams);
  if (key !== binKey) {
    binKey = key;
    const result = generateSlantedBin(binParams);
    binMesh = setMeshPositions(binMesh, result.positions, binMaterial);
    binMesh.visible = modelView.bin.visible;
    updateDimensionInfo(result.dimensions);
  }

  // End bin — only exists when a floor bin is slanted; it doesn't depend on
  // wall thickness or the wall mount
  const { wallThickness, orientation, wallSystem, mountMethod, ui: _ui, ...endParams } = params;
  const endKey = params.offsetUnits > 0 && orientation === 'horizontal' ? JSON.stringify(endParams) : null;
  if (endKey !== endBinKey) {
    endBinKey = endKey;
    if (endKey) {
      endBinMesh = setMeshPositions(endBinMesh, generateEndBin(endParams).positions, endBinMaterial);
      endBinMesh.visible = modelView.endBin.visible;
    } else if (endBinMesh) {
      scene.remove(endBinMesh);
      endBinMesh.geometry.dispose();
      endBinMesh = null;
    }
  }

  // Wall mount part — depends only on the back's size and the mount choice
  const pk = orientation === 'vertical'
    ? JSON.stringify({
      gridX: params.gridX, gridY: params.gridY, gridMM: params.gridMM, pitchX: params.pitchX, pitchY: params.pitchY,
      wallSystem, mountMethod, fitClearance: params.fitClearance,
    })
    : null;
  if (pk !== partKey) {
    partKey = pk;
    const part = pk ? generateWallPart(params) : null;
    partInfo = part ? { name: part.name, count: part.count } : null;
    if (part) {
      partMesh = setMeshPositions(partMesh, part.positions, partMaterial);
      partMesh.visible = modelView.part.visible;
    } else if (partMesh) {
      scene.remove(partMesh);
      partMesh.geometry.dispose();
      partMesh = null;
    }
  }
  if (partMesh) {
    // Lay it on the plate beside the bin, off its -Y side
    binMesh.geometry.computeBoundingBox();
    partMesh.geometry.computeBoundingBox();
    const b = binMesh.geometry.boundingBox, p = partMesh.geometry.boundingBox;
    partMesh.position.set(Math.max(b.min.x, 0) - p.min.x, b.min.y - 10 - p.max.y, 0);
  }

  // Hide the chips and downloads of models that don't exist right now
  const hasEndBin = Boolean(endBinMesh);
  if (modelView.endBin.chip) modelView.endBin.chip.el.style.display = hasEndBin ? '' : 'none';
  document.getElementById('download-end-bin').disabled = !hasEndBin;
  document.getElementById('download-end-bin-row').classList.toggle('disabled', !hasEndBin);
  document.getElementById('download-end-bin-row').style.display = orientation === 'vertical' ? 'none' : '';
  const hasPart = Boolean(partMesh);
  if (modelView.part.chip) modelView.part.chip.el.style.display = hasPart ? '' : 'none';
  document.getElementById('download-part-row').style.display = hasPart ? '' : 'none';
  document.getElementById('download-part').disabled = !hasPart;
  if (partInfo) {
    document.getElementById('download-part-label').textContent =
      `${PART_LABELS[partInfo.name] ?? 'Mount part'} (print ${partInfo.count})`;
  }
  updateExportButton();
}

// Inputs can fire many times per frame (slider drags); rebuild at most once
// per frame, just before rendering.
let rebuildPending = false;

function scheduleRebuild() {
  rebuildPending = true;
  requestRender();
}

function flushRebuild() {
  if (!rebuildPending) return;
  rebuildPending = false;
  updateBinMesh();
}

// Export is possible when at least one available model is selected
function updateExportButton() {
  const bin = document.getElementById('download-bin');
  const end = document.getElementById('download-end-bin');
  const part = document.getElementById('download-part');
  document.getElementById('export-stl').disabled =
    !bin.checked && !(end.checked && !end.disabled) && !(part.checked && !part.disabled);
}

// ---------------------------------------------------------------------------
// Theme (light default, dark optional)
// ---------------------------------------------------------------------------

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* storage unavailable */ }
  sceneColors = SCENE_PALETTES[theme];

  scene.background.set(sceneColors.viewerBg);
  rebuildGrid();

  binMaterial.color.set(sceneColors.bin);
  endBinMaterial.color.set(sceneColors.endBin);
  partMaterial.color.set(sceneColors.part);
  for (const key of Object.keys(modelView)) {
    modelView[key].chip?.update({ color: sceneColors[`${key}Chip`] });
  }

  updateThemeToggle();
}

function updateThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  const dark = currentTheme() === 'dark';
  btn.textContent = dark ? 'Light' : 'Dark';
  btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

// ---------------------------------------------------------------------------
// UI parameter reading
// ---------------------------------------------------------------------------

// Choices read from the page are checked against what the generator knows.
function readOrientation() {
  const v = document.querySelector('input[name="orientation"]:checked')?.value;
  return v === 'vertical' ? 'vertical' : 'horizontal';
}

function readWallSystem() {
  const v = document.getElementById('wall-system').value;
  return Object.hasOwn(WALL_SYSTEMS, v) ? v : DEFAULT_WALL_SYSTEM;
}

// The attachment for the current wall system, or null if it has no choice
function readMountMethod() {
  return resolveMethod(readWallSystem(), document.getElementById('mount-method').value);
}

// Fill the attachment picker with the wall system's methods, keeping the
// current choice when the new system has it too.
let methodSystem = null;
function syncMethodOptions() {
  const system = readWallSystem();
  if (system === methodSystem) return;
  methodSystem = system;
  const select = document.getElementById('mount-method');
  const previous = select.value;
  const methods = WALL_SYSTEMS[system].methods ?? {};
  select.replaceChildren(...Object.entries(methods).map(([key, { label }]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = label;
    return option;
  }));
  if (Object.hasOwn(methods, previous)) select.value = previous;
}

// Size inputs that count grid units; fractional when divisions > 1. The main
// bin's two (BIN_SIZE_IDS) take lengths instead when Size in is mm, cm or in.
const UNIT_INPUT_IDS = ['grid-x', 'grid-y', 'end-grid-x', 'end-grid-y'];
const BIN_SIZE_IDS = ['grid-x', 'grid-y'];
const MAX_UNITS = 20;

// Lengths a bin size can be typed in: mm per unit, input bounds and step
const LENGTH_UNITS = {
  mm: { mm: 1,    min: 10,  max: 840, step: 0.5,  digits: 1 },
  cm: { mm: 10,   min: 1,   max: 84,  step: 0.05, digits: 2 },
  in: { mm: 25.4, min: 0.4, max: 33,  step: 0.05, digits: 2 },
};

function readGridMM() {
  const v = parseFloat(document.getElementById('grid-unit-mm').value);
  return v >= 20 && v <= 100 ? v : GRID_MM;
}

function readDivisions() {
  return parseInt(document.getElementById('grid-divisions').value) || 1;
}

// 'units' or a key of LENGTH_UNITS
function readSizeUnit() {
  const v = document.getElementById('size-unit').value;
  return Object.hasOwn(LENGTH_UNITS, v) ? v : 'units';
}

function readOffsetMode() {
  return document.querySelector('input[name="offset-mode"]:checked')?.value === 'angle' ? 'angle' : 'grid';
}

// Browsers don't enforce min/max on typed values, so clamp to the input's own
// bounds; an unbounded size can generate enough geometry to hang the tab.
function readNumber(id, fallback, parse = parseFloat) {
  const el = document.getElementById(id);
  const v = parse(el.value);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Number(el.max), Math.max(Number(el.min), v));
}

// Read a grid-unit input, snapped to the nearest allowed division.
function readUnits(id, divisions = readDivisions()) {
  const v = parseFloat(document.getElementById(id).value);
  if (!(v > 0)) return 2;
  return snapUnits(v, divisions);
}

function snapUnits(v, divisions = readDivisions()) {
  return Math.min(MAX_UNITS, Math.max(1 / divisions, Math.round(v * divisions) / divisions));
}

// The pitch, in mm, of one grid unit along the bin's X and Y: on a wall the
// board's spacing across and up it (the Unit size for a system without one),
// in a drawer the Unit size both ways.
function readPitch() {
  const unit = readGridMM();
  if (readOrientation() !== 'vertical') return { x: unit, y: unit };
  const { across, up } = wallSpacing(readWallSystem(), unit);
  return { x: across, y: up };
}

// Whether the bin stands on Gridfinity feet, which need a whole foot under it
function hasFeet() {
  return readOrientation() === 'vertical'
    ? readWallSystem() === 'gridfinity'
    : document.getElementById('include-base').checked;
}

// The bin's size as generator units of the pitch. A size in a length is the
// bin's outside, so it takes TOLERANCE_MM less than units x pitch.
function readSize(divisions = readDivisions()) {
  const pitch = readPitch();
  const sizeUnit = readSizeUnit();
  if (sizeUnit === 'units') {
    return { gridX: readUnits('grid-x', divisions), gridY: readUnits('grid-y', divisions), pitchX: pitch.x, pitchY: pitch.y };
  }
  const { mm } = LENGTH_UNITS[sizeUnit];
  const min = hasFeet() ? 1 / divisions : 0;
  const units = (id, p) => Math.max(min, (readNumber(id, 80 / mm) * mm + TOLERANCE_MM) / p);
  return { gridX: units('grid-x', pitch.x), gridY: units('grid-y', pitch.y), pitchX: pitch.x, pitchY: pitch.y };
}

// Set the bin size inputs' bounds and step for the Size in choice.
function configureSizeInputs(divisions = readDivisions()) {
  const sizeUnit = readSizeUnit();
  const len = LENGTH_UNITS[sizeUnit];
  for (const id of BIN_SIZE_IDS) {
    const el = document.getElementById(id);
    el.min = String(len ? len.min : 1 / divisions);
    el.max = String(len ? len.max : MAX_UNITS);
    el.step = String(len ? len.step : 1 / divisions);
  }
}

// Size in changed from `from` to the current choice: carry each size over,
// so the bin stays as close to the same as the new steps allow.
let sizeUnitShown = null;
function applySizeUnit() {
  const from = sizeUnitShown, to = readSizeUnit();
  sizeUnitShown = to;
  if (from === null || from === to) { configureSizeInputs(); return; }
  const pitch = readPitch();
  const divisions = readDivisions();
  const values = BIN_SIZE_IDS.map((id, i) => {
    const p = i === 0 ? pitch.x : pitch.y;
    const v = parseFloat(document.getElementById(id).value);
    const outsideMM = from === 'units'
      ? snapUnits(v > 0 ? v : 2, divisions) * p - TOLERANCE_MM
      : (Number.isFinite(v) ? v : 0) * LENGTH_UNITS[from].mm;
    if (to === 'units') return String(snapUnits((outsideMM + TOLERANCE_MM) / p, divisions));
    const len = LENGTH_UNITS[to];
    const shown = Math.min(len.max, Math.max(len.min, outsideMM / len.mm));
    return String(Number(shown.toFixed(len.digits)));
  });
  configureSizeInputs(divisions);
  BIN_SIZE_IDS.forEach((id, i) => { document.getElementById(id).value = values[i]; });
}

// Match the size inputs' step/min to the division setting and snap their values.
function applyDivisions() {
  const divisions = readDivisions();
  const lengths = readSizeUnit() !== 'units';
  for (const id of UNIT_INPUT_IDS) {
    if (lengths && BIN_SIZE_IDS.includes(id)) continue;
    const el = document.getElementById(id);
    const snapped = readUnits(id, divisions);
    el.step = el.min = String(1 / divisions);
    el.value = String(snapped);
  }
}

// The slant, as an offset in mm and in grid units along the slant: Grid mode
// counts units of the pitch the slant runs along (up the wall on a wall);
// Angle mode leans the walls by that many degrees, up to the same 20-unit
// offset limit, which a steep angle on a short bin reaches before 90°.
function readSlant(mode = readOffsetMode()) {
  const vertical = readOrientation() === 'vertical';
  const pitch = readPitch();
  const axis = document.querySelector('input[name="offset-axis"]:checked')?.value === 'y' ? 'y' : 'x';
  const slantPitch = vertical || axis === 'y' ? pitch.y : pitch.x;
  const maxMM = MAX_UNITS * slantPitch;
  const wallH = Math.max(0, interiorHeightMM(readNumber('height-units', 12, parseInt)));
  if (mode === 'grid') {
    const units = readNumber('offset-units', 0);
    return { offsetMM: units * slantPitch, offsetUnits: units, slantPitch, wallH, capped: false };
  }
  const deg = readNumber('offset-angle', 0);
  const wanted = deg >= 90 ? Infinity : wallH * Math.tan(deg * Math.PI / 180);
  const offsetMM = Math.min(maxMM, wanted);
  return { offsetMM, offsetUnits: offsetMM / slantPitch, slantPitch, wallH, capped: wanted > maxMM, deg };
}

// Switching Grid / Angle carries the current slant over to the other input.
let offsetModeShown = null;
function applyOffsetMode() {
  const to = readOffsetMode();
  if (offsetModeShown !== null && offsetModeShown !== to) {
    const { offsetMM, slantPitch, wallH } = readSlant(offsetModeShown);
    if (to === 'angle') {
      const deg = wallH > 0 ? Math.atan2(offsetMM, wallH) * 180 / Math.PI : 0;
      document.getElementById('offset-angle').value = String(Math.round(deg * 2) / 2);
    } else {
      const units = Math.min(MAX_UNITS, Math.max(0, Math.round(offsetMM / slantPitch * 2) / 2));
      document.getElementById('offset-units').value = String(units);
    }
  }
  offsetModeShown = to;
}

// The end bin spans the slant, so its length along the offset axis tracks
// the offset (rounded down to the division step); the cross axis stays free.
function syncEndBinToOffset() {
  const divisions = readDivisions();
  const offset = readSlant().offsetUnits;
  if (!(offset > 0)) return;
  const axis = document.querySelector('input[name="offset-axis"]:checked')?.value || 'x';
  // Round down so a fractional offset never makes the end bin overshoot the slant
  const units = Math.min(MAX_UNITS, Math.max(1 / divisions, Math.floor(offset * divisions + 1e-9) / divisions));
  document.getElementById(axis === 'x' ? 'end-grid-x' : 'end-grid-y').value = String(units);
}

function readParams() {
  const divisions = readDivisions();
  const slant = readSlant();
  return {
    gridMM: readGridMM(),
    divisions,
    ...readSize(divisions),
    heightUnits: readNumber('height-units', 12, parseInt),
    offsetUnits: slant.offsetUnits,
    offsetMM: slant.offsetMM,
    offsetAxis: document.querySelector('input[name="offset-axis"]:checked')?.value === 'y' ? 'y' : 'x',
    wallThickness: readNumber('wall-thickness', 0.82),
    includeBase: document.getElementById('include-base').checked,
    orientation: readOrientation(),
    wallSystem: readWallSystem(),
    mountMethod: readMountMethod(),
    fitClearance: readNumber('fit-clearance', 0),
    endGridX: readUnits('end-grid-x', divisions),
    endGridY: readUnits('end-grid-y', divisions),
    // How the sizes and slant were set, for labels and file names only
    ui: {
      sizeUnit: readSizeUnit(),
      sizeX: readNumber('grid-x', 2),
      sizeY: readNumber('grid-y', 2),
      offsetMode: readOffsetMode(),
      offsetAngle: readNumber('offset-angle', 0),
      slantCapped: slant.capped,
    },
  };
}

// ---------------------------------------------------------------------------
// Dimension info display
// ---------------------------------------------------------------------------

function updateDimensionInfo(dims) {
  const mm = (v) => `${v.toFixed(1)} mm`;
  const pair = (a, b) => `${a.toFixed(1)} x ${b.toFixed(1)} mm`;
  // On a wall the bin is turned: its width and depth become width and
  // height on the wall (gridfinity-geometry.js), and its height the reach.
  const rows = dims.orientation === 'vertical' ? [
    ['Max pen length', mm(dims.maxPenLength), 'highlight', 'dims.maxPen'],
    ['Back (W x H)', pair(dims.outerDepth, dims.outerWidth)],
    ['Opening', pair(dims.innerDepth, dims.innerWidth)],
    ['Out from wall', mm(dims.totalHeight)],
    ['Interior depth', mm(dims.interiorHeight)],
    ['Mount', dims.mount.fits ? dims.mount.label : 'does not fit'],
    ['Offset up the wall', mm(dims.totalOffset)],
    ['Slant angle', `${dims.slantAngleDeg.toFixed(1)}° from level`],
    ['Slant diagonal', mm(dims.slantDiagonal)],
    ['Wall thickness', `${dims.wallThickness.toFixed(2)} mm`],
  ] : [
    ['Max pen length', mm(dims.maxPenLength), 'highlight', 'dims.maxPen'],
    ['Outer footprint', pair(dims.outerWidth, dims.outerDepth)],
    ['Interior', pair(dims.innerWidth, dims.innerDepth)],
    ['Total height', mm(dims.totalHeight)],
    ['Interior height', mm(dims.interiorHeight)],
    ['Base height', mm(dims.baseHeight)],
    ['Total offset', mm(dims.totalOffset)],
    ['Slant angle', `${dims.slantAngleDeg.toFixed(1)}° from vertical`],
    ['Slant diagonal', mm(dims.slantDiagonal)],
    ['Wall thickness', `${dims.wallThickness.toFixed(2)} mm`],
  ];
  // What the mount added, or why it couldn't, under the wall system picker
  document.getElementById('wall-system-val').textContent = dims.mount
    ? (dims.mount.fits ? dims.mount.text || 'magnet holes in the feet' : `none: ${dims.mount.text}`)
    : '';
  document.getElementById('dim-info').replaceChildren(...rows.map(([label, value, extra, help]) => {
    const row = document.createElement('div');
    row.className = extra ? `dim-row ${extra}` : 'dim-row';
    const name = document.createElement('span');
    name.textContent = label;
    if (help) {
      // A bare caption: its click does nothing else, so it opens help too
      name.dataset.help = help;
      name.dataset.helpClick = '';
    }
    const val = document.createElement('span');
    val.textContent = value;
    row.append(name, val);
    return row;
  }));
}

// ---------------------------------------------------------------------------
// UI event binding
// ---------------------------------------------------------------------------

function bindControls() {
  document.getElementById('theme-toggle').addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });
  updateThemeToggle();

  const controlIds = [
    'grid-unit-mm', 'grid-x', 'grid-y', 'height-units', 'offset-units', 'offset-angle',
    'wall-thickness', 'include-base', 'fit-clearance',
    'end-grid-x', 'end-grid-y',
  ];

  for (const id of controlIds) {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      // The end bin spans the slant, which the height sets too in Angle mode
      if (['offset-units', 'offset-angle', 'height-units', 'grid-unit-mm'].includes(id)) syncEndBinToOffset();
      updateValueDisplays();
      scheduleRebuild();
    });
  }

  // Snap a typed size like 1.3 to the nearest allowed step once it's committed
  for (const id of UNIT_INPUT_IDS) {
    document.getElementById(id).addEventListener('change', applyDivisions);
  }

  document.getElementById('size-unit').addEventListener('change', () => {
    applySizeUnit();
    updateValueDisplays();
    scheduleRebuild();
  });

  for (const radio of document.querySelectorAll('input[name="offset-mode"]')) {
    radio.addEventListener('change', () => {
      applyOffsetMode();
      applyOrientation();
      syncEndBinToOffset();
      updateValueDisplays();
      scheduleRebuild();
    });
  }

  // Unit size moves the scene's section lines too
  document.getElementById('grid-unit-mm').addEventListener('input', () => {
    const unit = readGridMM();
    if (unit !== gridUnitMM) {
      gridUnitMM = unit;
      rebuildGrid();
    }
  });

  document.getElementById('grid-divisions').addEventListener('change', () => {
    applyDivisions();
    configureSizeInputs();
    syncEndBinToOffset();
    updateValueDisplays();
    scheduleRebuild();
  });

  // Floor or wall: switch the controls that only apply to one, then reframe
  for (const radio of document.querySelectorAll('input[name="orientation"]')) {
    radio.addEventListener('change', () => {
      applyOrientation();
      updateValueDisplays();
      scheduleRebuild();
      flushRebuild();
      cameraNav.setView('iso');
    });
  }
  // A nozzle choice fills in its suggested clearance, which stays editable
  document.getElementById('nozzle').addEventListener('change', () => {
    const nozzle = NOZZLES.includes(document.getElementById('nozzle').value)
      ? Number(document.getElementById('nozzle').value) : 0.4;
    document.getElementById('fit-clearance').value = suggestedClearance(nozzle).toFixed(2);
    updateValueDisplays();
    scheduleRebuild();
  });

  // A wall system brings its board's spacing, so the sizes and offset in
  // grid units now mean different millimetres
  for (const id of ['wall-system', 'mount-method']) {
    document.getElementById(id).addEventListener('change', () => {
      applyOrientation();
      updateValueDisplays();
      scheduleRebuild();
    });
  }

  // Radio buttons
  for (const radio of document.querySelectorAll('input[name="offset-axis"]')) {
    radio.addEventListener('change', () => {
      syncEndBinToOffset();
      updateValueDisplays();
      scheduleRebuild();
    });
  }

  // Downloads: choose which models Export STL saves
  for (const id of ['download-bin', 'download-end-bin', 'download-part']) {
    document.getElementById(id).addEventListener('change', updateExportButton);
  }

  // Export STL — saves a separate file for each selected model
  document.getElementById('export-stl').addEventListener('click', () => {
    flushRebuild();
    if (!binMesh) return;
    const wantBin = document.getElementById('download-bin').checked;
    const wantEndBin = document.getElementById('download-end-bin').checked;
    const wantPart = document.getElementById('download-part').checked;
    const params = readParams();
    const { ui } = params;
    const vertical = params.orientation === 'vertical';
    // The Unit size only matters where no board spacing replaces it
    const ownSpacing = vertical && WALL_SYSTEMS[params.wallSystem].spacing;
    const unitTag = params.gridMM !== GRID_MM && !ownSpacing ? `_unit${params.gridMM}mm` : '';
    const axisTag = vertical ? 'up' : params.offsetAxis;
    const methodTag = vertical && params.mountMethod ? `-${params.mountMethod}` : '';
    const wallTag = vertical ? `_wall-${params.wallSystem}${methodTag}` : '';
    const fitTag = params.fitClearance ? `_fit${params.fitClearance > 0 ? '+' : ''}${params.fitClearance.toFixed(2)}` : '';
    // 2x2 in grid units, or 100mmx80mm; offset2x in grid units, or slant30degx
    const sizeTag = ui.sizeUnit === 'units' ? `${params.gridX}x${params.gridY}` : `${ui.sizeX}${ui.sizeUnit}x${ui.sizeY}${ui.sizeUnit}`;
    const slantTag = ui.offsetMode === 'angle' ? `${ui.offsetAngle}deg${axisTag}` : `${params.offsetUnits}${axisTag}`;
    const base = `slanted-gridfinity-${sizeTag}x${params.heightUnits}_${ui.offsetMode === 'angle' ? 'slant' : 'offset'}${slantTag}${unitTag}${wallTag}${fitTag}`;

    // Main bin
    if (wantBin) {
      downloadSTL(generateBinarySTL(binMesh.geometry.attributes.position.array), `${base}_bin.stl`);
    }

    // End bin (separate file)
    if (wantEndBin && endBinMesh) {
      downloadSTL(
        generateBinarySTL(endBinMesh.geometry.attributes.position.array), `${base}_support-wedge.stl`
      );
    }

    // Wall mount part (separate file, in its print orientation; print several)
    if (wantPart && partMesh && partInfo) {
      downloadSTL(
        generateBinarySTL(partMesh.geometry.attributes.position.array), `${base}_${partInfo.name}.stl`
      );
    }

    // Tell the page what was exported, e.g. 'both:2x2:h12:o2x', or
    // 'bin-part:2x1:h6:o1up' with a wall mount part ('100mmx80mm' for a size
    // in a length, 'a30degx' for a slant set by angle). The app itself sends
    // nothing anywhere; a site that hosts it can listen for this event to
    // count exports (README, "Embedding").
    const gotEnd = wantEndBin && endBinMesh;
    const gotPart = wantPart && partMesh && partInfo;
    const bins = wantBin && gotEnd ? 'both' : wantBin ? 'bin' : gotEnd ? 'end' : '';
    const parts = gotPart ? (bins ? `${bins}-part` : 'part') : bins;
    document.dispatchEvent(new CustomEvent('tool-action', {
      detail: {
        action: 'export',
        detail: `${parts}:${sizeTag}:h${params.heightUnits}:${ui.offsetMode === 'angle' ? 'a' : 'o'}${slantTag}`,
      },
    }));
  });

  // Dimensions overlay: on phones it shows only the max pen length until
  // tapped open (the toggle is inert on desktop, where every row shows).
  document.getElementById('dim-toggle').addEventListener('click', (e) => {
    const expanded = document.getElementById('info-overlay').classList.toggle('expanded');
    e.currentTarget.setAttribute('aria-expanded', String(expanded));
  });
}

// Print fit. The published fits assume a 0.4 mm nozzle; a wider one lays
// wider lines and rounder corners, so holes print smaller and pegs fatter.
// The suggestion adds half the nozzle's difference from 0.4 per side (a rule
// of thumb, not a measured value): -0.1, 0, +0.1, +0.2 mm.
const NOZZLES = ['0.2', '0.4', '0.6', '0.8'];
const suggestedClearance = (nozzle) => (nozzle - 0.4) / 2;

// On a wall the slant always runs up, the mount replaces the base, and
// there's no row to end, so those controls only show for a floor bin.
function applyOrientation() {
  const vertical = readOrientation() === 'vertical';
  const show = (id, on) => { document.getElementById(id).style.display = on ? '' : 'none'; };
  show('wall-system-row', vertical);
  // The attachment picker, for systems that offer more than one way to mount
  syncMethodOptions();
  const method = readMountMethod();
  show('mount-method-row', vertical && method !== null);
  document.getElementById('mount-method-val').textContent =
    method ? WALL_SYSTEMS[readWallSystem()].methods[method].hint : '';
  show('offset-axis-row', !vertical);
  show('base-section', !vertical);
  show('end-bin-section', !vertical);
  // A board with its own spacing replaces the Unit size input
  const ownSpacing = vertical && Boolean(WALL_SYSTEMS[readWallSystem()].spacing);
  show('grid-unit-mm', !ownSpacing);
  show('grid-unit-fixed', ownSpacing);
  const angle = readOffsetMode() === 'angle';
  show('offset-units-row', !angle);
  show('offset-angle-row', angle);
  document.getElementById('orientation-val').textContent = vertical ? 'on a wall' : 'in a drawer';
}

// mm with at most one decimal, no trailing zero: 40, 40.9
const fmtMM = (v) => String(Number(v.toFixed(1)));
// A pitch pair: '42' when square, '40.9 × 23.6' otherwise
const fmtPitch = ({ x, y }) => (Math.abs(x - y) < 1e-9 ? fmtMM(x) : `${fmtMM(x)} × ${fmtMM(y)}`);

function updateValueDisplays() {
  const params = readParams();
  const { ui, divisions } = params;
  const unit = readGridMM();
  const vertical = params.orientation === 'vertical';
  const pitch = { x: params.pitchX, y: params.pitchY };
  const system = WALL_SYSTEMS[params.wallSystem];
  const setText = (id, text) => { document.getElementById(id).textContent = text; };

  const fit = readNumber('fit-clearance', 0);
  setText('fit-clearance-val', fit === 0 ? 'mm per side; published fits' : `mm per side; ${fit > 0 ? 'looser' : 'tighter'}`);

  // Unit size: the board's spacing on a wall that has one, else the input
  if (vertical && system.spacing) {
    setText('grid-unit-fixed', `${fmtPitch(pitch)} mm`);
    setText('grid-unit-note', `${system.label.replace(/ \(.*\)$/, '')} spacing`);
  } else {
    setText('grid-unit-note', vertical && params.wallSystem === 'cleat' ? 'mm per unit; a cleat has no grid' : 'mm per grid unit');
  }

  // Divisions: the step, and the feet it makes where there are feet
  const step = { x: pitch.x / divisions, y: pitch.y / divisions };
  setText('grid-unit-val', hasFeet()
    ? (divisions > 1 ? `${1 / divisions}u steps, ${fmtMM(step.x)}mm feet` : `1u = ${fmtMM(unit)}mm${unit === GRID_MM ? ' (standard)' : ''}`)
    : `${divisions > 1 ? `${1 / divisions}u steps` : '1u'} = ${fmtPitch(step)}mm`);

  // Size in, and what the two size inputs mean
  const across = vertical ? 'across × up the wall' : 'X × Y';
  if (ui.sizeUnit === 'units') {
    setText('size-unit-val', `of ${fmtPitch(pitch)} mm`);
    setText('grid-size-val', `${across}, units`);
  } else {
    setText('size-unit-val', 'any size');
    // Feet need a whole foot under the bin, so a smaller size grows to one
    const minMM = (1 / divisions) * unit - TOLERANCE_MM;
    const raised = hasFeet() && Math.min(ui.sizeX, ui.sizeY) * LENGTH_UNITS[ui.sizeUnit].mm < minMM - 1e-6;
    const feet = hasFeet()
      ? `, ${footCount(params.gridX, divisions)} × ${footCount(params.gridY, divisions)} feet${raised ? `; at least ${fmtMM(minMM)}mm` : ''}`
      : '';
    setText('grid-size-val', `${across} outside, ${ui.sizeUnit}${feet}`);
  }

  // Height
  const hu = params.heightUnits;
  setText('height-units-val', `${(hu * HEIGHT_UNIT_MM).toFixed(0)}mm total, ${interiorHeightMM(hu).toFixed(0)}mm inside`);

  // Slant: offset and angle are two views of one lean
  const wallH = Math.max(0, interiorHeightMM(hu));
  const deg = wallH > 0 ? Math.atan2(params.offsetMM, wallH) * 180 / Math.PI : 0;
  const from = vertical ? 'from level' : 'from vertical';
  setText('offset-mode-val', ui.offsetMode === 'angle' ? 'any angle' : 'opening on the grid');
  setText('offset-units-val', `${vertical ? 'units up the wall' : 'grid units'}, ${params.offsetMM.toFixed(0)}mm, ${deg.toFixed(1)}°`);
  setText('offset-angle-val', ui.slantCapped
    ? `° ${from}; capped at ${params.offsetMM.toFixed(0)}mm offset, ${deg.toFixed(1)}°`
    : `° ${from}, ${params.offsetMM.toFixed(0)}mm offset`);

  // Max pen length: 3D diagonal from one bottom interior corner to the
  // opposite top interior corner.  Uses interior dimensions (innerW/innerD)
  // so the measurement reflects the actual space a pen can occupy.
  const wt = params.wallThickness;
  const intW = params.gridX * params.pitchX - TOLERANCE_MM - 2 * wt;
  const intD = params.gridY * params.pitchY - TOLERANCE_MM - 2 * wt;
  // On a wall the slant runs up the bin's Y size (its height on the wall)
  const axis = vertical ? 'y' : params.offsetAxis;
  // Pen spans from bottom near-corner to top far-corner of interior
  const spanOffset = params.offsetMM + (axis === 'x' ? intW : intD);
  const spanCross = axis === 'x' ? intD : intW;
  const maxPen = Math.sqrt(spanOffset * spanOffset + spanCross * spanCross + wallH * wallH);
  setText('diagonal-val', `Max pen length: ${maxPen.toFixed(1)}mm`);
  setText('wall-thickness-val', `${wt.toFixed(2)}mm`);
}

// ---------------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------------

function onResize() {
  const container = canvas.parentElement;
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);  // resizing clears the canvas; redraw before it's shown
}

// Also covers window resizes, since the container tracks the window.
new ResizeObserver(onResize).observe(canvas.parentElement);

// ---------------------------------------------------------------------------
// Rendering — on demand: a frame is drawn only when something changed, and
// frames continue only while a view transition or orbit damping is moving.
// ---------------------------------------------------------------------------

let renderRequested = false;

function requestRender() {
  if (renderRequested) return;
  renderRequested = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame() {
  renderRequested = false;
  flushRebuild();
  const tweening = cameraNav.update();
  const moving = controls.update();  // true until damping settles
  renderer.render(scene, camera);
  if (tweening || moving) requestRender();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

// Inputs the browser restored on reload count as the current choice
sizeUnitShown = readSizeUnit();
offsetModeShown = readOffsetMode();
configureSizeInputs();
syncEndBinToOffset();
applyOrientation();
updateValueDisplays();
createModelToggles();
updateBinMesh();
cameraNav.setView('iso', { animate: false });
requestRender();
bindControls();
initParamHelp({ getContext: readParams });  // after updateBinMesh, so its check sees the Dimensions rows
