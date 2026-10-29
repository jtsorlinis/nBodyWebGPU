import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./helperFunctions-BH8P-eyq.js";import{t as n}from"./imageProcessingDeclaration-Bb7hft1z.js";import{t as r}from"./imageProcessingFunctions-BdsOoAXj.js";var i=`imageProcessingPixelShader`,a=`varying vUV: vec2f;var textureSamplerSampler: sampler;var textureSampler: texture_2d<f32>;
#include<imageProcessingDeclaration>
#include<helperFunctions>
#include<imageProcessingFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {var result: vec4f=textureSample(textureSampler,textureSamplerSampler,input.vUV);result=vec4f(max(result.rgb,vec3f(0.)),result.a);
#ifdef IMAGEPROCESSING
#ifndef FROMLINEARSPACE
result=vec4f(toLinearSpaceVec3(result.rgb),result.a);
#endif
result=applyImageProcessing(result);
#else
#ifdef FROMLINEARSPACE
result=applyImageProcessing(result);
#endif
#endif
fragmentOutputs.color=result;}`;e.ShadersStoreWGSL[i]||(e.ShadersStoreWGSL[i]=a);var o=[n,t,r];for(let t of o)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var s={name:i,shader:a};export{s as t};