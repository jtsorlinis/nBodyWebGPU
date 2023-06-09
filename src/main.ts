import {
  DefaultRenderingPipeline,
  MeshBuilder,
  StorageBuffer,
  UniformBuffer,
  Vector3,
} from "@babylonjs/core";
import "./style.css";
import { initScene, randomPointInSphere } from "./utils";
import { createBodiesComputeShader, createBodiesMaterial } from "./shaders";
import { randRange } from "./utils";

// Constants
const numBodies = 1 << 15;
let gravity = 5;
let blackHoleMass = 16384; // Sagitarrius A* is 4 million solar masses
let initialSpin = 30;
const softeningFactor = 0.001;
let twinGalaxies = false;

const { engine, scene, camera } = await initScene();

const fpsText = document.getElementById("fpsText") as HTMLElement;
const bodiesText = document.getElementById("bodiesText") as HTMLElement;
const gravityText = document.getElementById("gravityText") as HTMLElement;
const gravitySlider = document.getElementById(
  "gravitySlider"
) as HTMLInputElement;
gravityText.innerText = `Gravity: ${gravity}`;
const blackHoleMassText = document.getElementById("bhMassText") as HTMLElement;
const blackHoleMassSlider = document.getElementById(
  "bhMassSlider"
) as HTMLInputElement;
blackHoleMassText.innerText = `Black Hole Mass: ${blackHoleMass}`;
const spinText = document.getElementById("spinText") as HTMLElement;
const spinSlider = document.getElementById("spinSlider") as HTMLInputElement;
spinText.innerText = `Initial spin: ${initialSpin}`;
const restartButton = document.getElementById("restartButton") as HTMLElement;
const twinGalaxiesToggle = document.getElementById(
  "twinGalaxiesToggle"
) as HTMLInputElement;

// Setup compute shader
const bodiesComputeShader = createBodiesComputeShader(engine);
const params = new UniformBuffer(engine);
params.addUniform("numBodies", 1);
params.addUniform("gravity", 1);
params.addUniform("softeningFactor", 1);
params.addUniform("dt", 1);
params.addUniform("blackHoleMass", 1);
bodiesComputeShader.setUniformBuffer("params", params);

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
  new Vector3(1000000, 1000000, 1000000)
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
let swap = false;

const setup = () => {
  bodiesText.innerHTML = `Bodies: ${numBodies}`;

  // Setup size based on number of bodies
  const spaceLimit = Math.pow(numBodies * (twinGalaxies ? 0.5 : 1), 1 / 3) * 10;
  camera.position.set(0, 0, -spaceLimit * (twinGalaxies ? 5 : 2.75));
  camera.rotation.set(0, 0, 0);

  let galaxy1Offset = twinGalaxies ? -spaceLimit * 2 : 0;
  let galaxy2Offset = twinGalaxies ? spaceLimit * 2 : 0;
  // Intialize buffer with positions
  bodiesArr = new Float32Array(numBodies * 12);
  for (let i = 0; i < numBodies; i++) {
    const pos = randomPointInSphere(spaceLimit * 0.2, spaceLimit);
    const offset = i < numBodies / 2 ? galaxy1Offset : galaxy2Offset;
    bodiesArr[i * 12] = pos.x + offset;
    bodiesArr[i * 12 + 1] = pos.y;
    bodiesArr[i * 12 + 2] = pos.z;

    // Add spin
    const dist = pos.length();
    bodiesArr[i * 12 + 4] = (pos.y / dist) * initialSpin;
    bodiesArr[i * 12 + 5] = (-pos.x / dist) * initialSpin;

    // Set mass
    bodiesArr[i * 12 + 11] = randRange(0.5, 1.5);
  }

  // Black hole(s)
  // Set to center of galaxy and remove spin
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
  params.updateFloat("gravity", gravity);
  params.updateFloat("softeningFactor", softeningFactor);
  params.updateFloat("blackHoleMass", blackHoleMass);
  params.update();

  // Copy data to GPU
  bodiesBuffer = new StorageBuffer(engine, bodiesArr.byteLength);
  bodiesBuffer2 = new StorageBuffer(engine, bodiesArr.byteLength);
  bodiesBuffer.update(bodiesArr);
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

spinSlider.oninput = () => {
  initialSpin = spinSlider.valueAsNumber;
  spinText.innerText = `Initial spin: ${initialSpin}`;
};

restartButton.onclick = () => {
  bodiesBuffer.dispose();
  bodiesBuffer2.dispose();
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

  bodiesComputeShader.setStorageBuffer(
    "bodiesIn",
    swap ? bodiesBuffer2 : bodiesBuffer
  );
  bodiesComputeShader.setStorageBuffer(
    "bodiesOut",
    swap ? bodiesBuffer : bodiesBuffer2
  );
  bodiesMat.setStorageBuffer("bodies", swap ? bodiesBuffer : bodiesBuffer2);

  bodiesComputeShader.dispatchWhenReady(Math.ceil(numBodies / 256));
  swap = !swap;

  scene.render();
});
