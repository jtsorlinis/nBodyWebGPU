import { MathUtils, PerspectiveCamera, Scene, Vector3, WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

  // Drag to orbit the origin, where the galaxies stay centred, and scroll or pinch to zoom
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.cursorStyle = "grab"; // A closed hand while dragging
  controls.minDistance = 10;
  controls.maxDistance = camera.far / 2; // Keeps the galaxies inside the far plane

  const resize = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  return { device, renderer, scene, camera };
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
