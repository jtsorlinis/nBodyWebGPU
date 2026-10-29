import {
  DefaultRenderingPipeline,
  MeshBuilder,
  StorageBuffer,
  UniformBuffer,
  Vector3,
} from "@babylonjs/core";
import "./style.css";
import { createRotationCurve, initScene, randomPointInDisk } from "./utils";
import {
  createBodiesIntegrateShader,
  createBodiesMaterial,
  createBHTreeShader,
  createBHForcesShader,
  createBHClearShader,
  createBHBoundsShader,
  createBHOrderShader,
  createBHSummarizeShader,
  getBHForceBodiesPerWorkgroup,
} from "./shaders";
import { randRange } from "./utils";

// Constants
const initialNumBodies = 1 << 17;
let numBodies = initialNumBodies;
// Every node gets eight contiguous child records for the force pass, so the tree's
// capacity is also the record capacity. Trees have used at most 0.84 nodes per body,
// including failed allocations that insertion reuses.
const nodesPerBody = 2;
let maxNodes = numBodies * nodesPerBody;
let gravity = 5;
let blackHoleMass = numBodies / 2;
const softening = 3.0;
const theta = 0.5;
const simDt = 1 / 60; // Fixed simulation timestep (seconds)

let twinGalaxies = false;

const { engine, scene, camera } = await initScene();

const fpsText = document.getElementById("fpsText") as HTMLElement;
const bodiesText = document.getElementById("bodiesText") as HTMLElement;
const gravityText = document.getElementById("gravityText") as HTMLElement;
const gravitySlider = document.getElementById(
  "gravitySlider",
) as HTMLInputElement;
const updateGravityDisplay = () => {
  gravityText.textContent = String(gravity);
  const min = Number(gravitySlider.min);
  const max = Number(gravitySlider.max);
  gravitySlider.style.setProperty("--range-progress", `${(gravity - min) / (max - min) * 100}%`);
};
updateGravityDisplay();

const restartButton = document.getElementById("restartButton") as HTMLElement;
const twinGalaxiesToggle = document.getElementById(
  "twinGalaxiesToggle",
) as HTMLInputElement;

const bodyCountButtons = document.querySelectorAll<HTMLButtonElement>(
  "#bodyCountButtons button",
);
// The 128-byte child records are the largest buffer, and summarize dispatches two
// invocations per node.
const maxBufferBytes = Math.min(
  engine._device.limits.maxStorageBufferBindingSize,
  engine._device.limits.maxBufferSize,
);
for (const button of bodyCountButtons) {
  const count = Number(button.value);
  button.setAttribute("aria-pressed", String(count === numBodies));
  button.title = `${count.toLocaleString()} bodies`;
  if (count * nodesPerBody * 128 > maxBufferBytes ||
      Math.ceil(count * nodesPerBody * 2 / 256) > engine._device.limits.maxComputeWorkgroupsPerDimension) {
    button.disabled = true;
    button.title = "Unavailable on this GPU";
  }
}

// Setup compute shaders
const bodiesIntegrateShader = createBodiesIntegrateShader(engine);
const bhTreeShader = createBHTreeShader(engine);
const bhForcesShader = createBHForcesShader(engine);
const bhClearShader = createBHClearShader(engine);
const bhBoundsShader = createBHBoundsShader(engine);
const bhOrderShader = createBHOrderShader(engine);
const bhSummarizeShader = createBHSummarizeShader(engine);

const forceBodiesPerWorkgroup = getBHForceBodiesPerWorkgroup(engine);
const computeShaders = [bodiesIntegrateShader, bhClearShader, bhBoundsShader,
  bhTreeShader, bhSummarizeShader, bhOrderShader, bhForcesShader];
let computeShadersReady = false;

const params = new UniformBuffer(engine);
// Layout must match the shaders (std140/uniform alignment rules)
// 0: numBodies (u32)
// 4: gravity (f32)
// 8: deltaTime (f32)
// 12: blackHoleMass (f32)
// 16: softening (f32)
// 20: theta (f32)
// 24: maxNodes (u32)
// 28: massScale (f32)

