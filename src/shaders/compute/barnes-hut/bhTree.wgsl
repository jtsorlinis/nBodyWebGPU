// Node (see common.wgsl), with atomics so invocations can build the tree concurrently
struct BuildNode {
  massInt: atomic<i32>,
  comXInt: atomic<i32>,
  comYInt: atomic<i32>,
  comZInt: atomic<i32>,
  center: vec3<f32>,
  halfSize: f32,
  children: array<atomic<i32>, 8>,
};

// Params is shared by every kernel, see common.wgsl
@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> nodes : array<BuildNode>;
@group(0) @binding(3) var<storage, read_write> allocator : atomic<u32>;
// Min xyz then max xyz of all body positions, as order-preserving uints (see bhBounds)
@group(0) @binding(4) var<storage, read> bounds : array<u32, 6>;
// Number of bodies under each node, for putting bodies in tree order (see bhOrder)
@group(0) @binding(5) var<storage, read_write> counts : array<atomic<u32>>;

// Seed a complete three-level prefix of TOP_NODES (see common.wgsl), in breadth-first
// order. Workgroup aggregation removes most global atomic contention near the root.
const TOP_LEVELS = 3u;
const TOP_INTERNAL = 73u;
struct TopSum {
  mass: atomic<i32>,
  x: atomic<i32>,
  y: atomic<i32>,
  z: atomic<i32>,
  count: atomic<u32>,
}
// Together these use 15,776 bytes, within WebGPU's 16 KiB baseline limit.
var<workgroup> rootSums: array<vec4<i32>, 256>;
var<workgroup> topSums: array<TopSum, TOP_NODES - 1u>;

fn orderedToFloat(bits: u32) -> f32 {
  return bitcast<f32>(select(~bits, bits & 0x7FFFFFFFu, (bits & 0x80000000u) != 0u));
}

fn getOctant(pos: vec3<f32>, min: vec3<f32>, max: vec3<f32>) -> u32 {
  let center = (min + max) * 0.5;
  var octant = 0u;
  if (pos.x > center.x) { octant |= 1u; }
  if (pos.y > center.y) { octant |= 2u; }
  if (pos.z > center.z) { octant |= 4u; }
  return octant;
}

