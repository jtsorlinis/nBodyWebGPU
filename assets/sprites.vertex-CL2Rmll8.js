import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./fogVertexDeclaration-Bb9kDbrL.js";import{t as n}from"./logDepthDeclaration-3gXGtHbI.js";import{t as r}from"./logDepthVertex-D5IUM6qd.js";var i=`spritesVertexShader`,a=`attribute vec4 position;attribute vec2 options;attribute vec2 offsets;attribute vec2 inverts;attribute vec4 cellInfo;attribute vec4 color;uniform mat4 view;uniform mat4 projection;
#ifdef PREPASS
#if defined(PREPASS_POSITION) || defined(PREPASS_WORLD_NORMAL)
uniform mat4 invView;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
uniform vec2 cameraInfo;
#endif
#if defined(PREPASS_NORMAL) || defined(PREPASS_WORLD_NORMAL)
uniform float spriteNormalSign;
#endif
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
attribute vec4 previousPosition;attribute vec2 previousOptions;uniform mat4 previousView;uniform mat4 previousProjection;
#endif
varying vec2 vUV;varying vec4 vColor;
#ifdef PREPASS
#ifdef PREPASS_POSITION
varying vec3 vPositionW;
#endif
#ifdef PREPASS_LOCAL_POSITION
varying vec3 vPosition;
#endif
#ifdef PREPASS_DEPTH
varying vec3 vViewPos;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
varying float vNormViewDepth;
#endif
#ifdef PREPASS_NORMAL
varying vec3 vNormalV;
#endif
#ifdef PREPASS_WORLD_NORMAL
varying vec3 vNormalW;
#endif
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
varying vec4 vCurrentPosition;varying vec4 vPreviousPosition;
#endif
#include<fogVertexDeclaration>
#include<logDepthDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 viewPos=(view*vec4(position.xyz,1.0)).xyz; 
vec2 cornerPos;float angle=position.w;vec2 size=vec2(options.x,options.y);vec2 offset=offsets.xy;cornerPos=vec2(offset.x-0.5,offset.y -0.5)*size;vec3 rotatedCorner;rotatedCorner.x=cornerPos.x*cos(angle)-cornerPos.y*sin(angle);rotatedCorner.y=cornerPos.x*sin(angle)+cornerPos.y*cos(angle);rotatedCorner.z=0.;viewPos+=rotatedCorner;gl_Position=projection*vec4(viewPos,1.0); 
#ifdef PREPASS
#ifdef PREPASS_POSITION
vec4 worldPos=invView*vec4(viewPos,1.0);vPositionW=worldPos.xyz/worldPos.w;
#endif
#ifdef PREPASS_LOCAL_POSITION
vPosition=rotatedCorner;
#endif
#ifdef PREPASS_DEPTH
vViewPos=viewPos;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
vNormViewDepth=(viewPos.z-cameraInfo.x)/(cameraInfo.y-cameraInfo.x);
#endif
#ifdef PREPASS_NORMAL
vNormalV=vec3(0.0,0.0,spriteNormalSign);
#endif
#ifdef PREPASS_WORLD_NORMAL
vNormalW=normalize((invView*vec4(0.0,0.0,spriteNormalSign,0.0)).xyz);
#endif
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
vec3 previousViewPos=(previousView*vec4(previousPosition.xyz,1.0)).xyz;vec2 previousCornerPos=vec2(offset.x-0.5,offset.y-0.5)*previousOptions;vec3 previousRotatedCorner;previousRotatedCorner.x=previousCornerPos.x*cos(previousPosition.w)-previousCornerPos.y*sin(previousPosition.w);previousRotatedCorner.y=previousCornerPos.x*sin(previousPosition.w)+previousCornerPos.y*cos(previousPosition.w);previousRotatedCorner.z=0.0;previousViewPos+=previousRotatedCorner;vCurrentPosition=gl_Position;vPreviousPosition=previousProjection*vec4(previousViewPos,1.0);
#endif
vColor=color;vec2 uvOffset=vec2(abs(offset.x-inverts.x),abs(1.0-offset.y-inverts.y));vec2 uvPlace=cellInfo.xy;vec2 uvSize=cellInfo.zw;vUV.x=uvPlace.x+uvSize.x*uvOffset.x;vUV.y=uvPlace.y+uvSize.y*uvOffset.y;
#ifdef FOG
vFogDistance=viewPos;
#endif
#include<logDepthVertex>
#define CUSTOM_VERTEX_MAIN_END
}`;e.ShadersStore[i]||(e.ShadersStore[i]=a);var o=[t,n,r];for(let t of o)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var s={name:i,shader:a};export{s as t};