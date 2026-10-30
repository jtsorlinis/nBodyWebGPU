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

// SecondMoment (see common.wgsl), with atomics
struct BuildSecondMoment {
  diag: array<atomic<i32>, 3>,
  @align(16) cross: array<atomic<i32>, 3>,
};

// A body's integer sums for one node (see contribution)
struct Sums {
  first: vec4<i32>, // mass, then moment xyz
  diag: vec3<i32>, // second moment xx, yy, zz
  cross: vec3<i32>, // second moment xy, xz, yz
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
// Built for every node below the prefix; bhSummarize works out the prefix's own
@group(0) @binding(6) var<storage, read_write> secondMoments : array<BuildSecondMoment>;

// Seed a complete three-level prefix of TOP_NODES (see common.wgsl), in breadth-first
// order. Workgroup aggregation removes most global atomic contention near the root.
const TOP_LEVELS = 3u;

// Workgroup sums are kept as five words: mass, moment xyz, then the number of bodies.
// scratch first holds them for each prefix node below the root. Then it caches the sums
// insertion adds to the CACHED_LEVELS levels below the prefix, where clustered bodies
// still share nodes: CACHE_SIZE node indices, then CACHE_WORDS sums per entry (the five,
// then the second moment). Integer sums don't depend on the order they're added in, so
// the tree comes out the same.
// Together these use 15,776 bytes, within WebGPU's 16 KiB baseline limit.
const SCRATCH_WORDS = (TOP_NODES - 1u) * 5u;
const CACHE_WORDS = 11u;
const CACHE_SIZE = SCRATCH_WORDS / (CACHE_WORDS + 1u);
const CACHED_LEVELS = 4u;
const EMPTY_SLOT = -1;
var<workgroup> rootSums: array<vec4<i32>, 256>;
var<workgroup> scratch: array<atomic<i32>, SCRATCH_WORDS>;

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

// A body's integer mass, moment and second moment for a node.
// Moments are stored relative to the node's centre in units of the power of two just
// above its half size (see common.wgsl), so each body contributes less than
// +-mass * massScale to each component (sums can't overflow) and the precision is about
// the same at every depth. bhSummarize decodes them back to a centre of mass and quadrupole.
fn contribution(body: vec4<f32>, nodeMin: vec3<f32>, nodeMax: vec3<f32>) -> Sums {
  let center = (nodeMin + nodeMax) * 0.5;
  let halfSize = (nodeMax.x - nodeMin.x) * 0.5;
  let weight = body.w * params.massScale;
  // Inside (-1, 1). Each product below rounds once, the same way wherever it's computed.
  let offset = ldexp(body.xyz - center, vec3(-momentExponent(halfSize)));
  let moment = offset * weight;
  return Sums(vec4<i32>(i32(round(weight)), vec3<i32>(round(moment))),
    vec3<i32>(round(moment * offset)), vec3<i32>(round(moment.xxy * offset.yzz)));
}

// Adds mass and moment sums covering count bodies to a node using integer atomics
fn addFirstToNode(nodeIdx: i32, first: vec4<i32>, count: u32) {
  atomicAdd(&nodes[nodeIdx].massInt, first.x);
  atomicAdd(&nodes[nodeIdx].comXInt, first.y);
  atomicAdd(&nodes[nodeIdx].comYInt, first.z);
  atomicAdd(&nodes[nodeIdx].comZInt, first.w);
  atomicAdd(&counts[nodeIdx], count);
}

fn addSecondToNode(nodeIdx: i32, diag: vec3<i32>, cross: vec3<i32>) {
  atomicAdd(&secondMoments[nodeIdx].diag[0], diag.x);
  atomicAdd(&secondMoments[nodeIdx].diag[1], diag.y);
  atomicAdd(&secondMoments[nodeIdx].diag[2], diag.z);
  atomicAdd(&secondMoments[nodeIdx].cross[0], cross.x);
  atomicAdd(&secondMoments[nodeIdx].cross[1], cross.y);
  atomicAdd(&secondMoments[nodeIdx].cross[2], cross.z);
}

// Adds one body's sums to a node
fn addToNode(nodeIdx: i32, sums: Sums) {
  addFirstToNode(nodeIdx, sums.first, 1u);
  addSecondToNode(nodeIdx, sums.diag, sums.cross);
}

// Adds one body's mass and moment to the five scratch words at base
fn addToScratch(base: u32, first: vec4<i32>) {
  atomicAdd(&scratch[base], first.x);
  atomicAdd(&scratch[base + 1u], first.y);
  atomicAdd(&scratch[base + 2u], first.z);
  atomicAdd(&scratch[base + 3u], first.w);
  atomicAdd(&scratch[base + 4u], 1);
}

// Adds the five scratch words at base to a node, if any bodies were added to them
fn flushScratch(base: u32, nodeIdx: i32) {
  let count = atomicLoad(&scratch[base + 4u]);
  if (count > 0) {
    let first = vec4(atomicLoad(&scratch[base]), atomicLoad(&scratch[base + 1u]),
      atomicLoad(&scratch[base + 2u]), atomicLoad(&scratch[base + 3u]));
    addFirstToNode(nodeIdx, first, u32(count));
  }
}

// Adds a body's sums to the node's cache entry, claiming a free one if it has none.
// Returns false if the few slots it may use belong to other nodes.
fn addToCache(nodeIdx: i32, sums: Sums) -> bool {
  var slot = ((u32(nodeIdx) * 2654435761u) >> 16u) % CACHE_SIZE;
  for (var probe = 0u; probe < 4u; probe++) {
    // A spurious failure just moves on, so a node can end up with two entries
    let claim = atomicCompareExchangeWeak(&scratch[slot], EMPTY_SLOT, nodeIdx);
    if (claim.exchanged || claim.old_value == nodeIdx) {
      let base = CACHE_SIZE + slot * CACHE_WORDS;
      addToScratch(base, sums.first);
      atomicAdd(&scratch[base + 5u], sums.diag.x);
      atomicAdd(&scratch[base + 6u], sums.diag.y);
      atomicAdd(&scratch[base + 7u], sums.diag.z);
      atomicAdd(&scratch[base + 8u], sums.cross.x);
      atomicAdd(&scratch[base + 9u], sums.cross.y);
      atomicAdd(&scratch[base + 10u], sums.cross.z);
      return true;
    }
    slot = (slot + 1u) % CACHE_SIZE;
  }
  return false;
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
  for (var word = lid.x; word < SCRATCH_WORDS; word += 256u) {
    atomicStore(&scratch[word], 0);
  }
  workgroupBarrier();

  var startNode = 0u;
  var startMin = rootMin;
  var startMax = rootMax;
  if (id.x < params.numBodies) {
    let body = posMass[id.x];
    for (var depth = 0u; depth < topLevels; depth++) {
      let octant = getOctant(body.xyz, startMin, startMax);
      let upper = vec3<bool>((octant & 1u) != 0u, (octant & 2u) != 0u, (octant & 4u) != 0u);
      let center = (startMin + startMax) * 0.5;
      startMin = select(startMin, center, upper);
      startMax = select(center, startMax, upper);
      startNode = startNode * 8u + 1u + octant;
      // Round each body's contribution before reduction, just as insertion does.
      addToScratch((startNode - 1u) * 5u, contribution(body, startMin, startMax).first);
    }
  }
  workgroupBarrier();
  for (var n = lid.x; n < topNodes - 1u; n += 256u) {
    flushScratch(n * 5u, i32(n + 1u));
  }

  var rootSum = vec4<i32>(0);
  if (id.x < params.numBodies) {
    rootSum = contribution(posMass[id.x], rootMin, rootMax).first;
  }
  rootSums[lid.x] = rootSum;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride >>= 1u) {
    if (lid.x < stride) { rootSums[lid.x] += rootSums[lid.x + stride]; }
    workgroupBarrier();
  }
  if (lid.x == 0u) {
    addFirstToNode(0, rootSums[0], min(256u, params.numBodies - id.x));
  }

