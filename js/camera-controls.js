/**
 * camera-controls.js — CAD-style navigation layered on top of OrbitControls.
 *
 * Mouse:
 *   Left drag          orbit
 *   Right/middle drag  pan   (Shift/Cmd + left drag also pans)
 *   Wheel              zoom toward cursor
 *
 * Trackpad (macOS) — scroll gestures need input mode "trackpad" (or "auto"):
 *   Two-finger scroll          orbit
 *   Shift + two-finger scroll  pan
 *   Pinch                      zoom toward cursor
 *   Click-drag / two-finger click-drag  orbit / pan (same as mouse)
 *
 * Smooth-scrolling mice send the same events as trackpads, so the input mode
 * defaults to "mouse" (scroll always zooms) and is remembered per browser.
 *
 * Keys: 1 Front, 2 Back, 3 Right, 4 Left, 5 Top, 6 Bottom, 0 Iso, F Fit.
 *
 * The scene is Z-up, so "front" looks along +Y and "top" looks down -Z.
 */

import * as THREE from 'three';

const ORBIT_SPEED = 0.006;        // radians per pixel of scroll/drag
const WHEEL_ZOOM_SPEED = 0.0015;  // per pixel of mouse-wheel delta
const PINCH_ZOOM_SPEED = 0.01;    // per pixel of ctrl+wheel (pinch) delta
const LINE_HEIGHT_PX = 33;        // for wheel events reported in lines
const TRACKPAD_STICKY_MS = 400;   // keep a trackpad classification through momentum
const MIN_DISTANCE = 5;
const MAX_DISTANCE = 1500;
const POLAR_EPS = 1e-4;
const FIT_MARGIN = 1.15;
const TWEEN_MS = 350;
const INPUT_MODES = ['mouse', 'trackpad', 'auto'];
const INPUT_MODE_STORAGE_KEY = 'slanted-gridfinity.inputMode';

// Directions from target to camera.
const VIEW_DIRECTIONS = {
  front:  new THREE.Vector3(0, -1, 0),
  back:   new THREE.Vector3(0, 1, 0),
  right:  new THREE.Vector3(1, 0, 0),
  left:   new THREE.Vector3(-1, 0, 0),
  top:    new THREE.Vector3(0, -POLAR_EPS, 1).normalize(),
  bottom: new THREE.Vector3(0, -POLAR_EPS, -1).normalize(),
  iso:    new THREE.Vector3(80, -80, 60).normalize(),
};

const VIEW_KEYS = {
  '1': 'front', '2': 'back', '3': 'right', '4': 'left',
  '5': 'top', '6': 'bottom', '0': 'iso',
};

/**
 * @param {object} opts
 * @param {THREE.PerspectiveCamera} opts.camera
 * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} opts.controls
 * @param {HTMLCanvasElement} opts.canvas
 * @param {() => THREE.Object3D[]} opts.getFrameObjects  objects to fit in view
 */
