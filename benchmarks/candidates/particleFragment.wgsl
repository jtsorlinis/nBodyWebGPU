#include<sceneUboDeclaration>
varying col: vec4<f32>;
varying particleOffset: vec2<f32>;
varying viewCenter: vec3<f32>;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let radiusSq = dot(input.particleOffset, input.particleOffset);
  if (radiusSq > 0.25) { discard; }
  // Keep spherical depth at overlaps, even though each particle uses just two triangles.
  let surface = input.viewCenter + vec3<f32>(input.particleOffset, -sqrt(0.25 - radiusSq));
  let projected = scene.projection * vec4<f32>(surface, 1.0);
  fragmentOutputs.fragDepth = projected.z / projected.w;
  fragmentOutputs.color = input.col;
}
