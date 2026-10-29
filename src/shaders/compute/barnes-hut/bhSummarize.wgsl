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

// As built by bhTree. Left unchanged, so parents can read their children's sums
// while other invocations summarize those children.
struct Node {
  sums: vec4<i32>, // integer mass, then moment relative to the centre in half sizes
  geom: vec4<f32>, // center xyz, half size
  children: array<i32, 8>, // 0 = empty, > 0 = node, < 0 = body (-1 - bodyIdx)
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> nodes : array<Node>;
// Number of nodes this tree build allocated
@group(0) @binding(2) var<storage, read> allocator : u32;
// xyz = position, w = mass
@group(0) @binding(3) var<storage, read> posMass : array<vec4<f32>>;
// Eight contiguous child records per node: centre of mass xyz, mass (0 = empty)
@group(0) @binding(4) var<storage, read_write> records : array<vec4<f32>>;

// What the force pass needs from a child slot. Bodies are copied as they are;
// a node's moment is relative to its centre in units of its half size (see bhTree).
fn childRecord(child: i32) -> vec4<f32> {
  if (child < 0) {
    return posMass[u32(-child - 1)];
  }
  if (child > 0) {
    let sums = nodes[child].sums;
    if (sums.x > 0) {
      let geom = nodes[child].geom;
      return vec4(geom.xyz + vec3<f32>(sums.yzw) / f32(sums.x) * geom.w, f32(sums.x) / params.massScale);
    }
  }
  return vec4(0.0);
}

// Gathers each node's children into one 128-byte block, so the force pass opens a
// node with a single contiguous read instead of a scattered read chain per child.
// Two invocations per node, four child slots each. Unused (spare) nodes have no
// children, so their records are all empty.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let nodeIdx = id.x / 2u;
  if (nodeIdx >= min(allocator, params.maxNodes)) {
    return;
  }

  for (var k = 0u; k < 4u; k++) {
    let slot = (id.x % 2u) * 4u + k;
    records[nodeIdx * 8u + slot] = childRecord(nodes[nodeIdx].children[slot]);
  }
}
