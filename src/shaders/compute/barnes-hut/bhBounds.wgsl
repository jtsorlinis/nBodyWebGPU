// Floats are stored as order-preserving uints so they can be reduced with atomicMin/Max
struct Bounds {
  minBits: array<atomic<u32>, 3>,
  maxBits: array<atomic<u32>, 3>,
};

// Params is shared by every kernel, see common.wgsl
@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> bounds : Bounds;
@group(0) @binding(3) var<storage, read_write> allocator : u32;

var<workgroup> localMin : array<atomic<u32>, 3>;
var<workgroup> localMax : array<atomic<u32>, 3>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>,
        @builtin(local_invocation_id) lid : vec3<u32>) {
  // Reserve the nodes bhTree seeds. bhClear has already used last step's count, and
  // bhTree runs after this pass.
  if (id.x == 0u) {
    allocator = seededNodes();
  }

  if (lid.x < 3u) {
    atomicStore(&localMin[lid.x], 0xFFFFFFFFu);
    atomicStore(&localMax[lid.x], 0u);
  }
  workgroupBarrier();

  if (id.x < params.numBodies) {
    let pos = posMass[id.x].xyz;
    for (var i = 0u; i < 3u; i++) {
      let bits = floatToOrdered(pos[i]);
      atomicMin(&localMin[i], bits);
      atomicMax(&localMax[i], bits);
    }
  }
  workgroupBarrier();

  // Reduce within the workgroup first so there's only one global atomic per axis per workgroup
  if (lid.x < 3u) {
    atomicMin(&bounds.minBits[lid.x], atomicLoad(&localMin[lid.x]));
    atomicMax(&bounds.maxBits[lid.x], atomicLoad(&localMax[lid.x]));
  }
}
