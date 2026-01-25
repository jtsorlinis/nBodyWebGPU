import {
  DefaultRenderingPipeline,
  MeshBuilder,
  StorageBuffer,
  UniformBuffer,
  Vector3,
} from "@babylonjs/core";
import "./style.css";
import { initScene, randomPointInDisk } from "./utils";
import {
  createBodiesIntegrateShader,
  createBodiesMaterial,
  createBHTreeShader,
  createBHForcesShader,
  createBHClearShader,
} from "./shaders";
import { randRange } from "./utils";

// Constants
const numBodies = 1 << 17;
const maxNodes = numBodies * 8; // Estimate for octree nodes
let gravity = 5;
let blackHoleMass = numBodies / 2;

let twinGalaxies = false;

const { engine, scene, camera } = await initScene();

const fpsText = document.getElementById("fpsText") as HTMLElement;
const bodiesText = document.getElementById("bodiesText") as HTMLElement;
const gravityText = document.getElementById("gravityText") as HTMLElement;
const gravitySlider = document.getElementById(
  "gravitySlider",
) as HTMLInputElement;
gravityText.innerText = `Gravity: ${gravity}`;
const blackHoleMassText = document.getElementById("bhMassText") as HTMLElement;
const blackHoleMassSlider = document.getElementById(
  "bhMassSlider",
) as HTMLInputElement;
blackHoleMassText.innerText = `Black Hole Mass: ${blackHoleMass}`;

const restartButton = document.getElementById("restartButton") as HTMLElement;
const twinGalaxiesToggle = document.getElementById(
  "twinGalaxiesToggle",
) as HTMLInputElement;

// Setup compute shaders
const bodiesIntegrateShader = createBodiesIntegrateShader(engine);
const bhTreeShader = createBHTreeShader(engine);
const bhForcesShader = createBHForcesShader(engine);
const bhClearShader = createBHClearShader(engine);

const params = new UniformBuffer(engine);
// Layout must match the shaders (std140/uniform alignment rules)
// 0: numBodies (u32)
// 4: gravity (f32)
// 8: deltaTime (f32)
// 12: blackHoleMass (f32)
// 16: softening (f32)
// 20: theta (f32)
// 24: maxNodes (u32)
// 28: padding
// 32: minPos (vec3)
// 48: maxPos (vec3)

params.addUniform("numBodies", 1);
params.addUniform("gravity", 1);
params.addUniform("dt", 1);
params.addUniform("blackHoleMass", 1);
params.addUniform("softening", 1);
params.addUniform("theta", 1);
params.addUniform("maxNodes", 1);
params.addUniform("pad1", 1);
params.addUniform("minPos", 3);
params.addUniform("pad2", 1);
params.addUniform("maxPos", 3);
params.addUniform("pad3", 1);

params.updateFloat("softening", 3.0);
params.updateFloat("theta", 0.5);

bodiesIntegrateShader.setUniformBuffer("params", params);
bhTreeShader.setUniformBuffer("params", params);
bhForcesShader.setUniformBuffer("params", params);
bhClearShader.setUniformBuffer("params", params);

// Setup material and mesh
const bodiesMat = createBodiesMaterial(scene);

// Update colours based on params
const updateColours = () => {
  const maxAcc = Math.sqrt((numBodies + blackHoleMass) * gravity) / 15;
  bodiesMat.setFloat("maxAcc", maxAcc);
};
updateColours();

const ballMesh = MeshBuilder.CreateSphere("ball", { segments: 8 });
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
pipeline.bloomScale = 1;
pipeline.bloomThreshold = 0.0;

// Setup scene
let bodiesArr: Float32Array;
let bodiesBuffer: StorageBuffer;
let bodiesBuffer2: StorageBuffer;
let nodesBuffer: StorageBuffer;
let allocatorBuffer: StorageBuffer;
let swap = false;

const setup = () => {
  bodiesText.innerHTML = `Bodies: ${numBodies}`;

  // Setup size based on number of bodies
  const spaceLimit = Math.pow(numBodies * (twinGalaxies ? 0.5 : 1), 1 / 3) * 10;

  // Bounds for Octree (make sure it covers everything)
  const bounds = spaceLimit * 4;
  params.updateVector3("minPos", new Vector3(-bounds, -bounds, -bounds));
  params.updateVector3("maxPos", new Vector3(bounds, bounds, bounds));

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
    const pos = randomPointInDisk(spaceLimit * 0.1, spaceLimit);
    const offset = i < numBodies / 2 ? galaxy1Offset : galaxy2Offset;
    bodiesArr[i * 12] = pos.x + offset;
    bodiesArr[i * 12 + 1] = pos.z;
    bodiesArr[i * 12 + 2] = pos.y;

    // Keplerian Orbital Velocity
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    const speed = Math.sqrt((gravity * blackHoleMass) / dist);

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

  ballMesh.forcedInstanceCount = numBodies;
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

blackHoleMassSlider.oninput = () => {
  const val = Math.pow(2, blackHoleMassSlider.valueAsNumber);
  blackHoleMass = val;
  blackHoleMassText.innerText = `Black Hole Mass: ${val}`;
  params.updateFloat("blackHoleMass", blackHoleMass);
  params.update();
  updateColours();
};

restartButton.onclick = () => {
  bodiesBuffer.dispose();
  bodiesBuffer2.dispose();
  nodesBuffer.dispose();
  allocatorBuffer.dispose();
  setup();
};

twinGalaxiesToggle.onchange = () => {
  twinGalaxies = twinGalaxiesToggle.checked;
  setup();
};

engine.runRenderLoop(async () => {
  const dt = engine.getDeltaTime() / 1000;
  const fps = engine.getFps();
  fpsText.innerHTML = `FPS: ${fps.toFixed(2)}`;

  params.updateFloat("dt", dt);
  params.update();

  const bufferIn = swap ? bodiesBuffer2 : bodiesBuffer;
  const bufferOut = swap ? bodiesBuffer : bodiesBuffer2;

  // Pass 1: Integrate (Drift + Kick 1)
  bodiesIntegrateShader.setStorageBuffer("bodiesIn", bufferIn);
  bodiesIntegrateShader.setStorageBuffer("bodiesOut", bufferOut);
  bodiesIntegrateShader.dispatch(Math.ceil(numBodies / 256));

  // Pass 2: Barnes-Hut
  // 2a: Clear Nodes
  bhClearShader.setStorageBuffer("nodes", nodesBuffer);
  bhClearShader.dispatch(Math.ceil(maxNodes / 256));

  // 2b: Reset Allocator (Root is 0, so next free is 1)
  allocatorBuffer.update(new Uint32Array([1]));

  // 2c: Build Tree
  bhTreeShader.setStorageBuffer("bodies", bufferOut);
  bhTreeShader.setStorageBuffer("nodes", nodesBuffer);
  bhTreeShader.setStorageBuffer("allocator", allocatorBuffer);
  bhTreeShader.dispatch(Math.ceil(numBodies / 256));

  // 2d: Compute Forces (Kick 2)
  bhForcesShader.setStorageBuffer("bodies", bufferOut);
  bhForcesShader.setStorageBuffer("nodes", nodesBuffer);
  bhForcesShader.dispatch(Math.ceil(numBodies / 256));

  bodiesMat.setStorageBuffer("bodies", bufferOut);

  swap = !swap;

  scene.render();
});
