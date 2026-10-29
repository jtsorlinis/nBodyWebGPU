import{t as e}from"./shaderStore-D-XQlhUT.js";var t=`volumetricLightScatteringPassPixelShader`,n=`#if defined(ALPHATEST) || defined(NEED_UV)
varying vUV: vec2f;
#endif
#if defined(ALPHATEST)
var diffuseSamplerSampler: sampler;var diffuseSampler: texture_2d<f32>;
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#if defined(ALPHATEST)
let diffuseColor: vec4f=textureSample(diffuseSampler,diffuseSamplerSampler,input.vUV);if (diffuseColor.a<0.4) {discard;}
#endif
fragmentOutputs.color=vec4f(0.0,0.0,0.0,1.0);}
`;e.ShadersStoreWGSL[t]||(e.ShadersStoreWGSL[t]=n);var r={name:t,shader:n};export{r as t};