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

// Params is shared by every kernel, see params.wgsl
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

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  // Process bodies in tree order so neighbouring threads walk similar paths.
  // Bodies that were left out of the tree this step have no slot and are skipped.
  let bodyIdx = order[id.x];
  if (bodyIdx >= params.numBodies) {
    return;
  }

  let pos = posMass[bodyIdx].xyz;
  var newAcc = vec3(0.0);

  // A node can be approximated when size / dist < theta. A child's size is its
  // parent's half size, so each child's squared-distance threshold comes from the
  // popped node rather than being fetched per child.
  let invThetaSq = 1.0 / (params.theta * params.theta);

  // Stack of nodes to open, starting at the Root (which always contains this body).
  // Children are tested as soon as their parent is opened, so only nodes that need
  // opening go on the stack.
  var stack: array<i32, STACK_SIZE>;
  stack[0] = 0;
  var stackPtr = 1;

  while (stackPtr > 0) {
    stackPtr--;
    let nodeIdx = stack[stackPtr];
    let halfSize = nodes[nodeIdx].geom.w;
    let threshold = halfSize * halfSize * invThetaSq;

    // Invocations traverse independently here, so unlike bhForcesCoherent, only
    // load the records of occupied slots
    for (var i = 0u; i < 8u; i++) {
      let child = nodes[nodeIdx].children[i];
      if (child == 0) { continue; }
      let source = records[u32(nodeIdx) * 8u + i];
      // Empty cells of bhTree's fixed prefix have no mass
      if (source.w <= 0.0) { continue; }

      let r = source.xyz - pos;
      if (child < 0) {
        // It's a Body
        if (u32(-child - 1) != bodyIdx) {
          newAcc += attraction(r, source.w);
        }
      } else {
        // It's a Node. Check if we can approximate: size / dist < theta
        // If the stack is full, the point mass is used rather than dropping the node
        let distSq = dot(r, r);
        if (distSq > threshold || stackPtr >= STACK_SIZE) {
          newAcc += attraction(r, source.w);
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

  // Second Kick
  var vel = motion[bodyIdx].vel + 0.5 * newAcc * params.deltaTime;

  // Limit velocity
  let speed = length(vel);
  if (speed > 1000.0) {
    vel = normalize(vel) * 1000.0;
  }

  motion[bodyIdx] = Motion(vel, newAcc);
}