params.addUniform("numBodies", 1);
params.addUniform("gravity", 1);
params.addUniform("dt", 1);
params.addUniform("blackHoleMass", 1);
params.addUniform("softening", 1);
params.addUniform("theta", 1);
params.addUniform("maxNodes", 1);
params.addUniform("massScale", 1);

params.updateFloat("softening", softening);
params.updateFloat("theta", theta);
params.updateFloat("dt", simDt);

bodiesIntegrateShader.setUniformBuffer("params", params);
bhTreeShader.setUniformBuffer("params", params);
bhForcesShader.setUniformBuffer("params", params);
bhClearShader.setUniformBuffer("params", params);
bhBoundsShader.setUniformBuffer("params", params);
bhOrderShader.setUniformBuffer("params", params);
bhSummarizeShader.setUniformBuffer("params", params);

// Setup material and mesh
const bodiesMat = createBodiesMaterial(scene);

// Update colours based on params
const updateColours = () => {
  const maxAcc = Math.sqrt((numBodies + blackHoleMass) * gravity) / 15;
  bodiesMat.setFloat("maxAcc", maxAcc);
};

// Bodies are drawn as camera-facing discs (see bodiesVertex)
const bodyMesh = MeshBuilder.CreatePlane("body", { size: 1 });
bodyMesh.material = bodiesMat;
bodyMesh.buildBoundingInfo(
  new Vector3(-1000000, -1000000, -1000000),
  new Vector3(1000000, 1000000, 1000000),
);

// Add bloom
var pipeline = new DefaultRenderingPipeline("defaultPipeline", true, scene, [
  camera,
]);
pipeline.bloomEnabled = true;
pipeline.bloomScale = 0.5;
pipeline.bloomThreshold = 0.0;

// Setup scene
let posMassBuffer: StorageBuffer;
let motionBuffer: StorageBuffer;
let nodesBuffer: StorageBuffer;
let allocatorBuffer: StorageBuffer;
let boundsBuffer: StorageBuffer;
let countsBuffer: StorageBuffer;
let orderBuffer: StorageBuffer;
let recordsBuffer: StorageBuffer;

