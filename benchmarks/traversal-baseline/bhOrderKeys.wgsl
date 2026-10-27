struct Params {
  numBodies: u32, gravity: f32, deltaTime: f32, blackHoleMass: f32,
  softening: f32, theta: f32, maxNodes: u32, massScale: f32,
}
struct Body { pos: vec3<f32>, vel: vec3<f32>, acc: vec3<f32>, mass: f32, }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> bodies: array<Body>;
@group(0) @binding(2) var<storage, read> bounds: array<u32, 6>;
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> ranks: array<vec2<u32>>;

fn decode(bits: u32) -> f32 {
  return bitcast<f32>(select(~bits, bits & 0x7fffffffu, (bits & 0x80000000u) != 0u));
}
fn spread(value: u32) -> u32 {
  var v = value & 0x3ffu;
  v = (v | (v << 16u)) & 0x030000ffu;
  v = (v | (v << 8u)) & 0x0300f00fu;
  v = (v | (v << 4u)) & 0x030c30c3u;
  return (v | (v << 2u)) & 0x09249249u;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.numBodies) { return; }
  let lo = vec3<f32>(decode(bounds[0]), decode(bounds[1]), decode(bounds[2]));
  let hi = vec3<f32>(decode(bounds[3]), decode(bounds[4]), decode(bounds[5]));
  let extent = hi - lo;
  let size = max(max(extent.x, extent.y), extent.z) * 1.02 + 2.0;
  let origin = (lo + hi) * 0.5 - vec3<f32>(size * 0.5);
  let cell = vec3<u32>(clamp((bodies[id.x].pos - origin) / size * f32(GRID_SIZE), vec3<f32>(0.0), vec3<f32>(f32(GRID_SIZE - 1u))));
  let key = spread(cell.x) | (spread(cell.y) << 1u) | (spread(cell.z) << 2u);
  ranks[id.x] = vec2<u32>(key, atomicAdd(&counts[key], 1u));
}