export function setupCameraControls({ camera, controls, canvas, getFrameObjects }) {
  // Mouse buttons: CAD-style middle-button pan; we handle wheel ourselves.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.enableZoom = false;
  controls.screenSpacePanning = true;

  let inputMode = loadInputMode();
  let lastTrackpadTime = -Infinity;
  let gestureActive = false;
  let tween = null;

  const raycaster = new THREE.Raycaster();
  const tmpV = new THREE.Vector3();

  // -------------------------------------------------------------------------
  // Primitive camera moves
  // -------------------------------------------------------------------------

  function orbit(dxPx, dyPx) {
    const offset = tmpV.copy(camera.position).sub(controls.target);
    const r = offset.length();
    const theta = Math.atan2(offset.y, offset.x) - dxPx * ORBIT_SPEED;
    const phi = THREE.MathUtils.clamp(
      Math.acos(THREE.MathUtils.clamp(offset.z / r, -1, 1)) - dyPx * ORBIT_SPEED,
      POLAR_EPS, Math.PI - POLAR_EPS,
    );
    offset.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    );
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
  }

  function pan(dxPx, dyPx) {
    const dist = camera.position.distanceTo(controls.target);
    const worldPerPx =
      2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / canvas.clientHeight;
    camera.updateMatrix();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    const move = right.multiplyScalar(-dxPx * worldPerPx)
      .add(up.multiplyScalar(dyPx * worldPerPx));
    camera.position.add(move);
    controls.target.add(move);
  }

  /** Scale camera distance by `factor` (<1 zooms in), keeping the point under the cursor fixed. */
  function zoomAt(factor, clientX, clientY) {
    const dist = camera.position.distanceTo(controls.target);
    const newDist = THREE.MathUtils.clamp(dist * factor, MIN_DISTANCE, MAX_DISTANCE);
    const s = newDist / dist;

    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const viewDir = camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, controls.target);
    raycaster.setFromCamera(ndc, camera);
    const anchor = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
      ?? controls.target.clone();

    camera.position.sub(anchor).multiplyScalar(s).add(anchor);
    controls.target.sub(anchor).multiplyScalar(s).add(anchor);
  }

  // -------------------------------------------------------------------------
  // Wheel / trackpad handling
  // -------------------------------------------------------------------------

  function isTrackpad(e) {
    if (inputMode !== 'auto') return inputMode === 'trackpad';

    const now = performance.now();
    if (now - lastTrackpadTime < TRACKPAD_STICKY_MS) {
      lastTrackpadTime = now;
      return true;
    }

    let trackpad;
    if (e.deltaMode !== 0) {
      trackpad = false;  // line/page deltas only come from wheels
    } else if (e.wheelDeltaY || e.wheelDeltaX) {
      // Chrome/Safari: trackpads report wheelDelta = -3 * delta; wheels report ±120 steps.
      const wd = e.wheelDeltaY || e.wheelDeltaX;
      const d = e.wheelDeltaY ? e.deltaY : e.deltaX;
      trackpad = Math.abs(wd + 3 * d) < 1.5;
    } else {
      trackpad = e.deltaX !== 0 || Math.abs(e.deltaY) < 50;
    }

    if (trackpad) lastTrackpadTime = now;
    return trackpad;
  }

  function onWheel(e) {
    e.preventDefault();
    cancelTween();

    const unit = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? canvas.clientHeight : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;

    if (e.ctrlKey) {
      // Pinch on Chrome/Firefox arrives as ctrl+wheel. Safari uses gesture events instead.
      if (!gestureActive) zoomAt(Math.exp(dy * PINCH_ZOOM_SPEED), e.clientX, e.clientY);
      return;
    }

    if (isTrackpad(e)) {
      // Scroll deltas are opposite to finger motion; negate so the model follows the fingers.
      if (e.shiftKey) pan(-dx, -dy);
      else orbit(-dx, -dy);
    } else {
      zoomAt(Math.exp(dy * WHEEL_ZOOM_SPEED), e.clientX, e.clientY);
    }
  }

  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Safari pinch-to-zoom
  let gestureScale = 1;
  canvas.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    cancelTween();
    gestureActive = true;
    gestureScale = 1;
  });
  canvas.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    zoomAt(gestureScale / e.scale, e.clientX, e.clientY);
    gestureScale = e.scale;
  });
  canvas.addEventListener('gestureend', (e) => {
    e.preventDefault();
    gestureActive = false;
  });

  // Right-drag pans; don't pop up the browser menu.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  controls.addEventListener('start', cancelTween);

  // -------------------------------------------------------------------------
  // Standard views and fit
  // -------------------------------------------------------------------------

  function frameBounds() {
    const box = new THREE.Box3();
    for (const obj of getFrameObjects()) {
      if (obj) box.expandByObject(obj);
    }
    if (box.isEmpty()) return { center: new THREE.Vector3(), distance: 140 };

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distance = FIT_MARGIN * sphere.radius / Math.sin(Math.min(vFov, hFov) / 2);
    return { center: sphere.center, distance };
  }

  function cancelTween() {
    if (!tween) return;
    tween = null;
    controls.enableDamping = true;
  }

  function moveTo(direction, { animate = true } = {}) {
    const { center, distance } = frameBounds();
    if (!animate) {
      cancelTween();
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.lookAt(center);
      controls.update();
      return;
    }

    const fromOffset = camera.position.clone().sub(controls.target);
    tween = {
      start: performance.now(),
      fromTarget: controls.target.clone(),
      toTarget: center.clone(),
      fromDir: fromOffset.clone().normalize(),
      rotation: new THREE.Quaternion().setFromUnitVectors(
        fromOffset.clone().normalize(), direction.clone().normalize(),
      ),
      fromDist: fromOffset.length(),
      toDist: distance,
    };
    // Damping would fight the tween with leftover momentum.
    controls.enableDamping = false;
  }

  function setView(name, opts) {
    const dir = VIEW_DIRECTIONS[name];
    if (dir) moveTo(dir, opts);
  }

  function fit(opts) {
    moveTo(camera.position.clone().sub(controls.target).normalize(), opts);
  }

  /** Advance any running view transition. Call once per frame before controls.update(). */
  function update() {
    if (!tween) return;
    const t = Math.min((performance.now() - tween.start) / TWEEN_MS, 1);
    const k = t * t * (3 - 2 * t);  // smoothstep

    const q = new THREE.Quaternion().slerp(tween.rotation, k);
    const dir = tween.fromDir.clone().applyQuaternion(q);
    const dist = THREE.MathUtils.lerp(tween.fromDist, tween.toDist, k);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.lookAt(controls.target);

    if (t >= 1) cancelTween();
  }

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
      // Number inputs use digits; let them keep focus-specific keys.
      if (el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'range') return;
    }

    const key = e.key.toLowerCase();
    if (VIEW_KEYS[key]) {
      setView(VIEW_KEYS[key]);
      e.preventDefault();
    } else if (key === 'f') {
      fit();
      e.preventDefault();
    }
  });

  return {
    setView,
    fit,
    update,
    get inputMode() { return inputMode; },
    setInputMode(mode) {
      if (!INPUT_MODES.includes(mode)) return;
      inputMode = mode;
      lastTrackpadTime = -Infinity;
      try { localStorage.setItem(INPUT_MODE_STORAGE_KEY, mode); } catch { /* storage unavailable */ }
    },
  };
}

function loadInputMode() {
  try {
    const saved = localStorage.getItem(INPUT_MODE_STORAGE_KEY);
    if (INPUT_MODES.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  return 'mouse';
}
