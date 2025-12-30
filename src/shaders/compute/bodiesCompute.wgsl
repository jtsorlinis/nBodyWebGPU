struct Params {
  numBodies: u32,
  gravity: f32,
  softeningFactor: f32,
  deltaTime: f32,
  blackHoleMass: f32,
}

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
  mass : f32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage,read> bodiesIn : array<Body>;
@group(0) @binding(2) var<storage,read_write> bodiesOut : array<Body>;

var<workgroup> localBodies : array<Body, 256>;

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>, 
        @builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(num_workgroups) numGroups : vec3<u32>) {
  
  var body = bodiesIn[id.x];

  // First "Kick": Half update of the velocity
  body.vel += 0.5 * body.acc * params.deltaTime;

  // "Drift": Full update of the position
  body.pos += body.vel * params.deltaTime;

  // Compute new acceleration
  var newAcc = vec3(0.0);

  for(var tile = 0u; tile < numGroups.x; tile++) {
    // Load the body into shared memory if it's in bounds
    let loadIndex = lid.x + tile * 256;
    if (loadIndex < params.numBodies) {
      localBodies[lid.x] = bodiesIn[loadIndex];
    } else {
      localBodies[lid.x] = Body();
    }
    workgroupBarrier();
    
    for (var i = 0u; i < 256; i++) {
      let otherIndex = i + tile * 256;
      if (id.x != otherIndex) {
        let other = localBodies[i];
        let r = other.pos - body.pos;
        let distSq = dot(r, r) + params.softeningFactor;
        let invDist = inverseSqrt(distSq);
        let f = params.gravity * other.mass * invDist * invDist * invDist;
        newAcc += r * f;
      }
    }
    workgroupBarrier();
  }

  // Don't write out of bounds
  if (id.x >= params.numBodies) {
    return;
  }

  // Store the new acceleration for the next timestep
  body.acc = newAcc;

  // Second "Kick": Another half update of the velocity
  body.vel += 0.5 * body.acc * params.deltaTime;

  // Update black hole masses
  if(body.mass > 1000) {
    body.mass = params.blackHoleMass;
  }

  // Write the updated body back to the buffer
  bodiesOut[id.x] = body;
}

