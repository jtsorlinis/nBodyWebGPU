struct Params {
  numBodies: u32, gravity: f32, deltaTime: f32, blackHoleMass: f32,
  softening: f32, theta: f32, maxNodes: u32, massScale: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> allocator: u32;
@group(0) @binding(2) var<storage, read_write> bounds: array<u32, 6>;
// Dispatch dimensions followed by the exact number of nodes to clear.
@group(0) @binding(3) var<storage, read_write> clearArgs: array<u32, 4>;

@compute @workgroup_size(1)
fn main() {
  let count = min(allocator, params.maxNodes);
  clearArgs[0] = (count + 255u) / 256u;
  clearArgs[1] = 1u;
  clearArgs[2] = 1u;
  clearArgs[3] = count;
  allocator = 1u;
  for (var i = 0u; i < 3u; i++) {
    bounds[i] = 0xffffffffu;
    bounds[i + 3u] = 0u;
  }
}
