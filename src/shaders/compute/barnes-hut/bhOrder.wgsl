// Params and Node are shared by every kernel, see common.wgsl
@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> nodes : array<Node>;
@group(0) @binding(3) var<storage, read> counts : array<u32>;
@group(0) @binding(4) var<storage, read_write> order : array<u32>;

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
    let octant = octantOf(pos, nodes[nodeIdx].geom.xyz);
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
