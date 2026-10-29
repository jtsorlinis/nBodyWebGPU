import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./instancesDeclaration-CJBvtBV5.js";import{t as n}from"./instancesVertex-C-FoRQR1.js";import{t as r}from"./clipPlaneVertexDeclaration-Be-obVGF.js";import{t as i}from"./clipPlaneVertex-6IHcna3I.js";import{t as a}from"./sceneUboDeclaration-B5VhSG0v.js";import{t as o}from"./meshUboDeclaration-BmNu2KU_.js";import{t as s}from"./logDepthDeclaration-3gXGtHbI.js";import{t as c}from"./logDepthVertex-D5IUM6qd.js";var l=`lineVertexDeclaration`,u=`uniform mat4 viewProjection;
#define ADDITIONAL_VERTEX_DECLARATION
`;e.IncludesShadersStore[l]||(e.IncludesShadersStore[l]=u);var d={name:l,shader:u},f=`lineUboDeclaration`,p=`layout(std140,column_major) uniform;
#include<sceneUboDeclaration>
#include<meshUboDeclaration>
`;e.IncludesShadersStore[f]||(e.IncludesShadersStore[f]=p);var m={name:f,shader:p},h=`lineVertexShader`,g=`#include<__decl__lineVertex>
#include<instancesDeclaration>
#include<clipPlaneVertexDeclaration>
attribute vec3 position;attribute vec4 normal;uniform float width;uniform float aspectRatio;
#include<logDepthDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
#include<instancesVertex>
mat4 worldViewProjection=viewProjection*finalWorld;vec4 viewPosition=worldViewProjection*vec4(position,1.0);vec4 viewPositionNext=worldViewProjection*vec4(normal.xyz,1.0);vec2 currentScreen=viewPosition.xy/viewPosition.w;vec2 nextScreen=viewPositionNext.xy/viewPositionNext.w;currentScreen.x*=aspectRatio;nextScreen.x*=aspectRatio;vec2 dir=normalize(nextScreen-currentScreen);vec2 normalDir=vec2(-dir.y,dir.x);normalDir*=width/2.0;normalDir.x/=aspectRatio;vec4 offset=vec4(normalDir*normal.w,0.0,0.0);gl_Position=viewPosition+offset;
#if defined(CLIPPLANE) || defined(CLIPPLANE2) || defined(CLIPPLANE3) || defined(CLIPPLANE4) || defined(CLIPPLANE5) || defined(CLIPPLANE6)
vec4 worldPos=finalWorld*vec4(position,1.0);
#include<clipPlaneVertex>
#endif
#include<logDepthVertex>
#define CUSTOM_VERTEX_MAIN_END
}`;e.ShadersStore[h]||(e.ShadersStore[h]=g);var _=[d,a,o,m,t,r,s,n,i,c];for(let t of _)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var v={name:h,shader:g};export{v as t};