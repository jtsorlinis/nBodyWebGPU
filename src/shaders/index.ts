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
      storageBuffers: ["bodiesPos", "bodiesAcc"],
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
        bodiesPosIn: { group: 0, binding: 1 },
        bodiesPosOut: { group: 0, binding: 2 },
        bodiesVelIn: { group: 0, binding: 3 },
        bodiesVelOut: { group: 0, binding: 4 },
        bodiesAccIn: { group: 0, binding: 5 },
        bodiesAccOut: { group: 0, binding: 6 },
      },
    }
  );
