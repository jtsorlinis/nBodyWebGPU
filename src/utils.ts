import { Scene, UniversalCamera, Vector3, WebGPUEngine } from "@babylonjs/core";

export const initScene = async () => {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  canvas.onpointerdown = () => {
    canvas.requestPointerLock();
  };

  canvas.onpointerup = () => {
    document.exitPointerLock();
  };

  const engine = new WebGPUEngine(canvas, {
    setMaximumLimits: true,
    enableAllFeatures: true,
  });
  await engine.initAsync();

  const scene = new Scene(engine);
  scene.clearColor.set(0, 0, 0, 1);

  const camera = new UniversalCamera("camera", new Vector3(0, 0, -10), scene);
  camera.minZ = 0.1;
  camera.speed = 100;
  camera.angularSensibility = 250;
  camera.inertia = 0;
  camera.keysLeft = [65];
  camera.keysRight = [68];
  camera.keysUp = [87];
  camera.keysDown = [83];
  camera.keysUpward = [69];
  camera.keysDownward = [81];
  camera.attachControl();

  return { engine, scene, camera };
};

export const randomPointInSphere = (min: number, r: number) => {
  if (min > r) {
    throw new Error("min must be less than or equal to r");
  }

  let rho = Math.cbrt(
    Math.random() * (Math.pow(r, 3) - Math.pow(min, 3)) + Math.pow(min, 3),
  );
  let theta = Math.random() * 2 * Math.PI;
  let phi = Math.acos(1 - Math.random() * 2);

  let x = rho * Math.sin(phi) * Math.cos(theta);
  let y = rho * Math.sin(phi) * Math.sin(theta);
  let z = rho * Math.cos(phi);

  return new Vector3(x, y, z);
};

export const randRange = (min: number, max: number) =>
  min + Math.random() * (max - min);

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
    const i = Math.min(Math.max(Math.floor(t), 0), numSamples - 2);
    const f = Math.min(Math.max(t - i, 0), 1);
    return speeds[i] * (1 - f) + speeds[i + 1] * f;
  };
};

export const randomPointInDisk = (min: number, r: number) => {
  if (min > r) {
    throw new Error("min must be less than or equal to r");
  }

  let rho = Math.sqrt(
    Math.random() * (Math.pow(r, 2) - Math.pow(min, 2)) + Math.pow(min, 2),
  );
  let theta = Math.random() * 2 * Math.PI;

  let x = rho * Math.cos(theta);
  let y = rho * Math.sin(theta);
  let z = randRange(-r * 0.05, r * 0.05); // Thin disk

  return new Vector3(x, y, z);
};
