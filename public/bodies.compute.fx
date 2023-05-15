struct Params {
  numBodies: u32,
  gravity: f32,
  softeningFactor: f32,
  deltaTime: f32,
}

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage,read> bodiesIn : array<Body>;
@group(0) @binding(2) var<storage,read_write> bodiesOut : array<Body>;

const mass : f32 = 1.0;

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  var body = bodiesIn[id.x];

  // First "Kick": Half update of the velocity
  body.vel += 0.5 * body.acc * params.deltaTime;

  // "Drift": Full update of the position
  body.pos += body.vel * params.deltaTime;

  // Compute new acceleration
  var newAcc = vec3<f32>(0.0, 0.0, 0.0);
  for (var i = 0u; i < params.numBodies; i += 1) {
    if (i != id.x) {
      let other = bodiesIn[i];
      let r = other.pos - body.pos;
      let distSqr = dot(r, r) + params.softeningFactor;
      let invDist = 1.0 / sqrt(distSqr);
      let invDistCube = invDist * invDist * invDist;
      let s = params.gravity * mass * invDistCube;
      newAcc += s * r;
    }
  }

  // Store the new acceleration for the next timestep
  body.acc = newAcc;

  // Second "Kick": Another half update of the velocity
  body.vel += 0.5 * body.acc * params.deltaTime;

  // Write the updated body back to the buffer
  bodiesOut[id.x] = body;
}

