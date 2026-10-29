import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./helperFunctions-gEnZbjN3.js";import{t as n}from"./logDepthDeclaration-3gXGtHbI.js";import{t as r}from"./fogFragmentDeclaration-kXoGw5iI.js";import{t as i}from"./logDepthFragment-C5lxT4l1.js";import{t as a}from"./fogFragment-CKCGTcJi.js";import{t as o}from"./objectIdFunctions-BCg-H1o3.js";import{t as s}from"./prePassDeclaration-BXhzfxgD.js";import{t as c}from"./geometryRenderingFragment-DZg0Y277.js";var l=`imageProcessingCompatibility`,u=`#ifdef IMAGEPROCESSINGPOSTPROCESS
gl_FragColor.rgb=pow(gl_FragColor.rgb,vec3(2.2));
#endif
`;e.IncludesShadersStore[l]||(e.IncludesShadersStore[l]=u);var d={name:l,shader:u},f=`spritesPixelShader`,p=`#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
#include<prePassDeclaration>[SCENE_MRT_COUNT]
uniform bool alphaTest;varying vec4 vColor;
#ifdef PREPASS
uniform float geometryZeroAlphaDiscard;
#ifdef PREPASS_POSITION
varying vec3 vPositionW;
#endif
#ifdef PREPASS_NORMAL
varying vec3 vNormalV;
#endif
#ifdef PREPASS_WORLD_NORMAL
varying vec3 vNormalW;
#endif
#endif
varying vec2 vUV;uniform sampler2D diffuseSampler;
#include<fogFragmentDeclaration>
#include<logDepthDeclaration>
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
#ifdef PIXEL_PERFECT
vec2 uvPixelPerfect(vec2 uv) {vec2 res=vec2(textureSize(diffuseSampler,0));uv=uv*res;vec2 seam=floor(uv+0.5);uv=seam+clamp((uv-seam)/fwidth(uv),-0.5,0.5);return uv/res;}
#endif
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#ifdef PIXEL_PERFECT
vec2 uv=uvPixelPerfect(vUV);
#else
vec2 uv=vUV;
#endif
vec4 color=texture2D(diffuseSampler,uv);float fAlphaTest=float(alphaTest);if (fAlphaTest != 0.)
{if (color.a<0.95)
discard;}
color*=vColor;
#ifdef PREPASS
#if defined(PREPASS_ALBEDO) || defined(PREPASS_ALBEDO_SQRT)
vec3 geometryAlbedo=toLinearSpace(color.rgb);
#endif
if (fAlphaTest==0.0 && color.a==0.0 && geometryZeroAlphaDiscard>0.0) {discard;}
#endif
#include<logDepthFragment>
#include<fogFragment>
gl_FragColor=color;
#include<imageProcessingCompatibility>
#ifdef PREPASS
vec4 geometryColor=gl_FragColor;
#ifdef PREPASS_POSITION
vec3 geometryPositionW=vPositionW;
#endif
#ifdef PREPASS_LOCAL_POSITION
vec3 geometryPositionL=vPosition;
#endif
#ifdef PREPASS_DEPTH
float geometryViewDepth=vViewPos.z;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
float geometryNormalizedViewDepth=vNormViewDepth;
#endif
#ifdef PREPASS_NORMAL
vec3 geometryNormalV=vNormalV;
#endif
#ifdef PREPASS_WORLD_NORMAL
vec3 geometryNormalW=vNormalW;
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
vec4 geometryCurrentPosition=vCurrentPosition;vec4 geometryPreviousPosition=vPreviousPosition;
#endif
#include<geometryRenderingFragment>
#endif
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[f]||(e.ShadersStore[f]=p);var m=[o,s,r,n,t,i,a,d,c];for(let t of m)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var h={name:f,shader:p};export{h as t};