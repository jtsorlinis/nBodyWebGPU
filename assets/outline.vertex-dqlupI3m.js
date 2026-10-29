import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./bonesDeclaration-CyjXpdlz.js";import{t as n}from"./bakedVertexAnimationDeclaration-C-g0vyVW.js";import{t as r}from"./morphTargetsVertexGlobalDeclaration-B4Uhgd1q.js";import{t as i}from"./morphTargetsVertexDeclaration-D7nvpAib.js";import{t as a}from"./instancesDeclaration-DsiFqYXH.js";import{t as o}from"./morphTargetsVertexGlobal-CH8bCQ4f.js";import{t as s}from"./morphTargetsVertex-wwizyQUK.js";import{t as c}from"./instancesVertex-Dty6qjVO.js";import{t as l}from"./bonesVertex-3u5jVDJW.js";import{t as u}from"./bakedVertexAnimation-CP3BNGXM.js";import{t as d}from"./clipPlaneVertexDeclaration-CAg6OFbU.js";import{t as f}from"./clipPlaneVertex-C1oDvPhB.js";import{t as p}from"./logDepthDeclaration-DYYUVTrx.js";import{t as m}from"./logDepthVertex-DSD5XdGw.js";var h=`outlineVertexShader`,g=`attribute position: vec3f;attribute normal: vec3f;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<clipPlaneVertexDeclaration>
uniform offset: f32;
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
#ifdef ALPHATEST
varying vUV: vec2f;uniform diffuseMatrix: mat4x4f; 
#ifdef UV1
attribute uv: vec2f;
#endif
#ifdef UV2
attribute uv2: vec2f;
#endif
#endif
#include<logDepthDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input: VertexInputs)->FragmentInputs {var positionUpdated: vec3f=vertexInputs.position;var normalUpdated: vec3f=vertexInputs.normal;
#ifdef UV1
var uvUpdated: vec2f=vertexInputs.uv;
#endif
#ifdef UV2
var uv2Updated: vec2f=vertexInputs.uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
var offsetPosition: vec3f=positionUpdated+(normalUpdated*uniforms.offset);
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
var worldPos: vec4f=finalWorld*vec4f(offsetPosition,1.0);vertexOutputs.position=uniforms.viewProjection*worldPos;
#ifdef ALPHATEST
#ifdef UV1
vertexOutputs.vUV=(uniforms.diffuseMatrix*vec4f(uvUpdated,1.0,0.0)).xy;
#endif
#ifdef UV2
vertexOutputs.vUV=(uniforms.diffuseMatrix*vec4f(uv2Updated,1.0,0.0)).xy;
#endif
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
}
`;e.ShadersStoreWGSL[h]||(e.ShadersStoreWGSL[h]=g);var _=[t,n,r,i,d,a,p,o,s,c,l,u,f,m];for(let t of _)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var v={name:h,shader:g};export{v as t};