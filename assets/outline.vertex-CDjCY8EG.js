import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./bonesDeclaration-oDxSsnww.js";import{n,t as r}from"./bakedVertexAnimation-7XIMgH6x.js";import{t as i}from"./morphTargetsVertexGlobalDeclaration-D6da8uHC.js";import{t as a}from"./morphTargetsVertexDeclaration-DQIU8BV5.js";import{t as o}from"./instancesDeclaration-CJBvtBV5.js";import{t as s}from"./morphTargetsVertexGlobal-Bo-wqe4M.js";import{t as c}from"./morphTargetsVertex-Uz52QWNe.js";import{t as l}from"./instancesVertex-C-FoRQR1.js";import{t as u}from"./bonesVertex-BZbvWQw2.js";import{t as d}from"./clipPlaneVertexDeclaration-Be-obVGF.js";import{t as f}from"./clipPlaneVertex-6IHcna3I.js";import{t as p}from"./logDepthDeclaration-3gXGtHbI.js";import{t as m}from"./logDepthVertex-D5IUM6qd.js";var h=`outlineVertexShader`,g=`attribute vec3 position;attribute vec3 normal;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<clipPlaneVertexDeclaration>
uniform float offset;
#include<instancesDeclaration>
uniform mat4 viewProjection;
#ifdef ALPHATEST
varying vec2 vUV;uniform mat4 diffuseMatrix;
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#endif
#include<logDepthDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
void main(void)
{vec3 positionUpdated=position;vec3 normalUpdated=normal;
#ifdef UV1
vec2 uvUpdated=uv;
#endif
#ifdef UV2
vec2 uv2Updated=uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
vec3 offsetPosition=positionUpdated+(normalUpdated*offset);
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(offsetPosition,1.0);gl_Position=viewProjection*worldPos;
#ifdef ALPHATEST
#ifdef UV1
vUV=vec2(diffuseMatrix*vec4(uvUpdated,1.0,0.0));
#endif
#ifdef UV2
vUV=vec2(diffuseMatrix*vec4(uv2Updated,1.0,0.0));
#endif
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
}
`;e.ShadersStore[h]||(e.ShadersStore[h]=g);var _=[t,n,i,a,d,o,p,s,c,l,u,r,f,m];for(let t of _)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var v={name:h,shader:g};export{v as t};