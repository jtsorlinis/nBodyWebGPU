// Params, Node and SecondMoment are shared by every kernel, see common.wgsl
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
// As built by bhTree below its prefix. The prefix workgroup adds the prefix's own.
@group(0) @binding(5) var<storage, read_write> secondMoments : array<SecondMoment>;
// Each child record's quadrupole (see quadrupoleRecord)
@group(0) @binding(6) var<storage, read_write> quadrupoles : array<vec4<u32>>;

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

// A child node's quadrupole about its centre of mass, as halves: the traceless part
// (3 * second moment - trace) xx, yy | xy, xz | yz, then the trace. It's normalized by the
// node's mass * size^2, which keeps every component within +-3, so halves are precise
// enough. Bodies and empty slots have none.
fn quadrupoleRecord(child: i32) -> vec4<u32> {
  if (child <= 0) {
    return vec4(0u);
  }
  let sums = nodes[child].sums;
  if (sums.x <= 0) {
    return vec4(0u);
  }
  let halfSize = nodes[child].geom.w;
  let second = secondMoments[child];
  // Second moment about the centre of mass per unit mass, from the moments about the centre
  let mass = f32(sums.x);
  let offset = vec3<f32>(sums.yzw) / mass;
  let unitsPerSize = ldexp(0.5 / halfSize, momentExponent(halfSize));
  let toSizeSq = unitsPerSize * unitsPerSize;
  let diag = (vec3<f32>(second.diag) / mass - offset * offset) * toSizeSq;
  let cross = (vec3<f32>(second.cross) / mass - offset.xxy * offset.yzz) * toSizeSq;
  let trace = diag.x + diag.y + diag.z;
  let traceless = 3.0 * diag - trace;
  return vec4(pack2x16float(traceless.xy), pack2x16float(3.0 * cross.xy),
    pack2x16float(vec2(3.0 * cross.z, trace)), 0u);
}

// A child's second moment about its parent's centre, in the parent's units (2^exponent)
fn shiftedSecondMoment(child: i32, parentCenter: vec3<f32>, exponent: i32) -> array<vec3<f32>, 2> {
  if (child < 0) {
    let body = posMass[u32(-child - 1)];
    let offset = ldexp(body.xyz - parentCenter, vec3(-exponent));
    let moment = offset * (body.w * params.massScale);
    return array(moment * offset, moment.xxy * offset.yzz);
  }
  if (child == 0) {
    return array(vec3(0.0), vec3(0.0));
  }
  // A node's sums are about its own centre, offset from the parent's by shift
  let sums = nodes[child].sums;
  let geom = nodes[child].geom;
  let second = secondMoments[child];
  let toParentUnits = ldexp(1.0, momentExponent(geom.w) - exponent);
  let mass = f32(sums.x);
  let moment = vec3<f32>(sums.yzw) * toParentUnits;
  let shift = ldexp(geom.xyz - parentCenter, vec3(-exponent));
  let unitsSq = toParentUnits * toParentUnits;
  return array(
    vec3<f32>(second.diag) * unitsSq + 2.0 * moment * shift + mass * shift * shift,
    vec3<f32>(second.cross) * unitsSq + moment.xxy * shift.yzz + shift.xxy * moment.yzz +
      mass * shift.xxy * shift.yzz);
}

// bhTree's prefix nodes have no second moments of their own, since summing them for every
// body would contend on a few hundred nodes. Build them from their children instead, a
// level at a time from the bottom, then write the records whose children are prefix nodes.
fn summarizePrefix(lid: u32) {
  var levelStart = TOP_INTERNAL;
  var levelEnd = TOP_NODES;
  for (var level = 0u; level < 3u; level++) {
    for (var nodeIdx = levelStart + lid; nodeIdx < levelEnd; nodeIdx += 256u) {
      let geom = nodes[nodeIdx].geom;
      let exponent = momentExponent(geom.w);
      var diag = vec3(0.0);
      var cross = vec3(0.0);
      for (var slot = 0u; slot < 8u; slot++) {
        let shifted = shiftedSecondMoment(nodes[nodeIdx].children[slot], geom.xyz, exponent);
        diag += shifted[0];
        cross += shifted[1];
      }
      secondMoments[nodeIdx] = SecondMoment(vec3<i32>(round(diag)), vec3<i32>(round(cross)));
    }
    storageBarrier();
    levelEnd = levelStart;
    levelStart = (levelStart - 1u) / 8u;
  }
  for (var i = lid; i < TOP_INTERNAL * 8u; i += 256u) {
    let child = nodes[i / 8u].children[i % 8u];
    records[i] = childRecord(child);
    quadrupoles[i] = quadrupoleRecord(child);
  }
}

// Gathers each node's children into one 128-byte block of records, and one of
// quadrupoles, so the force pass opens a node with contiguous reads instead of a scattered
// read chain per child. Two invocations per node, four child slots each. Unused (spare)
// nodes have no children, so their records are all empty. One extra workgroup, the first
// (so it overlaps the rest), handles the nodes whose children are in bhTree's prefix.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>,
        @builtin(local_invocation_index) lid : u32,
        @builtin(workgroup_id) group : vec3<u32>) {
  let seedPrefix = seedsTopPrefix();
  if (group.x == 0u) {
    if (seedPrefix) {
      summarizePrefix(lid);
    }
    return;
  }

  let nodeIdx = (id.x - 256u) / 2u;
  if ((seedPrefix && nodeIdx < TOP_INTERNAL) || nodeIdx >= min(allocator, params.maxNodes)) {
    return;
  }

  for (var k = 0u; k < 4u; k++) {
    let slot = (id.x % 2u) * 4u + k;
    let child = nodes[nodeIdx].children[slot];
    records[nodeIdx * 8u + slot] = childRecord(child);
    quadrupoles[nodeIdx * 8u + slot] = quadrupoleRecord(child);
  }
}
