#include<sceneUboDeclaration>

struct Motion {
  vel : vec3<f32>,
  acc : vec3<f32>,
};

// xyz = position, w = mass
var<storage,read> posMass : array<vec4<f32>>;
var<storage,read> motion : array<Motion>;

uniform maxAcc : f32;
// Time since the last simulation step, to extrapolate positions between fixed steps
uniform extrapolationTime : f32;
attribute position : vec3<f32>;
varying col : vec4<f32>;
varying corner : vec2<f32>;

fn colorFromAcc(val: vec3<f32>) -> vec4<f32> {
  let mag = saturate(length(val)/uniforms.maxAcc);

  // blue = RGB(3, 16, 252)
  // orange = RGB(255, 96, 48)
  let low = vec4<f32>(0.012, 0.063, 0.988, 1.0);
  let high = vec4<f32>(1.0, 0.376, 0.188, 1.0);

  return mix(low, high, mag);
}

@vertex
fn main(input : VertexInputs) -> FragmentInputs {
  let body = motion[input.instanceIndex];
  let pos = posMass[input.instanceIndex].xyz + body.vel * uniforms.extrapolationTime;

  // Camera-facing quad: offset the corners in view space
  let viewPos = scene.view * vec4<f32>(pos, 1.0);
  vertexOutputs.position = scene.projection * (viewPos + vec4<f32>(vertexInputs.position.xy, 0.0, 0.0));
  vertexOutputs.col = colorFromAcc(body.acc);
  vertexOutputs.corner = vertexInputs.position.xy * 2.0;
}
