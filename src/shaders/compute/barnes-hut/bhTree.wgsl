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

// Child slots: 0 = empty, > 0 = node index (the root is never a child), < 0 = body (-1 - bodyIdx).
// A zeroed node is therefore an empty node, which is what bhClear resets nodes to.
struct Node {
  massInt: atomic<i32>,
  comXInt: atomic<i32>,
  comYInt: atomic<i32>,
  comZInt: atomic<i32>,
  center: vec3<f32>,
  halfSize: f32,
  children: array<atomic<i32>, 8>,
};

@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> nodes : array<Node>;
@group(0) @binding(3) var<storage, read_write> allocator : atomic<u32>;
// Min xyz then max xyz of all body positions, as order-preserving uints (see bhBounds)
@group(0) @binding(4) var<storage, read> bounds : array<u32, 6>;
// Number of bodies under each node, for putting bodies in tree order (see bhOrder)
@group(0) @binding(5) var<storage, read_write> counts : array<atomic<u32>>;

var<workgroup> rootSums: array<vec4<i32>, 256>;

const MAX_DEPTH = 30u;

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
// precision is the same at every depth. bhForces decodes it back to a centre of mass.
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

  // Thread 0 initializes the Root Node (0)
  if (id.x == 0u) {
     nodes[0].center = (rootMin + rootMax) * 0.5;
     nodes[0].halfSize = (rootMax.x - rootMin.x) * 0.5;
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
  for (var stride=128u; stride>0u; stride >>= 1u) {
    if(lid.x < stride) { rootSums[lid.x] += rootSums[lid.x + stride]; }
    workgroupBarrier();
  }
  if(lid.x == 0u) {
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

  // Start insertion from Root
  var nodeIdx = 0i;
  var depth = 0u;
  var min = rootMin;
  var max = rootMax;

  // A node this thread allocated but lost the race to link in, kept for its next split.
  // Without reuse, every thread that loses a race leaks a node, which adds up to several
  // times the tree's size; with it, at most one node per thread goes unused.
  var spareNode = -1i;

  loop {
    // Update Mass/COM for current node (using atomics)
    if (nodeIdx != 0) { accumulate(nodeIdx, body, min, max); }

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
