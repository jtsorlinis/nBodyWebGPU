import source from '../physics-baseline/bhForces.wgsl?raw';

export const baselineForce = source.replace('FORCE_WORKGROUP_SIZE', '64');

export function directLoads(code: string) {
  return code.replace('    let node = nodes[nodeIdx]; // Read from global memory (cached)', '')
    .replaceAll('node.', 'nodes[nodeIdx].');
}

export function unrollChildren(code: string) {
  const start = code.indexOf('for (var i = 0; i < 8; i++)');
  const open = code.indexOf('{', start);
  let depth = 1, end = open + 1;
  while (depth) { if (code[end] === '{') depth++; if (code[end] === '}') depth--; end++; }
  const body = code.slice(open + 1, end - 1).replace('if (child == -1) { continue; }', 'if (child != -1) {');
  return code.slice(0, start) + Array.from({ length: 8 }, (_, i) => '{' + body.replaceAll('children[i]', `children[${i}]`) + '}}').join('\n') + code.slice(end);
}

export function orderedForce(code: string) {
  return code.replace('@compute @workgroup_size', '@group(0) @binding(3) var<storage, read> bodyOrder: array<u32>;\n\n@compute @workgroup_size')
    .replace('  var body = bodies[id.x];', '  let bodyIndex = bodyOrder[id.x];\n  var body = bodies[bodyIndex];')
    .replace('!= id.x', '!= bodyIndex').replaceAll('bodies[id.x]', 'bodies[bodyIndex]');
}

export function decodedForce(code: string) {
  const binding = code.includes('bodyOrder:') ? 4 : 3;
  return code.replace('@compute @workgroup_size', `@group(0) @binding(${binding}) var<storage, read> aggregates: array<vec4<f32>>;\n\n@compute @workgroup_size`)
    .replace(/    let mass = f32\((?:node|nodes\[nodeIdx\])\.massInt\) \/ params.massScale;/,
      '    let aggregate = aggregates[nodeIdx];\n    let mass = aggregate.w;')
    .replace(/    let moment = vec3\([^\n]+\n/, '')
    .replace(/    let com = [^\n]+/, '    let com = aggregate.xyz;');
}

export function ropeForce(code: string) {
  const binding = code.includes('bodyOrder:') ? 4 : 3;
  return code.replace('@compute @workgroup_size', `@group(0) @binding(${binding}) var<storage, read> ropes: array<i32>;\n\n@compute @workgroup_size`)
    .replace(/  \/\/ Stack for traversal[\s\S]*?  let thetaSq/, '  var nextNode = 0;\n  let thetaSq')
    .replace(/  while \(stackPtr > 0\) \{\s*stackPtr--;\s*let nodeIdx = stack\[stackPtr\];/,
      '  while (nextNode >= 0) {\n    let nodeIdx = nextNode;\n    nextNode = ropes[nodeIdx];')
    .replace(/if \(stackPtr < 256\) \{\s*stack\[stackPtr\] = child;\s*stackPtr\+\+;\s*\}/, 'nextNode = child;');
}
