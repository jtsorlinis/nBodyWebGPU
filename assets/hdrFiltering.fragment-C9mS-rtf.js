import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./helperFunctions-gEnZbjN3.js";import{t as n}from"./pbrBRDFFunctions-BCNINF-p.js";import{n as r,t as i}from"./hdrFilteringFunctions-Dw0rQ8Bu.js";var a=`hdrFilteringPixelShader`,o=`#include<helperFunctions>
#include<importanceSampling>
#include<pbrBRDFFunctions>
#include<hdrFilteringFunctions>
uniform float alphaG;uniform samplerCube inputTexture;uniform vec2 vFilteringInfo;uniform float hdrScale;varying vec3 direction;void main() {vec3 color=radiance(alphaG,inputTexture,direction,vFilteringInfo);gl_FragColor=vec4(color*hdrScale,1.0);}`;e.ShadersStore[a]||(e.ShadersStore[a]=o);var s=[t,r,n,i];for(let t of s)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var c={name:a,shader:o};export{c as t};