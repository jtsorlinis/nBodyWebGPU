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

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
  mass : f32,
};

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
@group(0) @binding(1) var<storage, read_write> bodies : array<Body>;
@group(0) @binding(2) var<storage, read_write> nodes : array<Node>;
@group(0) @binding(3) var<storage, read_write> allocator : atomic<u32>;
// Min xyz then max xyz of all body positions, as order-preserving uints (see bhBounds)
@group(0) @binding(4) var<storage, read> bounds : array<u32, 6>;

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
fn accumulate(nodeIdx: i32, body: Body, nodeMin: vec3<f32>, nodeMax: vec3<f32>) {
  let center = (nodeMin + nodeMax) * 0.5;
  let halfSize = (nodeMax.x - nodeMin.x) * 0.5;
  let weight = body.mass * params.massScale;
  let moment = (body.pos - center) / halfSize * weight;
  atomicAdd(&nodes[nodeIdx].massInt, i32(round(weight)));
  atomicAdd(&nodes[nodeIdx].comXInt, i32(round(moment.x)));
  atomicAdd(&nodes[nodeIdx].comYInt, i32(round(moment.y)));
  atomicAdd(&nodes[nodeIdx].comZInt, i32(round(moment.z)));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
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

  if (id.x >= params.numBodies) {
    return;
  }

  let bodyIdx = i32(id.x);
  let body = bodies[bodyIdx];

  // Start insertion from Root
  var nodeIdx = 0i;
  var depth = 0u;
  var min = rootMin;
  var max = rootMax;

  loop {
    // Update Mass/COM for current node (using atomics)
    accumulate(nodeIdx, body, min, max);

    let octant = getOctant(body.pos, min, max);
    let childPtr = &nodes[nodeIdx].children[octant];
    
    // CAS loop to insert or descend
    var done = false;
    loop {
      let oldVal = atomicLoad(childPtr);
      
      // Case 1: Empty (-1). Insert Body.
      // Body encoded as: -2 - bodyIdx
      let bodyEncoded = -2 - bodyIdx;
      
      if (oldVal == -1) {
        let res = atomicCompareExchangeWeak(childPtr, -1, bodyEncoded);
        if (res.exchanged) {
          done = true; 
          break;
        }
        continue; // Retry
      }
      
      // Case 2: It's a Node (>= 0)
      if (oldVal >= 0) {
        nodeIdx = oldVal;
        // Update bounds
        let center = (min + max) * 0.5;
        if ((octant & 1u) != 0u) { min.x = center.x; } else { max.x = center.x; }
        if ((octant & 2u) != 0u) { min.y = center.y; } else { max.y = center.y; }
        if ((octant & 4u) != 0u) { min.z = center.z; } else { max.z = center.z; }
        depth++;
        break; // Break inner loop, continue outer loop
      }
      
      // Case 3: It's another Body (<= -2)
      // We need to split.
      if (oldVal <= -2) {
        let otherBodyIdx = -oldVal - 2;
        
        // Allocate new node
        let newNodeIdx = i32(atomicAdd(&allocator, 1u));
        // Check for overflow
        if (u32(newNodeIdx) >= params.maxNodes) {
           done = true; // Drop this body (or just stop descending)
           break;
        }
        
        let center = (min + max) * 0.5;
        var childMin = min;
        var childMax = max;
        if ((octant & 1u) != 0u) { childMin.x = center.x; } else { childMax.x = center.x; }
        if ((octant & 2u) != 0u) { childMin.y = center.y; } else { childMax.y = center.y; }
        if ((octant & 4u) != 0u) { childMin.z = center.z; } else { childMax.z = center.z; }
        
        // IMPORTANT: Write new node geometry
        let newCenter = (childMin + childMax) * 0.5;
        let newHalfSize = (childMax.x - childMin.x) * 0.5;
        nodes[newNodeIdx].center = newCenter;
        nodes[newNodeIdx].halfSize = newHalfSize;
        
        let otherBody = bodies[otherBodyIdx];
        
        // Update Mass/COM for the new node (it will contain the other body)
        accumulate(newNodeIdx, otherBody, childMin, childMax);
        
        // Put other body into the new node
        let otherOctant = getOctant(otherBody.pos, childMin, childMax);
        atomicStore(&nodes[newNodeIdx].children[otherOctant], -2 - otherBodyIdx);
        
        // Try to swap [Old Body] -> [New Node] in Parent
        let res = atomicCompareExchangeWeak(childPtr, oldVal, newNodeIdx);
        if (res.exchanged) {
          // Success. Now we are at the new node.
          // We continue the loop to insert OURSELVES into this new node.
          nodeIdx = newNodeIdx;
          min = childMin;
          max = childMax;
          depth++;
          break; // Continue outer loop
        } else {
          // Failed (someone else modified the child pointer).
          // Retrying inner loop.
          // Note: newNodeIdx is leaked (unused). This is acceptable for lock-free, 
          // but if contention is high we might run out of nodes.
          continue;
        }
      }
    }
    
    if (done) { break; }
    if (depth > MAX_DEPTH) { break; }
  }
}
