import { DoubleSide, NodeMaterial, type StorageBufferAttribute, type UniformNode } from "three/webgpu";
import {
  Discard,
  Fn,
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  float,
  instanceIndex,
  length,
  mix,
  positionGeometry,
  saturate,
  storage,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import commonSource from "./compute/common.wgsl?raw";
import bodiesIntegrateSource from "./compute/bodiesIntegrate.wgsl?raw";
import bhTreeSource from "./compute/barnes-hut/bhTree.wgsl?raw";
import bhForcesSource from "./compute/barnes-hut/bhForces.wgsl?raw";
import bhCoherentSource from "./compute/barnes-hut/bhForcesCoherent.wgsl?raw";
import bhClearSource from "./compute/barnes-hut/bhClear.wgsl?raw";
import bhBoundsSource from "./compute/barnes-hut/bhBounds.wgsl?raw";
import bhOrderSource from "./compute/barnes-hut/bhOrder.wgsl?raw";
import bhSummarizeSource from "./compute/barnes-hut/bhSummarize.wgsl?raw";

// A WGSL compute shader run directly on the device three.js renders with. Its bindings
// are all in group 0, and each one is given the buffer of the same name.
class ComputeShader {
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindings: readonly string[];
  private bindGroup: GPUBindGroup | null = null;

  private constructor(device: GPUDevice, pipeline: GPUComputePipeline, bindings: readonly string[]) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindings = bindings;
  }

  static async create(device: GPUDevice, label: string, kernel: string) {
    // Every kernel uses the shared declarations. WGSL declarations can come in any order,
    // so appending them keeps directives first and compile errors on the kernel's own lines.
    const code = `${kernel}\n${commonSource}`;
    const bindings: string[] = [];
    for (const [, binding, name] of code.matchAll(/@binding\((\d+)\)\s*var(?:<[^>]*>)?\s+(\w+)/g)) {
      bindings[Number(binding)] = name;
    }
    const module = device.createShaderModule({ label, code });
    const pipeline = await device.createComputePipelineAsync({
      label,
      layout: "auto",
      compute: { module },
    });
    return new ComputeShader(device, pipeline, bindings);
  }

  setBuffers(buffers: Record<string, GPUBuffer>) {
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: this.bindings.map((name, binding) => ({
        binding,
        resource: { buffer: buffers[name] },
      })),
    });
  }

  dispatch(pass: GPUComputePassEncoder, workgroups: number) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroups);
  }
}

// Subgroup traversal shares opening decisions without assuming a subgroup size or
// any mapping between lane IDs and body IDs. Keep a portable independent path.
const supportsCoherentTraversal = (device: GPUDevice) =>
  device.features.has("subgroups") &&
  navigator.gpu.wgslLanguageFeatures.has("subgroup_uniformity");
// The coherent shader handles two targets per invocation, with 128 invocations.
export const getBHForceBodiesPerWorkgroup = (device: GPUDevice) =>
  supportsCoherentTraversal(device) ? 128 * 2 : 256;

// Bodies are drawn as camera-facing discs, read straight from the simulation's buffers
export const createBodiesMaterial = (
  posMass: StorageBufferAttribute,
  motion: StorageBufferAttribute,
  numBodies: number,
  maxAcc: UniformNode<"float", number>,
  extrapolationTime: UniformNode<"float", number>,
) => {
  const bodies = storage(posMass, "vec4", numBodies).toReadOnly();
  // Two vec4s per body: velocity, then acceleration
  const motions = storage(motion, "vec4", numBodies * 2).toReadOnly();
  const vel = motions.element(instanceIndex.mul(2)).xyz;
  const acc = motions.element(instanceIndex.mul(2).add(1)).xyz;

  const pos = bodies.element(instanceIndex).xyz.add(vel.mul(extrapolationTime));
  const center = cameraViewMatrix.mul(vec4(pos, 1)).xyz;
  const corner = positionGeometry.xy;

  const material = new NodeMaterial();
  material.side = DoubleSide;
  material.vertexNode = cameraProjectionMatrix.mul(vec4(center.add(vec3(corner, 0)), 1));

  const viewCenter = varying(center);
  const particleOffset = varying(corner);
  const mag = saturate(length(acc).div(maxAcc));
  const col = varying(mix(vec3(0.012, 0.063, 0.988), vec3(1.0, 0.376, 0.188), mag));

  const radiusSq = dot(particleOffset, particleOffset);
  // Keep spherical depth at overlaps, even though each particle uses just two triangles.
  const surface = viewCenter.add(vec3(particleOffset, float(0.25).sub(radiusSq).sqrt()));
  const projected = cameraProjectionMatrix.mul(vec4(surface, 1));
  material.depthNode = projected.z.div(projected.w);

  material.fragmentNode = Fn(() => {
    Discard(radiusSq.greaterThan(0.25));
    return vec4(col, 1);
  })();

  return material;
};

export const createBodiesIntegrateShader = (device: GPUDevice) =>
  ComputeShader.create(device, "bodiesIntegrate", bodiesIntegrateSource);

export const createBHTreeShader = (device: GPUDevice) =>
  ComputeShader.create(device, "bhTree", bhTreeSource);

export const createBHForcesShader = (device: GPUDevice) =>
  ComputeShader.create(device, "bhForces",
    supportsCoherentTraversal(device) ? bhCoherentSource : bhForcesSource);

export const createBHBoundsShader = (device: GPUDevice) =>
  ComputeShader.create(device, "bhBounds", bhBoundsSource);

export const createBHSummarizeShader = (device: GPUDevice) =>
  ComputeShader.create(device, "bhSummarize", bhSummarizeSource);

export const createBHOrderShader = (device: GPUDevice) =>
  ComputeShader.create(device, "bhOrder", bhOrderSource);

export const createBHClearShader = (device: GPUDevice) =>
  ComputeShader.create(device, "bhClear", bhClearSource);
