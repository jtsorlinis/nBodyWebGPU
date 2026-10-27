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
@group(0) @binding(3) var<storage, read> parents: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read_write> ropes: array<i32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= min(allocator, params.maxNodes)) { return; }
  var current = id.x;
  var next = -1;
  for (var depth = 0u; depth < 32u; depth++) {
    let info = parents[current];
    if (info.x == 0u) { break; }
    let parent = info.x - 1u;
    for (var c = i32(info.y) - 1; c >= 0; c--) {
      let child = nodes[parent].children[c];
      if (child >= 0) { next = child; break; }
    }
    if (next >= 0) { break; }
    current = parent;
  }
  ropes[id.x] = next;
}
