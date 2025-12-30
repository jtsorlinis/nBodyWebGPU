struct Params {
  numBodies: u32,
  gravity: f32,
  deltaTime: f32,
  blackHoleMass: f32,
  softening: f32,
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

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  var body = bodiesIn[id.x];

  // First "Kick": Half update of the velocity
  body.vel += 0.5 * body.acc * params.deltaTime;

  // "Drift": Full update of the position
  body.pos += body.vel * params.deltaTime;

  bodiesOut[id.x] = body;
}
