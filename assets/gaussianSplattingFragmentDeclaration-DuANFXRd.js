import{t as e}from"./shaderStore-D-XQlhUT.js";import"./logDepthFragment-C5lxT4l1.js";import"./fogFragment-CKCGTcJi.js";var t=`gaussianSplattingFragmentDeclaration`,n=`vec4 gaussianColor(vec4 inColor)
{float A=-dot(vPosition,vPosition);if (A<-4.0) discard;float B=exp(A)*inColor.a;
#include<logDepthFragment>
vec3 color=inColor.rgb;
#ifdef FOG
#include<fogFragment>
#endif
return vec4(color,B);}
`;e.IncludesShadersStore[t]||(e.IncludesShadersStore[t]=n);var r={name:t,shader:n};export{r as t};