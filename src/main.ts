import {
  BackgroundMaterial,
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
import { calculateBodiesCPU } from "./cpu";
import { Cell, createOctree } from "./octree";

// Constants
const numBodies = 3000;
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
let bodiesArr: Float32Array;
let bodiesBuffer: StorageBuffer;
let spaceLimit: number;

const setup = () => {
  bodiesText.innerHTML = `Bodies: ${numBodies}`;

  // Setup size based on number of bodies
  spaceLimit = Math.pow(numBodies, 1 / 3) * 10;
  camera.position.set(0, 0, -spaceLimit * 2.75);
  camera.rotation.set(0, 0, 0);

  // Intialize buffer with positions
  bodiesArr = new Float32Array(numBodies * 12);
  for (let i = 0; i < numBodies; i++) {
    const pos = randomPointInSphere(spaceLimit * 0.2, spaceLimit);
    bodiesArr.set(pos.asArray(), i * 12);

    // Add spin
    const dist = pos.length();
    bodiesArr[i * 12 + 4] = (pos.y / dist) * initialSpin;
    bodiesArr[i * 12 + 5] = (-pos.x / dist) * initialSpin;

    // Set mass
    bodiesArr[i * 12 + 11] = randRange(0.5, 1.5);
  }

  // Black hole
  // Set to center of galaxy and remove spin
  bodiesArr.set([0, 0, 0], 0); // Pos
  bodiesArr.set([0, 0, 0], 4); // Vel
  bodiesArr[11] = blackHoleMass;

  // Set params
  params.updateUInt("numBodies", numBodies);
  params.updateFloat("gravity", gravity);
  params.updateFloat("softeningFactor", softeningFactor);
  params.updateFloat("blackHoleMass", blackHoleMass);
  params.update();

  // Copy data to GPU
  bodiesBuffer = new StorageBuffer(engine, bodiesArr.byteLength);
  bodiesMat.setStorageBuffer("bodies", bodiesBuffer);
  bodiesBuffer.update(bodiesArr);
  ballMesh.forcedInstanceCount = numBodies;

  // let box = MeshBuilder.CreateBox("box");
  // box.material = new BackgroundMaterial("boxMat", scene);
  // box.material.wireframe = true;
  // box.isVisible = false;

  // const drawOctree = (cell: Cell) => {
  //   const instance = box.createInstance("boxInstance");
  //   instance.position = cell.pos;
  //   instance.scaling = new Vector3(cell.size, cell.size, cell.size);
  //   if (cell.children.length > 0) {
  //     for (let i = 0; i < cell.children.length; i++) {
  //       drawOctree(cell.children[i]);
  //     }
  //   }
  // };

  // drawOctree(octree);
};

setup();

// UI interaction
gravitySlider.oninput = () => {
  gravity = gravitySlider.valueAsNumber;
  gravityText.innerText = `Gravity: ${gravity}`;
};

blackHoleMassSlider.oninput = () => {
  const val = Math.pow(2, blackHoleMassSlider.valueAsNumber);
  blackHoleMass = val;
  blackHoleMassText.innerText = `Black Hole Mass: ${val}`;
};

spinSlider.oninput = () => {
  initialSpin = spinSlider.valueAsNumber;
  spinText.innerText = `Initial spin: ${initialSpin}`;
};

restartButton.onclick = () => {
  bodiesBuffer.dispose();
  setup();
};

engine.runRenderLoop(async () => {
  const dt = engine.getDeltaTime() / 1000;
  const fps = engine.getFps();
  fpsText.innerHTML = `FPS: ${fps.toFixed(2)}`;

  const octree = createOctree(bodiesArr, spaceLimit * 4);
  calculateBodiesCPU(
    bodiesArr,
    numBodies,
    gravity,
    softeningFactor,
    dt,
    octree
  );
  bodiesBuffer.update(bodiesArr);
  scene.render();
});
