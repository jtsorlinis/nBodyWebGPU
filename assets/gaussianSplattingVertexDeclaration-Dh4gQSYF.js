import{t as e}from"./shaderStore-D-XQlhUT.js";var t=`gaussianSplattingVertexDeclaration`,n=`attribute vec3 position;attribute vec4 splatIndex0;attribute vec4 splatIndex1;attribute vec4 splatIndex2;attribute vec4 splatIndex3;uniform mat4 view;uniform mat4 projection;uniform mat4 world;uniform vec4 vEyePosition;
#ifdef PREPASS
uniform mat4 inverseProjection;
#endif
`;e.IncludesShadersStore[t]||(e.IncludesShadersStore[t]=n);var r={name:t,shader:n};export{r as t};