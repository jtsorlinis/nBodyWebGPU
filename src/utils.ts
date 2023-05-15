import { Scene, UniversalCamera, Vector3, WebGPUEngine } from "@babylonjs/core";

export const randRange = (min: number, max: number) =>
  min + Math.random() * (max - min);

export const initScene = async () => {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  canvas.onpointerdown = () => {
    canvas.requestPointerLock();
  };

  canvas.onpointerup = () => {
    document.exitPointerLock();
  };

  const engine = new WebGPUEngine(canvas, {
    setMaximumLimits: true,
    enableAllFeatures: true,
  });
  await engine.initAsync();

  const scene = new Scene(engine);
  scene.clearColor.set(0, 0, 0, 1);

  const camera = new UniversalCamera("camera", new Vector3(0, 0, -10), scene);
  camera.minZ = 0.1;
  camera.speed = 5;
  camera.keysLeft = [65];
  camera.keysRight = [68];
  camera.keysUp = [87];
  camera.keysDown = [83];
  camera.keysUpward = [69];
  camera.keysDownward = [81];
  camera.attachControl();

  return { engine, scene, camera };
};
