#include<sceneUboDeclaration>

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
  mass : f32,
};

var<storage,read> bodies : array<Body>;

uniform maxAcc : f32;
attribute position : vec3<f32>;
varying col : vec4<f32>;

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
  let body = bodies[input.instanceIndex];
  vertexOutputs.position = scene.viewProjection * vec4<f32>(vertexInputs.position + body.pos, 1.0);
  vertexOutputs.col = colorFromAcc(body.acc);
}
