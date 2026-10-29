import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./bonesDeclaration-oDxSsnww.js";import{n,t as r}from"./bakedVertexAnimation-7XIMgH6x.js";import{t as i}from"./morphTargetsVertexGlobalDeclaration-D6da8uHC.js";import{t as a}from"./morphTargetsVertexDeclaration-DQIU8BV5.js";import{t as o}from"./morphTargetsVertexGlobal-Bo-wqe4M.js";import{t as s}from"./morphTargetsVertex-Uz52QWNe.js";import{t as c}from"./instancesVertex-C-FoRQR1.js";import{t as l}from"./bonesVertex-BZbvWQw2.js";import{t as u}from"./helperFunctions-gEnZbjN3.js";import{t as d}from"./clipPlaneVertexDeclaration-Be-obVGF.js";import{t as f}from"./clipPlaneVertex-6IHcna3I.js";import{t as p}from"./sceneVertexDeclaration-CluTp-RC.js";import{t as m}from"./meshVertexDeclaration-CPlGPeEg.js";import{t as h}from"./sceneUboDeclaration-B5VhSG0v.js";import{t as g}from"./meshUboDeclaration-BmNu2KU_.js";import{t as _}from"./shadowMapVertexMetric-DLVzym1s.js";var v=`shadowMapVertexDeclaration`,y=`#include<sceneVertexDeclaration>
#include<meshVertexDeclaration>
`;e.IncludesShadersStore[v]||(e.IncludesShadersStore[v]=y);var b={name:v,shader:y},x=`shadowMapUboDeclaration`,S=`layout(std140,column_major) uniform;
#include<sceneUboDeclaration>
#include<meshUboDeclaration>
`;e.IncludesShadersStore[x]||(e.IncludesShadersStore[x]=S);var C={name:x,shader:S},w=`shadowMapVertexExtraDeclaration`,T=`#if SM_NORMALBIAS==1
uniform vec3 lightDataSM;
#endif
uniform vec3 biasAndScaleSM;uniform vec2 depthValuesSM;varying float vDepthMetricSM;
#if SM_USEDISTANCE==1
varying vec3 vPositionWSM;
#endif
#if defined(SM_DEPTHCLAMP) && SM_DEPTHCLAMP==1
varying float zSM;
#endif
`;e.IncludesShadersStore[w]||(e.IncludesShadersStore[w]=T);var E={name:w,shader:T},D=`shadowMapVertexNormalBias`,O=`#if SM_NORMALBIAS==1
#if SM_DIRECTIONINLIGHTDATA==1
vec3 worldLightDirSM=normalize(-lightDataSM.xyz);
#else
vec3 directionToLightSM=lightDataSM.xyz-worldPos.xyz;vec3 worldLightDirSM=normalize(directionToLightSM);
#endif
float ndlSM=dot(vNormalW,worldLightDirSM);float sinNLSM=sqrt(1.0-ndlSM*ndlSM);float normalBiasSM=biasAndScaleSM.y*sinNLSM;worldPos.xyz-=vNormalW*normalBiasSM;
#endif
`;e.IncludesShadersStore[D]||(e.IncludesShadersStore[D]=O);var k={name:D,shader:O},A=`shadowMapVertexShader`,j=`attribute vec3 position;
#ifdef NORMAL
attribute vec3 normal;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#ifdef INSTANCES
attribute vec4 world0;attribute vec4 world1;attribute vec4 world2;attribute vec4 world3;
#endif
#include<helperFunctions>
#include<__decl__shadowMapVertex>
#ifdef ALPHATEXTURE
varying vec2 vUV;uniform mat4 diffuseMatrix;
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#endif
#include<shadowMapVertexExtraDeclaration>
#include<clipPlaneVertexDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
void main(void)
{vec3 positionUpdated=position;
#ifdef UV1
vec2 uvUpdated=uv;
#endif
#ifdef UV2
vec2 uv2Updated=uv2;
#endif
#ifdef NORMAL
vec3 normalUpdated=normal;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
#ifdef NORMAL
mat3 normWorldSM=mat3(finalWorld);
#if defined(INSTANCES) && defined(THIN_INSTANCES)
vec3 vNormalW=normalUpdated/vec3(dot(normWorldSM[0],normWorldSM[0]),dot(normWorldSM[1],normWorldSM[1]),dot(normWorldSM[2],normWorldSM[2]));vNormalW=normalize(normWorldSM*vNormalW);
#else
#ifdef NONUNIFORMSCALING
normWorldSM=transposeMat3(inverseMat3(normWorldSM));
#endif
vec3 vNormalW=normalize(normWorldSM*normalUpdated);
#endif
#endif
#include<shadowMapVertexNormalBias>
gl_Position=viewProjection*worldPos;
#include<shadowMapVertexMetric>
#ifdef ALPHATEXTURE
#ifdef UV1
vUV=vec2(diffuseMatrix*vec4(uvUpdated,1.0,0.0));
#endif
#ifdef UV2
vUV=vec2(diffuseMatrix*vec4(uv2Updated,1.0,0.0));
#endif
#endif
#include<clipPlaneVertex>
}`;e.ShadersStore[A]||(e.ShadersStore[A]=j);var M=[t,n,i,a,u,p,m,b,h,g,C,E,d,o,s,c,l,r,k,_,f];for(let t of M)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var N={name:A,shader:j};export{N as t};