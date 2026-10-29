import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./helperFunctions-BH8P-eyq.js";var n=`rgbdDecodePixelShader`,r=`varying vUV: vec2f;var textureSamplerSampler: sampler;var textureSampler: texture_2d<f32>;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {fragmentOutputs.color=vec4f(fromRGBD(textureSample(textureSampler,textureSamplerSampler,input.vUV)),1.0);}`;e.ShadersStoreWGSL[n]||(e.ShadersStoreWGSL[n]=r);var i=[t];for(let t of i)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var a={name:n,shader:r};export{a as t};