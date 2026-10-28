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

struct Node {
  sums: vec4<i32>,
  geom: vec4<f32>,
  children: array<i32, 8>,
};

@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> nodes : array<Node>;
@group(0) @binding(3) var<storage, read> counts : array<u32>;
@group(0) @binding(4) var<storage, read_write> order : array<u32>;

const MAX_DEPTH = 30u;

// Bodies under a child slot: a node's count, 1 for a body, 0 if empty
fn bodiesUnder(child: i32) -> u32 {
  if (child > 0) {
    return counts[child];
  }
  return select(0u, 1u, child < 0);
}

// Puts bodies in the order of a depth-first walk of the tree (a Morton curve), so the force
// pass can give neighbouring threads nearby bodies, which visit mostly the same nodes.
// Each body follows its own path from the root, adding up the bodies in earlier siblings.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  let pos = posMass[id.x].xyz;
  let encoded = -1 - i32(id.x);
  var nodeIdx = 0;
  var rank = 0u;

  // Bodies sit at most MAX_DEPTH + 1 levels down (see bhTree)
  for (var depth = 0u; depth <= MAX_DEPTH + 1u; depth++) {
    // Same octant test as bhTree, against the node's stored centre
    let center = nodes[nodeIdx].geom.xyz;
    var octant = 0u;
    if (pos.x > center.x) { octant |= 1u; }
    if (pos.y > center.y) { octant |= 2u; }
    if (pos.z > center.z) { octant |= 4u; }

    for (var i = 0u; i < octant; i++) {
      rank += bodiesUnder(nodes[nodeIdx].children[i]);
    }

    let child = nodes[nodeIdx].children[octant];
    if (child == encoded) {
      order[rank] = id.x;
      return;
    }
    if (child <= 0) {
      // Dropped from the tree (out of nodes or too deep), so it's left out
      return;
    }
    nodeIdx = child;
  }
}
