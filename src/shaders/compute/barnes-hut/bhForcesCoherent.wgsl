requires subgroup_uniformity;
enable subgroups;
// All active and padded lanes start at root with identical stacks. Every child
// comes from subgroupBroadcastFirst, and every push decision comes from subgroupAll.
// Thus all lanes in a subgroup execute each collective in the same control flow.
// The compiler cannot prove the private-stack invariant across the loop.
// Each lane owns two targets; both opening tests join the collective.
// Padded targets participate using a clamped position, but are never written out.
diagnostic(off, subgroup_uniformity);

// Params, Motion, Body, Node and Unranked are shared by every kernel, see common.wgsl
@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> motion : array<Motion>;
@group(0) @binding(3) var<storage, read> nodes : array<Node>;
// Body indices in tree order (see bhOrder)
@group(0) @binding(4) var<storage, read> order : array<u32>;
// Each node's eight child records: centre of mass xyz, mass. A bucket's blocks, here and
// in quadrupoles, hold its bodies instead (see bhSummarize).
@group(0) @binding(5) var<storage, read> records : array<vec4<f32>>;
// Each child record's quadrupole, packed (see bhSummarize)
@group(0) @binding(6) var<storage, read> quadrupoles : array<vec4<u32>>;
// The bodies with no rank in the tree order (see bhOrder)
@group(0) @binding(7) var<storage, read_write> unranked : Unranked;
// The bodies after this step, in tree order
@group(0) @binding(8) var<storage, read_write> sortedBodies : array<Body>;

// The body a target is: the one at its rank in the tree order, or if bhOrder left that
// rank empty, one of the bodies it couldn't place (there are as many of each). A target
// past the last body is padding, which only needs a position near its subgroup's others.
fn targetBody(rank: u32) -> u32 {
  let last = params.numBodies - 1u;
  if (rank > last) { return min(order[last], last); }
  let body = order[rank];
  if (body <= last) { return body; }
  return min(unranked.bodies[atomicAdd(&unranked.taken, 1u)], last);
}

// Called only for a valid, uniquely owned target, after all subgroup collectives.
// Writing each body at its rank is what puts the bodies in tree order: the next step
// reads them back from there (see bodiesIntegrate), so its passes find neighbours in
// space next to each other in memory.
fn finishBody(bodyIdx: u32, rank: u32, acceleration: vec3<f32>) {
  var acc = acceleration;
  let accLen = length(acc);
  if (accLen > 1000.0) { acc *= 1000.0 / accLen; }
  var vel = motion[bodyIdx].vel + 0.5 * acc * params.deltaTime;
  let speed = length(vel);
  if (speed > 1000.0) { vel *= 1000.0 / speed; }
  sortedBodies[rank] = Body(posMass[bodyIdx], Motion(vel, acc));
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  // Two adjacent targets amortize node loads and traversal over more force work. More
  // make the subgroup's targets spread wider, so it opens more nodes; with quadrupole
  // interactions that costs more than it saves (two measured fastest of one to four).
  // Keep the accumulators explicit so they stay in registers. No subgroup width
  // or relationship between lane IDs and invocation IDs is assumed.
  let rank0 = id.x * 2u;
  let valid0 = rank0 < params.numBodies;
  let body0 = targetBody(rank0);
  let pos0 = posMass[body0].xyz;
  var acc0 = vec3(0.0);

  let rank1 = rank0 + 1u;
  let valid1 = rank1 < params.numBodies;
  let body1 = targetBody(rank1);
  let pos1 = posMass[body1].xyz;
  var acc1 = vec3(0.0);

  // A node can be approximated when size / theta + offset < dist, where offset is how far
  // its centre of mass is from its centre. Without the offset, a node whose mass sits in
  // one corner could be approximated for a target nearly as close as its far bodies, where
  // the quadrupole expansion breaks down. A child's size is its parent's half size.
  let invTheta = 1.0 / params.theta;

  // Stack of nodes to open, starting at the root (which contains every target).
  // Children are tested as soon as their parent is opened, so only nodes that need
  // opening go on the stack.
  var stack: array<i32, STACK_SIZE>;
  stack[0] = 0;
  var stackPtr = 1;

  while (stackPtr > 0) {
    stackPtr--;
    let nodeIdx = stack[stackPtr];
    let halfSize = subgroupBroadcastFirst(nodes[nodeIdx].geom.w);
    let sizeOverTheta = halfSize * invTheta;

    // Issue every load for this node before using any of them, so they overlap
    let children = nodes[nodeIdx].children;
    var childRecords: array<vec4<f32>, 8>;
    var childQuads: array<vec4<u32>, 8>;
    for (var i = 0u; i < 8u; i++) {
      childRecords[i] = records[u32(nodeIdx) * 8u + i];
      childQuads[i] = quadrupoles[u32(nodeIdx) * 8u + i];
    }

    // A bucket's blocks hold the bodies under it instead: position, then minus the mass
    // (see writeBucket in bhSummarize). Sum them directly, up to the first unused entry.
    // A target's own entry adds nothing, as for a body below.
    if (subgroupBroadcastFirst(childRecords[0].w) < 0.0) {
      for (var i = 0u; i < BUCKET_SIZE; i++) {
        let entry = select(bitcast<vec4<f32>>(childQuads[i & 7u]), childRecords[i & 7u], i < 8u);
        if (subgroupBroadcastFirst(entry.w) == 0.0) { break; }
        acc0 += attraction(entry.xyz - pos0, -entry.w);
        acc1 += attraction(entry.xyz - pos1, -entry.w);
      }
      continue;
    }

    for (var i = 0u; i < 8u; i++) {
      let child = subgroupBroadcastFirst(children[i]);
      let source = childRecords[i];
      // Empty slots, and empty cells of bhTree's fixed prefix, have no mass
      if (subgroupBroadcastFirst(source.w) <= 0.0) { continue; }

      let r0 = source.xyz - pos0;
      let r1 = source.xyz - pos1;
      if (child < 0) {
        // It's a Body. Self attraction is exactly zero: displacement is zero and softening > 0.
        acc0 += attraction(r0, source.w);
        acc1 += attraction(r1, source.w);
      } else {
        // It's a Node. Approximate only if EVERY target in EVERY participating lane
        // passes the opening test. Batching can only make this test more conservative.
        // If the stack is full, the node is approximated rather than dropped
        let openDist = sizeOverTheta + bitcast<f32>(childQuads[i].w);
        let threshold = openDist * openDist;
        let canApproximate = dot(r0, r0) > threshold && dot(r1, r1) > threshold;
        if (subgroupBroadcastFirst(u32(subgroupAll(canApproximate))) != 0u || stackPtr >= STACK_SIZE) {
          // The child's size is this node's half size
          let gm = params.gravity * source.w;
          let q = unpackQuadrupole(childQuads[i], gm * halfSize * halfSize);
          acc0 += quadrupoleAttraction(r0, gm, q.quad, q.softTrace);
          acc1 += quadrupoleAttraction(r1, gm, q.quad, q.softTrace);
        } else {
          stack[stackPtr] = child;
          stackPtr++;
        }
      }
    }
  }
  // Write each owned target once
  if (valid0) { finishBody(body0, rank0, acc0); }
  if (valid1) { finishBody(body1, rank1, acc1); }
}
