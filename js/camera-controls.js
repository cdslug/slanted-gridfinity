/**
 * camera-controls.js — CAD-style navigation layered on top of OrbitControls.
 *
 * Mouse:
 *   Left drag          orbit
 *   Right/middle drag  pan   (Shift/Cmd + left drag also pans)
 *   Wheel              zoom toward cursor
 *
 * Trackpad (macOS):
 *   Two-finger scroll  zoom toward cursor (same as the wheel)
 *   Pinch              zoom toward cursor
 *   Click-drag / two-finger click-drag  orbit / pan (same as mouse)
 *
 * Keys: 1 Front, 2 Back, 3 Right, 4 Left, 5 Top, 6 Bottom, 0 Iso, F Fit.
 *
 * The scene is Z-up, so "front" looks along +Y and "top" looks down -Z.
 */

import * as THREE from 'three';

const WHEEL_ZOOM_SPEED = 0.0015;  // per pixel of mouse-wheel delta
const PINCH_ZOOM_SPEED = 0.01;    // per pixel of ctrl+wheel (pinch) delta
const LINE_HEIGHT_PX = 33;        // for wheel events reported in lines
const MIN_DISTANCE = 5;
const MAX_DISTANCE = 1500;
const POLAR_EPS = 1e-4;
const FIT_MARGIN = 1.15;
const TWEEN_MS = 350;

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
 * @param {() => void} [opts.requestRender]  schedule a frame (the viewer renders on demand)
 */
export function setupCameraControls({ camera, controls, canvas, getFrameObjects, requestRender = () => {} }) {
  // Mouse buttons: CAD-style middle-button pan; we handle wheel ourselves.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.enableZoom = false;
  controls.screenSpacePanning = true;

  let gestureActive = false;
  let tween = null;

  const raycaster = new THREE.Raycaster();

  // -------------------------------------------------------------------------
  // Primitive camera moves
  // -------------------------------------------------------------------------

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
    requestRender();
  }

  // -------------------------------------------------------------------------
  // Wheel handling
  // -------------------------------------------------------------------------

  function onWheel(e) {
    e.preventDefault();
    cancelTween();

    const unit = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? canvas.clientHeight : 1;
    const dy = e.deltaY * unit;

    if (e.ctrlKey) {
      // Pinch on Chrome/Firefox arrives as ctrl+wheel. Safari uses gesture events instead.
      if (!gestureActive) zoomAt(Math.exp(dy * PINCH_ZOOM_SPEED), e.clientX, e.clientY);
      return;
    }

    zoomAt(Math.exp(dy * WHEEL_ZOOM_SPEED), e.clientX, e.clientY);
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
      requestRender();
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
    requestRender();
  }

  function setView(name, opts) {
    const dir = VIEW_DIRECTIONS[name];
    if (dir) moveTo(dir, opts);
  }

  function fit(opts) {
    moveTo(camera.position.clone().sub(controls.target).normalize(), opts);
  }

  /**
   * Advance any running view transition. Call in each rendered frame before
   * controls.update(); returns true while a transition still needs frames.
   */
  function update() {
    if (!tween) return false;
    const t = Math.min((performance.now() - tween.start) / TWEEN_MS, 1);
    const k = t * t * (3 - 2 * t);  // smoothstep

    const q = new THREE.Quaternion().slerp(tween.rotation, k);
    const dir = tween.fromDir.clone().applyQuaternion(q);
    const dist = THREE.MathUtils.lerp(tween.fromDist, tween.toDist, k);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.lookAt(controls.target);

    if (t >= 1) cancelTween();
    return tween !== null;
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
  };
}
