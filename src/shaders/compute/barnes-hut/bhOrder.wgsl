// Params, Node and Unranked are shared by every kernel, see common.wgsl
@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> nodes : array<Node>;
@group(0) @binding(3) var<storage, read> counts : array<u32>;
@group(0) @binding(4) var<storage, read_write> order : array<u32>;
@group(0) @binding(5) var<storage, read_write> unranked : Unranked;

// The Hilbert curve's 24 orientations in a cube. An orientation is the eight steps the
// curve takes through the cube's octants, a byte per step: the octant in the low 3 bits,
// and the curve's orientation inside it in the high 5. x holds the first four steps from
// its lowest byte, and y the last four.
const HILBERT_STEPS = array<vec2<u32>, 24>(
  vec2(0x1A062C08u, 0x11350723u), vec2(0x410B4A38u, 0x545E0F2Du), vec2(0x34165F75u, 0x694B1260u),
  vec2(0x071E745Du, 0x49681A7Bu), vec2(0x7A233948u, 0x5C552706u), vec2(0x812D0420u, 0x8A962F0Bu),
  vec2(0x123697A3u, 0x19053498u), vec2(0xAC3D2100u, 0x928B3F4Eu), vec2(0x0F43B28Eu, 0x24784185u),
  vec2(0x6C4E0A28u, 0x31134F3Du), vec2(0x5A538FB6u, 0x7C2551B8u), vec2(0x515B1765u, 0x440E5A70u),
  vec2(0x9C60791Du, 0xA7B36216u), vec2(0x4F6EA293u, 0x01186CADu), vec2(0xB9701C7Du, 0xB7A6725Bu),
  vec2(0x277B6115u, 0x0C407A1Eu), vec2(0x2F85BC56u, 0x3AA88143u), vec2(0x948D57BEu, 0xAA3B89B0u),
  vec2(0x8995379Bu, 0x822E94A0u), vec2(0x6298A96Bu, 0x77BD9C36u), vec2(0xB1A06AABu, 0xBF76A495u),
  vec2(0x3FAD9933u, 0x2A80AC6Eu), vec2(0xA4B04286u, 0x9F63B18Du), vec2(0x72B88446u, 0x679DB953u),
);

// Bodies under a child slot: a node's count, 1 for a body, 0 if empty
fn bodiesUnder(child: i32) -> u32 {
  if (child > 0) {
    return counts[child];
  }
  return select(0u, 1u, child < 0);
}

// Puts bodies in the order a Hilbert curve visits them, so the force pass can give
// neighbouring threads nearby bodies, which visit mostly the same nodes. The curve walks
// the tree depth first, and turns inside each node so it enters every octant next to where
// it left the last one. Taking the octants in index order instead (a Morton curve) jumps
// across the node between some of them, which spreads a subgroup's bodies further apart.
// Each body follows its own path from the root, adding up the bodies in the octants the
// curve visits before its own.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  let pos = posMass[id.x].xyz;
  let encoded = -1 - i32(id.x);
  var nodeIdx = 0;
  var rank = 0u;
  // The curve's orientation in the current node, starting with the root's
  var orientation = 0u;

  // Bodies sit at most MAX_DEPTH + 1 levels down (see bhTree)
  for (var depth = 0u; depth <= MAX_DEPTH + 1u; depth++) {
    let octant = octantOf(pos, nodes[nodeIdx].geom.xyz);
    // Follow the curve up to this body's octant, which every orientation reaches
    let steps = HILBERT_STEPS[orientation];
    var step = 0u;
    for (var i = 0u; i < 8u; i++) {
      step = (select(steps.x, steps.y, i >= 4u) >> (8u * (i % 4u))) & 0xFFu;
      if ((step & 7u) == octant) { break; }
      rank += bodiesUnder(nodes[nodeIdx].children[step & 7u]);
    }

    let child = nodes[nodeIdx].children[octant];
    if (child == encoded) {
      order[rank] = id.x;
      return;
    }
    if (child <= 0) {
      break;
    }
    nodeIdx = child;
    orientation = step >> 3u;
  }

  // bhTree left this body out (out of nodes or too deep), so it has no rank. The nodes it
  // passed through still counted it, which leaves a rank empty; the force pass puts one of
  // these bodies there, so every body is still written out.
  unranked.bodies[atomicAdd(&unranked.count, 1u)] = id.x;
}
