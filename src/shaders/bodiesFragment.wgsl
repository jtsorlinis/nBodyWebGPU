varying col: vec4<f32>;
varying corner: vec2<f32>;

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  // Round the quad off into a disc
  if (dot(input.corner, input.corner) > 1.0) {
    discard;
  }
  fragmentOutputs.color = input.col;
}
