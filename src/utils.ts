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

// A random number from the standard normal distribution
const randomNormal = () =>
  Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

// A galaxy close to equilibrium, centred on the origin and rotating anticlockwise seen
// from above. It has a central black hole, a spherical bulge (a Plummer sphere) and an
// exponential disc in the xz plane, and uses the same softened gravity as the shaders.
// Stars start between rMin and rMax from the centre.
export const createGalaxy = ({
  gravity,
  softening,
  blackHoleMass,
  bulgeMass,
  bulgeRadius,
  diskMass,
  diskScaleLength,
  diskScaleHeight,
  toomreQ,
  rMin,
  rMax,
}: {
  gravity: number;
  softening: number;
  blackHoleMass: number;
  bulgeMass: number;
  bulgeRadius: number;
  diskMass: number;
  diskScaleLength: number;
  diskScaleHeight: number;
  // How much random motion the disc has, as Toomre's Q. Too little and it breaks into
  // clumps; too much and it stays smooth.
  toomreQ: number;
  rMin: number;
  rMax: number;
}) => {
  const softSq = softening * softening;

  // The disc's properties are worked out at these radii, then interpolated
  const numSamples = 64;
  const sampleRadius = (s: number) => rMin + (s / (numSamples - 1)) * (rMax - rMin);
  const interpolate = (table: Float64Array, r: number) => {
    const t = ((r - rMin) / (rMax - rMin)) * (numSamples - 1);
    const i = MathUtils.clamp(Math.floor(t), 0, numSamples - 2);
    const f = MathUtils.clamp(t - i, 0, 1);
    return MathUtils.lerp(table[i], table[i + 1], f);
  };

  // Surface density falls off exponentially, scaled so the disc holds diskMass
  const h = diskScaleLength;
  const massOutside = (r: number) => (1 + r / h) * Math.exp(-r / h);
  const centralDensity = diskMass / (2 * Math.PI * h * h * (massOutside(rMin) - massOutside(rMax)));
  const surfaceDensity = (r: number) => centralDensity * Math.exp(-r / h);

  // Inward acceleration in the midplane. The disc's pull is integrated numerically over a
  // grid, using its symmetry in angle and height. Its layers above the midplane are
  // weighted by its sech^2 vertical profile, and count for the mirrored ones below too.
  const nR = 192;
  const nPhi = 256;
  const nZ = 4;
  const dR = (rMax - rMin) / nR;
  const dPhi = Math.PI / nPhi;
  const dZ = (3 * diskScaleHeight) / nZ;
  const cosPhi = new Float64Array(nPhi);
  for (let j = 0; j < nPhi; j++) {
    cosPhi[j] = Math.cos((j + 0.5) * dPhi);
  }
  const layerWeight = new Float64Array(nZ);
  for (let k = 0; k < nZ; k++) {
    layerWeight[k] = Math.cosh(((k + 0.5) * dZ) / diskScaleHeight) ** -2;
  }
  const layerTotal = layerWeight.reduce((sum, w) => sum + w);
  for (let k = 0; k < nZ; k++) {
    layerWeight[k] /= layerTotal;
  }

  const acceleration = new Float64Array(numSamples);
  for (let s = 0; s < numSamples; s++) {
    const r = sampleRadius(s);
    let diskAcc = 0;
    for (let i = 0; i < nR; i++) {
      const rp = rMin + (i + 0.5) * dR;
      // x2 for the mirrored half in angle
      const ringMass = 2 * surfaceDensity(rp) * rp * dR * dPhi;
      for (let k = 0; k < nZ; k++) {
        const z = (k + 0.5) * dZ;
        const cellMass = ringMass * layerWeight[k];
        const base = r * r + rp * rp + z * z + softSq;
        for (let j = 0; j < nPhi; j++) {
          const c = cosPhi[j];
          const d2 = base - 2 * r * rp * c;
          diskAcc += (cellMass * (r - rp * c)) / (d2 * Math.sqrt(d2));
        }
      }
    }
    // A Plummer sphere pulls like a point mass softened by its radius
    const bulgeAcc = (bulgeMass * r) / Math.pow(r * r + bulgeRadius * bulgeRadius + softSq, 1.5);
    const blackHoleAcc = (blackHoleMass * r) / Math.pow(r * r + softSq, 1.5);
    acceleration[s] = gravity * (diskAcc + bulgeAcc + blackHoleAcc);
  }
  const circularSpeed = (r: number) => Math.sqrt(r * interpolate(acceleration, r));

  // The disc's random motion (Hernquist 1993): radial from Toomre Q, around the orbit
  // from the epicycle approximation, and vertical to hold up its thickness. Random
  // motion also slows the mean rotation below circular speed (asymmetric drift).
  const sigmaR = new Float64Array(numSamples);
  const sigmaPhi = new Float64Array(numSamples);
  const sigmaY = new Float64Array(numSamples);
  const meanSpeed = new Float64Array(numSamples);
  const epicycleRatio = new Float64Array(numSamples); // kappa^2 / (4 omega^2)
  const pressure = new Float64Array(numSamples); // surface density * sigmaR^2
  // Central differences, one-sided at the ends
  const neighbours = (s: number) => [Math.max(s - 1, 0), Math.min(s + 1, numSamples - 1)];
  const sampleSpacing = (rMax - rMin) / (numSamples - 1);
  for (let s = 0; s < numSamples; s++) {
    const r = sampleRadius(s);
    const omegaSq = acceleration[s] / r;
    const [prev, next] = neighbours(s);
    const omegaSqSlope =
      (acceleration[next] / sampleRadius(next) - acceleration[prev] / sampleRadius(prev)) /
      ((next - prev) * sampleSpacing);
    const kappaSq = Math.max(r * omegaSqSlope + 4 * omegaSq, 0);
    const density = surfaceDensity(r);
    // Capped so the dense centre isn't too hot to stay in orbit
    sigmaR[s] = Math.min(
      (toomreQ * 3.36 * gravity * density) / Math.sqrt(kappaSq),
      0.5 * circularSpeed(r),
    );
    epicycleRatio[s] = kappaSq / (4 * omegaSq);
    sigmaPhi[s] = sigmaR[s] * Math.sqrt(epicycleRatio[s]);
    // A self-gravitating sheet with a sech^2 profile
    sigmaY[s] = Math.sqrt(Math.PI * gravity * density * diskScaleHeight);
    pressure[s] = density * sigmaR[s] * sigmaR[s];
  }
  for (let s = 0; s < numSamples; s++) {
    const r = sampleRadius(s);
    const [prev, next] = neighbours(s);
    const pressureSlope = // d ln(pressure) / d ln(r)
      (r * Math.log(pressure[next] / pressure[prev])) / ((next - prev) * sampleSpacing);
    const driftSq = sigmaR[s] * sigmaR[s] * (1 - epicycleRatio[s] + pressureSlope);
    meanSpeed[s] = Math.sqrt(Math.max(r * acceleration[s] + driftSq, 0));
  }

  // The bulge's random speed balances its pressure against gravity (the isotropic Jeans
  // equation), integrated in from well beyond rMax, where everything pulls as if central
  const bulgeDensity = (r: number) => (1 + (r * r) / (bulgeRadius * bulgeRadius)) ** -2.5;
  const pullAt = (r: number) =>
    r <= rMax ? interpolate(acceleration, r) : acceleration[numSamples - 1] * (rMax / r) ** 2;
  const bulgeSigma = new Float64Array(numSamples);
  for (let s = 0; s < numSamples; s++) {
    const r0 = sampleRadius(s);
    const steps = 1024;
    const step = (4 * rMax - r0) / steps;
    let bulgePressure = 0;
    for (let k = 0; k < steps; k++) {
      const r = r0 + (k + 0.5) * step;
      bulgePressure += bulgeDensity(r) * pullAt(r) * step;
    }
    bulgeSigma[s] = Math.sqrt(bulgePressure / bulgeDensity(r0));
  }

  const diskStar = () => {
    // A radius weighted by r * exp(-r / h): the sum of two exponential distributions
    let r: number;
    do {
      r = -h * Math.log((1 - Math.random()) * (1 - Math.random()));
    } while (r < rMin || r > rMax);
    const angle = Math.random() * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Clamped so the rare extreme height doesn't land far from the disc
    const y = diskScaleHeight * Math.atanh(MathUtils.clamp(2 * Math.random() - 1, -0.999, 0.999));

    const vR = randomNormal() * interpolate(sigmaR, r);
    const vPhi = interpolate(meanSpeed, r) + randomNormal() * interpolate(sigmaPhi, r);
    const vY = randomNormal() * interpolate(sigmaY, r);
    return {
      pos: new Vector3(r * cos, y, r * sin),
      vel: new Vector3(vR * cos + vPhi * sin, vY, vR * sin - vPhi * cos),
    };
  };

  const bulgeStar = () => {
    // Inverts the Plummer sphere's enclosed mass
    let r: number;
    do {
      r = bulgeRadius / Math.sqrt(Math.random() ** (-2 / 3) - 1);
    } while (r < rMin || r > rMax);
    const sigma = interpolate(bulgeSigma, r);
    // Escape speed is at least sqrt(2) times circular speed, so this keeps every star bound
    const maxSpeed = Math.SQRT2 * circularSpeed(r);
    const vel = new Vector3();
    do {
      vel.set(randomNormal(), randomNormal(), randomNormal()).multiplyScalar(sigma);
    } while (vel.length() > maxSpeed);
    const pos = new Vector3().randomDirection().multiplyScalar(r);

    // Turn stars orbiting against the disc around, so the bulge rotates with it. This
    // only reverses their motion around the axis, so the bulge keeps the same balance.
    const angularMomentum = pos.z * vel.x - pos.x * vel.z;
    if (angularMomentum < 0) {
      const flip = (2 * angularMomentum) / (pos.x * pos.x + pos.z * pos.z);
      vel.x -= flip * pos.z;
      vel.z += flip * pos.x;
    }
    return { pos, vel };
  };

  return { diskStar, bulgeStar };
};
