import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./helperFunctions-gEnZbjN3.js";import{t as n}from"./pbrBRDFFunctions-BCNINF-p.js";import{n as r,t as i}from"./hdrFilteringFunctions-Dw0rQ8Bu.js";var a=`hdrIrradianceFilteringPixelShader`,o=`#include<helperFunctions>
#include<importanceSampling>
#include<pbrBRDFFunctions>
#include<hdrFilteringFunctions>
uniform samplerCube inputTexture;
#ifdef IBL_CDF_FILTERING
uniform sampler2D icdfTexture;
#endif
uniform vec2 vFilteringInfo;uniform float hdrScale;varying vec3 direction;void main() {vec3 color=irradiance(inputTexture,direction,vFilteringInfo,0.0,vec3(1.0),direction
#ifdef IBL_CDF_FILTERING
,icdfTexture
#endif
);gl_FragColor=vec4(color*hdrScale,1.0);}`;e.ShadersStore[a]||(e.ShadersStore[a]=o);var s=[t,r,n,i];for(let t of s)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var c={name:a,shader:o};export{c as t};