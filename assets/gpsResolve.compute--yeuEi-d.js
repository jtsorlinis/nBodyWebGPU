import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./gaussianPointSplatting-UwjdZPb8.js";var n=`gpsResolveComputeShader`,r=`#include<gaussianPointSplatting>
struct GpsResolveParams {resolution : vec2f, 
outResolution : vec2f,
depthNorm : vec2f, 
colorMask : vec2f, 
upsample : vec4f, 
misc2 : vec4f, 
projZ : vec4f, 
inverseProjection : mat4x4f,
occlusion : vec4f, };@group(0) @binding(0) var<storage,read_write> accumBuffer : array<vec4f>;@group(0) @binding(1) var<uniform> params : GpsResolveParams;@group(0) @binding(2) var<storage,read_write> imageBuffer : array<atomic<u32>>;@group(0) @binding(3) var<storage,read_write> accumDepth : array<f32>;@group(0) @binding(4) var<storage,read_write> hiZ : array<f32>; 
@group(0) @binding(5) var<storage,read_write> accumCount : array<u32>; 
const GPS_HIZ_FAR : f32=1e30; 
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {let res=vec2u(params.resolution); 
if (gid.x>=res.x || gid.y>=res.y) {return;}
let idx=gid.y*res.x+gid.x; 
let raw=atomicLoad(&imageBuffer[idx]);var hitColor=vec3f(0.0,0.0,0.0);var hit=0.0;var depth=1.0;var occlVz=GPS_HIZ_FAR;var viewZ=0.0;if (raw != GPS_DEPTH_CLEAR) {hitColor=gpsKeyColor(raw,u32(params.colorMask.x))*params.colorMask.y;hit=1.0;let dq=f32(raw>>16u)/f32(GPS_DEPTH_MAX_CODE);let vz=params.depthNorm.x+dq*(params.depthNorm.y-params.depthNorm.x);occlVz=vz+(params.depthNorm.y-params.depthNorm.x)/f32(GPS_DEPTH_MAX_CODE);depth=(params.projZ.x*vz+params.projZ.z)/(params.projZ.y*vz+params.projZ.w);if (params.misc2.w>0.5) {depth=select(vz,1.0-vz,params.misc2.z>0.5);let outputPixel=vec2f(gid.xy)*params.upsample.x+params.upsample.yz+0.5;let ndcXY=outputPixel/params.outResolution*2.0-1.0;let unprojected=params.inverseProjection*vec4f(ndcXY,depth,1.0);viewZ=unprojected.z/unprojected.w;}}
if (params.occlusion.x>0.5) {hiZ[idx]=occlVz;}
atomicStore(&imageBuffer[idx],GPS_DEPTH_CLEAR);let n=u32(params.upsample.x);let outRes=vec2u(params.outResolution);let gen=u32(params.upsample.w);let premult=hitColor*hit;if (params.misc2.y>0.5) {for (var dy=0u; dy<n; dy=dy+1u) {for (var dx=0u; dx<n; dx=dx+1u) {let ox2=gid.x*n+dx;let oy2=gid.y*n+dy;if (ox2<outRes.x && oy2<outRes.y) {let oi=oy2*outRes.x+ox2;var outputDepth=depth;var outputHit=hit;if (params.misc2.w>0.5 && hit>0.5) {let ndcXY=(vec2f(f32(ox2),f32(oy2))+0.5)/params.outResolution*2.0-1.0;let projected=gpsProjectedDepth(params.inverseProjection,ndcXY,viewZ);outputDepth=projected.x;outputHit=select(0.0,hit,projected.x>=0.0 && projected.x<=1.0 && projected.y>0.0);}
accumBuffer[oi]=vec4f(hitColor*outputHit,outputHit);accumCount[oi]=(gen<<16u) | 1u;accumDepth[oi]=select(1.0,outputDepth,outputHit>0.5);}}}
return;}
let ox=select(0u,u32(params.upsample.y),n>1u);let oy=select(0u,u32(params.upsample.z),n>1u);let outX=gid.x*n+ox;let outY=gid.y*n+oy;if (outX>=outRes.x || outY>=outRes.y) {return;}
let outIdx=outY*outRes.x+outX;let packed=accumCount[outIdx];let count=select(0u,packed & 0xFFFFu,(packed>>16u)==gen);let t=select(1.0/(f32(count)+1.0),1.0,count==0u);let prev=accumBuffer[outIdx];let newRgb=mix(prev.rgb,premult,t);let newCov=mix(prev.w,hit,t);accumBuffer[outIdx]=vec4f(newRgb,newCov);accumCount[outIdx]=(gen<<16u) | min(count+1u,u32(params.misc2.x));if (hit>0.5) {accumDepth[outIdx]=depth;} else if (count==0u) {accumDepth[outIdx]=1.0;}}
`;e.ShadersStoreWGSL[n]||(e.ShadersStoreWGSL[n]=r);var i=[t];for(let t of i)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var a={name:n,shader:r};export{a as t};