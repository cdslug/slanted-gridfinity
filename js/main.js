/**
 * main.js — Three.js scene, UI controls, and application logic.
 *
 * 3D preview:
 *   Camera: fov 50, Z-up, opens on a fitted iso view
 *   Colors: Form Fit Print "Filament" palette, light (default) or dark
 *           (SCENE_PALETTES below; theme set on <html data-theme>)
 *   Ambient 1.0, directional 1.8 + fill 0.7
 *   Grid on XY plane, 42mm section lines
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  generateSlantedBin,
  generateEndBin,
  GRID_MM, HEIGHT_UNIT_MM, BASE_HEIGHT_MM,
  binOuterMM, interiorHeightMM, interiorWidthMM,
} from './gridfinity-geometry.js';
import { generateBinarySTL, downloadSTL } from './stl-export.js';
import { setupCameraControls } from './camera-controls.js';

// ---------------------------------------------------------------------------
// Scene colors — mirrors form-fit-print/frontend/src/theme/palette.js
// ---------------------------------------------------------------------------

const SCENE_PALETTES = {
  light: {
    viewerBg:     '#e8e1d4',
    gridCell:     '#ddd3c2',
    gridSection:  '#cbbfa8',
    bin:          '#f5c242',  // brand gold; palette's deeper #cf9a10 shades to brown here
    endBin:       '#4f8a3c',  // mesh.sweep (green)
    wireframe:    '#7d7160',  // textMuted
    crossSection: '#bd6f12',  // warn
  },
  dark: {
    viewerBg:     '#0f0d0b',
    gridCell:     '#2e2a24',
    gridSection:  '#3a352d',
    bin:          '#f5c242',  // mesh.result (brand gold)
    endBin:       '#6aa84f',  // mesh.sweep (green)
    wireframe:    '#9a8f7e',  // textMuted
    crossSection: '#e08a2e',  // warn (orange, distinct from gold)
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
renderer.setPixelRatio(window.devicePixelRatio);
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
  getFrameObjects: () => [binMesh, endBinMesh],
});

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
// Grid helper (XY plane, Z-up) — 42mm section lines for gridfinity units
// ---------------------------------------------------------------------------

function createGrid() {
  const group = new THREE.Group();

  // Fine grid: 5mm cells over 250mm
  const fineGrid = new THREE.GridHelper(250, 50, sceneColors.gridCell, sceneColors.gridCell);
  fineGrid.rotation.x = Math.PI / 2;
  fineGrid.position.z = -0.02;
  group.add(fineGrid);

  // Section grid: 42mm (1 gridfinity unit) over 252mm (6 units)
  const sectionGrid = new THREE.GridHelper(252, 6, sceneColors.gridSection, sceneColors.gridSection);
  sectionGrid.rotation.x = Math.PI / 2;
  sectionGrid.position.z = -0.01;
  group.add(sectionGrid);

  return group;
}

let grid = createGrid();
scene.add(grid);

// Axes helper (small, at origin)
const axes = new THREE.AxesHelper(15);
scene.add(axes);

// ---------------------------------------------------------------------------
// Bin mesh
// ---------------------------------------------------------------------------

let binMesh = null;
let binWireframe = null;
let endBinMesh = null;
let endBinWireframe = null;
let currentGeomResult = null;
let currentEndBinResult = null;

const binMaterial = new THREE.MeshStandardMaterial({
  color: sceneColors.bin,
  metalness: 0.1,
  roughness: 0.6,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.85,
});

const endBinMaterial = new THREE.MeshStandardMaterial({
  color: sceneColors.endBin,
  metalness: 0.1,
  roughness: 0.6,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.85,
});

const wireframeMaterial = new THREE.LineBasicMaterial({
  color: sceneColors.wireframe,
  transparent: true,
  opacity: 0.3,
});

function updateBinMesh() {
  // Remove old meshes
  if (binMesh) { scene.remove(binMesh); binMesh.geometry.dispose(); }
  if (binWireframe) { scene.remove(binWireframe); binWireframe.geometry.dispose(); }
  if (endBinMesh) { scene.remove(endBinMesh); endBinMesh.geometry.dispose(); endBinMesh = null; }
  if (endBinWireframe) { scene.remove(endBinWireframe); endBinWireframe.geometry.dispose(); endBinWireframe = null; }

  const params = readParams();
  const result = generateSlantedBin(params);
  currentGeomResult = result;
  currentEndBinResult = null;

  // Main bin mesh
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
  binMesh = new THREE.Mesh(geom, binMaterial);
  scene.add(binMesh);

  // End bin (if enabled)
  if (params.endBinEnabled && params.offsetUnits > 0) {
    const endResult = generateEndBin({
      ...params,
      endGridX: params.endGridX,
      endGridY: params.endGridY,
    });
    currentEndBinResult = endResult;

    const endGeom = new THREE.BufferGeometry();
    endGeom.setAttribute('position', new THREE.BufferAttribute(endResult.positions, 3));
    endGeom.setAttribute('normal', new THREE.BufferAttribute(endResult.normals, 3));
    endBinMesh = new THREE.Mesh(endGeom, endBinMaterial);
    scene.add(endBinMesh);
  }

  // Wireframe overlays
  if (document.getElementById('show-wireframe').checked) {
    const wireGeom = new THREE.WireframeGeometry(geom);
    binWireframe = new THREE.LineSegments(wireGeom, wireframeMaterial);
    scene.add(binWireframe);

    if (endBinMesh) {
      const endWireGeom = new THREE.WireframeGeometry(endBinMesh.geometry);
      endBinWireframe = new THREE.LineSegments(endWireGeom, wireframeMaterial);
      scene.add(endBinWireframe);
    }
  }

  // Update dimension readouts
  updateDimensionInfo(result.dimensions);
}

// ---------------------------------------------------------------------------
// Cross-section plane indicator
// ---------------------------------------------------------------------------

let crossSectionPlane = null;

function updateCrossSectionPlane() {
  if (crossSectionPlane) {
    scene.remove(crossSectionPlane);
    crossSectionPlane.geometry.dispose();
  }

  if (!document.getElementById('show-cross-section').checked || !currentGeomResult) return;

  const zSlider = document.getElementById('cross-section-z');
  const d = currentGeomResult.dimensions;
  const zFrac = parseFloat(zSlider.value) / 100;
  const z = zFrac * d.interiorHeight;

  // Show the XY cross-section plane
  const planeSize = Math.max(d.outerWidth, d.outerDepth) + d.totalOffset + 20;
  const planeGeom = new THREE.PlaneGeometry(planeSize, planeSize);
  const planeMat = new THREE.MeshBasicMaterial({
    color: sceneColors.crossSection,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  crossSectionPlane = new THREE.Mesh(planeGeom, planeMat);
  // Offset plane center to follow the slant
  const params = readParams();
  const frac = d.interiorHeight > 0 ? z / d.interiorHeight : 0;
  const ox = params.offsetAxis === 'x' ? frac * d.totalOffset : 0;
  const oy = params.offsetAxis === 'y' ? frac * d.totalOffset : 0;
  crossSectionPlane.position.set(ox, oy, z);
  scene.add(crossSectionPlane);

  // Update Z label
  document.getElementById('cross-section-z-val').textContent = z.toFixed(1);
}

// ---------------------------------------------------------------------------
// Theme (light default, dark optional)
// ---------------------------------------------------------------------------

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* storage unavailable */ }
  sceneColors = SCENE_PALETTES[theme];

  scene.background.set(sceneColors.viewerBg);
  scene.remove(grid);
  grid.traverse((obj) => { obj.geometry?.dispose(); obj.material?.dispose(); });
  grid = createGrid();
  scene.add(grid);

  binMaterial.color.set(sceneColors.bin);
  endBinMaterial.color.set(sceneColors.endBin);
  wireframeMaterial.color.set(sceneColors.wireframe);
  crossSectionPlane?.material.color.set(sceneColors.crossSection);

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