// Add a body's mass and moment to a node using integer atomics.
// The moment is stored relative to the node's centre in units of its half size, so each
// body contributes at most +-mass * massScale per axis (sums can't overflow) and the
// precision is the same at every depth. bhSummarize decodes it back to a centre of mass.
fn accumulate(nodeIdx: i32, body: vec4<f32>, nodeMin: vec3<f32>, nodeMax: vec3<f32>) {
  let center = (nodeMin + nodeMax) * 0.5;
  let halfSize = (nodeMax.x - nodeMin.x) * 0.5;
  let weight = body.w * params.massScale;
  let moment = (body.xyz - center) / halfSize * weight;
  atomicAdd(&nodes[nodeIdx].massInt, i32(round(weight)));
  atomicAdd(&nodes[nodeIdx].comXInt, i32(round(moment.x)));
  atomicAdd(&nodes[nodeIdx].comYInt, i32(round(moment.y)));
  atomicAdd(&nodes[nodeIdx].comZInt, i32(round(moment.z)));
  atomicAdd(&counts[nodeIdx], 1u);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  // Root is a cube around all bodies, padded so none sit exactly on its boundary
  let lo = vec3(orderedToFloat(bounds[0]), orderedToFloat(bounds[1]), orderedToFloat(bounds[2]));
  let hi = vec3(orderedToFloat(bounds[3]), orderedToFloat(bounds[4]), orderedToFloat(bounds[5]));
  let extent = hi - lo;
  let rootHalfSize = max(max(extent.x, extent.y), extent.z) * 0.51 + 1.0;
  let rootMin = (lo + hi) * 0.5 - vec3(rootHalfSize);
  let rootMax = (lo + hi) * 0.5 + vec3(rootHalfSize);

  let seedPrefix = seedsTopPrefix();
  let topLevels = select(0u, TOP_LEVELS, seedPrefix);
  let topNodes = select(1u, TOP_NODES, seedPrefix);

  // Only the first workgroup initializes the prefix. Its strided loop covers all
  // 585 nodes even when fewer than 585 body invocations are dispatched.
  // Insertion starts BELOW its internal links and computes geometry locally, so
  // no insertion reads these writes; the next dispatch observes the finished tree.
  if (id.x < 256u) {
    for (var index = lid.x; index < topNodes; index += 256u) {
      var path: array<u32, TOP_LEVELS>;
      var n = index;
      var depth = 0u;
      while (n > 0u) {
        path[depth] = (n - 1u) % 8u;
        n = (n - 1u) / 8u;
        depth++;
      }
      var lo = rootMin;
      var hi = rootMax;
      while (depth > 0u) {
        depth--;
        let octant = path[depth];
        let upper = vec3<bool>((octant & 1u) != 0u, (octant & 2u) != 0u, (octant & 4u) != 0u);
        let center = (lo + hi) * 0.5;
        lo = select(lo, center, upper);
        hi = select(center, hi, upper);
      }
      nodes[index].center = (lo + hi) * 0.5;
      nodes[index].halfSize = (hi.x - lo.x) * 0.5;
      if (topLevels > 0u && index < TOP_INTERNAL) {
        for (var octant = 0u; octant < 8u; octant++) {
          atomicStore(&nodes[index].children[octant], i32(index * 8u + 1u + octant));
        }
      }
    }
  }
  for (var n = lid.x; n < topNodes - 1u; n += 256u) {
    atomicStore(&topSums[n].mass, 0);
    atomicStore(&topSums[n].x, 0);
    atomicStore(&topSums[n].y, 0);
    atomicStore(&topSums[n].z, 0);
    atomicStore(&topSums[n].count, 0u);
  }
  workgroupBarrier();

  var startNode = 0u;
  var startMin = rootMin;
  var startMax = rootMax;
  if (id.x < params.numBodies) {
    let body = posMass[id.x];
    let weight = body.w * params.massScale;
    for (var depth = 0u; depth < topLevels; depth++) {
      let octant = getOctant(body.xyz, startMin, startMax);
      let upper = vec3<bool>((octant & 1u) != 0u, (octant & 2u) != 0u, (octant & 4u) != 0u);
      let center = (startMin + startMax) * 0.5;
      startMin = select(startMin, center, upper);
      startMax = select(center, startMax, upper);
      startNode = startNode * 8u + 1u + octant;
      let moment = (body.xyz - (startMin + startMax) * 0.5) / ((startMax.x - startMin.x) * 0.5) * weight;
      let n = startNode - 1u;
      // Round each body's contribution before reduction, just as accumulate does.
      atomicAdd(&topSums[n].mass, i32(round(weight)));
      atomicAdd(&topSums[n].x, i32(round(moment.x)));
      atomicAdd(&topSums[n].y, i32(round(moment.y)));
      atomicAdd(&topSums[n].z, i32(round(moment.z)));
      atomicAdd(&topSums[n].count, 1u);
    }
  }
  workgroupBarrier();
  for (var n = lid.x; n < topNodes - 1u; n += 256u) {
    let count = atomicLoad(&topSums[n].count);
    if (count > 0u) {
      atomicAdd(&nodes[n + 1u].massInt, atomicLoad(&topSums[n].mass));
      atomicAdd(&nodes[n + 1u].comXInt, atomicLoad(&topSums[n].x));
      atomicAdd(&nodes[n + 1u].comYInt, atomicLoad(&topSums[n].y));
      atomicAdd(&nodes[n + 1u].comZInt, atomicLoad(&topSums[n].z));
      atomicAdd(&counts[n + 1u], count);
    }
  }

  var contribution = vec4<i32>(0);
  if (id.x < params.numBodies) {
    let body = posMass[id.x];
    let weight = body.w * params.massScale;
    let moment = (body.xyz - (rootMin + rootMax) * 0.5) / ((rootMax.x - rootMin.x) * 0.5) * weight;
    contribution = vec4<i32>(i32(round(weight)), vec3<i32>(round(moment)));
  }
  rootSums[lid.x] = contribution;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride >>= 1u) {
    if (lid.x < stride) { rootSums[lid.x] += rootSums[lid.x + stride]; }
    workgroupBarrier();
  }
  if (lid.x == 0u) {
    atomicAdd(&nodes[0].massInt, rootSums[0].x);
    atomicAdd(&nodes[0].comXInt, rootSums[0].y);
    atomicAdd(&nodes[0].comYInt, rootSums[0].z);
    atomicAdd(&nodes[0].comZInt, rootSums[0].w);
    atomicAdd(&counts[0], min(256u, params.numBodies - id.x));
  }
  if (id.x >= params.numBodies) {
    return;
  }

  let bodyIdx = i32(id.x);
  let body = posMass[bodyIdx];

  // The prefix already contains this body's contributions; build only below it.
  var nodeIdx = i32(startNode);
  var depth = topLevels;
  var min = startMin;
  var max = startMax;

  // A node this thread allocated but lost the race to link in, kept for its next split.
  // Without reuse, every thread that loses a race leaks a node, which adds up to several
  // times the tree's size; with it, at most one node per thread goes unused.
  var spareNode = -1i;

  loop {
    // Update Mass/COM for current node (using atomics)
    if (depth > topLevels) { accumulate(nodeIdx, body, min, max); }

    let octant = getOctant(body.xyz, min, max);
    let childPtr = &nodes[nodeIdx].children[octant];

    // Bounds of the child octant
    let center = (min + max) * 0.5;
    var childMin = min;
    var childMax = max;
    if ((octant & 1u) != 0u) { childMin.x = center.x; } else { childMax.x = center.x; }
    if ((octant & 2u) != 0u) { childMin.y = center.y; } else { childMax.y = center.y; }
    if ((octant & 4u) != 0u) { childMin.z = center.z; } else { childMax.z = center.z; }

    // CAS loop to insert or descend.
    // This is lock-free on purpose: WebGPU doesn't guarantee threads waiting on a lock let
    // the thread holding it run, so a spin lock here can hang the GPU.
    var done = false;
    var childNode = 0i;
    loop {
      let oldVal = atomicLoad(childPtr);

      if (oldVal == 0) {
        // Case 1: Empty. Insert Body (encoded as -1 - bodyIdx)
        done = atomicCompareExchangeWeak(childPtr, 0, -1 - bodyIdx).exchanged;
      } else if (oldVal > 0) {
        // Case 2: It's a Node. Descend into it
        childNode = oldVal;
      } else {
        // Case 3: It's another Body. We need to split.
        var newNodeIdx = spareNode;
        if (newNodeIdx < 0) {
          newNodeIdx = i32(atomicAdd(&allocator, 1u));
        }

        if (u32(newNodeIdx) >= params.maxNodes) {
          // Out of nodes: drop this body
          done = true;
        } else {
          // Write new node geometry (the rest of the node is zero: from bhClear, or from
          // the undo below if this is a reused spare)
          nodes[newNodeIdx].center = (childMin + childMax) * 0.5;
          nodes[newNodeIdx].halfSize = (childMax.x - childMin.x) * 0.5;

          // Put the other body into the new node
          let otherBodyIdx = -oldVal - 1;
          let otherBody = posMass[otherBodyIdx];
          accumulate(newNodeIdx, otherBody, childMin, childMax);
          let otherOctant = getOctant(otherBody.xyz, childMin, childMax);
          let otherChildPtr = &nodes[newNodeIdx].children[otherOctant];
          atomicStore(otherChildPtr, -1 - otherBodyIdx);

          // Try to swap [Old Body] -> [New Node] in Parent
          if (atomicCompareExchangeWeak(childPtr, oldVal, newNodeIdx).exchanged) {
            spareNode = -1;
            childNode = newNodeIdx;
          } else {
            // Someone else changed the slot first. Nobody else can see the new node yet,
            // so undo it and keep it for this thread's next split
            atomicStore(&nodes[newNodeIdx].massInt, 0);
            atomicStore(&nodes[newNodeIdx].comXInt, 0);
            atomicStore(&nodes[newNodeIdx].comYInt, 0);
            atomicStore(&nodes[newNodeIdx].comZInt, 0);
            atomicStore(&counts[newNodeIdx], 0u);
            atomicStore(otherChildPtr, 0);
            spareNode = newNodeIdx;
          }
        }
      }
      // Otherwise a CAS failed: retry

      if (done || childNode > 0) { break; }
    }

    if (done) { break; }

    // Continue the loop to insert OURSELVES into the child node
    nodeIdx = childNode;
    min = childMin;
    max = childMax;
    depth++;
    if (depth > MAX_DEPTH) { break; }
  }
}
