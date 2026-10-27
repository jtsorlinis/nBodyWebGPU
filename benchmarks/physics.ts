import { initialBodies, options, report, status, summarize } from './common';
import integrateSource from './physics-baseline/bodiesIntegrate.wgsl?raw';
import prepareSource from './physics-baseline/bhPrepare.wgsl?raw';
import clearSource from './physics-baseline/bhClear.wgsl?raw';
import boundsSource from './physics-baseline/bhBounds.wgsl?raw';
import treeSource from './physics-baseline/bhTree.wgsl?raw';
import { baselineForce, directLoads, unrollChildren, orderedForce, decodedForce, ropeForce } from './physics-candidates/variants';
import orderKeys from './physics-candidates/orderKeys.wgsl?raw';
import orderScan from './physics-candidates/orderScan.wgsl?raw';
import orderScatter from './physics-candidates/orderScatter.wgsl?raw';
import orderClear from './physics-candidates/orderClear.wgsl?raw';
import decodeNodes from './physics-candidates/decodeNodes.wgsl?raw';
import parentsSource from './physics-candidates/parents.wgsl?raw';
import ropesSource from './physics-candidates/ropes.wgsl?raw';
import productionForce from './traversal-baseline/bhForces.wgsl?raw';
import round2Parents from './traversal-baseline/bhParents.wgsl?raw';
import round2Ropes from './traversal-baseline/bhRopes.wgsl?raw';
import round2Clear from './traversal-baseline/bhOrderClear.wgsl?raw';
import round2Keys from './traversal-baseline/bhOrderKeys.wgsl?raw';
import round2Scan from './traversal-baseline/bhOrderScan.wgsl?raw';
import round2Scatter from './traversal-baseline/bhOrderScatter.wgsl?raw';

const BH_FORCE_WORKGROUP_SIZE = 64, BH_ORDER_GRID_SIZE = 64;
const bhTraversalSources = {parents:round2Parents,ropes:round2Ropes,orderClear:round2Clear,
  orderKeys:round2Keys.replaceAll('GRID_SIZE','64u'),orderScan:round2Scan.replaceAll('BIN_COUNT','262144u'),orderScatter:round2Scatter};

type Variant = { name: string; source: string; workgroup: number; grid?: number; decode?: boolean; rope?: boolean };

