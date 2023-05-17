import {
  DefaultRenderingPipeline,
  MeshBuilder,
  StorageBuffer,
  UniformBuffer,
  Vector3,
} from "@babylonjs/core";
import "./style.css";
import { initScene, randRange } from "./utils";
import { createBodiesComputeShader, createBodiesMaterial } from "./shaders";
import { calculateBodiesCPU } from "./cpu";

let numBodies = 3000;
const gravity = 10;
const softeningFactor = 0.5; // 2 times radius squared of each body

const { engine, scene, camera } = await initScene();

const fpsText = document.getElementById("fpsText") as HTMLElement;
const gpuToggle = document.getElementById("gpuToggle") as HTMLInputElement;
let useGpu = gpuToggle.checked;
const bodiesText = document.getElementById("bodiesText") as HTMLElement;
const bigToggle = document.getElementById("bigToggle") as HTMLInputElement;

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
const ballMesh = MeshBuilder.CreateSphere("ball");
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
pipeline.bloomWeight = 0.5;

// Setup scene
let bodiesArr: Float32Array;
let bodiesBuffer: StorageBuffer;
let bodiesBuffer2: StorageBuffer;
let swap = false;

const setup = () => {
  bodiesText.innerHTML = `Bodies: ${numBodies}`;

  // Setup size based on number of bodies
  const spaceLimit = Math.pow(numBodies, 1 / 3) * 10;
  camera.position.z = -spaceLimit * 2.5;
  camera.rotation.set(0, 0, 0);

  // Intialize buffer with positions
  bodiesArr = new Float32Array(numBodies * 12);
  for (let i = 0; i < numBodies; i++) {
    // pos
    bodiesArr[i * 12 + 0] = randRange(-spaceLimit, spaceLimit);
    bodiesArr[i * 12 + 1] = randRange(-spaceLimit / 2, spaceLimit / 2);
    bodiesArr[i * 12 + 2] = randRange(-spaceLimit, spaceLimit);

    // spin
    const dist = Math.sqrt(
      bodiesArr[i * 12 + 0] ** 2 +
        bodiesArr[i * 12 + 1] ** 2 +
        bodiesArr[i * 12 + 2] ** 2
    );

    const spinForce = spaceLimit / 250;
    bodiesArr[i * 12 + 4] = ((bodiesArr[i * 12 + 1] * 20) / dist) * spinForce;
    bodiesArr[i * 12 + 5] = ((-bodiesArr[i * 12 + 0] * 20) / dist) * spinForce;
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
  numBodies = bigToggle.checked ? 30000 : 3000;
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
    calculateBodiesCPU(bodiesArr, numBodies, gravity, softeningFactor, dt);
    swap ? bodiesBuffer2.update(bodiesArr) : bodiesBuffer.update(bodiesArr);
  }

  scene.render();
});
