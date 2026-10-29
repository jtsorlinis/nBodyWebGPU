import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./bonesDeclaration-CyjXpdlz.js";import{t as n}from"./bakedVertexAnimationDeclaration-C-g0vyVW.js";import{t as r}from"./instancesDeclaration-DsiFqYXH.js";import{t as i}from"./instancesVertex-Dty6qjVO.js";import{t as a}from"./bonesVertex-3u5jVDJW.js";import{t as o}from"./bakedVertexAnimation-CP3BNGXM.js";import{t as s}from"./clipPlaneVertexDeclaration-CAg6OFbU.js";import{t as c}from"./clipPlaneVertex-C1oDvPhB.js";import{t as l}from"./fogVertexDeclaration-CiHbVcSR.js";import{t as u}from"./fogVertex-D0bmc4KF.js";import{t as d}from"./vertexColorMixing-UCrnwszu.js";var f=`colorVertexShader`,p=`attribute position: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#ifdef FOG
uniform view: mat4x4f;
#endif
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
varying vColor: vec4f;
#endif
#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input : VertexInputs)->FragmentInputs {
#define CUSTOM_VERTEX_MAIN_BEGIN
#ifdef VERTEXCOLOR
var colorUpdated: vec4f=vertexInputs.color;
#endif
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
var worldPos: vec4f=finalWorld* vec4f(vertexInputs.position,1.0);vertexOutputs.position=uniforms.viewProjection*worldPos;
#include<clipPlaneVertex>
#include<fogVertex>
#include<vertexColorMixing>
#define CUSTOM_VERTEX_MAIN_END
}`;e.ShadersStoreWGSL[f]||(e.ShadersStoreWGSL[f]=p);var m=[t,n,s,l,r,i,a,o,c,u,d];for(let t of m)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var h={name:f,shader:p};export{h as t};