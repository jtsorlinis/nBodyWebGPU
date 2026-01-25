struct Params {
  numBodies: u32,
  gravity: f32,
  deltaTime: f32,
  blackHoleMass: f32,
  softening: f32,
  theta: f32,
  maxNodes: u32,
  _pad0: u32,
  minPos: vec3<f32>,
  maxPos: vec3<f32>,
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
  children: array<atomic<i32>, 8>,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read_write> bodies : array<Body>;
@group(0) @binding(2) var<storage, read_write> nodes : array<Node>;
@group(0) @binding(3) var<storage, read_write> allocator : atomic<u32>;

const MAX_DEPTH = 30u;
const SCALE_MASS = 100.0;
const SCALE_MOMENT = 10.0;

fn getOctant(pos: vec3<f32>, min: vec3<f32>, max: vec3<f32>) -> u32 {
  let center = (min + max) * 0.5;
  var octant = 0u;
  if (pos.x > center.x) { octant |= 1u; }
  if (pos.y > center.y) { octant |= 2u; }
  if (pos.z > center.z) { octant |= 4u; }
  return octant;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  let bodyIdx = i32(id.x);
  let body = bodies[bodyIdx];
  
  // Start insertion from Root
  var nodeIdx = 0i;
  var depth = 0u;
  var min = params.minPos;
  var max = params.maxPos;
  
  loop {
    // Update Mass/COM for current node (using atomics)
    atomicAdd(&nodes[nodeIdx].massInt, i32(body.mass * SCALE_MASS));
    atomicAdd(&nodes[nodeIdx].comXInt, i32(body.pos.x * body.mass * SCALE_MOMENT));
    atomicAdd(&nodes[nodeIdx].comYInt, i32(body.pos.y * body.mass * SCALE_MOMENT));
    atomicAdd(&nodes[nodeIdx].comZInt, i32(body.pos.z * body.mass * SCALE_MOMENT));

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
        
        let otherBody = bodies[otherBodyIdx];
        
        // Update Mass/COM for the new node (it will contain the other body)
        atomicAdd(&nodes[newNodeIdx].massInt, i32(otherBody.mass * SCALE_MASS));
        atomicAdd(&nodes[newNodeIdx].comXInt, i32(otherBody.pos.x * otherBody.mass * SCALE_MOMENT));
        atomicAdd(&nodes[newNodeIdx].comYInt, i32(otherBody.pos.y * otherBody.mass * SCALE_MOMENT));
        atomicAdd(&nodes[newNodeIdx].comZInt, i32(otherBody.pos.z * otherBody.mass * SCALE_MOMENT));
        
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
