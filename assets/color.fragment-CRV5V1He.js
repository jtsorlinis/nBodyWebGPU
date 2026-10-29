import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./clipPlaneFragmentDeclaration-LJdlhFDo.js";import{t as n}from"./clipPlaneFragment-B_IgbgTE.js";import{t as r}from"./fogFragmentDeclaration-kXoGw5iI.js";import{t as i}from"./fogFragment-CKCGTcJi.js";var a=`colorPixelShader`,o=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
#define VERTEXCOLOR
varying vec4 vColor;
#else
uniform vec4 color;
#endif
#include<clipPlaneFragmentDeclaration>
#include<fogFragmentDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
gl_FragColor=vColor;
#else
gl_FragColor=color;
#endif
#include<fogFragment>(color,gl_FragColor)
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[a]||(e.ShadersStore[a]=o);var s=[t,r,n,i];for(let t of s)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var c={name:a,shader:o};export{c as t};