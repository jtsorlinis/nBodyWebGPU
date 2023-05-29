#include<sceneUboDeclaration>

var<storage,read> bodiesPos : array<vec4f>;
var<storage,read> bodiesAcc : array<vec4f>;


attribute position : vec4<f32>;
varying col : vec4<f32>;

fn colorFromAcc(val: vec3<f32>) -> vec4<f32> {
  let mag = saturate(length(val)/150);

  // blue = RGB(175, 201, 255)
  // orange = RGB(255, 166, 81)
  let low = vec4<f32>(.686, .788, 1.0, 1.0);
  let high = vec4<f32>(1.0, .651, .318, 1.0);
  
  return mix(low, high, mag);
}

@vertex
fn main(input : VertexInputs) -> FragmentInputs {
  vertexOutputs.position = scene.viewProjection * (vertexInputs.position + bodiesPos[input.instanceIndex]);
  vertexOutputs.col = colorFromAcc(bodiesAcc[input.instanceIndex].xyz);
}
