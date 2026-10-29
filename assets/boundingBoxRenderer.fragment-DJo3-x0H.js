import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./boundingBoxRendererUboDeclaration-p4IHL4lf.js";var n=`boundingBoxRendererFragmentDeclaration`,r=`uniform vec4 color;
`;e.IncludesShadersStore[n]||(e.IncludesShadersStore[n]=r);var i={name:n,shader:r},a=`boundingBoxRendererPixelShader`,o=`#include<__decl__boundingBoxRendererFragment>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
gl_FragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[a]||(e.ShadersStore[a]=o);var s=[i,t];for(let t of s)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var c={name:a,shader:o};export{c as t};