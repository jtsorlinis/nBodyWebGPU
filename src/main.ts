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
import {
  buildOctreeCPU,
  calculateBodiesCPU,
  clearOctreeCPU,
  fillOctreeCPU,
  getGridPos,
} from "./cpu";

// Constants
const cpuBodies = 100;
const gpuBodies = 30000;
const gravity = 10;
const initialSpin = 10;
const softeningFactor = 0.5; // 2 times radius squared of each body

const { engine, scene, camera } = await initScene();

const fpsText = document.getElementById("fpsText") as HTMLElement;
const gpuToggle = document.getElementById("gpuToggle") as HTMLInputElement;
let useGpu = gpuToggle.checked;
const bodiesText = document.getElementById("bodiesText") as HTMLElement;
const bigToggle = document.getElementById("bigToggle") as HTMLInputElement;

let numBodies = cpuBodies;
const boxes = [];
const drawDepth = 5;

// Setup compute shader
const bodiesComputeShader = createBodiesComputeShader(engine);
const params = new UniformBuffer(engine);
params.addUniform("numBodies", 1);
params.addUniform("gravity", 1);
params.addUniform("softeningFactor", 1);
params.addUniform("dt", 1);
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
// var pipeline = new DefaultRenderingPipeline("defaultPipeline", true, scene, [
//   camera,
// ]);
// pipeline.bloomEnabled = true;
// pipeline.bloomScale = 1;
// pipeline.bloomWeight = 3;
// pipeline.bloomThreshold = 0;

// Setup scene
let bodiesArr: Float32Array;
let bodiesBuffer: StorageBuffer;
let bodiesBuffer2: StorageBuffer;
let swap = false;
let octree: any;
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
    const pos = randomPointInSphere(spaceLimit * 0.5, spaceLimit);
    bodiesArr[i * 12 + 0] = pos.x;
    bodiesArr[i * 12 + 1] = pos.y;
    bodiesArr[i * 12 + 2] = pos.z;

    // Add spin
    bodiesArr[i * 12 + 4] = bodiesArr[i * 12 + 1] * (initialSpin / 100);
    bodiesArr[i * 12 + 5] = -bodiesArr[i * 12 + 0] * (initialSpin / 100);

    // Add colour
    bodiesArr[i * 12 + 11] = Math.random();
  }

  // Set params
  params.updateUInt("numBodies", numBodies);
  params.updateFloat("gravity", gravity);
  params.updateFloat("softeningFactor", softeningFactor);
  params.update();

  // Copy data to GPU
  bodiesBuffer = new StorageBuffer(engine, bodiesArr.byteLength);
  bodiesBuffer2 = new StorageBuffer(engine, bodiesArr.byteLength);
  bodiesBuffer.update(bodiesArr);
  ballMesh.forcedInstanceCount = numBodies;
  swap = false;

  // octree
  octree = buildOctreeCPU(8, spaceLimit);
  // const testSphere = MeshBuilder.CreateSphere("ball", { diameter: 5 }, scene);
  // testSphere.position = new Vector3(
  //   -spaceLimit + 40,
  //   -spaceLimit - 40,
  //   -spaceLimit + 100
  // );
  // console.log(getGridPos(testSphere.position, spaceLimit, drawDepth));
  let box = MeshBuilder.CreateBox(
    "box",
    { size: (spaceLimit * 4) / Math.pow(2, drawDepth) },
    scene
  );
  box.material = new BackgroundMaterial("boxMat", scene);
  box.material.wireframe = true;
  box.isVisible = false;
  for (let i = 0; i < octree[drawDepth].length; i++) {
    const instance = box.createInstance("box" + i);
    instance.position = octree[drawDepth][i].pos;
    instance.scaling = new Vector3(0);
    boxes.push(instance);
  }
};

setup();

gpuToggle.onclick = async () => {
  if (!gpuToggle.checked) {
    const buffer = swap
      ? await bodiesBuffer2.read()
      : await bodiesBuffer.read();
    bodiesArr.set(new Float32Array(buffer.buffer));
  }
  useGpu = gpuToggle.checked;
  bigToggle.disabled = !useGpu;
};

bigToggle.onclick = () => {
  bodiesBuffer?.dispose();
  bodiesBuffer2?.dispose();
  numBodies = bigToggle.checked ? gpuBodies : cpuBodies;
  gpuToggle.disabled = bigToggle.checked;
  setup();
};

engine.runRenderLoop(async () => {
  const dt = engine.getDeltaTime() / 1000;
  const fps = engine.getFps();
  fpsText.innerHTML = `FPS: ${fps.toFixed(2)}`;

  if (useGpu) {
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
  } else {
    // octree
    clearOctreeCPU(octree);
    fillOctreeCPU(octree, bodiesArr, spaceLimit);
    for (let i = 0; i < octree[drawDepth].length; i++) {
      boxes[i].scaling = new Vector3();
      if (octree[drawDepth][i].mass > 0) {
        boxes[i].scaling = new Vector3(1, 1, 1);
      }
    }

    calculateBodiesCPU(bodiesArr, numBodies, gravity, softeningFactor, dt);
    swap ? bodiesBuffer2.update(bodiesArr) : bodiesBuffer.update(bodiesArr);
  }

  scene.render();
});
