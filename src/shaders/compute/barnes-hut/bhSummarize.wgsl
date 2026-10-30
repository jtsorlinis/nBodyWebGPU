// Params and Node are shared by every kernel, see common.wgsl
@group(0) @binding(0) var<uniform> params : Params;
// As built by bhTree. Left unchanged, so parents can read their children's sums
// while other invocations summarize those children.
@group(0) @binding(1) var<storage, read> nodes : array<Node>;
// Number of nodes this tree build allocated
@group(0) @binding(2) var<storage, read> allocator : u32;
// xyz = position, w = mass
@group(0) @binding(3) var<storage, read> posMass : array<vec4<f32>>;
// Eight contiguous child records per node: centre of mass xyz, mass (0 = empty)
@group(0) @binding(4) var<storage, read_write> records : array<vec4<f32>>;

// What the force pass needs from a child slot. Bodies are copied as they are;
// a node's moment is relative to its centre (see momentExponent in common.wgsl).
fn childRecord(child: i32) -> vec4<f32> {
  if (child < 0) {
    return posMass[u32(-child - 1)];
  }
  if (child > 0) {
    let sums = nodes[child].sums;
    if (sums.x > 0) {
      let geom = nodes[child].geom;
      let offset = vec3<f32>(sums.yzw) / f32(sums.x) * ldexp(1.0, momentExponent(geom.w));
      return vec4(geom.xyz + offset, f32(sums.x) / params.massScale);
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
