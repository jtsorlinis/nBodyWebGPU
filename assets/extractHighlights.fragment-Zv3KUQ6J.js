import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./helperFunctions-gEnZbjN3.js";var n=`extractHighlightsPixelShader`,r=`#include<helperFunctions>
varying vec2 vUV;uniform sampler2D textureSampler;uniform float threshold;uniform float exposure;
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) 
{gl_FragColor=texture2D(textureSampler,vUV);float luma=dot(LuminanceEncodeApprox,gl_FragColor.rgb*exposure);gl_FragColor.rgb=step(threshold,luma)*gl_FragColor.rgb;}`;e.ShadersStore[n]||(e.ShadersStore[n]=r);var i=[t];for(let t of i)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var a={name:n,shader:r};export{a as t};