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

const numBodies = 20000;
const gravity = 10;
const softeningFactor = 0.5; // 2 times radius squared of each body

const { engine, scene, camera } = await initScene();

// Setup size based on number of bodies
const spaceLimit = Math.pow(numBodies, 1 / 3) * 10;
camera.position.z = -spaceLimit * 2.5;

// Setup material
const bodiesMat = createBodiesMaterial(scene);

// Setup compute shader
const bodiesComputeShader = createBodiesComputeShader(engine);

// Setup mesh
const ballMesh = MeshBuilder.CreateSphere("ball");
ballMesh.buildBoundingInfo(
  new Vector3(-1000000, -1000000, -1000000),
  new Vector3(1000000, 1000000, 1000000)
);
ballMesh.forcedInstanceCount = numBodies;
ballMesh.material = bodiesMat;

// Intialize buffer with positions
const bodiesArr = new Float32Array(numBodies * 12);
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
  bodiesArr[i * 12 + 4] = (bodiesArr[i * 12 + 1] * 20) / dist;
  bodiesArr[i * 12 + 5] = (-bodiesArr[i * 12 + 0] * 20) / dist;

  // random velocity
  // bodiesArr[i * 12 + 4] = randRange(-gravity * 2, gravity * 2);
  // bodiesArr[i * 12 + 5] = randRange(-gravity * 2, gravity * 2);
  // bodiesArr[i * 12 + 6] = randRange(-gravity * 2, gravity * 2);
}

// Set params
const params = new UniformBuffer(engine);
params.addUniform("numBodies", 1);
params.addUniform("gravity", 1);
params.addUniform("softeningFactor", 1);
params.addUniform("dt", 1);

params.updateUInt("numBodies", numBodies);
params.updateFloat("gravity", gravity);
params.updateFloat("softeningFactor", softeningFactor);
params.update();

// Copy data to GPU
const bodiesBuffer = new StorageBuffer(engine, bodiesArr.byteLength);
const bodiesBuffer2 = new StorageBuffer(engine, bodiesArr.byteLength);
bodiesBuffer.update(bodiesArr);
bodiesComputeShader.setUniformBuffer("params", params);

// Add bloom
var pipeline = new DefaultRenderingPipeline("defaultPipeline", true, scene, [
  camera,
]);
pipeline.bloomEnabled = true;
pipeline.bloomScale = 1;
pipeline.bloomWeight = 0.5;

let swap = false;
engine.runRenderLoop(async () => {
  const dt = scene.deltaTime / 1000;
  if (isFinite(dt) && dt > 0) {
    params.updateFloat("dt", dt);
    params.update();
  }

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
