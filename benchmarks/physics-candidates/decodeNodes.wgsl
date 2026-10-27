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
@group(0) @binding(3) var<storage, read_write> aggregates: array<vec4<f32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= min(allocator, params.maxNodes)) { return; }
  let node = nodes[id.x];
  if (node.massInt <= 0) { aggregates[id.x] = vec4<f32>(0.0); return; }
  let mass = f32(node.massInt) / params.massScale;
  let moment = vec3<f32>(f32(node.comXInt), f32(node.comYInt), f32(node.comZInt));
  let com = node.center + moment / f32(node.massInt) * node.halfSize;
  aggregates[id.x] = vec4<f32>(com, mass);
}
