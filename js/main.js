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
  GRID_MM, HEIGHT_UNIT_MM, BASE_HEIGHT_MM,
  binOuterMM, interiorHeightMM, interiorWidthMM,
} from './gridfinity-geometry.js';
import { WALL_SYSTEMS, DEFAULT_WALL_SYSTEM, resolveMethod } from './wall-mounts.js';
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
  const { endGridX, endGridY, ...binParams } = params;
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
  const { wallThickness, orientation, wallSystem, mountMethod, ...endParams } = params;
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
      gridX: params.gridX, gridY: params.gridY, gridMM: params.gridMM, wallSystem, mountMethod,
      fitClearance: params.fitClearance,
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

// Size inputs that count grid units; fractional when divisions > 1.
const UNIT_INPUT_IDS = ['grid-x', 'grid-y', 'end-grid-x', 'end-grid-y'];

function readGridMM() {
  const v = parseFloat(document.getElementById('grid-unit-mm').value);
  return v >= 20 && v <= 100 ? v : GRID_MM;
}

function readDivisions() {
  return parseInt(document.getElementById('grid-divisions').value) || 1;
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
  const max = Number(document.getElementById(id).max);
  return Math.min(max, Math.max(1 / divisions, Math.round(v * divisions) / divisions));
}

// Match the size inputs' step/min to the division setting and snap their values.
function applyDivisions() {
  const divisions = readDivisions();
  for (const id of UNIT_INPUT_IDS) {
    const el = document.getElementById(id);
    const snapped = readUnits(id, divisions);
    el.step = el.min = String(1 / divisions);
    el.value = String(snapped);
  }
}

// The end bin spans the slant, so its length along the offset axis tracks
// the offset (rounded down to the division step); the cross axis stays free.
function syncEndBinToOffset() {
  const divisions = readDivisions();
  const offset = readNumber('offset-units', 0);
  if (!(offset > 0)) return;
  const axis = document.querySelector('input[name="offset-axis"]:checked')?.value || 'x';
  // Round down so a fractional offset never makes the end bin overshoot the slant
  const units = Math.max(1 / divisions, Math.floor(offset * divisions + 1e-9) / divisions);
  document.getElementById(axis === 'x' ? 'end-grid-x' : 'end-grid-y').value = String(units);
}

