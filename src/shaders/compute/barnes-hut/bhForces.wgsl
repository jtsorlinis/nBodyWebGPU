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

const SCALE_MASS = 100.0;
const SCALE_MOMENT = 1.0;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  var body = bodies[id.x];
  var newAcc = vec3(0.0);

  // Stack for traversal (just indices now, much lighter)
  var stack: array<i32, 256>;
  var stackPtr = 0;

  // Push Root
  stack[0] = 0;
  stackPtr = 1;

  let thetaSq = params.theta * params.theta;
  let softeningSq = params.softening * params.softening;

  while (stackPtr > 0) {
    stackPtr--;
    let nodeIdx = stack[stackPtr];
    let node = nodes[nodeIdx]; // Read from global memory (cached)

    let mass = f32(node.massInt) / SCALE_MASS;
    
    if (mass <= 0.0) { continue; }

    let moment = vec3(f32(node.comXInt), f32(node.comYInt), f32(node.comZInt)) / SCALE_MOMENT;
    let com = moment / mass;

    let r = com - body.pos;
    let distSq = dot(r, r);
    
    let halfSize = node.halfSize;
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
           let child = node.children[i];
           if (child == -1) { continue; }
           
           if (child <= -2) {
               // It's a Body
               let otherBodyIdx = -child - 2;
               if (u32(otherBodyIdx) != id.x) {
                   let otherBody = bodies[otherBodyIdx];
                   let r_b = otherBody.pos - body.pos;
                   let d2 = dot(r_b, r_b) + softeningSq;
                   let invD = inverseSqrt(d2);
                   let f_b = params.gravity * otherBody.mass * invD * invD * invD;
                   newAcc += r_b * f_b;
               }
           } else {
               // It's a Node
               if (stackPtr < 256) {
                   stack[stackPtr] = child;
                   stackPtr++;
               }
           }
        }
    }
  }

  // Limit acceleration
  let accLen = length(newAcc);
  if (accLen > 1000.0) {
    newAcc = normalize(newAcc) * 1000.0;
  }

  bodies[id.x].acc = newAcc;
  
  // Second Kick
  bodies[id.x].vel += 0.5 * newAcc * params.deltaTime;
  
  // Limit velocity
  let speed = length(bodies[id.x].vel);
  if (speed > 1000.0) {
     bodies[id.x].vel = normalize(bodies[id.x].vel) * 1000.0;
  }
}
