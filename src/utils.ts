import { Scene, UniversalCamera, Vector3, WebGPUEngine } from "@babylonjs/core";

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

export const randomPointInSphere = (min: number, r: number) => {
  if (min > r) {
    throw new Error("min must be less than or equal to r");
  }

  let rho = Math.cbrt(
    Math.random() * (Math.pow(r, 3) - Math.pow(min, 3)) + Math.pow(min, 3)
  ); // change is here
  let theta = Math.random() * 2 * Math.PI;
  let phi = Math.acos(1 - Math.random() * 2);

  let x = rho * Math.sin(phi) * Math.cos(theta);
  let y = rho * Math.sin(phi) * Math.sin(theta);
  let z = rho * Math.cos(phi);

  return new Vector3(x, y, z);
};

export const randRange = (min: number, max: number) =>
  min + Math.random() * (max - min);
