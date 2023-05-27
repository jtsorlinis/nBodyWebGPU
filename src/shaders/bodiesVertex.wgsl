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

@vertex
fn main(input : VertexInputs) -> FragmentInputs {
  let body = bodies[input.instanceIndex];
  vertexOutputs.position = scene.viewProjection * vec4<f32>(vertexInputs.position + body.pos, 1.0);
  vertexOutputs.col = vec4<f32>(1,1,1,1);
}
