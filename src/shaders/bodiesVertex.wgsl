#include<sceneUboDeclaration>

struct Motion { vel: vec3<f32>, acc: vec3<f32>, };
var<storage, read> posMass: array<vec4<f32>>;
var<storage, read> motion: array<Motion>;
uniform maxAcc: f32;
uniform extrapolationTime: f32;
attribute position: vec3<f32>;
varying col: vec4<f32>;
varying particleOffset: vec2<f32>;
varying viewCenter: vec3<f32>;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let body = motion[input.instanceIndex];
  let pos = posMass[input.instanceIndex].xyz + body.vel * uniforms.extrapolationTime;
  let center = (scene.view * vec4<f32>(pos, 1.0)).xyz;
  vertexOutputs.position = scene.projection * vec4<f32>(center + vec3<f32>(vertexInputs.position.xy, 0.0), 1.0);
  vertexOutputs.particleOffset = vertexInputs.position.xy;
  vertexOutputs.viewCenter = center;
  let mag = saturate(length(body.acc) / uniforms.maxAcc);
  vertexOutputs.col = mix(vec4<f32>(0.012, 0.063, 0.988, 1.0), vec4<f32>(1.0, 0.376, 0.188, 1.0), mag);
}
