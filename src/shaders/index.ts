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
import bhPrepareSource from "./compute/barnes-hut/bhPrepare.wgsl?raw";
import bhParentsSource from "./compute/barnes-hut/bhParents.wgsl?raw";
import bhRopesSource from "./compute/barnes-hut/bhRopes.wgsl?raw";
import bhOrderClearSource from "./compute/barnes-hut/bhOrderClear.wgsl?raw";
import bhOrderKeysSource from "./compute/barnes-hut/bhOrderKeys.wgsl?raw";
import bhOrderScanSource from "./compute/barnes-hut/bhOrderScan.wgsl?raw";
import bhOrderScanBlocksSource from "./compute/barnes-hut/bhOrderScanBlocks.wgsl?raw";
import bhOrderScatterSource from "./compute/barnes-hut/bhOrderScatter.wgsl?raw";

// Share the dispatch size with main.ts so the shader and dispatch cannot drift apart.
export const BH_FORCE_WORKGROUP_SIZE = 256;
// 64 or 128 cells per axis keep both scan levels divisible by 256 and dispatches
// within WebGPU's workgroup-count limit. Morton keys index the histogram directly.
export const BH_ORDER_GRID_SIZE = 128;
export const BH_ORDER_BIN_COUNT = BH_ORDER_GRID_SIZE ** 3;
export const BH_ORDER_BLOCK_COUNT = BH_ORDER_BIN_COUNT / 256;

// Also used by the GPU benchmark, so it checks the actual production shaders.
export const bhTraversalSources = {
  parents: bhParentsSource,
  ropes: bhRopesSource,
  orderClear: bhOrderClearSource,
  orderKeys: bhOrderKeysSource.replace(/GRID_SIZE/g, `${BH_ORDER_GRID_SIZE}u`),
  orderScanBlocks: bhOrderScanBlocksSource,
  orderScan: bhOrderScanSource.replace(/BLOCK_COUNT/g, `${BH_ORDER_BLOCK_COUNT}u`),
  orderScatter: bhOrderScatterSource,
};

export const createBHTraversalShaders = (engine: WebGPUEngine) => {
  const create = (name: keyof typeof bhTraversalSources, bindings: string[]) =>
    new ComputeShader(name, engine, { computeSource: bhTraversalSources[name] }, {
      bindingsMapping: Object.fromEntries(bindings.map((name, binding) =>
        [name, { group: 0, binding }])),
    });
  return {
    parents: create("parents", ["params", "nodes", "allocator", "parents"]),
    ropes: create("ropes", ["params", "nodes", "allocator", "parents", "ropes"]),
    orderClear: create("orderClear", ["counts"]),
    orderKeys: create("orderKeys", ["params", "bodies", "bounds", "counts", "ranks"]),
    orderScanBlocks: create("orderScanBlocks", ["counts", "blocks"]),
    orderScan: create("orderScan", ["blocks"]),
    orderScatter: create("orderScatter", ["params", "counts", "ranks", "bodyOrder", "blocks"]),
  };
};

export const createBodiesMaterial = (scene: Scene) => {
  const material = new ShaderMaterial(
    "bodiesMat",
    scene,
    { vertexSource: bodiesVertex, fragmentSource: bodiesFragment },
    {
      attributes: ["position"],
      uniformBuffers: ["Scene", "Mesh"],
      storageBuffers: ["bodies"],
      shaderLanguage: ShaderLanguage.WGSL,
    },
  );
  material.backFaceCulling = false;
  return material;
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
        bounds: { group: 0, binding: 4 },
      },
    },
  );

export const createBHForcesShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bhForces",
    engine,
    {
      computeSource: bhForcesSource.replace(
        "FORCE_WORKGROUP_SIZE",
        String(BH_FORCE_WORKGROUP_SIZE),
      ),
    },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        bodies: { group: 0, binding: 1 },
        nodes: { group: 0, binding: 2 },
        bodyOrder: { group: 0, binding: 3 },
        ropes: { group: 0, binding: 4 },
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
        bodies: { group: 0, binding: 1 },
        bounds: { group: 0, binding: 2 },
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
        clearArgs: { group: 0, binding: 2 },
      },
    },
  );

export const createBHPrepareShader = (engine: WebGPUEngine) =>
  new ComputeShader(
    "bhPrepare",
    engine,
    { computeSource: bhPrepareSource },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        allocator: { group: 0, binding: 1 },
        bounds: { group: 0, binding: 2 },
        clearArgs: { group: 0, binding: 3 },
      },
    },
  );
