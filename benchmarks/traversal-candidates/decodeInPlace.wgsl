struct Params {
  numBodies: u32, gravity: f32, deltaTime: f32, blackHoleMass: f32,
  softening: f32, theta: f32, maxNodes: u32, massScale: f32,
}
struct Node {
  massInt: i32, comXInt: i32, comYInt: i32, comZInt: i32,
  center: vec3<f32>, halfSize: f32, children: array<i32, 8>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> nodes: array<Node>;
@group(0) @binding(2) var<storage, read> allocator: u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= min(allocator, params.maxNodes)) { return; }
  let weight = nodes[id.x].massInt;
  let mass = f32(weight) / params.massScale;
  var com = vec3<f32>(0.0);
  if (weight > 0) {
    let moment = vec3<f32>(f32(nodes[id.x].comXInt), f32(nodes[id.x].comYInt), f32(nodes[id.x].comZInt));
    com = nodes[id.x].center + moment / f32(weight) * nodes[id.x].halfSize;
  }
  nodes[id.x].massInt = bitcast<i32>(com.x);
  nodes[id.x].comXInt = bitcast<i32>(com.y);
  nodes[id.x].comYInt = bitcast<i32>(com.z);
  nodes[id.x].comZInt = bitcast<i32>(mass);
}
