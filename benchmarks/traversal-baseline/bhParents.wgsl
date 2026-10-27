struct Params {
  numBodies: u32, gravity: f32, deltaTime: f32, blackHoleMass: f32,
  softening: f32, theta: f32, maxNodes: u32, massScale: f32,
}
struct Node {
  massInt: i32, comXInt: i32, comYInt: i32, comZInt: i32,
  center: vec3<f32>, halfSize: f32, children: array<i32, 8>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;
@group(0) @binding(2) var<storage, read> allocator: u32;
@group(0) @binding(3) var<storage, read_write> parents: array<vec2<u32>>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= min(allocator, params.maxNodes)) { return; }
  // Every reachable internal node except the root has exactly one parent.
  // Unpublished allocations only contain a body leaf, so cannot overwrite these links.
  for (var c = 0u; c < 8u; c++) {
    let child = nodes[id.x].children[c];
    if (child >= 0) { parents[child] = vec2<u32>(id.x + 1u, c); }
  }
}
