import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./gaussianPointSplattingScan-COj6jNKT.js";var n=`gpsScanSumsComputeShader`,r=`#include<gaussianPointSplattingScan>
@group(0) @binding(0) var<storage,read_write> blockSums : array<u32>;@group(0) @binding(1) var<storage,read_write> pointCount : array<u32>;@group(0) @binding(2) var<storage,read_write> indirectArgs : array<u32>;var<workgroup> wgCarry : u32;var<workgroup> wgChunkTotal : u32;@compute @workgroup_size(256,1,1)
fn main(@builtin(local_invocation_id) lid : vec3u) {let t=lid.x;let n=arrayLength(&blockSums);if (t==0u) {wgCarry=0u;}
workgroupBarrier();var chunk=0u;loop {if (chunk>=n) {break;}
let i0=chunk+2u*t;let i1=chunk+2u*t+1u;gpsScanTemp[2u*t]=select(0u,blockSums[i0],i0<n);gpsScanTemp[2u*t+1u]=select(0u,blockSums[i1],i1<n);let total=gpsScanExclusive512(t);if (t==0u) {wgChunkTotal=total;}
workgroupBarrier();if (i0<n) {blockSums[i0]=gpsSaturatingAdd(gpsScanTemp[2u*t],wgCarry);}
if (i1<n) {blockSums[i1]=gpsSaturatingAdd(gpsScanTemp[2u*t+1u],wgCarry);}
workgroupBarrier();if (t==0u) {wgCarry=gpsSaturatingAdd(wgCarry,wgChunkTotal);}
workgroupBarrier();chunk=chunk+512u;}
if (t==0u) {let totalGroups=wgCarry/256u+select(0u,1u,(wgCarry % 256u) != 0u);let gx=min(totalGroups,65535u);let gy=totalGroups/65535u+select(0u,1u,(totalGroups % 65535u) != 0u);pointCount[0]=wgCarry; 
pointCount[1]=totalGroups; 
indirectArgs[0]=gx;indirectArgs[1]=gy;indirectArgs[2]=1u;}}
`;e.ShadersStoreWGSL[n]||(e.ShadersStoreWGSL[n]=r);var i=[t];for(let t of i)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var a={name:n,shader:r};export{a as t};