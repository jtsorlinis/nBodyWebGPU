struct Params {
  numBodies: u32,
  gravity: f32,
  deltaTime: f32,
  blackHoleMass: f32,
  softening: f32,
  theta: f32,
  maxNodes: u32,
  massScale: f32,
}

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
  mass : f32,
};

// Floats are stored as order-preserving uints so they can be reduced with atomicMin/Max
struct Bounds {
  minBits: array<atomic<u32>, 3>,
  maxBits: array<atomic<u32>, 3>,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> bodies : array<Body>;
@group(0) @binding(2) var<storage, read_write> bounds : Bounds;

var<workgroup> localMin : array<atomic<u32>, 3>;
var<workgroup> localMax : array<atomic<u32>, 3>;

// Positive floats get the sign bit set, negative floats have all bits flipped,
// so comparing the uints gives the same order as comparing the floats
fn floatToOrdered(f: f32) -> u32 {
  let bits = bitcast<u32>(f);
  return select(bits | 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>,
        @builtin(local_invocation_id) lid : vec3<u32>) {
  if (lid.x < 3u) {
    atomicStore(&localMin[lid.x], 0xFFFFFFFFu);
    atomicStore(&localMax[lid.x], 0u);
  }
  workgroupBarrier();

  if (id.x < params.numBodies) {
    let pos = bodies[id.x].pos;
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
