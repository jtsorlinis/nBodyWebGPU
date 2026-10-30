// Params and Motion are shared by every kernel, see common.wgsl
@group(0) @binding(0) var<uniform> params : Params;
// xyz = position, w = mass
@group(0) @binding(1) var<storage, read_write> posMass : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> motion : array<Motion>;

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  var body = motion[id.x];

  // First "Kick": Half update of the velocity
  body.vel += 0.5 * body.acc * params.deltaTime;

  // "Drift": Full update of the position
  posMass[id.x] = vec4(posMass[id.x].xyz + body.vel * params.deltaTime, posMass[id.x].w);
  motion[id.x].vel = body.vel;
}
