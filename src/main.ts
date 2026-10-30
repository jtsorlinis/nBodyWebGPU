import {
  Mesh,
  NodeMaterial,
  PlaneGeometry,
  RenderPipeline,
  StorageBufferAttribute,
} from "three/webgpu";
import { pass, pow, uniform, vec4 } from "three/tsl";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
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

const { device, renderer, scene, camera, controls } = await initScene();

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
  device.limits.maxStorageBufferBindingSize,
  device.limits.maxBufferSize,
);
for (const button of bodyCountButtons) {
  const count = Number(button.value);
  button.setAttribute("aria-pressed", String(count === numBodies));
  button.title = `${count.toLocaleString()} bodies`;
  if (count * nodesPerBody * 128 > maxBufferBytes ||
      Math.ceil(count * nodesPerBody * 2 / 256) > device.limits.maxComputeWorkgroupsPerDimension) {
    button.disabled = true;
    button.title = "Unavailable on this GPU";
  }
}

// Setup compute shaders
const [
  bodiesIntegrateShader,
  bhTreeShader,
  bhForcesShader,
  bhClearShader,
  bhBoundsShader,
  bhOrderShader,
  bhSummarizeShader,
] = await Promise.all([
  createBodiesIntegrateShader(device),
  createBHTreeShader(device),
  createBHForcesShader(device),
  createBHClearShader(device),
  createBHBoundsShader(device),
  createBHOrderShader(device),
  createBHSummarizeShader(device),
]);

const forceBodiesPerWorkgroup = getBHForceBodiesPerWorkgroup(device);

