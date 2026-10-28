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

struct Node {
  sums: vec4<i32>,
  geom: vec4<f32>,
  children: array<i32, 8>,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read_write> nodes : array<Node>;
// Number of nodes this tree build allocated
@group(0) @binding(2) var<storage, read> allocator : u32;

// Converts each node into what the force pass needs, so it isn't redone per body:
// - sums becomes the centre of mass (xyz) and mass (w) as floats (bitcast into the i32s).
//   The moment is relative to the node centre in units of its half size (see bhTree).
// - geom.w becomes the squared distance beyond which the node can be approximated,
//   i.e. size / dist < theta. geom.xyz (the centre) is left for bhOrder.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= min(allocator, params.maxNodes)) {
    return;
  }

  // Unused (spare) nodes stay zeroed, which reads as zero mass
  let sums = nodes[id.x].sums;
  if (sums.x <= 0) {
    return;
  }

  let geom = nodes[id.x].geom;
  let com = geom.xyz + vec3<f32>(sums.yzw) / f32(sums.x) * geom.w;
  nodes[id.x].sums = bitcast<vec4<i32>>(vec4(com, f32(sums.x) / params.massScale));

  let size = geom.w * 2.0;
  nodes[id.x].geom.w = size * size / (params.theta * params.theta);
}
