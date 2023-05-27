#include<sceneUboDeclaration>

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
  mass : f32,
};

var<storage,read> bodies : array<Body>;

attribute position : vec3<f32>;
varying col : vec4<f32>;

fn colorFromAcc(val: vec3<f32>) -> vec4<f32> {
  let mag = saturate(length(val)/150);
  let low = vec4<f32>(0, 0.7, 1, 1.0);
  let high = vec4<f32>(1, 1, .8, 1.0);
  
  return mix(low, high, mag);
}

@vertex
fn main(input : VertexInputs) -> FragmentInputs {
  let body = bodies[input.instanceIndex];
  vertexOutputs.position = scene.viewProjection * vec4<f32>(vertexInputs.position + body.pos, 1.0);
  vertexOutputs.col = colorFromAcc(body.acc);
}
