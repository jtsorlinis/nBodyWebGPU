import {
  ComputeShader,
  Scene,
  ShaderLanguage,
  ShaderMaterial,
  WebGPUEngine,
} from "@babylonjs/core";
import bodiesVertex from "./bodiesVertex.wgsl?raw";
import bodiesFragment from "./bodiesFragment.wgsl?raw";
import bodiesIntegrateSource from "./compute/bodiesIntegrate.wgsl?raw";
import bodiesForcesSource from "./compute/bodiesForces.wgsl?raw";
import bhTreeSource from "./compute/barnes-hut/bhTree.wgsl?raw";
import bhForcesSource from "./compute/barnes-hut/bhForces.wgsl?raw";
import bhClearSource from "./compute/barnes-hut/bhClear.wgsl?raw";
import bhBoundsSource from "./compute/barnes-hut/bhBounds.wgsl?raw";
import bhOrderSource from "./compute/barnes-hut/bhOrder.wgsl?raw";
import bhSummarizeSource from "./compute/barnes-hut/bhSummarize.wgsl?raw";

export const createBodiesMaterial = (scene: Scene) => {
  return new ShaderMaterial(
    "bodiesMat",
    scene,
    { vertexSource: bodiesVertex, fragmentSource: bodiesFragment },
    {
      attributes: ["position", "uv", "normal"],
      uniformBuffers: ["Scene", "Mesh"],
      storageBuffers: ["posMass", "motion"],
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
        posMass: { group: 0, binding: 1 },
        motion: { group: 0, binding: 2 },
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
        posMass: { group: 0, binding: 1 },
        motion: { group: 0, binding: 2 },
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
        posMass: { group: 0, binding: 1 },
        nodes: { group: 0, binding: 2 },
        allocator: { group: 0, binding: 3 },
        bounds: { group: 0, binding: 4 },
        counts: { group: 0, binding: 5 },
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
        posMass: { group: 0, binding: 1 },
        motion: { group: 0, binding: 2 },
        nodes: { group: 0, binding: 3 },
        order: { group: 0, binding: 4 },
      },
    },
  );

export const createBHBoundsShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bhBounds",
    engine,
    { computeSource: bhBoundsSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        posMass: { group: 0, binding: 1 },
        bounds: { group: 0, binding: 2 },
        allocator: { group: 0, binding: 3 },
      },
    },
  );

export const createBHSummarizeShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bhSummarize",
    engine,
    { computeSource: bhSummarizeSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        nodes: { group: 0, binding: 1 },
        allocator: { group: 0, binding: 2 },
      },
    },
  );

export const createBHOrderShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bhOrder",
    engine,
    { computeSource: bhOrderSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        posMass: { group: 0, binding: 1 },
        nodes: { group: 0, binding: 2 },
        counts: { group: 0, binding: 3 },
        order: { group: 0, binding: 4 },
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
        allocator: { group: 0, binding: 2 },
        bounds: { group: 0, binding: 3 },
        counts: { group: 0, binding: 4 },
        order: { group: 0, binding: 5 },
      },
    },
  );
