requires subgroup_uniformity;
enable subgroups;
// All active and padded lanes start at root with identical stacks. Every child
// comes from subgroupBroadcastFirst, and every push decision comes from subgroupAll.
// Thus all lanes in a subgroup execute each collective in the same control flow.
// The compiler cannot prove the private-stack invariant across the loop.
// Each lane owns four targets; all four opening tests join the collective.
// Padded targets participate using a clamped position, but never access motion.
diagnostic(off, subgroup_uniformity);
struct Params {
  numBodies: u32,
  gravity: f32,
  deltaTime: f32,
  blackHoleMass: f32,
  softening: f32,
  theta: f32,
  maxNodes: u32,
  massScale: f32,
}

struct Motion {
  vel : vec3<f32>,
  acc : vec3<f32>,
};

// As built by bhTree (bhSummarize leaves nodes unchanged)
struct Node {
  sums: vec4<i32>, // integer mass, then moment relative to the centre in half sizes
  geom: vec4<f32>, // center xyz, half size
  children: array<i32, 8>, // 0 = empty, > 0 = node, < 0 = body (-1 - bodyIdx)
};

@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> motion : array<Motion>;
@group(0) @binding(3) var<storage, read> nodes : array<Node>;
// Body indices in tree order (see bhOrder)
@group(0) @binding(4) var<storage, read> order : array<u32>;
// Each node's eight child records: centre of mass xyz, mass (see bhSummarize)
@group(0) @binding(5) var<storage, read> records : array<vec4<f32>>;

// MAX_DEPTH=30 permits internal children through depth 31. A depth-first walk
// needs at most 1 + 7*31 pending nodes, so 256 entries cover every valid tree.
const STACK_SIZE = 256;

// Softened acceleration towards a point mass at offset r
fn attraction(r: vec3<f32>, mass: f32) -> vec3<f32> {
  let invDist = inverseSqrt(dot(r, r) + params.softening * params.softening);
  return r * (params.gravity * mass * invDist * invDist * invDist);
}

// Called only for a valid, uniquely owned target, after all subgroup collectives.
fn finishBody(bodyIdx: u32, acceleration: vec3<f32>) {
  var acc = acceleration;
  let accLen = length(acc);
  if (accLen > 1000.0) { acc *= 1000.0 / accLen; }
  var vel = motion[bodyIdx].vel + 0.5 * acc * params.deltaTime;
  let speed = length(vel);
  if (speed > 1000.0) { vel *= 1000.0 / speed; }
  motion[bodyIdx] = Motion(vel, acc);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  // Four adjacent targets amortize node loads and traversal over more force work.
  // Keep the accumulators explicit so they stay in registers. No subgroup width
  // or relationship between lane IDs and invocation IDs is assumed.
  let rank0 = id.x * 4u;
  let requested0 = order[min(rank0, params.numBodies - 1u)];
  let valid0 = rank0 < params.numBodies && requested0 < params.numBodies;
  let body0 = min(requested0, params.numBodies - 1u);
  let pos0 = posMass[body0].xyz;
  var acc0 = vec3(0.0);

  let rank1 = rank0 + 1u;
  let requested1 = order[min(rank1, params.numBodies - 1u)];
  let valid1 = rank1 < params.numBodies && requested1 < params.numBodies;
  let body1 = min(requested1, params.numBodies - 1u);
  let pos1 = posMass[body1].xyz;
  var acc1 = vec3(0.0);

  let rank2 = rank0 + 2u;
  let requested2 = order[min(rank2, params.numBodies - 1u)];
  let valid2 = rank2 < params.numBodies && requested2 < params.numBodies;
  let body2 = min(requested2, params.numBodies - 1u);
  let pos2 = posMass[body2].xyz;
  var acc2 = vec3(0.0);

  let rank3 = rank0 + 3u;
  let requested3 = order[min(rank3, params.numBodies - 1u)];
  let valid3 = rank3 < params.numBodies && requested3 < params.numBodies;
  let body3 = min(requested3, params.numBodies - 1u);
  let pos3 = posMass[body3].xyz;
  var acc3 = vec3(0.0);

  // A node can be approximated when size / dist < theta. A child's size is its
  // parent's half size, so each child's squared-distance threshold comes from the
  // popped node rather than being fetched per child.
  let invThetaSq = 1.0 / (params.theta * params.theta);

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
    let threshold = halfSize * halfSize * invThetaSq;

    // Issue every load for this node before using any of them, so they overlap
    let children = nodes[nodeIdx].children;
    var childRecords: array<vec4<f32>, 8>;
    for (var i = 0u; i < 8u; i++) { childRecords[i] = records[u32(nodeIdx) * 8u + i]; }

    for (var i = 0u; i < 8u; i++) {
      let child = subgroupBroadcastFirst(children[i]);
      let source = childRecords[i];
      // Empty slots, and empty cells of bhTree's fixed prefix, have no mass
      if (subgroupBroadcastFirst(source.w) <= 0.0) { continue; }

      let r0 = source.xyz - pos0;
      let r1 = source.xyz - pos1;
      let r2 = source.xyz - pos2;
      let r3 = source.xyz - pos3;
      if (child < 0) {
        // It's a Body. Self attraction is exactly zero: displacement is zero and softening > 0.
        acc0 += attraction(r0, source.w);
        acc1 += attraction(r1, source.w);
        acc2 += attraction(r2, source.w);
        acc3 += attraction(r3, source.w);
      } else {
        // It's a Node. Approximate only if EVERY target in EVERY participating lane
        // passes size / dist < theta. Batching can only make this test more conservative.
        // If the stack is full, the point mass is used rather than dropping the node
        let canApproximate = dot(r0, r0) > threshold && dot(r1, r1) > threshold &&
          dot(r2, r2) > threshold && dot(r3, r3) > threshold;
        if (subgroupBroadcastFirst(u32(subgroupAll(canApproximate))) != 0u || stackPtr >= STACK_SIZE) {
          acc0 += attraction(r0, source.w);
          acc1 += attraction(r1, source.w);
          acc2 += attraction(r2, source.w);
          acc3 += attraction(r3, source.w);
        } else {
          stack[stackPtr] = child;
          stackPtr++;
        }
      }
    }
  }
  // Write each owned target once. Padded targets must not even read motion while
  // the invocation owning that clamped body updates it.
  if (valid0) { finishBody(body0, acc0); }
  if (valid1) { finishBody(body1, acc1); }
  if (valid2) { finishBody(body2, acc2); }
  if (valid3) { finishBody(body3, acc3); }
}