function readParams() {
  return {
    gridX: parseInt(document.getElementById('grid-x').value) || 2,
    gridY: parseInt(document.getElementById('grid-y').value) || 2,
    heightUnits: parseInt(document.getElementById('height-units').value) || 13,
    offsetUnits: parseFloat(document.getElementById('offset-units').value) || 0,
    offsetAxis: document.querySelector('input[name="offset-axis"]:checked')?.value || 'x',
    wallThickness: parseFloat(document.getElementById('wall-thickness').value) || 0.82,
    includeBase: document.getElementById('include-base').checked,
    cornerSegments: parseInt(document.getElementById('corner-segments').value) || 8,
    endBinEnabled: document.getElementById('end-bin-enabled').checked,
    endGridX: parseInt(document.getElementById('end-grid-x').value) || 2,
    endGridY: parseInt(document.getElementById('end-grid-y').value) || 2,
  };
}

// ---------------------------------------------------------------------------
// Dimension info display
// ---------------------------------------------------------------------------

function updateDimensionInfo(dims) {
  const el = document.getElementById('dim-info');
  el.innerHTML = `
    <div class="dim-row"><span>Outer footprint</span><span>${dims.outerWidth.toFixed(1)} x ${dims.outerDepth.toFixed(1)} mm</span></div>
    <div class="dim-row"><span>Interior</span><span>${dims.innerWidth.toFixed(1)} x ${dims.innerDepth.toFixed(1)} mm</span></div>
    <div class="dim-row"><span>Total height</span><span>${dims.totalHeight.toFixed(1)} mm</span></div>
    <div class="dim-row"><span>Interior height</span><span>${dims.interiorHeight.toFixed(1)} mm</span></div>
    <div class="dim-row"><span>Base height</span><span>${dims.baseHeight.toFixed(1)} mm</span></div>
    <div class="dim-row"><span>Total offset</span><span>${dims.totalOffset.toFixed(1)} mm</span></div>
    <div class="dim-row"><span>Slant angle</span><span>${dims.slantAngleDeg.toFixed(1)}&deg; from vertical</span></div>
    <div class="dim-row"><span>Slant diagonal</span><span>${dims.slantDiagonal.toFixed(1)} mm</span></div>
    <div class="dim-row highlight"><span>Max pen length</span><span>${dims.maxPenLength.toFixed(1)} mm</span></div>
    <div class="dim-row"><span>Wall thickness</span><span>${dims.wallThickness.toFixed(2)} mm</span></div>
  `;
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
    'grid-x', 'grid-y', 'height-units', 'offset-units',
    'wall-thickness', 'include-base', 'corner-segments',
    'end-grid-x', 'end-grid-y',
  ];

  for (const id of controlIds) {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      updateValueDisplays();
      updateBinMesh();
      updateCrossSectionPlane();
    });
  }

  // Radio buttons
  for (const radio of document.querySelectorAll('input[name="offset-axis"]')) {
    radio.addEventListener('change', () => {
      updateBinMesh();
      updateCrossSectionPlane();
    });
  }

  // End bin toggle
  document.getElementById('end-bin-enabled').addEventListener('change', () => {
    const panel = document.getElementById('end-bin-controls');
    panel.style.display = document.getElementById('end-bin-enabled').checked ? 'block' : 'none';
    updateBinMesh();
    updateCrossSectionPlane();
  });

  // Wireframe toggle
  document.getElementById('show-wireframe').addEventListener('change', () => {
    updateBinMesh();
  });

  // Cross-section toggle and slider
  document.getElementById('show-cross-section').addEventListener('change', () => {
    const panel = document.getElementById('cross-section-controls');
    panel.style.display = document.getElementById('show-cross-section').checked ? 'flex' : 'none';
    updateCrossSectionPlane();
  });

  document.getElementById('cross-section-z').addEventListener('input', () => {
    updateCrossSectionPlane();
  });

  // Export STL — saves separate files for main bin and end bin
  document.getElementById('export-stl').addEventListener('click', () => {
    if (!currentGeomResult) return;
    const params = readParams();
    const base = `slanted-gridfinity-${params.gridX}x${params.gridY}x${params.heightUnits}_offset${params.offsetUnits}${params.offsetAxis}`;

    // Main bin
    const mainBuf = generateBinarySTL(
      currentGeomResult.positions, currentGeomResult.normals, currentGeomResult.triangleCount
    );
    downloadSTL(mainBuf, `${base}_bin.stl`);

    // End bin (separate file)
    if (currentEndBinResult) {
      const endBuf = generateBinarySTL(
        currentEndBinResult.positions, currentEndBinResult.normals, currentEndBinResult.triangleCount
      );
      downloadSTL(endBuf, `${base}_support-wedge.stl`);
    }
  });

  // Standard views
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => cameraNav.setView(btn.dataset.view));
  }
  document.getElementById('fit-view').addEventListener('click', () => cameraNav.fit());

  // Wheel/trackpad interpretation
  const inputModeSelect = document.getElementById('input-mode');
  inputModeSelect.value = cameraNav.inputMode;
  inputModeSelect.addEventListener('change', (e) => {
    cameraNav.setInputMode(e.target.value);
  });

  // Controls help
  document.getElementById('toggle-help').addEventListener('click', () => {
    document.getElementById('nav-help').classList.toggle('hidden');
  });
}

