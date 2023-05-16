import {
  ComputeShader,
  Scene,
  ShaderLanguage,
  ShaderMaterial,
  ThinEngine,
} from "@babylonjs/core";
import bodiesVertex from "./bodiesVertex.wgsl?raw";
import bodiesFragment from "./bodiesFragment.wgsl?raw";
import bodiesComputeSource from "./compute/bodiesCompute.wgsl?raw";

export const createBodiesMaterial = (scene: Scene) => {
  return new ShaderMaterial(
    "bodiesMat",
    scene,
    { vertexSource: bodiesVertex, fragmentSource: bodiesFragment },
    {
      attributes: ["position", "uv", "normal"],
      uniformBuffers: ["Scene", "Mesh"],
      storageBuffers: ["bodies"],
      shaderLanguage: ShaderLanguage.WGSL,
    }
  );
};

export const createBodiesComputeShader = (engine: ThinEngine) =>
  new ComputeShader(
    "bodiesCompute",
    engine,
    { computeSource: bodiesComputeSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        bodiesIn: { group: 0, binding: 1 },
        bodiesOut: { group: 0, binding: 2 },
      },
    }
  );
