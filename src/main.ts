import {
  MathUtils,
  type Material,
  Mesh,
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

// Constants
let numBodies = 1 << 17;
// Every node gets eight contiguous child records for the force pass, so the tree's
// capacity is also the record capacity. Trees have used at most 0.84 nodes per body,
// including failed allocations that insertion reuses.
const nodesPerBody = 2;
// Eight child records per node: centre of mass xyz, mass. Their quadrupoles are a
// separate buffer of the same size.
const recordBytesPerNode = 8 * 16;
// Derived from numBodies by setup
let maxNodes = 0;
let blackHoleMass = 0;
const softening = 3.0;
const theta = 0.6;
const simDt = 1 / 60; // Fixed simulation timestep (seconds)

const { device, renderer, scene, camera, controls } = await initScene();

const fpsText = document.getElementById("fpsText") as HTMLElement;
const bodiesText = document.getElementById("bodiesText") as HTMLElement;
const gravityText = document.getElementById("gravityText") as HTMLElement;
const gravitySlider = document.getElementById(
  "gravitySlider",
) as HTMLInputElement;
const restartButton = document.getElementById("restartButton") as HTMLElement;
const twinGalaxiesToggle = document.getElementById(
  "twinGalaxiesToggle",
) as HTMLInputElement;

// The controls hold the starting settings
let gravity = gravitySlider.valueAsNumber;
let twinGalaxies = twinGalaxiesToggle.checked;

const updateGravityDisplay = () => {
  gravityText.textContent = String(gravity);
  const min = Number(gravitySlider.min);
  const max = Number(gravitySlider.max);
  gravitySlider.style.setProperty("--range-progress", `${(gravity - min) / (max - min) * 100}%`);
};
updateGravityDisplay();

const bodyCountButtons = document.querySelectorAll<HTMLButtonElement>(
  "#bodyCountButtons button",
);
// The child records are the largest buffer, and summarize dispatches two
// invocations per node.
const maxBufferBytes = Math.min(
  device.limits.maxStorageBufferBindingSize,
  device.limits.maxBufferSize,
);
for (const button of bodyCountButtons) {
  const count = Number(button.value);
  button.title = `${count.toLocaleString()} bodies`;
  if (count * nodesPerBody * recordBytesPerNode > maxBufferBytes ||
      Math.ceil(count * nodesPerBody * 2 / 256) + 1 > device.limits.maxComputeWorkgroupsPerDimension) {
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

// Layout must match the Params struct in shaders/compute/common.wgsl (uniform alignment rules)
const paramsData = new DataView(new ArrayBuffer(32));
const params = device.createBuffer({
  size: paramsData.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
let massScale = 0;

// Sends the settings to the compute shaders, and rescales the colours to match
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
  maxAcc.value = Math.sqrt((numBodies + blackHoleMass) * gravity) / 15;
};

// Setup material and mesh
const maxAcc = uniform(1);
const extrapolationTime = uniform(0);

// Bodies are drawn as camera-facing discs (see createBodiesMaterial)
const bodyMesh = new Mesh<PlaneGeometry, Material>(new PlaneGeometry(1, 1));
bodyMesh.frustumCulled = false;
scene.add(bodyMesh);

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
// Storage buffers for the current simulation, destroyed when it restarts
let simBuffers: GPUBuffer[] = [];

// Starts the simulation over with the current settings
const setup = () => {
  for (const buffer of simBuffers) buffer.destroy();

  maxNodes = numBodies * nodesPerBody;
  blackHoleMass = numBodies / 2;
  bodiesText.textContent = numBodies.toLocaleString();
  for (const button of bodyCountButtons) {
    button.setAttribute("aria-pressed", String(Number(button.value) === numBodies));
  }

  // Setup size based on number of bodies
  const numGalaxies = twinGalaxies ? 2 : 1;
  const spaceLimit = Math.pow(numBodies / numGalaxies, 1 / 3) * 10;
  const innerRadius = spaceLimit * 0.1;
  const halfThickness = spaceLimit * 0.05;

  // Speed for a circular orbit at each radius, including the pull of the disk itself
  const orbitalSpeed = createRotationCurve({
    gravity,
    centralMass: blackHoleMass,
    diskMass: numBodies / numGalaxies, // Bodies have a mean mass of 1
    rMin: innerRadius,
    rMax: spaceLimit,
    halfThickness,
    softening,
  });

  const cameraDist = spaceLimit * (twinGalaxies ? 4 : 2.25);
  const elevationAngle = MathUtils.degToRad(30);
  const y = cameraDist * Math.sin(elevationAngle);
  const z = cameraDist * Math.cos(elevationAngle);

  camera.position.set(0, y, z);
  camera.lookAt(0, 0, 0);

  const galaxy1Offset = twinGalaxies ? -spaceLimit * 1.5 : 0;
  const galaxy2Offset = twinGalaxies ? spaceLimit * 1.5 : 0;
  // Initialize bodies
  // posMass: xyz = position, w = mass
  // motion: velocity, acceleration (vec3s padded to 4 floats)
  const posMassArr = new Float32Array(numBodies * 4);
  const motionArr = new Float32Array(numBodies * 8);
  for (let i = 0; i < numBodies; i++) {
    const pos = randomPointInDisk(innerRadius, spaceLimit, halfThickness);
    const offset = i < numBodies / 2 ? galaxy1Offset : galaxy2Offset;
    posMassArr[i * 4] = pos.x + offset;
    posMassArr[i * 4 + 1] = pos.y;
    posMassArr[i * 4 + 2] = pos.z;

    // Circular Orbital Velocity, anticlockwise seen from above
    const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    const speed = orbitalSpeed(dist);

    // Add some random noise to velocity to make it less perfect
    const speedNoise = MathUtils.randFloat(0.8, 1.2);

    motionArr[i * 8] = (pos.z / dist) * speed * speedNoise;
    motionArr[i * 8 + 2] = (-pos.x / dist) * speed * speedNoise;

    // Set mass
    posMassArr[i * 4 + 3] = MathUtils.randFloat(0.5, 1.5);
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
  const buffers = {
    posMass: createStorageBuffer(posMassArr.byteLength, posMassArr),
    motion: createStorageBuffer(motionArr.byteLength, motionArr),
    // 64 and 32 bytes per node. New buffers are zeroed, which is an empty tree
    nodes: createStorageBuffer(maxNodes * 64),
    secondMoments: createStorageBuffer(maxNodes * 32),
    // 1 uint
    allocator: createStorageBuffer(4),
    // min xyz, max xyz
    bounds: createStorageBuffer(6 * 4),
    // Bodies under each node, and body indices in tree order: 1 uint each
    counts: createStorageBuffer(maxNodes * 4),
    order: createStorageBuffer(numBodies * 4),
    // Rebuilt every step
    records: createStorageBuffer(maxNodes * recordBytesPerNode),
    quadrupoles: createStorageBuffer(maxNodes * recordBytesPerNode),
  };
  simBuffers = Object.values(buffers);

  // Bodies are updated in place, so the buffers only need binding once
  for (const shader of [bodiesIntegrateShader, bhClearShader, bhBoundsShader,
    bhTreeShader, bhSummarizeShader, bhOrderShader, bhForcesShader]) {
    shader.setBuffers({ params, ...buffers });
  }

  bodyMesh.material.dispose();
  bodyMesh.material = createBodiesMaterial(
    shareWithRenderer(buffers.posMass, 4),
    shareWithRenderer(buffers.motion, 4),
    numBodies,
    maxAcc,
    extrapolationTime,
  );
  bodyMesh.count = numBodies;
};

setup();

// UI interaction
gravitySlider.oninput = () => {
  gravity = gravitySlider.valueAsNumber;
  updateGravityDisplay();
  updateParams();
};

restartButton.onclick = setup;

twinGalaxiesToggle.onchange = () => {
  twinGalaxies = twinGalaxiesToggle.checked;
  setup();
};

for (const button of bodyCountButtons) {
  button.onclick = () => {
    const count = Number(button.value);
    if (count === numBodies) return;
    numBodies = count;
    setup();
  };
}

const step = () => {
  const encoder = device.createCommandEncoder();
  const computePass = encoder.beginComputePass();
  const bodyWorkgroups = Math.ceil(numBodies / 256);

  // Pass 1: Integrate (Drift + Kick 1)
  bodiesIntegrateShader.dispatch(computePass, bodyWorkgroups);

  // Pass 2: Barnes-Hut
  // 2a: Clear the Nodes the last tree used, and reset Bounds and the tree order
  bhClearShader.dispatch(computePass, Math.ceil(maxNodes / 256));

  // 2b: Compute Bounds of all bodies (Root of the tree), and reset Allocator
  bhBoundsShader.dispatch(computePass, bodyWorkgroups);

  // 2c: Build Tree
  bhTreeShader.dispatch(computePass, bodyWorkgroups);

  // 2d: Gather each node's child centres of mass and quadrupoles into contiguous records
  // for the force pass, plus one workgroup for the tree's top levels
  bhSummarizeShader.dispatch(computePass, Math.ceil(maxNodes * 2 / 256) + 1);

  // 2e: Put bodies in tree order
  bhOrderShader.dispatch(computePass, bodyWorkgroups);

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