const setup = () => {
  bodiesText.textContent = numBodies.toLocaleString();
  updateColours();

  // Setup size based on number of bodies
  const numGalaxies = twinGalaxies ? 2 : 1;
  const spaceLimit = Math.pow(numBodies / numGalaxies, 1 / 3) * 10;
  const innerRadius = spaceLimit * 0.1;

  // Speed for a circular orbit at each radius, including the pull of the disk itself
  const orbitalSpeed = createRotationCurve({
    gravity,
    centralMass: blackHoleMass,
    diskMass: numBodies / numGalaxies, // Bodies have a mean mass of 1
    rMin: innerRadius,
    rMax: spaceLimit,
    halfThickness: spaceLimit * 0.05, // Matches randomPointInDisk
    softening,
  });

  const dist = spaceLimit * (twinGalaxies ? 4 : 2.25);
  const elevationAngle = 30 * (Math.PI / 180);
  const y = dist * Math.sin(elevationAngle);
  const z = -dist * Math.cos(elevationAngle);

  camera.position.set(0, y, z);
  camera.setTarget(Vector3.Zero());

  let galaxy1Offset = twinGalaxies ? -spaceLimit * 1.5 : 0;
  let galaxy2Offset = twinGalaxies ? spaceLimit * 1.5 : 0;
  // Intialize buffers
  // posMass: xyz = position, w = mass
  // motion: velocity, acceleration (vec3s padded to 4 floats)
  const posMassArr = new Float32Array(numBodies * 4);
  const motionArr = new Float32Array(numBodies * 8);
  for (let i = 0; i < numBodies; i++) {
    const pos = randomPointInDisk(innerRadius, spaceLimit);
    const offset = i < numBodies / 2 ? galaxy1Offset : galaxy2Offset;
    posMassArr[i * 4] = pos.x + offset;
    posMassArr[i * 4 + 1] = pos.z;
    posMassArr[i * 4 + 2] = pos.y;

    // Circular Orbital Velocity
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    const speed = orbitalSpeed(dist);

    // Add some random noise to velocity to make it less perfect
    const speedNoise = randRange(0.8, 1.2);

    motionArr[i * 8] = (-pos.y / dist) * speed * speedNoise;
    motionArr[i * 8 + 1] = 0;
    motionArr[i * 8 + 2] = (pos.x / dist) * speed * speedNoise;

    // Set mass
    posMassArr[i * 4 + 3] = randRange(0.5, 1.5);
  }

  // Black hole(s)
  posMassArr.set([galaxy1Offset, 0, 0, blackHoleMass], 0); // Pos, Mass
  motionArr.set([0, 0, 0], 0); // Vel

  if (twinGalaxies) {
    posMassArr.set([galaxy2Offset, 0, 0, blackHoleMass], 4); // Pos, Mass
    motionArr.set([0, 0, 0], 8); // Vel
  }

  // Set params
  params.updateUInt("numBodies", numBodies);
  params.updateUInt("maxNodes", maxNodes);
  params.updateFloat("gravity", gravity);
  params.updateFloat("blackHoleMass", blackHoleMass);
  // Fixed-point scale for the octree's mass/COM sums, so the total mass fits in an i32
  const maxTotalMass = numBodies * 1.5 + numGalaxies * blackHoleMass;
  params.updateFloat(
    "massScale",
    Math.floor(0x7fffffff / (maxTotalMass * 1.1)),
  );
  params.update();

  // Copy data to GPU
  posMassBuffer = new StorageBuffer(engine, posMassArr.byteLength);
  posMassBuffer.update(posMassArr);
  motionBuffer = new StorageBuffer(engine, motionArr.byteLength);
  motionBuffer.update(motionArr);

  // Nodes Buffer: 64 bytes per node. New buffers are zeroed, which is an empty tree
  nodesBuffer = new StorageBuffer(engine, maxNodes * 64);

  // Allocator: 1 uint
  allocatorBuffer = new StorageBuffer(engine, 4);

  // Bounds: min xyz, max xyz
  boundsBuffer = new StorageBuffer(engine, 6 * 4);

  // Bodies under each node, and body indices in tree order: 1 uint each
  countsBuffer = new StorageBuffer(engine, maxNodes * 4);
  orderBuffer = new StorageBuffer(engine, numBodies * 4);

  // Child records: 8 x (centre of mass xyz, mass) per node, rebuilt every step
  recordsBuffer = new StorageBuffer(engine, maxNodes * 8 * 16);

  // Bodies are updated in place, so the buffers only need binding once
  bodiesIntegrateShader.setStorageBuffer("posMass", posMassBuffer);
  bodiesIntegrateShader.setStorageBuffer("motion", motionBuffer);
  bhClearShader.setStorageBuffer("nodes", nodesBuffer);
  bhClearShader.setStorageBuffer("allocator", allocatorBuffer);
  bhClearShader.setStorageBuffer("bounds", boundsBuffer);
  bhClearShader.setStorageBuffer("counts", countsBuffer);
  bhClearShader.setStorageBuffer("order", orderBuffer);
  bhBoundsShader.setStorageBuffer("posMass", posMassBuffer);
  bhBoundsShader.setStorageBuffer("bounds", boundsBuffer);
  bhBoundsShader.setStorageBuffer("allocator", allocatorBuffer);
  bhTreeShader.setStorageBuffer("posMass", posMassBuffer);
  bhTreeShader.setStorageBuffer("nodes", nodesBuffer);
  bhTreeShader.setStorageBuffer("allocator", allocatorBuffer);
  bhTreeShader.setStorageBuffer("bounds", boundsBuffer);
  bhTreeShader.setStorageBuffer("counts", countsBuffer);
  bhSummarizeShader.setStorageBuffer("nodes", nodesBuffer);
  bhSummarizeShader.setStorageBuffer("allocator", allocatorBuffer);
  bhSummarizeShader.setStorageBuffer("posMass", posMassBuffer);
  bhSummarizeShader.setStorageBuffer("records", recordsBuffer);
  bhOrderShader.setStorageBuffer("posMass", posMassBuffer);
  bhOrderShader.setStorageBuffer("nodes", nodesBuffer);
  bhOrderShader.setStorageBuffer("counts", countsBuffer);
  bhOrderShader.setStorageBuffer("order", orderBuffer);
  bhForcesShader.setStorageBuffer("posMass", posMassBuffer);
  bhForcesShader.setStorageBuffer("motion", motionBuffer);
  bhForcesShader.setStorageBuffer("nodes", nodesBuffer);
  bhForcesShader.setStorageBuffer("order", orderBuffer);
  bhForcesShader.setStorageBuffer("records", recordsBuffer);
  bodiesMat.setStorageBuffer("posMass", posMassBuffer);
  bodiesMat.setStorageBuffer("motion", motionBuffer);

  bodyMesh.forcedInstanceCount = numBodies;
};

