import{S as r}from"./index-Bv7rEvxk.js";const o="oitFinalSimpleBlendPixelShader",e=`precision highp float;uniform sampler2D uFrontColor;void main() {ivec2 fragCoord=ivec2(gl_FragCoord.xy);vec4 frontColor=texelFetch(uFrontColor,fragCoord,0);glFragColor=frontColor;}
`;r.ShadersStore[o]||(r.ShadersStore[o]=e);const l={name:o,shader:e};export{l as oitFinalSimpleBlendPixelShader};
