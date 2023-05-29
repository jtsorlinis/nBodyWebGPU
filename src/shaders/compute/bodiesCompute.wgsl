struct Params {
  numBodies: u32,
  gravity: f32,
  softeningFactor: f32,
  deltaTime: f32,
  blackHoleMass: f32,
}


@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage,read> bodiesPosIn : array<vec4f>;
@group(0) @binding(2) var<storage,read_write> bodiesPosOut : array<vec4f>;
@group(0) @binding(3) var<storage,read> bodiesVelIn : array<vec4f>;
@group(0) @binding(4) var<storage,read_write> bodiesVelOut : array<vec4f>;
@group(0) @binding(5) var<storage,read> bodiesAccIn : array<vec4f>;
@group(0) @binding(6) var<storage,read_write> bodiesAccOut : array<vec4f>;

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if(id.x >= params.numBodies) {
    return;
  }

  var bodyPos = bodiesPosIn[id.x].xyz;
  var bodyVel = bodiesVelIn[id.x].xyz;
  var bodyAcc = bodiesAccIn[id.x].xyz;
  var bodyMass = bodiesAccIn[id.x].w;

  // Update black hole masses
  if(bodyMass > 1000) {
    bodyMass = params.blackHoleMass;
  }

  // First "Kick": Half update of the velocity
  bodyVel += 0.5 * bodyAcc * params.deltaTime;

  // "Drift": Full update of the position
  bodyPos += bodyVel * params.deltaTime;

  // Compute new acceleration
  var newAcc = vec3<f32>(0.0, 0.0, 0.0);
  for (var i = 0u; i < params.numBodies; i += 1) {
    if (i != id.x) {
      let otherPos = bodiesPosIn[i].xyz;
      let otherMass = bodiesAccIn[i].w;
      let r = otherPos - bodyPos;
      let distSq = max(dot(r, r), params.softeningFactor);
      let f = params.gravity * ((bodyMass * otherMass) / distSq);
      let a = f / bodyMass;
      let direction = r / sqrt(distSq);
      newAcc += a * direction;
    }
  }

  // Store the new acceleration for the next timestep
  bodyAcc = newAcc;

  // Second "Kick": Another half update of the velocity
  bodyVel += 0.5 * bodyAcc * params.deltaTime;

  // Write the updated body back to the buffer
  bodiesPosOut[id.x] = vec4f(bodyPos,0);
  bodiesVelOut[id.x] = vec4f(bodyVel,0);
  bodiesAccOut[id.x] = vec4f(bodyAcc, bodyMass);
}

