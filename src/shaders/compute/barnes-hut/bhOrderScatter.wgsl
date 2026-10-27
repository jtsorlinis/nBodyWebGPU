struct Params {
  numBodies: u32, gravity: f32, deltaTime: f32, blackHoleMass: f32,
  softening: f32, theta: f32, maxNodes: u32, massScale: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> counts: array<u32>;
@group(0) @binding(2) var<storage, read> ranks: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read_write> bodyOrder: array<u32>;

@group(0) @binding(4) var<storage, read> blocks: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.numBodies) { return; }
  let rank = ranks[id.x];
  bodyOrder[blocks[rank.x / 256u] + counts[rank.x] + rank.y] = id.x;
}
