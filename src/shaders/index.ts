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
import buildOctreeComputeSource from "./compute/buildOctree.wgsl?raw";
import clearOctreeComputeSource from "./compute/clearOctree.wgsl?raw";
import fillOctreeComputeSource from "./compute/fillOctree.wgsl?raw";

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

export const createBodiesComputeShader = (engine: ThinEngine) => {
  return new ComputeShader(
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
};

export const createBuildOctreeComputeShader = (engine: ThinEngine) => {
  return new ComputeShader(
    "buildOctree",
    engine,
    { computeSource: buildOctreeComputeSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        depthInfos: { group: 0, binding: 1 },
        octree: { group: 0, binding: 2 },
      },
    }
  );
};

export const createClearOctreeComputeShader = (engine: ThinEngine) => {
  return new ComputeShader(
    "clearOctree",
    engine,
    { computeSource: clearOctreeComputeSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        octree: { group: 0, binding: 1 },
      },
    }
  );
};

export const createFillOctreeComputeShader = (engine: ThinEngine) => {
  return new ComputeShader(
    "fillOctree",
    engine,
    { computeSource: fillOctreeComputeSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        bodies: { group: 0, binding: 1 },
        octree: { group: 0, binding: 2 },
        depthInfos: { group: 0, binding: 3 },
      },
    }
  );
};
