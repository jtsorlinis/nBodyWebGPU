struct Params {
  numBodies: u32,
  gravity: f32,
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
@group(0) @binding(1) var<storage,read_write> bodies : array<Body>;

var<workgroup> localBodies : array<Body, 256>;

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>, 
        @builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(num_workgroups) numGroups : vec3<u32>) {
  
  var body = bodies[id.x];

  // Compute new acceleration
  var newAcc = vec3(0.0);

  for(var tile = 0u; tile < numGroups.x; tile++) {
    // Load the body into shared memory if it's in bounds
    let loadIndex = lid.x + tile * 256;
    if (loadIndex < params.numBodies) {
      localBodies[lid.x] = bodies[loadIndex];
    } else {
      localBodies[lid.x] = Body();
    }
    workgroupBarrier();
    
    for (var i = 0u; i < 256; i++) {
        let otherIndex = i + tile * 256;
        if (id.x != otherIndex) {
            let other = localBodies[i];
            let r = other.pos - body.pos;
            // Use a tiny epsilon to prevent division by zero, but rely on clamp for singularities
            let distSq = max(dot(r, r), 1e-9); 
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

  // Clamp acceleration magnitude to prevent ejections from singularities
  let accLen = length(newAcc);
  if (accLen > 1000.0) {
    newAcc = normalize(newAcc) * 1000.0;
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
  bodies[id.x] = body;
}
