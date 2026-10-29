import{t as e}from"./shaderStore-D-XQlhUT.js";var t=`gaussianPointSplattingScan`,n=`const GpsMaxPointCount : u32=0xFFFFFF00u;fn gpsSaturatingAdd(a : u32,b : u32)->u32 {let sum=a+b;return select(GpsMaxPointCount,sum,sum>=a && sum<=GpsMaxPointCount);}
var<workgroup> gpsScanTemp : array<u32,512>;fn gpsScanExclusive512(t : u32)->u32 {var offset=1u;for (var d=256u; d>0u; d=d>>1u) {workgroupBarrier();if (t<d) {let ai=offset*(2u*t+1u)-1u;let bi=offset*(2u*t+2u)-1u;gpsScanTemp[bi]=gpsSaturatingAdd(gpsScanTemp[bi],gpsScanTemp[ai]);}
offset=offset<<1u;}
var total=0u;if (t==0u) {total=gpsScanTemp[511];gpsScanTemp[511]=0u; }
for (var d=1u; d<512u; d=d<<1u) {offset=offset>>1u;workgroupBarrier();if (t<d) {let ai=offset*(2u*t+1u)-1u;let bi=offset*(2u*t+2u)-1u;let s=gpsScanTemp[ai];gpsScanTemp[ai]=gpsScanTemp[bi];gpsScanTemp[bi]=gpsSaturatingAdd(gpsScanTemp[bi],s);}}
workgroupBarrier();return total;}
`;e.IncludesShadersStoreWGSL[t]||(e.IncludesShadersStoreWGSL[t]=n);var r={name:t,shader:n};export{r as t};