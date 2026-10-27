import force from '../traversal-baseline/bhForces.wgsl?raw';
import tree from '../traversal-baseline/bhTree.wgsl?raw';
import integrate from '../traversal-baseline/bodiesIntegrate.wgsl?raw';
import ropes from '../traversal-baseline/bhRopes.wgsl?raw';
import decode from './decodeInPlace.wgsl?raw';

export type Variant = {
  name: string; grid: number; workgroup: number; parallel?: boolean;
  packed?: boolean; treeParents?: boolean; indirect?: boolean; inplace?: boolean;
  fused?: boolean; precompute?: boolean; fusedPack?: boolean;
};

export const variants: Variant[] = [
  { name: 'baseline', grid: 64, workgroup: 64 },
  { name: 'parallel64', grid: 64, workgroup: 64, parallel: true },
  { name: 'parallel128', grid: 128, workgroup: 64, parallel: true },
  { name: 'wg32', grid: 64, workgroup: 32 },
  { name: 'wg128', grid: 64, workgroup: 128 },
  { name: 'packed', grid: 64, workgroup: 64, packed: true },
  { name: 'parallel128-packed', grid: 128, workgroup: 64, parallel: true, packed: true },
  { name: 'tree-parents', grid: 64, workgroup: 64, treeParents: true },
  { name: 'indirect', grid: 64, workgroup: 64, indirect: true },
  { name: 'parallel64-wg128', grid: 64, workgroup: 128, parallel: true },
  { name: 'parallel128-wg128', grid: 128, workgroup: 128, parallel: true },
  { name: 'parallel128-wg256', grid: 128, workgroup: 256, parallel: true },
  { name: 'parallel256-wg128', grid: 256, workgroup: 128, parallel: true },
  { name: 'parallel128-packed-wg128', grid: 128, workgroup: 128, parallel: true, packed: true },
  { name: 'inplace', grid: 64, workgroup: 64, inplace: true },
  { name: 'combined-inplace', grid: 128, workgroup: 128, parallel: true, inplace: true },
  { name: 'combined-inplace-packed', grid: 128, workgroup: 128, parallel: true, inplace: true, packed: true },
  { name: 'fused', grid: 128, workgroup: 128, parallel: true, inplace: true, fused: true },
  { name: 'precompute', grid: 128, workgroup: 128, parallel: true, inplace: true, fused: true, precompute: true },
  { name: 'precompute64', grid: 64, workgroup: 128, parallel: true, inplace: true, fused: true, precompute: true },
  { name: 'precompute256', grid: 128, workgroup: 256, parallel: true, inplace: true, fused: true, precompute: true },
  { name: 'precompute-packed', grid: 128, workgroup: 128, parallel: true, inplace: true, fused: true, precompute: true, packed: true, fusedPack: true },
  { name: 'fused256', grid: 128, workgroup: 256, parallel: true, inplace: true, fused: true },
  { name: 'fused64-wg256', grid: 64, workgroup: 256, parallel: true, inplace: true, fused: true },
  { name: 'wg256', grid: 64, workgroup: 256 },
];

export function forceSource(v: Variant) {
  let code = force.replace('FORCE_WORKGROUP_SIZE', String(v.workgroup));
  if (v.inplace) code = code
    .replace('let mass = f32(nodes[nodeIdx].massInt) / params.massScale;', 'let mass = bitcast<f32>(nodes[nodeIdx].comZInt);')
    .replace(/    let moment = [^\n]+\n/, '')
    .replace(/    let com = [^\n]+/, '    let com = vec3<f32>(bitcast<f32>(nodes[nodeIdx].massInt), bitcast<f32>(nodes[nodeIdx].comXInt), bitcast<f32>(nodes[nodeIdx].comYInt));');
  if (v.precompute) code = code.replace(/    let halfSize = [^\n]+\n/, '').replace(/    let size = [^\n]+\n/, '')
    .replace('(size * size)', 'nodes[nodeIdx].center.x')
    .replace('params.gravity * mass * invDist', 'mass * invDist');
  if (v.packed) code = code
    .replace('@compute @workgroup_size', '@group(0) @binding(5) var<storage, read> sources: array<vec4<f32>>;\n@compute @workgroup_size')
    .replace('let otherBody = bodies[otherBodyIdx];', 'let otherBody = sources[otherBodyIdx];')
    .replace('otherBody.pos', 'otherBody.xyz').replace('otherBody.mass', 'otherBody.w');
  return code;
}

export function decodeSource(v: Variant) {
  if (!v.precompute) return decode;
  return decode.replace('let mass = f32(weight) / params.massScale;', 'let mass = params.gravity * (f32(weight) / params.massScale);')
    .replace('  nodes[id.x].massInt =', '  let size = nodes[id.x].halfSize * 2.0;\n  nodes[id.x].center.x = size * size;\n  nodes[id.x].massInt =');
}

export function ropesSource(v: Variant) {
  if (!v.fused) return ropes;
  const code = decodeSource(v);
  const body = code.slice(code.indexOf('  let weight ='), code.lastIndexOf('}'));
  return ropes.replace('var<storage, read> nodes:', 'var<storage, read_write> nodes:')
    .replace('  ropes[id.x] = next;', '  ropes[id.x] = next;\n'+body);
}

export function integrateSource(v: Variant) {
  if (!v.fusedPack) return integrate;
  return integrate.replace('@compute @workgroup_size', '@group(0) @binding(3) var<storage, read_write> sources: array<vec4<f32>>;\n@compute @workgroup_size')
    .replace('  bodiesOut[id.x] = body;', '  bodiesOut[id.x] = body;\n  sources[id.x] = vec4<f32>(body.pos, body.mass);');
}

export function treeSource(v: Variant) {
  if (!v.treeParents) return tree;
  return tree.replace('var<workgroup> rootSums:', '@group(0) @binding(5) var<storage, read_write> parents: array<vec2<u32>>;\n\nvar<workgroup> rootSums:')
    .replace('// Success. Now we are at the new node.', 'parents[newNodeIdx] = vec2<u32>(u32(nodeIdx) + 1u, octant);\n          // Success. Now we are at the new node.');
}
