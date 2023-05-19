varying col: vec4<f32>;

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  fragmentOutputs.color = input.col;
}