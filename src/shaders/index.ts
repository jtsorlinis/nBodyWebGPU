import { ComputeShader } from "@babylonjs/core/Compute/computeShader";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import bodiesVertex from "./bodiesVertex.wgsl?raw";
import bodiesFragment from "./bodiesFragment.wgsl?raw";
import bodiesIntegrateSource from "./compute/bodiesIntegrate.wgsl?raw";
import bodiesForcesSource from "./compute/bodiesForces.wgsl?raw";
import bhTreeSource from "./compute/barnes-hut/bhTree.wgsl?raw";
import bhForcesSource from "./compute/barnes-hut/bhForces.wgsl?raw";
import bhClearSource from "./compute/barnes-hut/bhClear.wgsl?raw";

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
    },
  );
};

export const createBodiesIntegrateShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bodiesIntegrate",
    engine,
    { computeSource: bodiesIntegrateSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        bodiesIn: { group: 0, binding: 1 },
        bodiesOut: { group: 0, binding: 2 },
      },
    },
  );

export const createBodiesForcesShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bodiesForces",
    engine,
    { computeSource: bodiesForcesSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        bodies: { group: 0, binding: 1 },
      },
    },
  );

export const createBHTreeShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bhTree",
    engine,
    { computeSource: bhTreeSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        bodies: { group: 0, binding: 1 },
        nodes: { group: 0, binding: 2 },
        allocator: { group: 0, binding: 3 },
      },
    },
  );

export const createBHForcesShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bhForces",
    engine,
    { computeSource: bhForcesSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        bodies: { group: 0, binding: 1 },
        nodes: { group: 0, binding: 2 },
      },
    },
  );

export const createBHClearShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bhClear",
    engine,
    { computeSource: bhClearSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        nodes: { group: 0, binding: 1 },
      },
    },
  );