  // Every invocation has finished with the prefix sums (the barriers above), so scratch
  // becomes the cache for insertion
  for (var word = lid.x; word < SCRATCH_WORDS; word += 256u) {
    atomicStore(&scratch[word], select(0, EMPTY_SLOT, word < CACHE_SIZE));
  }
  workgroupBarrier();

  if (id.x < params.numBodies) {
    insertBody(i32(id.x), startNode, startMin, startMax, topLevels);
  }

  // Once the whole workgroup has inserted its bodies, add the cached sums to the tree.
  // Nothing reads node sums until the next dispatch.
  workgroupBarrier();
  for (var slot = lid.x; slot < CACHE_SIZE; slot += 256u) {
    let nodeIdx = atomicLoad(&scratch[slot]);
    if (nodeIdx != EMPTY_SLOT) {
      let base = CACHE_SIZE + slot * CACHE_WORDS;
      flushScratch(base, nodeIdx);
      addSecondToNode(nodeIdx,
        vec3(atomicLoad(&scratch[base + 5u]), atomicLoad(&scratch[base + 6u]), atomicLoad(&scratch[base + 7u])),
        vec3(atomicLoad(&scratch[base + 8u]), atomicLoad(&scratch[base + 9u]), atomicLoad(&scratch[base + 10u])));
    }
  }
}

// Inserts a body below the prefix node it starts in. The prefix already contains this
// body's contributions; build only below it.
fn insertBody(bodyIdx: i32, startNode: u32, startMin: vec3<f32>, startMax: vec3<f32>, topLevels: u32) {
  let body = posMass[bodyIdx];
  var nodeIdx = i32(startNode);
  var depth = topLevels;
  var min = startMin;
  var max = startMax;

  // A node this thread allocated but lost the race to link in, kept for its next split.
  // Without reuse, every thread that loses a race leaks a node, which adds up to several
  // times the tree's size; with it, at most one node per thread goes unused.
  var spareNode = -1i;

  loop {
    // Update Mass/COM for current node (using atomics). Nodes on this path are already
    // linked into the tree, so their sums can wait in the workgroup's cache.
    if (depth > topLevels) {
      let sums = contribution(body, min, max);
      if (depth > topLevels + CACHED_LEVELS || !addToCache(nodeIdx, sums)) {
        addToNode(nodeIdx, sums);
      }
    }

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

          // Put the other body into the new node. Its sums go straight to the node, which
          // the undo below may need to clear.
          let otherBodyIdx = -oldVal - 1;
          let otherBody = posMass[otherBodyIdx];
          addToNode(newNodeIdx, contribution(otherBody, childMin, childMax));
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
            for (var axis = 0u; axis < 3u; axis++) {
              atomicStore(&secondMoments[newNodeIdx].diag[axis], 0);
              atomicStore(&secondMoments[newNodeIdx].cross[axis], 0);
            }
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
