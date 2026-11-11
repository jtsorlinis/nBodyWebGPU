// Params, Node and Unranked are shared by every kernel, see common.wgsl
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read_write> nodes : array<Node>;
// Number of nodes the last tree build allocated
@group(0) @binding(2) var<storage, read> allocator : u32;
@group(0) @binding(3) var<storage, read_write> bounds : array<u32, 6>;
@group(0) @binding(4) var<storage, read_write> counts : array<u32>;
@group(0) @binding(5) var<storage, read_write> order : array<u32>;
@group(0) @binding(6) var<storage, read_write> secondMoments : array<SecondMoment>;
@group(0) @binding(7) var<storage, read_write> unranked : Unranked;

// Only the nodes the last tree used need zeroing (a zeroed node is empty),
// since everything past them was never written. Early-out workgroups are cheap.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  // Bounds are reduced with atomicMin/Max (see bhBounds), so start them at the extremes
  if (id.x == 0u) {
    bounds = array<u32, 6>(0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0u, 0u, 0u);
    // Empty the list of bodies left out of the tree
    atomicStore(&unranked.count, 0u);
    atomicStore(&unranked.taken, 0u);
  }

  // A body left out of the tree leaves a rank in the order empty (see bhOrder)
  if (id.x < params.numBodies) {
    order[id.x] = 0xFFFFFFFFu;
  }

  // Failed allocations can push the allocator past the end
  let used = min(allocator, params.maxNodes);
  if (id.x >= used) {
    return;
  }

  // Nor do the nodes insertion allocated but never linked into the tree (see bhTree),
  // which are still empty. Every node it did link has a body counted under it.
  if (counts[id.x] == 0u) {
    return;
  }

  nodes[id.x] = Node();
  counts[id.x] = 0u;
  secondMoments[id.x] = SecondMoment();
}
