import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./morphTargetsVertexGlobalDeclaration-B4Uhgd1q.js";import{t as n}from"./morphTargetsVertexDeclaration-D7nvpAib.js";import{t as r}from"./bonesVertex-3u5jVDJW.js";import{t as i}from"./bakedVertexAnimation-CP3BNGXM.js";import{t as a}from"./vertexPullingDeclaration-bSzsf5ND.js";var o=`iblVoxelGridVertexShader`,s=`#include <bakedVertexAnimationDeclaration>
#include <bonesDeclaration>(attribute matricesIndices : vec4f;,,attribute matricesWeights : vec4f;,,attribute matricesIndicesExtra : vec4f;,,attribute matricesWeightsExtra : vec4f;,)
#include <helperFunctions>
#include <instancesDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<vertexPullingDeclaration>
uniform invWorldScale : mat4x4f;varying vNormalizedPosition : vec3f;flat varying f_swizzle : i32;fn calculateTriangleNormal(v0
: vec3<f32>,v1
: vec3<f32>,v2
: vec3<f32>)
->vec3<f32> {let edge1=v1-v0;let edge2=v2-v0;let triangleNormal=cross(edge1,edge2);let normalizedTriangleNormal=normalize(triangleNormal);return normalizedTriangleNormal;}
@vertex
fn main(input : VertexInputs)->FragmentInputs {
#include <morphTargetsVertexGlobal>
var triPositions: array<vec3f,3>;var thisTriIndex : u32=vertexInputs.vertexIndex; 
for (var i: u32=0u; i<3u; i=i+1u) {var provokingVertNum : u32=vertexInputs.vertexIndex/3*3;let vertIdx=vp_readVertexIndex(provokingVertNum+i);if (provokingVertNum+i==vertexInputs.vertexIndex) {thisTriIndex=i;}
var positionUpdated=vp_readPosition(uniforms.vp_position_info,vertIdx);
#include <instancesVertex>
let inputPosition: vec3f=positionUpdated;
#include <morphTargetsVertex>(vertexInputs.position\\),inputPosition),vertexInputs.vertexIndex,vertIdx)[0..maxSimultaneousMorphTargets]
#if NUM_BONE_INFLUENCERS>0
let matrixIndex=vp_readBoneIndices(uniforms.vp_matricesIndices_info,vertIdx);let matrixWeight=vp_readBoneWeights(uniforms.vp_matricesWeights_info,vertIdx);
#if NUM_BONE_INFLUENCERS>4
let matrixIndexExtra=vp_readBoneIndicesExtra(uniforms.vp_matricesIndicesExtra_info,vertIdx);let matrixWeightExtra=vp_readBoneWeightsExtra(uniforms.vp_matricesWeightsExtra_info,vertIdx);
#endif
#endif
#include<bonesVertex>(vertexInputs.matricesIndices,matrixIndex,vertexInputs.matricesWeights,matrixWeight,vertexInputs.matricesIndicesExtra,matrixIndexExtra,vertexInputs.matricesWeightsExtra,matrixWeightExtra)
#include<bakedVertexAnimation>(vertexInputs.matricesIndices,matrixIndex,vertexInputs.matricesWeights,matrixWeight,vertexInputs.matricesIndicesExtra,matrixIndexExtra,vertexInputs.matricesWeightsExtra,matrixWeightExtra)
triPositions[i]=(finalWorld*vec4(positionUpdated,1.0)).xyz;}
var N : vec3<f32>=calculateTriangleNormal(triPositions[0],triPositions[1],triPositions[2]);let worldPos=triPositions[thisTriIndex];vertexOutputs.position=uniforms.invWorldScale*vec4(worldPos,1.0);N=abs(N);if (N.x>N.y && N.x>N.z) {vertexOutputs.f_swizzle=0;vertexOutputs.position=vec4f(vertexOutputs.position.yzx,1.0);} else if (N.y>N.z) {vertexOutputs.f_swizzle=1;vertexOutputs.position=vec4f(vertexOutputs.position.zxy,1.0);} else {vertexOutputs.f_swizzle=2;vertexOutputs.position=vec4f(vertexOutputs.position.xyz,1.0);}
vertexOutputs.vNormalizedPosition=vertexOutputs.position.xyz*0.5+0.5;vertexOutputs.position.z =
vertexOutputs.vNormalizedPosition.z; }
`;e.ShadersStoreWGSL[o]||(e.ShadersStoreWGSL[o]=s);var c=[t,n,a,r,i];for(let t of c)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var l={name:o,shader:s};export{l as t};