import {
  AdditiveBlending,
  DoubleSide,
  NodeMaterial,
  type StorageBufferAttribute,
  type UniformNode,
} from "three/webgpu";
import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  exp,
  float,
  instanceIndex,
  length,
  max,
  mix,
  positionGeometry,
  saturate,
  screenSize,
  select,
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

// Each star's light is a Gaussian with this standard deviation, in world units...
const starSigma = 0.25;
// ...or this many pixels, if that's wider, so distant stars don't flicker
const minSigmaPixels = 0.7;

// Bodies are drawn as soft points of light that add up, so dense regions glow brighter.
// They're read straight from the simulation's buffers.
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
  const body = bodies.element(instanceIndex);
  const vel = motions.element(instanceIndex.mul(2)).xyz;
  const acc = motions.element(instanceIndex.mul(2).add(1)).xyz;

  const pos = body.xyz.add(vel.mul(extrapolationTime));
  const center = cameraViewMatrix.mul(vec4(pos, 1)).xyz;

  // A star widened to the minimum size is dimmed to give off the same total light,
  // which also keeps a region's brightness the same at any zoom
  const verticalScale = cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y;
  const pixelsPerUnit = verticalScale.mul(screenSize.y).div(center.z.mul(-2));
  const sigma = max(starSigma, float(minSigmaPixels).div(pixelsPerUnit));
  // The quad reaches 3 standard deviations, where the Gaussian has all but faded out
  const corner = positionGeometry.xy.mul(6);

  const material = new NodeMaterial();
  material.side = DoubleSide;
  material.blending = AdditiveBlending;
  // Nothing else is drawn, and light adds up in any order
  material.depthTest = false;
  material.depthWrite = false;
  material.vertexNode = cameraProjectionMatrix.mul(vec4(center.add(vec3(corner.mul(sigma), 0)), 1));

  // Heavier stars are hotter and much brighter, so the few blue giants outshine the
  // many warm dwarfs. Stars feeling a strong pull, mostly in the old bulge around a
  // black hole, are cooled.
  const mass = body.w;
  const pull = saturate(length(acc).div(maxAcc));
  const heat = saturate(mass.sub(0.5)).mul(pull.mul(-0.5).add(1));
  // Along the blackbody curve, in linear sRGB: 3500 K, 6000 K, 15000 K
  const warm = vec3(1.0, 0.552, 0.25);
  const white = vec3(1.0, 0.896, 0.863);
  const blue = vec3(0.462, 0.61, 1.0);
  const colour = mix(mix(warm, white, saturate(heat.mul(2))), blue, saturate(heat.mul(2).sub(1)));
  // Black holes give off no light
  const luminosity = select(mass.greaterThan(2), float(0), mass.pow(2.5));
  // Stars per area grow with the cube root of the body count (see spaceLimit in setup),
  // so each one is dimmed to keep the galaxy equally bright
  const starLight = 15 / Math.cbrt(numBodies) / (2 * Math.PI);
  const light = varying(colour.mul(luminosity).mul(starLight).div(sigma.mul(sigma)));

  const offset = varying(corner);
  // Fades to zero at the quad's inscribed circle, so its edges don't show
  const falloff = exp(dot(offset, offset).mul(-0.5)).sub(Math.exp(-4.5)).max(0);
  material.fragmentNode = vec4(light.mul(falloff), 1);

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
