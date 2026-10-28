struct Params {
  numBodies: u32,
  gravity: f32,
  deltaTime: f32,
  blackHoleMass: f32,
  softening: f32,
}

struct Motion {
  vel : vec3<f32>,
  acc : vec3<f32>,
};

@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage,read> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> motion : array<Motion>;

var<workgroup> localBodies : array<vec4<f32>, 256>;

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>,
        @builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(num_workgroups) numGroups : vec3<u32>) {

  let pos = posMass[id.x].xyz;

  // Compute new acceleration
  var newAcc = vec3(0.0);

  for(var tile = 0u; tile < numGroups.x; tile++) {
    // Load the body into shared memory if it's in bounds
    let loadIndex = lid.x + tile * 256;
    if (loadIndex < params.numBodies) {
      localBodies[lid.x] = posMass[loadIndex];
    } else {
      localBodies[lid.x] = vec4(0.0);
    }
    workgroupBarrier();

    for (var i = 0u; i < 256; i++) {
        let otherIndex = i + tile * 256;
        if (id.x != otherIndex) {
            let other = localBodies[i];
            let r = other.xyz - pos;
            // Add softening to prevent singularities and unrealistic close encounters
            let distSq = dot(r, r) + params.softening * params.softening;
            let invDist = inverseSqrt(distSq);
            let f = params.gravity * other.w * invDist * invDist * invDist;
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

  // Second "Kick": Another half update of the velocity
  var vel = motion[id.x].vel + 0.5 * newAcc * params.deltaTime;

  // Limit velocity to prevent ejections from high-mass interactions
  let speed = length(vel);
  if (speed > 1000.0) {
    vel = normalize(vel) * 1000.0;
  }

  // Store the new acceleration for the next timestep
  motion[id.x] = Motion(vel, newAcc);
}
