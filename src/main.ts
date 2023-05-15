import {
  ComputeShader,
  DefaultRenderingPipeline,
  MeshBuilder,
  ShaderLanguage,
  ShaderMaterial,
  StorageBuffer,
  UniformBuffer,
  Vector3,
} from "@babylonjs/core";
import "./style.css";
import { initScene, randRange } from "./utils";

const numBodies = 10000;
const gravity = 10;
const softeningFactor = 0.1;

const { engine, scene, camera } = await initScene();

// Setup size based on number of bodies
const spaceLimit = Math.pow(numBodies, 1 / 3) * 10;
camera.position.z = -spaceLimit * 2.5;

// Setup material
const bodiesMat = new ShaderMaterial("bodiesMat", scene, "./bodies", {
  attributes: ["position", "uv", "normal"],
  uniformBuffers: ["Scene", "Mesh"],
  storageBuffers: ["bodies"],
  shaderLanguage: ShaderLanguage.WGSL,
});

// Setup compute shader
const bodiesComputeShader = new ComputeShader(
  "bodiesCompute",
  engine,
  "./bodies",
  {
    bindingsMapping: {
      params: { group: 0, binding: 0 },
      bodiesIn: { group: 0, binding: 1 },
      bodiesOut: { group: 0, binding: 2 },
    },
  }
);

// Setup mesh
const ballMesh = MeshBuilder.CreateSphere("ball");
ballMesh.buildBoundingInfo(
  new Vector3(-spaceLimit, -spaceLimit, -spaceLimit),
  new Vector3(spaceLimit, spaceLimit, spaceLimit)
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

  // vel
  // bodiesArr[i * 12 + 4] = bodiesArr[i * 12 + 1] / 10;
  // bodiesArr[i * 12 + 5] = bodiesArr[i * 12 + 0] / 10;
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

// Wait for compute shader to be ready
while (!bodiesComputeShader.isReady()) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

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