function updateValueDisplays() {
  // Height
  const hu = parseInt(document.getElementById('height-units').value) || 1;
  document.getElementById('height-units-val').textContent =
    `${hu}u = ${(hu * HEIGHT_UNIT_MM).toFixed(0)}mm total, ${interiorHeightMM(hu).toFixed(0)}mm interior`;

  // Offset
  const ou = parseFloat(document.getElementById('offset-units').value) || 0;
  document.getElementById('offset-units-val').textContent =
    `${ou}u = ${(ou * GRID_MM).toFixed(0)}mm`;

  // Max pen length: 3D diagonal from one bottom interior corner to the
  // opposite top interior corner.  Uses interior dimensions (innerW/innerD)
  // so the measurement reflects the actual space a pen can occupy.
  const wt = parseFloat(document.getElementById('wall-thickness').value) || 0.82;
  const gx = parseInt(document.getElementById('grid-x').value) || 2;
  const gy = parseInt(document.getElementById('grid-y').value) || 2;
  const intH = interiorHeightMM(hu);
  const totalOff = ou * GRID_MM;
  const intW = interiorWidthMM(gx, wt);
  const intD = interiorWidthMM(gy, wt);
  const axis = document.querySelector('input[name="offset-axis"]:checked')?.value || 'x';
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
}

window.addEventListener('resize', onResize);
new ResizeObserver(onResize).observe(canvas.parentElement);

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function animate() {
  requestAnimationFrame(animate);
  cameraNav.update();
  controls.update();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

updateValueDisplays();
updateBinMesh();
cameraNav.setView('iso', { animate: false });
animate();
bindControls();
