requires subgroup_uniformity;
enable subgroups;
// All active and padded lanes start at root with identical stacks. Every child
// comes from subgroupBroadcastFirst, and every push decision comes from subgroupAll.
// Thus all lanes in a subgroup execute each collective in the same control flow.
// The compiler cannot prove the private-stack invariant across the loop.
// Leaf self-exclusion rejoins before the next collective; padded lanes never write.
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

// As prepared by bhSummarize
struct Node {
  com: vec4<f32>, // centre of mass xyz, mass
  geom: vec4<f32>, // center xyz, squared distance beyond which the node can be approximated
  children: array<i32, 8>, // 0 = empty, > 0 = node, < 0 = body (-1 - bodyIdx)
};

@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> motion : array<Motion>;
@group(0) @binding(3) var<storage, read> nodes : array<Node>;
// Body indices in tree order (see bhOrder)
@group(0) @binding(4) var<storage, read> order : array<u32>;

// MAX_DEPTH=30 permits internal children through depth 31. A depth-first walk
// needs at most 1 + 7*31 pending nodes, so 256 entries cover every valid tree.
const STACK_SIZE = 256;

// Softened acceleration towards a point mass at offset r
fn attraction(r: vec3<f32>, mass: f32) -> vec3<f32> {
  let invDist = inverseSqrt(dot(r, r) + params.softening * params.softening);
  return r * (params.gravity * mass * invDist * invDist * invDist);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let requestedBody = order[min(id.x, params.numBodies - 1u)];
  let valid = id.x < params.numBodies && requestedBody < params.numBodies;

  // Process bodies in tree order so neighbouring threads walk similar paths.
  // Invalid/padded targets still participate in collectives but never write.
  let bodyIdx = min(requestedBody, params.numBodies - 1u);


  let pos = posMass[bodyIdx].xyz;
  var newAcc = vec3(0.0);

  // Stack of nodes to open, starting at the Root (which always contains this body).
  // Children are tested as soon as their parent is opened, so only nodes that need
  // opening go on the stack.
  var stack: array<i32, STACK_SIZE>;
  stack[0] = 0;
  var stackPtr = 1;

  while (stackPtr > 0) {
    stackPtr--;
    let nodeIdx = stack[stackPtr];

    for (var i = 0; i < 8; i++) {
      let child = subgroupBroadcastFirst(nodes[nodeIdx].children[i]);
      if (child < 0) {
        // It's a Body
        let otherBodyIdx = u32(-child - 1);
        if (otherBodyIdx != bodyIdx) {
          let other = posMass[otherBodyIdx];
          newAcc += attraction(other.xyz - pos, other.w);
        }
      } else if (child > 0) {
        // It's a Node. Only its first half is needed unless it gets opened
        let node = subgroupBroadcastFirst(nodes[child].com);
        if (node.w <= 0.0) { continue; }

        let r = node.xyz - pos;
        let distSq = dot(r, r);

        // Check if we can approximate: size / dist < theta
        // If the stack is full, the point mass is used rather than dropping the node
        if (subgroupBroadcastFirst(u32(subgroupAll(distSq > nodes[child].geom.w))) != 0u || stackPtr >= STACK_SIZE) {
          newAcc += attraction(r, node.w);
        } else {
          stack[stackPtr] = child;
          stackPtr++;
        }
      }
    }
  }

  // Limit acceleration
  let accLen = length(newAcc);
  if (accLen > 1000.0) {
    newAcc = normalize(newAcc) * 1000.0;
  }

  // Padded lanes must not read motion while the owning lane writes it.
  if (valid) {
    // Second Kick
    var vel = motion[bodyIdx].vel + 0.5 * newAcc * params.deltaTime;

    // Limit velocity
    let speed = length(vel);
    if (speed > 1000.0) {
      vel = normalize(vel) * 1000.0;
    }
    motion[bodyIdx] = Motion(vel, newAcc);
  }
}