// Layout must match the Params struct in the shaders (uniform alignment rules)
// 0: numBodies (u32)
// 4: gravity (f32)
// 8: deltaTime (f32)
// 12: blackHoleMass (f32)
// 16: softening (f32)
// 20: theta (f32)
// 24: maxNodes (u32)
// 28: massScale (f32)
const paramsData = new DataView(new ArrayBuffer(32));
const params = device.createBuffer({
  size: paramsData.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
let massScale = 0;

const updateParams = () => {
  paramsData.setUint32(0, numBodies, true);
  paramsData.setFloat32(4, gravity, true);
  paramsData.setFloat32(8, simDt, true);
  paramsData.setFloat32(12, blackHoleMass, true);
  paramsData.setFloat32(16, softening, true);
  paramsData.setFloat32(20, theta, true);
  paramsData.setUint32(24, maxNodes, true);
  paramsData.setFloat32(28, massScale, true);
  device.queue.writeBuffer(params, 0, paramsData);
};

// Setup material and mesh
const maxAcc = uniform(1);
const extrapolationTime = uniform(0);

// Update colours based on params
const updateColours = () => {
  maxAcc.value = Math.sqrt((numBodies + blackHoleMass) * gravity) / 15;
};

// Bodies are drawn as camera-facing discs (see createBodiesMaterial)
const bodyMesh = new Mesh(new PlaneGeometry(1, 1));
bodyMesh.frustumCulled = false;
scene.add(bodyMesh);
let bodiesMat: NodeMaterial | undefined;

// Add bloom: a soft glow from a half-resolution blur of the scene
const renderPipeline = new RenderPipeline(renderer);
const sceneColor = pass(scene, camera).getTextureNode();
const bloom = gaussianBlur(sceneColor, null, 6.5, { resolutionScale: 0.5 });
// Gamma-encode with a plain 2.2 power curve instead of sRGB's, which lifts the faint glow
renderPipeline.outputColorTransform = false;
renderPipeline.outputNode = pow(sceneColor.add(bloom.mul(0.15)), vec4(1 / 2.2));

const createStorageBuffer = (size: number, data?: Float32Array<ArrayBuffer>) => {
  // New buffers are zeroed
  const buffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  if (data) device.queue.writeBuffer(buffer, 0, data);
  return buffer;
};

// Lets three.js read one of the simulation's buffers in place, rather than
// uploading a copy of its own. three.js only creates a buffer for an attribute that has none.
const shareWithRenderer = (buffer: GPUBuffer, itemSize: number) => {
  const attribute = new StorageBufferAttribute(1, itemSize);
  const backend = renderer.backend as unknown as { get(object: object): { buffer?: GPUBuffer } };
  backend.get(attribute).buffer = buffer;
  return attribute;
};

// Setup scene
let posMassBuffer: GPUBuffer;
let motionBuffer: GPUBuffer;
let nodesBuffer: GPUBuffer;
let allocatorBuffer: GPUBuffer;
let boundsBuffer: GPUBuffer;
let countsBuffer: GPUBuffer;
let orderBuffer: GPUBuffer;
let recordsBuffer: GPUBuffer;

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
  const z = dist * Math.cos(elevationAngle);

  camera.position.set(0, y, z);
  camera.lookAt(0, 0, 0);

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

    // Circular Orbital Velocity, anticlockwise seen from above
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    const speed = orbitalSpeed(dist);

    // Add some random noise to velocity to make it less perfect
    const speedNoise = randRange(0.8, 1.2);

    motionArr[i * 8] = (pos.y / dist) * speed * speedNoise;
    motionArr[i * 8 + 1] = 0;
    motionArr[i * 8 + 2] = (-pos.x / dist) * speed * speedNoise;

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
  // Fixed-point scale for the octree's mass/COM sums, so the total mass fits in an i32
  const maxTotalMass = numBodies * 1.5 + numGalaxies * blackHoleMass;
  massScale = Math.floor(0x7fffffff / (maxTotalMass * 1.1));
  updateParams();

  // Copy data to GPU
  posMassBuffer = createStorageBuffer(posMassArr.byteLength, posMassArr);
  motionBuffer = createStorageBuffer(motionArr.byteLength, motionArr);

  // Nodes Buffer: 64 bytes per node. New buffers are zeroed, which is an empty tree
  nodesBuffer = createStorageBuffer(maxNodes * 64);

  // Allocator: 1 uint
  allocatorBuffer = createStorageBuffer(4);

  // Bounds: min xyz, max xyz
  boundsBuffer = createStorageBuffer(6 * 4);

  // Bodies under each node, and body indices in tree order: 1 uint each
  countsBuffer = createStorageBuffer(maxNodes * 4);
  orderBuffer = createStorageBuffer(numBodies * 4);

  // Child records: 8 x (centre of mass xyz, mass) per node, rebuilt every step
  recordsBuffer = createStorageBuffer(maxNodes * 8 * 16);

  // Bodies are updated in place, so the buffers only need binding once
  const buffers = {
    params,
    posMass: posMassBuffer,
    motion: motionBuffer,
    nodes: nodesBuffer,
    allocator: allocatorBuffer,
    bounds: boundsBuffer,
    counts: countsBuffer,
    order: orderBuffer,
    records: recordsBuffer,
  };
  for (const shader of [bodiesIntegrateShader, bhClearShader, bhBoundsShader,
    bhTreeShader, bhSummarizeShader, bhOrderShader, bhForcesShader]) {
    shader.setBuffers(buffers);
  }

  bodiesMat?.dispose();
  bodiesMat = createBodiesMaterial(
    shareWithRenderer(posMassBuffer, 4),
    shareWithRenderer(motionBuffer, 4),
    numBodies,
    maxAcc,
    extrapolationTime,
  );
  bodyMesh.material = bodiesMat;
  bodyMesh.count = numBodies;
};

setup();

// UI interaction
gravitySlider.oninput = () => {
  gravity = gravitySlider.valueAsNumber;
  updateGravityDisplay();
  updateParams();
  updateColours();
};

const restart = () => {
  posMassBuffer.destroy();
  motionBuffer.destroy();
  nodesBuffer.destroy();
  allocatorBuffer.destroy();
  boundsBuffer.destroy();
  countsBuffer.destroy();
  orderBuffer.destroy();
  recordsBuffer.destroy();
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
  const encoder = device.createCommandEncoder();
  const computePass = encoder.beginComputePass();

  // Pass 1: Integrate (Drift + Kick 1)
  bodiesIntegrateShader.dispatch(computePass, Math.ceil(numBodies / 256));

  // Pass 2: Barnes-Hut
  // 2a: Clear the Nodes the last tree used, and reset Bounds
  bhClearShader.dispatch(computePass, Math.ceil(maxNodes / 256));

  // 2b: Compute Bounds of all bodies (Root of the tree), and reset Allocator
  bhBoundsShader.dispatch(computePass, Math.ceil(numBodies / 256));

  // 2c: Build Tree
  bhTreeShader.dispatch(computePass, Math.ceil(numBodies / 256));

  // 2d: Gather each node's child centres of mass into contiguous records for the force pass
  bhSummarizeShader.dispatch(computePass, Math.ceil(maxNodes * 2 / 256));

  // 2e: Put bodies in tree order
  bhOrderShader.dispatch(computePass, Math.ceil(numBodies / 256));

  // 2f: Compute Forces (Kick 2)
  bhForcesShader.dispatch(computePass, Math.ceil(numBodies / forceBodiesPerWorkgroup));

  computePass.end();
  device.queue.submit([encoder.finish()]);
};

// Fixed timestep keeps the leapfrog integrator stable and results independent of frame rate.
// At most one step runs per frame: if the GPU can't keep up (or the tab was hidden) the
// simulation slows down instead of taking bigger, less accurate steps.
let timeAccumulator = 0;
let lastFrameTime: number | undefined;
let fpsTimer = 0;
let fpsFrames = 0;

renderer.setAnimationLoop((time) => {
  const frameTime = lastFrameTime === undefined ? 0 : (time - lastFrameTime) / 1000;
  lastFrameTime = time;

  // Setting the text forces a layout, so only update it a few times a second
  fpsTimer += frameTime;
  fpsFrames++;
  if (fpsTimer >= 0.25) {
    fpsText.textContent = Math.round(fpsFrames / fpsTimer).toLocaleString();
    fpsTimer = 0;
    fpsFrames = 0;
  }

  controls.update(frameTime);

  timeAccumulator = Math.min(timeAccumulator + frameTime, 2 * simDt);
  if (timeAccumulator >= simDt) {
    step();
    timeAccumulator -= simDt;
  }

  // Draw bodies where they'd be by now, so motion stays smooth at any refresh rate
  extrapolationTime.value = timeAccumulator;

  renderPipeline.render();
});
