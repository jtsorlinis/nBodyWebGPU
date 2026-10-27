import {
  Constants,
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
  createBHPrepareShader,
  BH_FORCE_WORKGROUP_SIZE,
} from "./shaders";
import { randRange } from "./utils";

// Constants
const initialNumBodies = 1 << 17;
let numBodies = initialNumBodies;
let maxNodes = numBodies * 8; // Estimate for octree nodes
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
gravityText.innerText = `Gravity: ${gravity}`;

const restartButton = document.getElementById("restartButton") as HTMLElement;
const twinGalaxiesToggle = document.getElementById(
  "twinGalaxiesToggle",
) as HTMLInputElement;

const moreBodiesToggle = document.getElementById(
  "moreBodiesToggle",
) as HTMLInputElement;

// Setup compute shaders
const bodiesIntegrateShader = createBodiesIntegrateShader(engine);
const bhTreeShader = createBHTreeShader(engine);
const bhForcesShader = createBHForcesShader(engine);
const bhClearShader = createBHClearShader(engine);
const bhBoundsShader = createBHBoundsShader(engine);
const bhPrepareShader = createBHPrepareShader(engine);
const computeShaders = [
  bodiesIntegrateShader,
  bhPrepareShader,
  bhClearShader,
  bhBoundsShader,
  bhTreeShader,
  bhForcesShader,
];
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
bhPrepareShader.setUniformBuffer("params", params);

// Setup material and mesh
const bodiesMat = createBodiesMaterial(scene);

// Update colours based on params
const updateColours = () => {
  const maxAcc = Math.sqrt((numBodies + blackHoleMass) * gravity) / 15;
  bodiesMat.setFloat("maxAcc", maxAcc);
};
updateColours();