setup();

// UI interaction
gravitySlider.oninput = () => {
  gravity = gravitySlider.valueAsNumber;
  updateGravityDisplay();
  params.updateFloat("gravity", gravity);
  params.update();
  updateColours();
};

const restart = () => {
  posMassBuffer.dispose();
  motionBuffer.dispose();
  nodesBuffer.dispose();
  allocatorBuffer.dispose();
  boundsBuffer.dispose();
  countsBuffer.dispose();
  orderBuffer.dispose();
  recordsBuffer.dispose();
  setup();
};

restartButton.onclick = restart;

twinGalaxiesToggle.onchange = () => {
  twinGalaxies = twinGalaxiesToggle.checked;
  restart();
};

for (const button of bodyCountButtons) {
  button.onclick = () => {
    const count = Number(button.value);
    if (count === numBodies) return;
    numBodies = count;
    maxNodes = numBodies * nodesPerBody;
    blackHoleMass = numBodies / 2;
    for (const other of bodyCountButtons) {
      other.setAttribute("aria-pressed", String(Number(other.value) === numBodies));
    }
    restart();
  };
}

const step = () => {
  // Avoid partial first steps while asynchronous shader compilation is pending.
  if (!computeShadersReady) {
    computeShadersReady = computeShaders.map(shader => shader.isReady()).every(Boolean);
    if (!computeShadersReady) return false;
  }
  // Pass 1: Integrate (Drift + Kick 1)
  bodiesIntegrateShader.dispatch(Math.ceil(numBodies / 256));

  // Pass 2: Barnes-Hut
  // 2a: Clear the Nodes the last tree used, and reset Bounds
  bhClearShader.dispatch(Math.ceil(maxNodes / 256));

  // 2b: Compute Bounds of all bodies (Root of the tree), and reset Allocator
  bhBoundsShader.dispatch(Math.ceil(numBodies / 256));

  // 2c: Build Tree
  bhTreeShader.dispatch(Math.ceil(numBodies / 256));

  // 2d: Gather each node's child centres of mass into contiguous records for the force pass
  bhSummarizeShader.dispatch(Math.ceil(maxNodes * 2 / 256));

  // 2e: Put bodies in tree order
  bhOrderShader.dispatch(Math.ceil(numBodies / 256));

  // 2f: Compute Forces (Kick 2)
  bhForcesShader.dispatch(Math.ceil(numBodies / forceBodiesPerWorkgroup));
  return true;
};

// Fixed timestep keeps the leapfrog integrator stable and results independent of frame rate.
// At most one step runs per frame: if the GPU can't keep up (or the tab was hidden) the
// simulation slows down instead of taking bigger, less accurate steps.
let timeAccumulator = 0;
let fpsTimer = 0;

engine.runRenderLoop(async () => {
  const frameTime = engine.getDeltaTime() / 1000;

  // Setting the text forces a layout, so only update it a few times a second
  fpsTimer += frameTime;
  if (fpsTimer >= 0.25) {
    fpsText.textContent = Math.round(engine.getFps()).toLocaleString();
    fpsTimer = 0;
  }

  timeAccumulator = Math.min(timeAccumulator + frameTime, 2 * simDt);
  if (timeAccumulator >= simDt) {
    if (step()) timeAccumulator -= simDt;
  }

  // Draw bodies where they'd be by now, so motion stays smooth at any refresh rate
  bodiesMat.setFloat("extrapolationTime", timeAccumulator);

  scene.render();
});
