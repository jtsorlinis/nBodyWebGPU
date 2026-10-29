import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./bonesDeclaration-CyjXpdlz.js";import{t as n}from"./bakedVertexAnimationDeclaration-C-g0vyVW.js";import{t as r}from"./morphTargetsVertexGlobalDeclaration-B4Uhgd1q.js";import{t as i}from"./morphTargetsVertexDeclaration-D7nvpAib.js";import{t as a}from"./instancesDeclaration-DsiFqYXH.js";import{t as o}from"./morphTargetsVertexGlobal-CH8bCQ4f.js";import{t as s}from"./morphTargetsVertex-wwizyQUK.js";import{t as c}from"./instancesVertex-Dty6qjVO.js";import{t as l}from"./bonesVertex-3u5jVDJW.js";import{t as u}from"./bakedVertexAnimation-CP3BNGXM.js";var d=`volumetricLightScatteringPassVertexShader`,f=`attribute position: vec3f;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;uniform depthValues: vec2f;
#if defined(ALPHATEST) || defined(NEED_UV)
varying vUV: vec2f;uniform diffuseMatrix: mat4x4f;
#ifdef UV1
attribute uv: vec2f;
#endif
#ifdef UV2
attribute uv2: vec2f;
#endif
#endif
#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input: VertexInputs)->FragmentInputs {var positionUpdated: vec3f=vertexInputs.position;
#if (defined(ALPHATEST) || defined(NEED_UV)) && defined(UV1)
var uvUpdated: vec2f=vertexInputs.uv;
#endif
#if (defined(ALPHATEST) || defined(NEED_UV)) && defined(UV2)
var uv2Updated: vec2f=vertexInputs.uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vertexOutputs.position=uniforms.viewProjection*finalWorld*vec4f(positionUpdated,1.0);
#if defined(ALPHATEST) || defined(NEED_UV)
#ifdef UV1
vertexOutputs.vUV=(uniforms.diffuseMatrix*vec4f(uvUpdated,1.0,0.0)).xy;
#endif
#ifdef UV2
vertexOutputs.vUV=(uniforms.diffuseMatrix*vec4f(uv2Updated,1.0,0.0)).xy;
#endif
#endif
}
`;e.ShadersStoreWGSL[d]||(e.ShadersStoreWGSL[d]=f);var p=[t,n,r,i,a,o,s,c,l,u];for(let t of p)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var m={name:d,shader:f};export{m as t};