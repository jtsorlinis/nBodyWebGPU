// Params, Motion and Body are shared by every kernel, see common.wgsl
@group(0) @binding(0) var<uniform> params : Params;
// The bodies as the force pass left them, in last step's tree order
@group(0) @binding(1) var<storage, read> sortedBodies : array<Body>;
// xyz = position, w = mass
@group(0) @binding(2) var<storage, read_write> posMass : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> motion : array<Motion>;

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  let body = sortedBodies[id.x];

  // First "Kick": Half update of the velocity
  let vel = body.motion.vel + 0.5 * body.motion.acc * params.deltaTime;

  // "Drift": Full update of the position
  posMass[id.x] = vec4(body.posMass.xyz + vel * params.deltaTime, body.posMass.w);
  motion[id.x] = Motion(vel, body.motion.acc);
}
