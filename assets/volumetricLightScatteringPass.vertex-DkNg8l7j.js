import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./bonesDeclaration-oDxSsnww.js";import{n,t as r}from"./bakedVertexAnimation-7XIMgH6x.js";import{t as i}from"./morphTargetsVertexGlobalDeclaration-D6da8uHC.js";import{t as a}from"./morphTargetsVertexDeclaration-DQIU8BV5.js";import{t as o}from"./instancesDeclaration-CJBvtBV5.js";import{t as s}from"./morphTargetsVertexGlobal-Bo-wqe4M.js";import{t as c}from"./morphTargetsVertex-Uz52QWNe.js";import{t as l}from"./instancesVertex-C-FoRQR1.js";import{t as u}from"./bonesVertex-BZbvWQw2.js";var d=`volumetricLightScatteringPassVertexShader`,f=`attribute vec3 position;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<instancesDeclaration>
uniform mat4 viewProjection;uniform vec2 depthValues;
#if defined(ALPHATEST) || defined(NEED_UV)
varying vec2 vUV;uniform mat4 diffuseMatrix;
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#endif
#define CUSTOM_VERTEX_DEFINITIONS
void main(void)
{vec3 positionUpdated=position;
#if (defined(ALPHATEST) || defined(NEED_UV)) && defined(UV1)
vec2 uvUpdated=uv;
#endif
#if (defined(ALPHATEST) || defined(NEED_UV)) && defined(UV2)
vec2 uv2Updated=uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
gl_Position=viewProjection*finalWorld*vec4(positionUpdated,1.0);
#if defined(ALPHATEST) || defined(BASIC_RENDER)
#ifdef UV1
vUV=vec2(diffuseMatrix*vec4(uvUpdated,1.0,0.0));
#endif
#ifdef UV2
vUV=vec2(diffuseMatrix*vec4(uv2Updated,1.0,0.0));
#endif
#endif
}
`;e.ShadersStore[d]||(e.ShadersStore[d]=f);var p=[t,n,i,a,o,s,c,l,u,r];for(let t of p)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var m={name:d,shader:f};export{m as t};