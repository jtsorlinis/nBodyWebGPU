import {
  BackgroundMaterial,
  DefaultRenderingPipeline,
  InstancedMesh,
  MeshBuilder,
  StorageBuffer,
  UniformBuffer,
  Vector3,
} from "@babylonjs/core";
import "./style.css";
import { initScene, randomPointInSphere } from "./utils";
import {
  createBodiesComputeShader,
  createBodiesMaterial,
  createBuildOctreeComputeShader,
} from "./shaders";
import {
  Octree,
  buildOctreeCPU,
  calculateBodiesCPU,
  clearOctreeCPU,
  fillOctreeCPU,
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
let boxes: InstancedMesh[] = [];

// Setup compute shader
const bodiesComputeShader = createBodiesComputeShader(engine);
const params = new UniformBuffer(engine);
params.addUniform("numBodies", 1);
params.addUniform("gravity", 1);
params.addUniform("softeningFactor", 1);
params.addUniform("dt", 1);
bodiesComputeShader.setUniformBuffer("params", params);

// Setup octree compute shaders
const buildOctreeComputeShader = createBuildOctreeComputeShader(engine);
const octreeParams = new UniformBuffer(engine);
octreeParams.addUniform("nodesAtDepth", 1);
octreeParams.addUniform("dimAtDepth", 1);
octreeParams.addUniform("cellSize", 1);
buildOctreeComputeShader.setUniformBuffer("params", octreeParams);

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
let octree: Octree;
let spaceLimit: number;

const setup = async () => {
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
  const octreeDepth = 9;
  const octreeBuffers: StorageBuffer[] = new Array(octreeDepth);
  const cellSizes = new Float32Array(octreeDepth);
  const cellSizesBuffer = new StorageBuffer(engine, 4 * octreeDepth);

  // build octree on gpu bottom up
  for (let currDepth = octreeDepth - 1; currDepth >= 0; currDepth--) {
    const nodesAtDepth = Math.pow(8, currDepth);
    const dimAtDepth = Math.pow(2, currDepth);
    const cellSize = (spaceLimit * 4) / dimAtDepth;
    cellSizes[currDepth] = cellSize;
    octreeParams.updateUInt("nodesAtDepth", nodesAtDepth);
    octreeParams.updateUInt("dimAtDepth", dimAtDepth);
    octreeParams.updateFloat("cellSize", cellSize);
    octreeParams.update();
    octreeBuffers[currDepth] = new StorageBuffer(engine, 16 * nodesAtDepth);
    buildOctreeComputeShader.setStorageBuffer(
      "octree",
      octreeBuffers[currDepth]
    );
    buildOctreeComputeShader.dispatch(Math.ceil(nodesAtDepth / 512));
  }
  cellSizesBuffer.update(cellSizes);

  octree = buildOctreeCPU(8, spaceLimit);
  // visualization
  const box = MeshBuilder.CreateBox("box");
  box.material = new BackgroundMaterial("boxMat", scene);
  box.material.wireframe = true;
  box.isVisible = false;
  for (let i = 0; i < 1000; i++) {
    const instance = box.createInstance("box" + i);
    instance.scaling = new Vector3();
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

    const usedBoxes = calculateBodiesCPU(
      bodiesArr,
      numBodies,
      octree,
      gravity,
      softeningFactor,
      dt
    );

    boxes.forEach((box) => (box.scaling = new Vector3()));
    for (let i = 0; i < usedBoxes.length; i++) {
      boxes[i].position = usedBoxes[i].pos;
      boxes[i].scaling = new Vector3(
        usedBoxes[i].size,
        usedBoxes[i].size,
        usedBoxes[i].size
      );
    }

    swap ? bodiesBuffer2.update(bodiesArr) : bodiesBuffer.update(bodiesArr);
  }

  scene.render();
});