export async function benchmarkPhysics() {
  const production = options.has('round2');
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || !adapter.features.has('timestamp-query')) throw new Error('WebGPU timestamp queries required');
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'], requiredLimits: {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize,
  } });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', e => { errors.push(e.error.message); void report({ type: 'gpu-error', error: e.error.message }); });
  device.lost.then(info => { if (info.reason !== 'destroyed') errors.push(info.message); });
  await report({ type: 'physics-environment', baselineCommit: '4e790f3', vendor: adapter.info.vendor,
    architecture: adapter.info.architecture, userAgent: navigator.userAgent });
  const makeBuffer = (size: number, extra = 0, uniform = false) => device.createBuffer({ size,
    usage: (uniform ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE) | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | extra });
  const makePipeline = async (label: string, code: string) => {
    const module = device.createShaderModule({ label, code });
    const info = await module.getCompilationInfo();
    const messages = info.messages.filter(m => m.type === 'error');
    if (messages.length) throw new Error(label + ': ' + messages.map(m => `${m.lineNum}: ${m.message}`).join('\n'));
    return device.createComputePipelineAsync({ label, layout: 'auto', compute: { module, entryPoint: 'main' } });
  };
  const bind = (pipeline: GPUComputePipeline, buffers: GPUBuffer[]) => device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
    entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const read = async (buffer: GPUBuffer, size = buffer.size) => {
    const staging = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ);
    const result = staging.getMappedRange().slice(0); staging.unmap(); staging.destroy(); return result;
  };
  const pipelines = {
    integrate: await makePipeline('integrate', integrateSource), prepare: await makePipeline('prepare', prepareSource),
    clear: await makePipeline('clear', clearSource), bounds: await makePipeline('bounds', boundsSource),
    tree: await makePipeline('tree', treeSource),
    decode: await makePipeline('decode', decodeNodes),
    parents: await makePipeline('parents', production ? bhTraversalSources.parents : parentsSource),
    ropes: await makePipeline('ropes', production ? bhTraversalSources.ropes : ropesSource),
  };
  const allVariants: Variant[] = [
    { name: 'baseline', source: baselineForce, workgroup: 64 },
    { name: 'direct-loads', source: directLoads(baselineForce), workgroup: 64 },
    { name: 'unrolled', source: unrollChildren(directLoads(baselineForce)), workgroup: 64 },
    { name: 'wg32', source: baselineForce.replace('@workgroup_size(64)', '@workgroup_size(32)'), workgroup: 32 },
    { name: 'order16', source: orderedForce(baselineForce), workgroup: 64, grid: 16 },
    { name: 'order32', source: orderedForce(baselineForce), workgroup: 64, grid: 32 },
    { name: 'order64', source: orderedForce(baselineForce), workgroup: 64, grid: 64 },
    { name: 'loads-order32', source: orderedForce(directLoads(baselineForce)), workgroup: 64, grid: 32 },
    { name: 'loads-order64', source: orderedForce(directLoads(baselineForce)), workgroup: 64, grid: 64 },
    { name: 'decode', source: decodedForce(baselineForce), workgroup: 64, decode: true },
    { name: 'decode-loads', source: decodedForce(directLoads(baselineForce)), workgroup: 64, decode: true },
    { name: 'decode-order32', source: decodedForce(orderedForce(directLoads(baselineForce))), workgroup: 64, grid: 32, decode: true },
    { name: 'decode-order64', source: decodedForce(orderedForce(directLoads(baselineForce))), workgroup: 64, grid: 64, decode: true },
    { name: 'rope', source: ropeForce(directLoads(baselineForce)), workgroup: 64, rope: true },
    { name: 'rope-order32', source: ropeForce(orderedForce(directLoads(baselineForce))), workgroup: 64, grid: 32, rope: true },
    { name: 'rope-order64', source: ropeForce(orderedForce(directLoads(baselineForce))), workgroup: 64, grid: 64, rope: true },
  ];
  const selection = options.get('physics');
  const variants: Variant[] = production ? [allVariants[0], {
    name: 'production', source: productionForce.replace('FORCE_WORKGROUP_SIZE', String(BH_FORCE_WORKGROUP_SIZE)),
    workgroup: BH_FORCE_WORKGROUP_SIZE, grid: BH_ORDER_GRID_SIZE, rope: true,
  }] : allVariants.filter(v => selection === 'suite' || v.name === 'baseline' || v.name === selection
    || (selection === 'ordering' && v.grid && !v.decode && !v.rope)
    || (selection === 'decode-suite' && (v.decode || v.name.startsWith('loads-order')))
    || (selection === 'rope-suite' && (v.rope || v.name.startsWith('loads-order'))));
  if (variants.length < 2) throw new Error('Select a physics variant or use &production');
  const forcePipelines = await Promise.all(variants.map(v => makePipeline(v.name, v.source)));
  const orderPipelines = await Promise.all(variants.map(async v => v.grid ? {
    clear: await makePipeline('order-clear', production ? bhTraversalSources.orderClear : orderClear),
    keys: await makePipeline('order-keys', production ? bhTraversalSources.orderKeys : orderKeys.replaceAll('GRID_SIZE', `${v.grid}u`)),
    scan: await makePipeline('order-scan', production ? bhTraversalSources.orderScan : orderScan.replaceAll('BIN_COUNT', `${v.grid**3}u`)),
    scatter: await makePipeline('order-scatter', production ? bhTraversalSources.orderScatter : orderScatter),
  } : undefined));
  const counts = options.has('edge') ? [1, 2, 63, 65, 255, 257, 4097] : options.has('quick') ? [131072] : [4096, 131072, 262144];
  const seed = Number(options.get('seed') ?? 123456789);
  const gravity = Number(options.get('gravity') ?? 5);
  const steps = options.has('evolve') ? 120 : 24;
  const mode = options.has('evolve') || production ? 'full' : options.get('mode') ?? 'paired';
  for (const count of counts) for (const twin of (count < 4097 || options.has('quick') || options.has('edge') ? [false] : [false, true])) {
    status.textContent = `Physics ${count}, twin=${twin}, ${mode}`;
    const data = initialBodies(count, twin, seed), maxNodes = count * 8;
    if (options.get('shape') === 'clustered') for (let i=0;i<count;i++) for (let k=0;k<3;k++) data[i*12+k] *= .01;
    if (options.get('shape') === 'outlier') data[(count-1)*12] = 1e6;
    const params = makeBuffer(32, 0, true);
    const p = new ArrayBuffer(32), f = new Float32Array(p), u = new Uint32Array(p);
    u[0] = count; f[1] = gravity; f[2] = 1/60; f[3] = count/2; f[4] = 3; f[5] = .5; u[6] = maxNodes;
    f[7] = Math.floor(0x7fffffff / ((count * 1.5 + (twin ? 2 : 1) * count / 2) * 1.1));
    device.queue.writeBuffer(params, 0, p);
    const bodiesIn = makeBuffer(data.byteLength), bodies = makeBuffer(data.byteLength), savedBodies = makeBuffer(data.byteLength);
    const nextInputs = makeBuffer(data.byteLength);
    const nodes = makeBuffer(maxNodes*64), allocator = makeBuffer(4), bounds = makeBuffer(24), clearArgs = makeBuffer(16, GPUBufferUsage.INDIRECT);
    const aggregates = makeBuffer(maxNodes*16);
    const parents = makeBuffer(maxNodes*8), ropes = makeBuffer(maxNodes*4);
    device.queue.writeBuffer(bodiesIn, 0, data); device.queue.writeBuffer(allocator, 0, new Uint32Array([maxNodes]));
    const groups = { integrate: bind(pipelines.integrate, [params,bodiesIn,bodies]), prepare: bind(pipelines.prepare,[params,allocator,bounds,clearArgs]),
      clear: bind(pipelines.clear,[params,nodes,clearArgs]), bounds: bind(pipelines.bounds,[params,bodies,bounds]),
      tree: bind(pipelines.tree,[params,bodies,nodes,allocator,bounds]) };
    const decodeGroup = bind(pipelines.decode,[params,nodes,allocator,aggregates]);
    const parentsGroup = bind(pipelines.parents,[params,nodes,allocator,parents]);
    const ropesGroup = bind(pipelines.ropes,[params,nodes,allocator,parents,ropes]);
    const orderResources = variants.map((v,i) => {
      if (!v.grid) return undefined;
      const counts = makeBuffer(v.grid**3 * 4), ranks = makeBuffer(count*8), order = makeBuffer(count*4);
      const p = orderPipelines[i]!;
      return { counts, ranks, order, groups: { clear: bind(p.clear,[counts]), keys: bind(p.keys,[params,bodies,bounds,counts,ranks]),
        scan: bind(p.scan,[counts]), scatter: bind(p.scatter,[params,counts,ranks,order]) } };
    });
    const forceGroups = forcePipelines.map((p,i) => bind(p,[params,bodies,nodes,...(orderResources[i] ? [orderResources[i]!.order] : []),...(variants[i].decode ? [aggregates] : []),...(variants[i].rope ? [ropes] : [])]));
    const queries = device.createQuerySet({ type: 'timestamp', count: 2 });
    const resolved = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const encodeBuild = (encoder: GPUCommandEncoder, timed = false) => {
      for (const name of ['integrate','prepare','clear','bounds','tree'] as const) {
        const pass = encoder.beginComputePass(timed && name === 'integrate' ? { timestampWrites: { querySet: queries, beginningOfPassWriteIndex: 0 } } : {});
        pass.setPipeline(pipelines[name]); pass.setBindGroup(0,groups[name]);
        if (name === 'clear') pass.dispatchWorkgroupsIndirect(clearArgs,0);
        else pass.dispatchWorkgroups(name === 'prepare' ? 1 : Math.ceil(count/256)); pass.end();
      }
    };
    const build = device.createCommandEncoder(); encodeBuild(build);
    build.copyBufferToBuffer(bodies,0,savedBodies,0,data.byteLength); device.queue.submit([build.finish()]);
    const measurements: number[][] = variants.map(() => []);
    const comparisons = variants.map(v => ({variant:v.name,finite:true,maxAccelerationDifference:0,maxVelocityDifference:0,maxPositionDifference:0,relativeRms:0,checkedStates:0}));
    let cpuCheck: Record<string, number> = {};
    let treeCheck: Record<string, unknown> = {};
    const validateTree = async (checkRopes: boolean) => {
      const used = new Uint32Array(await read(allocator))[0];
      if (used > maxNodes) throw new Error('Allocator overflow');
      const tree = new Int32Array(await read(nodes, used*64));
      const links = checkRopes ? new Int32Array(await read(ropes,used*4)) : undefined;
      const visited = new Uint8Array(used), leaves = new Uint8Array(count), traversal: number[] = [], ends = new Uint32Array(used);
      const walk = (node: number, depth: number) => {
        if (node < 0 || node >= used || visited[node] || depth > 32) throw new Error('Invalid tree topology');
        visited[node] = 1; traversal.push(node);
        for (let c=0;c<8;c++) { const child=tree[node*16+8+c]; if(child<=-2) { const index=-child-2;
          if(index>=count || leaves[index]) throw new Error('Duplicate or invalid leaf'); leaves[index]=1; } }
        for (let c=7;c>=0;c--) { const child=tree[node*16+8+c]; if(child>=0) walk(child,depth+1); }
        ends[node] = traversal.length;
      };
      walk(0,0);
      if (!leaves.every(x=>x===1)) throw new Error('Missing body in tree');
      if (links) for (const node of traversal) if(links[node] !== (traversal[ends[node]] ?? -1)) throw new Error('Wrong subtree successor');
      treeCheck = {usedNodes:used,reachableNodes:traversal.length,allBodiesInTree:true,...(links ? {validSuccessors:true}: {})};
    };
    for (let round = -4; round < steps; round++) {
      const order = variants.map((_,i)=>i); if (round >= 0 && round % 2) order.reverse();
      const checkState = round === -4 || round === steps-1 || options.has('evolve');
      const snapshots: Float32Array[] = [];
      for (const i of order) {
        const encoder = device.createCommandEncoder();
        if (mode === 'full') encodeBuild(encoder,true);
        else encoder.copyBufferToBuffer(savedBodies,0,bodies,0,data.byteLength);
        const pass = encoder.beginComputePass({ timestampWrites: { querySet: queries, ...(mode === 'full' ? {} : {beginningOfPassWriteIndex:0}), endOfPassWriteIndex: 1 } });
        if (variants[i].decode) {
          pass.setPipeline(pipelines.decode); pass.setBindGroup(0,decodeGroup); pass.dispatchWorkgroups(Math.ceil(maxNodes/256));
        }
        if (variants[i].rope) {
          pass.setPipeline(pipelines.parents); pass.setBindGroup(0,parentsGroup); pass.dispatchWorkgroups(Math.ceil(maxNodes/256));
          pass.setPipeline(pipelines.ropes); pass.setBindGroup(0,ropesGroup); pass.dispatchWorkgroups(Math.ceil(maxNodes/256));
        }
        if (orderResources[i]) {
          for (const name of ['clear','keys','scan','scatter'] as const) {
            pass.setPipeline(orderPipelines[i]![name]); pass.setBindGroup(0,orderResources[i]!.groups[name]);
            pass.dispatchWorkgroups(name === 'scan' ? 1 : Math.ceil((name === 'clear' ? variants[i].grid!**3 : count)/256));
          }
        }
        pass.setPipeline(forcePipelines[i]); pass.setBindGroup(0,forceGroups[i]);
        pass.dispatchWorkgroups(Math.ceil(count/variants[i].workgroup)); pass.end();
        if (options.has('evolve') && i === 0) encoder.copyBufferToBuffer(bodies,0,nextInputs,0,data.byteLength);
        encoder.resolveQuerySet(queries,0,2,resolved,0); device.queue.submit([encoder.finish()]);
        const ticks = new BigUint64Array(await read(resolved));
        if (round >= 0) measurements[i].push(Number(ticks[1]-ticks[0])/1e6);
        if (checkState) {
          snapshots[i] = new Float32Array(await read(bodies));
          if (orderResources[i]) {
            const permutation = new Uint32Array(await read(orderResources[i]!.order));
            const seen = new Uint8Array(count);
            for (const index of permutation) { if (index >= count || seen[index]) throw new Error('Invalid body permutation'); seen[index] = 1; }
            Object.assign(comparisons[i], {validPermutation:true});
          }
          if (round === steps-1 && variants[i].rope) await validateTree(true);
        }
      }
      if (checkState) {
        const baseline = snapshots[0];
        for (let i=0;i<variants.length;i++) {
          const actual = snapshots[i];
          let maxAcc = 0, maxVel = 0, maxPos = 0, sumDiff = 0, sumRef = 0;
          for (let b=0;b<count;b++) for (let k=0;k<3;k++) {
            maxPos = Math.max(maxPos,Math.abs(actual[b*12+k]-baseline[b*12+k]));
            maxVel = Math.max(maxVel,Math.abs(actual[b*12+4+k]-baseline[b*12+4+k]));
            const d = actual[b*12+8+k]-baseline[b*12+8+k];
            maxAcc = Math.max(maxAcc,Math.abs(d)); sumDiff+=d*d; sumRef+=baseline[b*12+8+k]**2;
          }
          const finite = actual.every(Number.isFinite), relativeRms = Math.sqrt(sumDiff/Math.max(sumRef,1e-20));
          const check = comparisons[i];
          check.finite &&= finite; check.checkedStates++;
          check.maxAccelerationDifference = Math.max(check.maxAccelerationDifference,maxAcc);
          check.maxVelocityDifference = Math.max(check.maxVelocityDifference,maxVel);
          check.maxPositionDifference = Math.max(check.maxPositionDifference,maxPos);
          check.relativeRms = Math.max(check.relativeRms,relativeRms);
          if (!finite || maxAcc !== 0 || maxVel !== 0 || maxPos !== 0) throw new Error('Numerical regression: '+JSON.stringify(check));
        }
        if (round === steps-1) {
          let error = 0, norm = 0;
          for(let sample=0;sample<Math.min(count,64);sample++) {
            const i=sample<2?sample:Math.floor(sample*count/Math.min(count,64));
            const expected=[0,0,0];
            for(let j=0;j<count;j++) if(i!==j) {
              const x=baseline[j*12]-baseline[i*12],y=baseline[j*12+1]-baseline[i*12+1],z=baseline[j*12+2]-baseline[i*12+2];
              const d2=x*x+y*y+z*z+9,g=gravity*baseline[j*12+11]/(d2*Math.sqrt(d2));
              expected[0]+=x*g;expected[1]+=y*g;expected[2]+=z*g;
            }
            const length=Math.hypot(...expected);
            if(length>1000) for(let k=0;k<3;k++) expected[k]*=1000/length;
            for(let k=0;k<3;k++) { error+=(baseline[i*12+8+k]-expected[k])**2;norm+=expected[k]**2; }
          }
          cpuCheck={relativeRms:Math.sqrt(error/Math.max(norm,1e-20))};
          if (!Number.isFinite(cpuCheck.relativeRms) || cpuCheck.relativeRms > .03) throw new Error('CPU force reference failed');
        }
      }
      if (options.has('evolve')) {
        const next = device.createCommandEncoder(); next.copyBufferToBuffer(nextInputs,0,bodiesIn,0,data.byteLength); device.queue.submit([next.finish()]);
      }
    }
    if (!variants.some(v=>v.rope)) await validateTree(false);
    await report({type:mode === 'full' ? 'physics-full-step' : 'physics-paired',count,twin,seed,gravity,samples:steps,warmup:4,evolving:options.has('evolve'),shape:options.get('shape')??'disk',
      gpuMs:Object.fromEntries(variants.map((v,i)=>[v.name,summarize(measurements[i])])),comparisons,cpuCheck,treeCheck});
    if (errors.length) throw new Error(errors.join('\n'));
    for (const b of [params,bodiesIn,bodies,savedBodies,nextInputs,nodes,allocator,bounds,clearArgs,resolved,aggregates,parents,ropes]) b.destroy(); queries.destroy();
    for (const r of orderResources) if (r) { r.counts.destroy(); r.ranks.destroy(); r.order.destroy(); }
  }
  device.destroy();
}
