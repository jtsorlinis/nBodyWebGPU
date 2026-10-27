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
  massInt: i32,
  comXInt: i32,
  comYInt: i32,
  comZInt: i32,
  center: vec3<f32>,
  halfSize: f32,
  children: array<i32, 8>,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read_write> bodies : array<Body>;
@group(0) @binding(2) var<storage, read> nodes : array<Node>;

@group(0) @binding(3) var<storage, read> bodyOrder: array<u32>;

@group(0) @binding(4) var<storage, read> ropes: array<i32>;

@compute @workgroup_size(FORCE_WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  let bodyIndex = bodyOrder[id.x];
  var body = bodies[bodyIndex];
  var newAcc = vec3(0.0);

  // Successor links preserve the original depth-first summation order without a private stack.
  var nextNode = 0;
  let thetaSq = params.theta * params.theta;
  let softeningSq = params.softening * params.softening;

  while (nextNode >= 0) {
    let nodeIdx = nextNode;
    nextNode = ropes[nodeIdx];

    let mass = f32(nodes[nodeIdx].massInt) / params.massScale;

    if (mass <= 0.0) { continue; }

    // Moment is relative to the node centre in units of its half size (see bhTree)
    let moment = vec3(f32(nodes[nodeIdx].comXInt), f32(nodes[nodeIdx].comYInt), f32(nodes[nodeIdx].comZInt));
    let com = nodes[nodeIdx].center + moment / f32(nodes[nodeIdx].massInt) * nodes[nodeIdx].halfSize;

    let r = com - body.pos;
    let distSq = dot(r, r);
    
    let halfSize = nodes[nodeIdx].halfSize;
    let size = halfSize * 2.0;

    // Check if we can approximate (Squared check)
    // size < theta * dist => size^2 < theta^2 * distSq
    if (distSq > 0.0 && (size * size) < (thetaSq * distSq)) {
        let softenedDistSq = distSq + softeningSq;
        let invDist = inverseSqrt(softenedDistSq);
        let f = params.gravity * mass * invDist * invDist * invDist;
        newAcc += r * f;
    } else {
        // Open the node
        for (var i = 0; i < 8; i++) {
           let child = nodes[nodeIdx].children[i];
           if (child == -1) { continue; }
           
           if (child <= -2) {
               // It's a Body
               let otherBodyIdx = -child - 2;
               if (u32(otherBodyIdx) != bodyIndex) {
                   let otherBody = bodies[otherBodyIdx];
                   let r_b = otherBody.pos - body.pos;
                   let d2 = dot(r_b, r_b) + softeningSq;
                   let invD = inverseSqrt(d2);
                   let f_b = params.gravity * otherBody.mass * invD * invD * invD;
                   newAcc += r_b * f_b;
               }
           } else {
               // Visit internal children in descending octant order, as the original stack did.
               nextNode = child;
           }
        }
    }
  }

  // Limit acceleration
  let accLen = length(newAcc);
  if (accLen > 1000.0) {
    newAcc = normalize(newAcc) * 1000.0;
  }

  bodies[bodyIndex].acc = newAcc;
  
  // Second Kick
  bodies[bodyIndex].vel += 0.5 * newAcc * params.deltaTime;
  
  // Limit velocity
  let speed = length(bodies[bodyIndex].vel);
  if (speed > 1000.0) {
     bodies[bodyIndex].vel = normalize(bodies[bodyIndex].vel) * 1000.0;
  }
}
