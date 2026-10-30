import { MathUtils, PerspectiveCamera, Scene, Vector3, WebGPURenderer } from "three/webgpu";

export const initScene = async () => {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

  // The compute passes share three.js's device so both can use the same buffers.
  // Large body counts need the adapter's maximum buffer sizes, and subgroups when available.
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new Error("WebGPU is not supported in this browser");
  }
  const requiredLimits: Record<string, number> = {};
  for (const name in adapter.limits) {
    if (name === "minSubgroupSize" || name === "maxSubgroupSize") {
      // Chrome exposes these limits in "webgpu developer" mode, but they can't be set on the device.
      continue;
    }
    requiredLimits[name] = adapter.limits[name as keyof GPUSupportedLimits];
  }
  const device = await adapter.requestDevice({
    requiredFeatures: [...adapter.features] as GPUFeatureName[],
    requiredLimits,
  });

  const renderer = new WebGPURenderer({ canvas, device });
  await renderer.init();

  const scene = new Scene();

  const camera = new PerspectiveCamera(45, 1, 0.1, 10000);
  const controls = attachCameraControls(camera, canvas);

  const resize = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  return { device, renderer, scene, camera, controls };
};

const lookSpeed = 1 / 250; // Radians per pixel dragged
const moveSpeed = 300; // World units per second
const pinchSpeed = 5; // World units per pixel the fingers spread
const maxPitch = Math.PI / 2 - 0.001;

// Camera-local directions for each held key (three.js cameras look down -z)
const keyDirections: Record<string, Vector3> = {
  KeyW: new Vector3(0, 0, -1),
  KeyS: new Vector3(0, 0, 1),
  KeyA: new Vector3(-1, 0, 0),
  KeyD: new Vector3(1, 0, 0),
  KeyE: new Vector3(0, 1, 0),
  KeyQ: new Vector3(0, -1, 0),
};

// Drag to look and WASD (plus Q/E for down/up) to fly. On touch screens, pinch flies
// forwards and backwards.
const attachCameraControls = (camera: PerspectiveCamera, canvas: HTMLCanvasElement) => {
  camera.rotation.order = "YXZ"; // Yaw, then pitch, with no roll

  const heldKeys = new Set<string>();
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;

  const getPinchDistance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      pinchDistance = getPinchDistance();
    }
    if (event.pointerType === "mouse") {
      void canvas.requestPointerLock?.()?.catch(() => {
        // Dragging still works when pointer lock is unavailable.
      });
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    // A locked pointer stays put, so only its movement is reported
    const locked = document.pointerLockElement === canvas;
    const dx = locked ? event.movementX : event.clientX - last.x;
    const dy = locked ? event.movementY : event.clientY - last.y;
    last.x = event.clientX;
    last.y = event.clientY;

    if (pointers.size === 1) {
      camera.rotation.y -= dx * lookSpeed;
      camera.rotation.x = MathUtils.clamp(camera.rotation.x - dy * lookSpeed, -maxPitch, maxPitch);
    } else if (pointers.size === 2) {
      const distance = getPinchDistance();
      camera.translateZ((pinchDistance - distance) * pinchSpeed);
      pinchDistance = distance;
    }
  });

  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 2) {
      pinchDistance = getPinchDistance();
    }
    if (event.pointerType === "mouse") {
      document.exitPointerLock?.();
    }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    // Skip shortcuts, whose keyup may never arrive
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    heldKeys.add(event.code);
  });
  window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
  window.addEventListener("blur", () => heldKeys.clear());

  const move = new Vector3();
  return {
    update: (deltaTime: number) => {
      move.set(0, 0, 0);
      for (const key of heldKeys) {
        const direction = keyDirections[key];
        if (direction) move.add(direction);
      }
      if (move.lengthSq() === 0) return;
      move.multiplyScalar(moveSpeed * deltaTime).applyQuaternion(camera.quaternion);
      camera.position.add(move);
    },
  };
};

// Circular orbital speed vs radius for a uniform-density disk around a central mass,
// using the same softened gravity as the shaders. The disk's own pull is integrated
// numerically over a grid (using its symmetry in angle and height), then interpolated.
export const createRotationCurve = ({
  gravity,
  centralMass,
  diskMass,
  rMin,
  rMax,
  halfThickness,
  softening,
}: {
  gravity: number;
  centralMass: number;
  diskMass: number;
  rMin: number;
  rMax: number;
  halfThickness: number;
  softening: number;
}) => {
  const numSamples = 64;
  const nR = 192;
  const nPhi = 256;
  const nZ = 4;
  const softSq = softening * softening;
  const dR = (rMax - rMin) / nR;
  const dPhi = Math.PI / nPhi;
  const dZ = halfThickness / nZ;
  const density =
    diskMass / (Math.PI * (rMax * rMax - rMin * rMin) * 2 * halfThickness);

  const cosPhi = new Float64Array(nPhi);
  for (let j = 0; j < nPhi; j++) {
    cosPhi[j] = Math.cos((j + 0.5) * dPhi);
  }

  const speeds = new Float64Array(numSamples);
  for (let s = 0; s < numSamples; s++) {
    const r = rMin + (s / (numSamples - 1)) * (rMax - rMin);
    let diskAcc = 0;
    for (let i = 0; i < nR; i++) {
      const rp = rMin + (i + 0.5) * dR;
      // x4 for the mirrored halves in angle and height
      const cellMass = 4 * density * rp * dR * dPhi * dZ;
      for (let k = 0; k < nZ; k++) {
        const z = (k + 0.5) * dZ;
        const base = r * r + rp * rp + z * z + softSq;
        for (let j = 0; j < nPhi; j++) {
          const c = cosPhi[j];
          const d2 = base - 2 * r * rp * c;
          diskAcc += (cellMass * (r - rp * c)) / (d2 * Math.sqrt(d2));
        }
      }
    }
    const centralAcc = (centralMass * r) / Math.pow(r * r + softSq, 1.5);
    const inwardAcc = gravity * (diskAcc + centralAcc);
    speeds[s] = Math.sqrt(Math.max(0, inwardAcc * r));
  }

  return (r: number) => {
    const t = ((r - rMin) / (rMax - rMin)) * (numSamples - 1);
    const i = MathUtils.clamp(Math.floor(t), 0, numSamples - 2);
    const f = MathUtils.clamp(t - i, 0, 1);
    return MathUtils.lerp(speeds[i], speeds[i + 1], f);
  };
};

// A uniformly random point in a disk of radius r with a hole of radius min, lying in
// the xz plane with y within halfThickness of it
export const randomPointInDisk = (min: number, r: number, halfThickness: number) => {
  const rho = Math.sqrt(MathUtils.randFloat(min * min, r * r));
  const theta = Math.random() * 2 * Math.PI;
  const y = MathUtils.randFloat(-halfThickness, halfThickness);

  return new Vector3(rho * Math.cos(theta), y, rho * Math.sin(theta));
};
