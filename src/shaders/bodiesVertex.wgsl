#include<sceneUboDeclaration>

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
  colFloat : f32,
};

// Define our color gradient: red -> orange -> yellow -> white -> blue
const colorRamp = array(
    vec3<f32>(1.0, 0.0, 0.0), // Red Star
    vec3<f32>(1.0, 0.5, 0.0), // Orange Star
    vec3<f32>(1.0, 1.0, 0.0), // Yellow Star
    vec3<f32>(1.0, 1.0, 1.0), // White Star
    vec3<f32>(0.0, 0.0, 1.0), // Blue Star
);

fn starColor(colFloat: f32) -> vec3<f32> {
    // Ensure float is in [0,1] range
    let normalized = clamp(colFloat, 0.0, 1.0);
    
    // Interpolate between the colors based on normalized value.
    let rampIndex = normalized * 4.0; // Multiply by 4 since we have 5 colors
    let index1 = i32(floor(rampIndex));
    let index2 = min(index1 + 1, 4);
    let fraction = rampIndex - f32(index1);

    return mix(colorRamp[index1], colorRamp[index2], fraction);
}

var<storage,read> bodies : array<Body>;

attribute position : vec3<f32>;
varying col : vec4<f32>;

@vertex
fn main(input : VertexInputs) -> FragmentInputs {
  let body = bodies[input.instanceIndex];
  vertexOutputs.position = scene.viewProjection * vec4<f32>(vertexInputs.position + body.pos, 1.0);
  vertexOutputs.col = vec4<f32>(starColor(body.colFloat),1);
}
