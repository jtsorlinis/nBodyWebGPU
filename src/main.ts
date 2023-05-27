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
const gravity = 1;
const initialSpin = 30;
const softeningFactor = 0.5; // 2 times radius squared of each body
const blackHoleMass = 400000; // Sagitarrius A* mass in solar masses

const { engine, scene, camera } = await initScene();

const fpsText = document.getElementById("fpsText") as HTMLElement;
const bodiesText = document.getElementById("bodiesText") as HTMLElement;

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
let bodiesBuffer2: StorageBuffer;
let swap = false;

const setup = () => {
  bodiesText.innerHTML = `Bodies: ${numBodies}`;

  // Setup size based on number of bodies
  const spaceLimit = Math.pow(numBodies, 1 / 3) * 10;
  camera.position.set(0, 0, -spaceLimit * 2.75);
  camera.rotation.set(0, 0, 0);

  // Intialize buffer with positions
  bodiesArr = new Float32Array(numBodies * 12);
  for (let i = 0; i < numBodies; i++) {
    const pos = randomPointInSphere(spaceLimit * 0.2, spaceLimit);
    bodiesArr[i * 12 + 0] = pos.x;
    bodiesArr[i * 12 + 1] = pos.y;
    bodiesArr[i * 12 + 2] = pos.z;

    // Add spin
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    bodiesArr[i * 12 + 4] = (bodiesArr[i * 12 + 1] / dist) * initialSpin;
    bodiesArr[i * 12 + 5] = (-bodiesArr[i * 12 + 0] / dist) * initialSpin;

    // Set mass
    bodiesArr[i * 12 + 11] = randRange(0.5, 1.5);
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
