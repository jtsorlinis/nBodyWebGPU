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
const numBodies = 30000;
let gravity = 5;
let blackHoleMass = 16384; // Sagitarrius A* is 4 million solar masses
let initialSpin = 30;
const softeningFactor = 0.5; // 2 times radius squared of each body

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
// pipeline.bloomWeight = 0.5;
pipeline.bloomThreshold = 0.1;

// Setup scene
let bodiesPosArr: Float32Array;
let bodiesVelArr: Float32Array;
let bodiesAccArr: Float32Array;
let bodiesPosBuffer: StorageBuffer;
let bodiesPosBuffer2: StorageBuffer;
let bodiesVelBuffer: StorageBuffer;
let bodiesVelBuffer2: StorageBuffer;
let bodiesAccBuffer: StorageBuffer;
let bodiesAccBuffer2: StorageBuffer;
let swap = false;

const setup = () => {
  bodiesText.innerHTML = `Bodies: ${numBodies}`;

  // Setup size based on number of bodies
  const spaceLimit = Math.pow(numBodies, 1 / 3) * 10;
  camera.position.set(0, 0, -spaceLimit * 2.75);
  camera.rotation.set(0, 0, 0);

  // Intialize buffer with positions
  bodiesPosArr = new Float32Array(numBodies * 4);
  bodiesVelArr = new Float32Array(numBodies * 4);
  bodiesAccArr = new Float32Array(numBodies * 4);
  for (let i = 0; i < numBodies; i++) {
    const pos = randomPointInSphere(spaceLimit * 0.2, spaceLimit);
    bodiesPosArr.set(pos.asArray(), i * 4);

    // Add spin
    const dist = pos.length();
    bodiesVelArr[i * 4] = (pos.y / dist) * initialSpin;
    bodiesVelArr[i * 4 + 1] = (-pos.x / dist) * initialSpin;

    // Set mass. W of accel array is mass
    bodiesAccArr[i * 4 + 3] = randRange(0.5, 1.5);
  }

  // Black hole
  // Set to center of galaxy and remove spin
  bodiesPosArr.set([0, 0, 0], 0); // Pos
  bodiesVelArr.set([0, 0, 0], 0); // Vel
  bodiesAccArr[3] = blackHoleMass;

  // Set params
  params.updateUInt("numBodies", numBodies);
  params.updateFloat("gravity", gravity);
  params.updateFloat("softeningFactor", softeningFactor);
  params.updateFloat("blackHoleMass", blackHoleMass);
  params.update();

  // Copy data to GPU
  bodiesPosBuffer = new StorageBuffer(engine, bodiesPosArr.byteLength);
  bodiesPosBuffer2 = new StorageBuffer(engine, bodiesPosArr.byteLength);
  bodiesPosBuffer.update(bodiesPosArr);

  bodiesVelBuffer = new StorageBuffer(engine, bodiesVelArr.byteLength);
  bodiesVelBuffer2 = new StorageBuffer(engine, bodiesVelArr.byteLength);
  bodiesVelBuffer.update(bodiesVelArr);

  bodiesAccBuffer = new StorageBuffer(engine, bodiesAccArr.byteLength);
  bodiesAccBuffer2 = new StorageBuffer(engine, bodiesAccArr.byteLength);
  bodiesAccBuffer.update(bodiesAccArr);

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
};

blackHoleMassSlider.oninput = () => {
  const val = Math.pow(2, blackHoleMassSlider.valueAsNumber);
  blackHoleMass = val;
  blackHoleMassText.innerText = `Black Hole Mass: ${val}`;
  params.updateFloat("blackHoleMass", blackHoleMass);
  params.update();
};

spinSlider.oninput = () => {
  initialSpin = spinSlider.valueAsNumber;
  spinText.innerText = `Initial spin: ${initialSpin}`;
};

restartButton.onclick = () => {
  bodiesPosBuffer.dispose();
  bodiesPosBuffer2.dispose();
  bodiesVelBuffer.dispose();
  bodiesVelBuffer2.dispose();
  bodiesAccBuffer.dispose();
  bodiesAccBuffer2.dispose();
  setup();
};

engine.runRenderLoop(async () => {
  const dt = engine.getDeltaTime() / 1000;
  const fps = engine.getFps();
  fpsText.innerHTML = `FPS: ${fps.toFixed(2)}`;

  params.updateFloat("dt", dt);
  params.update();

  swapBuffers(swap);

  bodiesComputeShader.dispatchWhenReady(Math.ceil(numBodies / 256));
  swap = !swap;

  scene.render();
});

const swapBuffers = (swap: boolean) => {
  bodiesComputeShader.setStorageBuffer(
    "bodiesPosIn",
    swap ? bodiesPosBuffer2 : bodiesPosBuffer
  );
  bodiesComputeShader.setStorageBuffer(
    "bodiesPosOut",
    swap ? bodiesPosBuffer : bodiesPosBuffer2
  );
  bodiesComputeShader.setStorageBuffer(
    "bodiesVelIn",
    swap ? bodiesVelBuffer2 : bodiesVelBuffer
  );
  bodiesComputeShader.setStorageBuffer(
    "bodiesVelOut",
    swap ? bodiesVelBuffer : bodiesVelBuffer2
  );
  bodiesComputeShader.setStorageBuffer(
    "bodiesAccIn",
    swap ? bodiesAccBuffer2 : bodiesAccBuffer
  );
  bodiesComputeShader.setStorageBuffer(
    "bodiesAccOut",
    swap ? bodiesAccBuffer : bodiesAccBuffer2
  );

  bodiesMat.setStorageBuffer(
    "bodiesPos",
    swap ? bodiesPosBuffer : bodiesPosBuffer2
  );
  bodiesMat.setStorageBuffer(
    "bodiesAcc",
    swap ? bodiesAccBuffer : bodiesAccBuffer2
  );
};