function readParams() {
  const divisions = readDivisions();
  return {
    gridMM: readGridMM(),
    divisions,
    gridX: readUnits('grid-x', divisions),
    gridY: readUnits('grid-y', divisions),
    heightUnits: readNumber('height-units', 12, parseInt),
    offsetUnits: readNumber('offset-units', 0),
    offsetAxis: document.querySelector('input[name="offset-axis"]:checked')?.value || 'x',
    wallThickness: readNumber('wall-thickness', 0.82),
    includeBase: document.getElementById('include-base').checked,
    orientation: readOrientation(),
    wallSystem: readWallSystem(),
    mountMethod: readMountMethod(),
    fitClearance: readNumber('fit-clearance', 0),
    endGridX: readUnits('end-grid-x', divisions),
    endGridY: readUnits('end-grid-y', divisions),
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
    'grid-unit-mm', 'grid-x', 'grid-y', 'height-units', 'offset-units',
    'wall-thickness', 'include-base', 'fit-clearance',
    'end-grid-x', 'end-grid-y',
  ];

  for (const id of controlIds) {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      if (id === 'offset-units') syncEndBinToOffset();
      updateValueDisplays();
      scheduleRebuild();
    });
  }

  // Snap a typed size like 1.3 to the nearest allowed step once it's committed
  for (const id of UNIT_INPUT_IDS) {
    document.getElementById(id).addEventListener('change', applyDivisions);
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
    syncEndBinToOffset();
    updateValueDisplays();
    scheduleRebuild();
  });

  // Floor or wall: switch the controls that only apply to one, then reframe
  for (const radio of document.querySelectorAll('input[name="orientation"]')) {
    radio.addEventListener('change', () => {
      applyOrientation();
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

  for (const id of ['wall-system', 'mount-method']) {
    document.getElementById(id).addEventListener('change', () => {
      applyOrientation();
      scheduleRebuild();
    });
  }

  // Radio buttons
  for (const radio of document.querySelectorAll('input[name="offset-axis"]')) {
    radio.addEventListener('change', () => {
      syncEndBinToOffset();
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
    const unitTag = params.gridMM !== GRID_MM ? `_unit${params.gridMM}mm` : '';
    const vertical = params.orientation === 'vertical';
    const axisTag = vertical ? 'up' : params.offsetAxis;
    const methodTag = vertical && params.mountMethod ? `-${params.mountMethod}` : '';
    const wallTag = vertical ? `_wall-${params.wallSystem}${methodTag}` : '';
    const fitTag = params.fitClearance ? `_fit${params.fitClearance > 0 ? '+' : ''}${params.fitClearance.toFixed(2)}` : '';
    const base = `slanted-gridfinity-${params.gridX}x${params.gridY}x${params.heightUnits}_offset${params.offsetUnits}${axisTag}${unitTag}${wallTag}${fitTag}`;

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
  document.getElementById('orientation-val').textContent = vertical ? 'on a wall' : 'in a drawer';
  document.getElementById('grid-size-val').textContent = vertical ? 'width × height on the wall' : 'X × Y units';
}

function updateValueDisplays() {
  const unit = readGridMM();
  const divisions = readDivisions();

  const fit = readNumber('fit-clearance', 0);
  document.getElementById('fit-clearance-val').textContent =
    fit === 0 ? 'mm per side; published fits' : `mm per side; ${fit > 0 ? 'looser' : 'tighter'}`;

  // Grid unit
  document.getElementById('grid-unit-val').textContent = divisions > 1
    ? `${1 / divisions}u steps, ${(unit / divisions).toFixed(1)}mm feet`
    : `1u = ${unit}mm${unit === GRID_MM ? ' (standard)' : ''}`;

  // Height
  const hu = readNumber('height-units', 1, parseInt);
  document.getElementById('height-units-val').textContent =
    `${(hu * HEIGHT_UNIT_MM).toFixed(0)}mm total, ${interiorHeightMM(hu).toFixed(0)}mm inside`;

  // Offset
  const ou = readNumber('offset-units', 0);
  document.getElementById('offset-units-val').textContent =
    `grid units, ${(ou * unit).toFixed(0)}mm`;

  // Max pen length: 3D diagonal from one bottom interior corner to the
  // opposite top interior corner.  Uses interior dimensions (innerW/innerD)
  // so the measurement reflects the actual space a pen can occupy.
  const wt = readNumber('wall-thickness', 0.82);
  const gx = readUnits('grid-x', divisions);
  const gy = readUnits('grid-y', divisions);
  const intH = interiorHeightMM(hu);
  const totalOff = ou * unit;
  const intW = interiorWidthMM(gx, wt, unit);
  const intD = interiorWidthMM(gy, wt, unit);
  // On a wall the slant runs up the bin's Y size (its height on the wall)
  const axis = readOrientation() === 'vertical'
    ? 'y' : document.querySelector('input[name="offset-axis"]:checked')?.value || 'x';
  // Pen spans from bottom near-corner to top far-corner of interior
  const spanOffset = totalOff + (axis === 'x' ? intW : intD);
  const spanCross = axis === 'x' ? intD : intW;
  const maxPen = Math.sqrt(spanOffset * spanOffset + spanCross * spanCross + intH * intH);
  document.getElementById('diagonal-val').textContent =
    `Max pen length: ${maxPen.toFixed(1)}mm`;
  document.getElementById('wall-thickness-val').textContent = `${wt.toFixed(2)}mm`;
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

syncEndBinToOffset();
applyOrientation();
updateValueDisplays();
createModelToggles();
updateBinMesh();
cameraNav.setView('iso', { animate: false });
requestRender();
bindControls();
initParamHelp({ getContext: readParams });  // after updateBinMesh, so its check sees the Dimensions rows
