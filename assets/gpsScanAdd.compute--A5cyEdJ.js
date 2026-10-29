import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./gaussianPointSplattingScan-COj6jNKT.js";var n=`gpsScanAddComputeShader`,r=`#include<gaussianPointSplattingScan>
@group(0) @binding(0) var<storage,read_write> cdf : array<u32>;@group(0) @binding(1) var<storage,read> blockSums : array<u32>;@compute @workgroup_size(256,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {let i=gid.y*65535u*256u+gid.x;if (i>=arrayLength(&cdf)) {return;}
cdf[i]=gpsSaturatingAdd(cdf[i],blockSums[i/512u]);}
`;e.ShadersStoreWGSL[n]||(e.ShadersStoreWGSL[n]=r);var i=[t];for(let t of i)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var a={name:n,shader:r};export{a as t};