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
  createClearOctreeComputeShader,
  createFillOctreeComputeShader,
} from "./shaders";
import {
  Octree,
  buildOctreeCPU,
  calculateBodiesCPU,
  clearOctreeCPU,
  fillOctreeCPU,
} from "./cpu";

// Constants
const cpuBodies = 1000;
const gpuBodies = 30000;
const gravity = 10;
const initialSpin = 25;
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
octreeParams.addUniform("spaceLimit", 1);
octreeParams.addUniform("numBodies", 1);
octreeParams.addUniform("maxDepth", 1);
octreeParams.addUniform("totalNodes", 1);
octreeParams.addUniform("minDistSq", 1);
buildOctreeComputeShader.setUniformBuffer("params", octreeParams);

const clearOctreeComputeShader = createClearOctreeComputeShader(engine);
clearOctreeComputeShader.setUniformBuffer("params", octreeParams);

const fillOctreeComputeShader = createFillOctreeComputeShader(engine);
fillOctreeComputeShader.setUniformBuffer("params", octreeParams);

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
let octreeDepth: number;
let totalNodes: number;
let maxDepth: number;
let octreeBuffer: StorageBuffer;
let depthInfos: Uint32Array;

const setup = async () => {
  bodiesText.innerHTML = `Bodies: ${numBodies}`;

  // Setup size based on number of bodies
  spaceLimit = Math.pow(numBodies, 1 / 3) * 5;
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

  // cpu octree
  octreeDepth = 8;
  octree = buildOctreeCPU(octreeDepth, spaceLimit);

  // octree
  octreeDepth = 9;
  maxDepth = octreeDepth - 1;
  totalNodes = (Math.pow(8, octreeDepth) - 1) / 7;
  octreeBuffer = new StorageBuffer(engine, totalNodes * 16);
  depthInfos = new Uint32Array(octreeDepth * 4);
  const depthInfosBuffer = new StorageBuffer(engine, depthInfos.byteLength);
  for (let i = 0; i < octreeDepth; i++) {
    depthInfos[i * 4 + 0] = (Math.pow(8, i) - 1) / 7; // offset for depth
    depthInfos[i * 4 + 1] = Math.pow(8, i); // nodes at depth
    depthInfos[i * 4 + 2] = Math.pow(2, i); // dim at depth
  }
  depthInfosBuffer.update(depthInfos);
  octreeParams.updateFloat("spaceLimit", spaceLimit);
  octreeParams.updateUInt("numBodies", numBodies);
  octreeParams.updateUInt("maxDepth", maxDepth);
  octreeParams.updateUInt("totalNodes", totalNodes);
  const minCellSize = (spaceLimit * 4) / depthInfos[maxDepth * 4 + 2];
  const minDistSq = Math.max(0.5, minCellSize * minCellSize);
  octreeParams.updateFloat("minDistSq", minDistSq);
  octreeParams.update();

  // Set buffers
  buildOctreeComputeShader.setStorageBuffer("octree", octreeBuffer);
  buildOctreeComputeShader.setStorageBuffer("depthInfos", depthInfosBuffer);

  clearOctreeComputeShader.setStorageBuffer("octree", octreeBuffer);

  fillOctreeComputeShader.setStorageBuffer("octree", octreeBuffer);
  fillOctreeComputeShader.setStorageBuffer("depthInfos", depthInfosBuffer);

  bodiesComputeShader.setStorageBuffer("octree", octreeBuffer);
  bodiesComputeShader.setUniformBuffer("octreeParams", octreeParams);
  bodiesComputeShader.setStorageBuffer("depthInfos", depthInfosBuffer);

  // build octree on gpu
  buildOctreeComputeShader.dispatch(Math.ceil(Math.pow(8, maxDepth) / 512));

  // // visualization debug
  // let drawDepth = 3;
  // const data = await octreeBuffer.read();
  // const x = new Float32Array(data.buffer);
  // const box = MeshBuilder.CreateBox("box");
  // box.material = new BackgroundMaterial("boxMat", scene);
  // box.material.wireframe = true;
  // box.isVisible = false;
  // const cellSize = (spaceLimit * 4) / depthInfos[drawDepth * 4 + 2];
  // for (let i = 0; i < depthInfos[drawDepth * 4 + 1]; i++) {
  //   const instance = box.createInstance("box" + i);
  //   instance.scaling = new Vector3(cellSize, cellSize, cellSize);
  //   const index = (depthInfos[drawDepth * 4 + 0] + i) * 4;
  //   instance.position = new Vector3(x[index + 0], x[index + 1], x[index + 2]);
  //   boxes.push(instance);
  // }
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
    // clear octree
    clearOctreeComputeShader.dispatch(Math.ceil(totalNodes / 512));

    // fill octree
    fillOctreeComputeShader.setStorageBuffer(
      "bodies",
      swap ? bodiesBuffer2 : bodiesBuffer
    );
    fillOctreeComputeShader.dispatch(Math.ceil(numBodies / 512));

    // // debug values
    // const debugDepth = 4;
    // const buff = await octreeBuffer.read();
    // const x = new Uint32Array(buff.buffer);
    // // Sum all the masses at this depth
    // let sum = 0;
    // for (let i = 0; i < depthInfos[debugDepth * 4 + 1]; i++) {
    //   const index = (depthInfos[debugDepth * 4 + 0] + i) * 4;
    //   sum += x[index + 3];
    // }
    // console.log(sum);

    // Calculate bodies
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

    // boxes.forEach((box) => (box.scaling = new Vector3()));
    // for (let i = 0; i < usedBoxes.length; i++) {
    //   boxes[i].position = usedBoxes[i].pos;
    //   boxes[i].scaling = new Vector3(
    //     usedBoxes[i].size,
    //     usedBoxes[i].size,
    //     usedBoxes[i].size
    //   );
    // }

    swap ? bodiesBuffer2.update(bodiesArr) : bodiesBuffer.update(bodiesArr);
  }

  scene.render();
});