// The shaders turn a two-triangle billboard into a circular particle with spherical depth.
const ballMesh = MeshBuilder.CreatePlane("bodies", { size: 1 });
ballMesh.material = bodiesMat;
ballMesh.buildBoundingInfo(
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
let bodiesArr: Float32Array;
let bodiesBuffer: StorageBuffer;
let bodiesBuffer2: StorageBuffer;
let nodesBuffer: StorageBuffer;
let allocatorBuffer: StorageBuffer;
let boundsBuffer: StorageBuffer;
let clearArgsBuffer: StorageBuffer;
let swap = false;

const setup = () => {
  bodiesText.innerHTML = `Bodies: ${numBodies}`;

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
  // Intialize buffer with positions
  bodiesArr = new Float32Array(numBodies * 12);
  for (let i = 0; i < numBodies; i++) {
    const pos = randomPointInDisk(innerRadius, spaceLimit);
    const offset = i < numBodies / 2 ? galaxy1Offset : galaxy2Offset;
    bodiesArr[i * 12] = pos.x + offset;
    bodiesArr[i * 12 + 1] = pos.z;
    bodiesArr[i * 12 + 2] = pos.y;

    // Circular Orbital Velocity
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    const speed = orbitalSpeed(dist);

    // Add some random noise to velocity to make it less perfect
    const speedNoise = randRange(0.8, 1.2);

    bodiesArr[i * 12 + 4] = (-pos.y / dist) * speed * speedNoise;
    bodiesArr[i * 12 + 5] = 0;
    bodiesArr[i * 12 + 6] = (pos.x / dist) * speed * speedNoise;

    // Set mass
    bodiesArr[i * 12 + 11] = randRange(0.5, 1.5);
  }

  // Black hole(s)
  bodiesArr.set([galaxy1Offset, 0, 0], 0); // Pos
  bodiesArr.set([0, 0, 0], 4); // Vel
  bodiesArr[11] = blackHoleMass;

  if (twinGalaxies) {
    bodiesArr.set([galaxy2Offset, 0, 0], 12); // Pos
    bodiesArr.set([0, 0, 0], 16); // Vel
    bodiesArr[23] = blackHoleMass;
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
  bodiesBuffer = new StorageBuffer(engine, bodiesArr.byteLength);
  bodiesBuffer2 = new StorageBuffer(engine, bodiesArr.byteLength);
  bodiesBuffer.update(bodiesArr);
  bodiesBuffer2.update(bodiesArr);

  // Nodes Buffer: 64 bytes per node
  nodesBuffer = new StorageBuffer(engine, maxNodes * 64);

  // Allocator: 1 uint
  allocatorBuffer = new StorageBuffer(engine, 4);
  // The first step clears the entire allocation. Later steps clear only nodes touched
  // by the previous tree build, including allocations abandoned after a failed CAS.
  allocatorBuffer.update(new Uint32Array([maxNodes]));

  // Bounds: min xyz, max xyz
  boundsBuffer = new StorageBuffer(engine, 24);
  clearArgsBuffer = new StorageBuffer(
    engine,
    16,
    Constants.BUFFER_CREATIONFLAG_READWRITE | Constants.BUFFER_CREATIONFLAG_INDIRECT,
  );
  bhPrepareShader.setStorageBuffer("allocator", allocatorBuffer);
  bhPrepareShader.setStorageBuffer("bounds", boundsBuffer);
  bhPrepareShader.setStorageBuffer("clearArgs", clearArgsBuffer);
  bhClearShader.setStorageBuffer("clearArgs", clearArgsBuffer);

  ballMesh.forcedInstanceCount = numBodies;
  bodiesMat.setStorageBuffer("bodies", bodiesBuffer);
  swap = false;
};

setup();

// UI interaction
gravitySlider.oninput = () => {
  gravity = gravitySlider.valueAsNumber;
  gravityText.innerText = `Gravity: ${gravity}`;
  params.updateFloat("gravity", gravity);
  params.update();
  updateColours();
};

const restart = () => {
  bodiesBuffer.dispose();
  bodiesBuffer2.dispose();
  nodesBuffer.dispose();
  allocatorBuffer.dispose();
  boundsBuffer.dispose();
  clearArgsBuffer.dispose();
  setup();
};

restartButton.onclick = restart;

twinGalaxiesToggle.onchange = () => {
  twinGalaxies = twinGalaxiesToggle.checked;
  restart();
};

moreBodiesToggle.onchange = () => {
  numBodies = moreBodiesToggle.checked
    ? initialNumBodies * 2
    : initialNumBodies;
  maxNodes = numBodies * 8;
  blackHoleMass = numBodies / 2;
  restart();
};

const step = () => {
  // A partial first step could reset the allocator before the clear shader is ready.
  // Compile every compute effect before submitting any part of the simulation step.
  if (!computeShadersReady) {
    computeShadersReady = computeShaders
      .map(shader => shader.isReady())
      .every(Boolean);
    if (!computeShadersReady) return false;
  }
  const bufferIn = swap ? bodiesBuffer2 : bodiesBuffer;
  const bufferOut = swap ? bodiesBuffer : bodiesBuffer2;

  // Pass 1: Integrate (Drift + Kick 1)
  bodiesIntegrateShader.setStorageBuffer("bodiesIn", bufferIn);
  bodiesIntegrateShader.setStorageBuffer("bodiesOut", bufferOut);
  bodiesIntegrateShader.dispatch(Math.ceil(numBodies / 256));

  // Pass 2: Barnes-Hut
  // 2a: Save the previous allocation count as indirect dispatch arguments and reset
  // the allocator/bounds on the GPU, without per-step uploads or CPU readback.
  bhPrepareShader.dispatch(1);

  // 2b: Clear only previously allocated nodes.
  bhClearShader.setStorageBuffer("nodes", nodesBuffer);
  bhClearShader.dispatchIndirect(clearArgsBuffer);

  // 2c: Compute Bounds of all bodies (Root of the tree)
  bhBoundsShader.setStorageBuffer("bodies", bufferOut);
  bhBoundsShader.setStorageBuffer("bounds", boundsBuffer);
  bhBoundsShader.dispatch(Math.ceil(numBodies / 256));

  // 2d: Build Tree
  bhTreeShader.setStorageBuffer("bodies", bufferOut);
  bhTreeShader.setStorageBuffer("nodes", nodesBuffer);
  bhTreeShader.setStorageBuffer("allocator", allocatorBuffer);
  bhTreeShader.setStorageBuffer("bounds", boundsBuffer);
  bhTreeShader.dispatch(Math.ceil(numBodies / 256));

  // 2e: Compute Forces (Kick 2)
  bhForcesShader.setStorageBuffer("bodies", bufferOut);
  bhForcesShader.setStorageBuffer("nodes", nodesBuffer);
  bhForcesShader.dispatch(Math.ceil(numBodies / BH_FORCE_WORKGROUP_SIZE));

  bodiesMat.setStorageBuffer("bodies", bufferOut);

  swap = !swap;
  return true;
};

// Fixed timestep keeps the leapfrog integrator stable and results independent of frame rate.
// At most one step runs per frame: if the GPU can't keep up (or the tab was hidden) the
// simulation slows down instead of taking bigger, less accurate steps.
let timeAccumulator = 0;

engine.runRenderLoop(async () => {
  const fps = engine.getFps();
  fpsText.innerHTML = `FPS: ${fps.toFixed(2)}`;

  timeAccumulator = Math.min(
    timeAccumulator + engine.getDeltaTime() / 1000,
    2 * simDt,
  );
  if (timeAccumulator >= simDt) {
    if (step()) timeAccumulator -= simDt;
  }

  // Draw bodies where they'd be by now, so motion stays smooth at any refresh rate
  bodiesMat.setFloat("extrapolationTime", timeAccumulator);

  scene.render();
});
