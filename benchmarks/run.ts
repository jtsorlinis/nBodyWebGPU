import { options, status, report, initialBodies, summarize } from './common';
import clearSource from './baseline/bhClear.wgsl?raw';
import boundsSource from './baseline/bhBounds.wgsl?raw';
import treeSource from './baseline/bhTree.wgsl?raw';
import forceSource from './baseline/bhForces.wgsl?raw';
import integrateSource from './baseline/bodiesIntegrate.wgsl?raw';
import reducedTreeSource from './candidates/bhTreeReduced.wgsl?raw';
import geometryClearSource from './candidates/bhClearGeometry.wgsl?raw';
import usedClearSource from './candidates/bhClearUsed.wgsl?raw';
import prepareSource from './candidates/bhPrepare.wgsl?raw';
import compactForceSource from './candidates/bhForcesCompact.wgsl?raw';
import productionTree from '../src/shaders/compute/barnes-hut/bhTree.wgsl?raw';
import productionClear from '../src/shaders/compute/barnes-hut/bhClear.wgsl?raw';
import productionForce from '../src/shaders/compute/barnes-hut/bhForces.wgsl?raw';
import productionPrepare from '../src/shaders/compute/barnes-hut/bhPrepare.wgsl?raw';
import { BH_FORCE_WORKGROUP_SIZE } from '../src/shaders';

async function computeBench() {
  const production = options.has('production');
  const forceWorkgroup = production ? BH_FORCE_WORKGROUP_SIZE : Number(options.get('workgroup') ?? 256);
  const usedClear = production || options.get('clear') === 'used';
  const iterations = options.has('evolve') ? 120 : 15;
  const gravity = Number(options.get('gravity') ?? 5);
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  if (!adapter.features.has('timestamp-query')) throw new Error('GPU timestamp queries unavailable');
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'],
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize } });
  const gpuErrors: string[] = [];
  device.addEventListener('uncapturederror', (e) => { gpuErrors.push(e.error.message); void report({ type: 'gpu-error', error: e.error.message }); });
  await report({ type: 'environment', adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
    device: adapter.info.device, description: adapter.info.description }, userAgent: navigator.userAgent,
    timestampQueries: true, seed: 123456789 });
  const makeBuffer = (size: number, uniform = false) => device.createBuffer({ size,
    usage: (uniform ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE) | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const makePipeline = async (label: string, code: string) => {
    const module = device.createShaderModule({ label, code });
    const info = await module.getCompilationInfo();
    if (info.messages.some(m => m.type === 'error')) throw new Error(label + ': ' + info.messages.map(m => m.message).join('\n'));
    return device.createComputePipelineAsync({ label, layout: 'auto', compute: { module, entryPoint: 'main' } });
  };
  const pipelines = {
    integrate: await makePipeline('integrate', integrateSource),
    clear: await makePipeline('clear', production ? productionClear : usedClear ? usedClearSource : options.get('clear') === 'geometry' ? geometryClearSource : clearSource),
    bounds: await makePipeline('bounds', boundsSource),
    tree: await makePipeline('tree', production ? productionTree : options.has('reducedTree') ? reducedTreeSource : treeSource),
    forces: await makePipeline('forces', production ? productionForce.replace('FORCE_WORKGROUP_SIZE', String(forceWorkgroup)) : (options.has('compact') ? compactForceSource : forceSource).replace('@workgroup_size(256)', `@workgroup_size(${forceWorkgroup})`)),
    prepare: await makePipeline('prepare', production ? productionPrepare : prepareSource),
    reference: await makePipeline('reference', forceSource),
  };
  const workgroupPipelines = options.has('sweep') ? await Promise.all([64, 128, 256].map(size =>
    makePipeline(`forces${size}`, forceSource.replace('@workgroup_size(256)', `@workgroup_size(${size})`)))) : [];
  const read = async (buffer: GPUBuffer, size = buffer.size) => {
    const staging = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = staging.getMappedRange().slice(0);
    staging.unmap(); staging.destroy();
    return data;
  };
  const counts = options.has('edge') ? [1, 2, 255, 257, 513, 4097] : options.has('quick') ? [4096, 131072] : [4096, 131072, 262144];
  for (const count of counts) for (const twin of (count <= 4097 ? [false] : [false, true])) {
    status.textContent = `Computing ${options.get('run') ?? 'baseline'}: ${count} bodies, twin=${twin}`;
    const maxNodes = count * 8;
    const data = initialBodies(count, twin);
    const params = makeBuffer(32, true);
    const paramsData = new ArrayBuffer(32), u = new Uint32Array(paramsData), f = new Float32Array(paramsData);
    u[0] = count; f[1] = gravity; f[2] = 1 / 60; f[3] = count / 2; f[4] = 3; f[5] = .5; u[6] = maxNodes;
    f[7] = Math.floor(0x7fffffff / ((count * 1.5 + (twin ? 2 : 1) * count / 2) * 1.1));
    device.queue.writeBuffer(params, 0, paramsData);
    const bodiesIn = makeBuffer(data.byteLength), bodies = makeBuffer(data.byteLength);
    device.queue.writeBuffer(bodiesIn, 0, data);
    const nodes = makeBuffer(maxNodes * 64), allocator = makeBuffer(4), bounds = makeBuffer(24);
    const clearArgs = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT });
    device.queue.writeBuffer(allocator, 0, new Uint32Array([maxNodes]));
    const reset = makeBuffer(28);
    device.queue.writeBuffer(reset, 0, new Uint32Array([1, 0xffffffff, 0xffffffff, 0xffffffff, 0, 0, 0]));
    const bind = (pipeline: GPUComputePipeline, buffers: GPUBuffer[]) => device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const groups = {
      integrate: bind(pipelines.integrate, [params, bodiesIn, bodies]),
      clear: bind(pipelines.clear, usedClear ? [params, nodes, clearArgs] : [params, nodes]),
      bounds: bind(pipelines.bounds, [params, bodies, bounds]),
      tree: bind(pipelines.tree, [params, bodies, nodes, allocator, bounds]),
      forces: bind(pipelines.forces, [params, bodies, nodes]),
      prepare: bind(pipelines.prepare, [params, allocator, bounds, clearArgs]),
      reference: bind(pipelines.reference, [params, bodies, nodes]),
    };
    const names = ['integrate', 'clear', 'bounds', 'tree', 'forces'] as const;
    const queries = device.createQuerySet({ type: 'timestamp', count: names.length * 2 });
    const resolved = device.createBuffer({ size: names.length * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const samples: Record<string, number[]> = Object.fromEntries([...names, 'total'].map(n => [n, []]));
    for (let iteration = -4; iteration < iterations; iteration++) {
      const encoder = device.createCommandEncoder();
      if (!usedClear) {
        encoder.copyBufferToBuffer(reset, 0, allocator, 0, 4);
        encoder.copyBufferToBuffer(reset, 4, bounds, 0, 24);
      }
      names.forEach((name, index) => {
        const pass = encoder.beginComputePass({ label: name, timestampWrites: { querySet: queries,
          beginningOfPassWriteIndex: index * 2, endOfPassWriteIndex: index * 2 + 1 } });
        if (name === 'clear' && usedClear) {
          pass.setPipeline(pipelines.prepare); pass.setBindGroup(0, groups.prepare); pass.dispatchWorkgroups(1);
        }
        pass.setPipeline(pipelines[name]); pass.setBindGroup(0, groups[name]);
        if (name === 'clear' && usedClear) pass.dispatchWorkgroupsIndirect(clearArgs, 0);
        else pass.dispatchWorkgroups(Math.ceil((name === 'clear' ? maxNodes : count) / (name === 'forces' ? forceWorkgroup : 256)));
        pass.end();
      });
      encoder.resolveQuerySet(queries, 0, names.length * 2, resolved, 0);
      if (options.has('evolve')) encoder.copyBufferToBuffer(bodies, 0, bodiesIn, 0, data.byteLength);
      device.queue.submit([encoder.finish()]);
      const values = new BigUint64Array(await read(resolved));
      if (iteration >= 0) {
        names.forEach((name, index) => samples[name].push(Number(values[index * 2 + 1] - values[index * 2]) / 1e6));
        samples.total.push(Number(values[values.length - 1] - values[0]) / 1e6);
      }
    }
    const usedNodes = new Uint32Array(await read(allocator))[0];
    const actual = new Float32Array(await read(bodies));
    const checkEncoder = device.createCommandEncoder();
    const checkPass = checkEncoder.beginComputePass();
    checkPass.setPipeline(pipelines.reference); checkPass.setBindGroup(0, groups.reference);
    checkPass.dispatchWorkgroups(Math.ceil(count / 256)); checkPass.end();
    device.queue.submit([checkEncoder.finish()]);
    const reference = new Float32Array(await read(bodies));
    let maxAccelerationDifference = 0;
    for (let i = 0; i < count; i++) for (let k = 8; k < 11; k++) {
      maxAccelerationDifference = Math.max(maxAccelerationDifference, Math.abs(actual[i * 12 + k] - reference[i * 12 + k]));
    }
    let errorSquared = 0, forceSquared = 0, maxRelative = 0;
    // An independent double-precision direct summation, including the production softening/clamp.
    const sampleCount = Math.min(64, count);
    for (let s = 0; s < sampleCount; s++) {
      const i = s < 2 ? s : Math.floor(s * count / sampleCount);
      const expected = [0, 0, 0];
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const r = [actual[j * 12] - actual[i * 12], actual[j * 12 + 1] - actual[i * 12 + 1], actual[j * 12 + 2] - actual[i * 12 + 2]];
        const d2 = r[0] ** 2 + r[1] ** 2 + r[2] ** 2 + 9;
        const g = gravity * actual[j * 12 + 11] / (d2 * Math.sqrt(d2));
        for (let k = 0; k < 3; k++) expected[k] += r[k] * g;
      }
      const length = Math.hypot(...expected);
      if (length > 1000) for (let k = 0; k < 3; k++) expected[k] *= 1000 / length;
      let err = 0, norm = 0;
      for (let k = 0; k < 3; k++) { err += (actual[i * 12 + 8 + k] - expected[k]) ** 2; norm += expected[k] ** 2; }
      errorSquared += err; forceSquared += norm;
      maxRelative = Math.max(maxRelative, Math.sqrt(err / Math.max(norm, 1e-10)));
    }
    const finite = actual.every(Number.isFinite);
    const rmsRelative = Math.sqrt(errorSquared / Math.max(forceSquared, 1e-20));
    const tests = { finite, allocatorInBounds: usedNodes <= maxNodes, rmsRelative, maxRelative, maxAccelerationDifference };
    if (count <= 4097) {
      const tree = new Int32Array(await read(nodes, Math.min(usedNodes, maxNodes) * 64));
      const leaves = new Set<number>(); const visit = [0]; const visited = new Set<number>();
      while (visit.length) {
        const node = visit.pop()!;
        if (visited.has(node)) throw new Error('Tree cycle');
        visited.add(node);
        for (let c = 0; c < 8; c++) { const child = tree[node * 16 + 8 + c]; if (child >= 0) visit.push(child); else if (child <= -2) leaves.add(-child - 2); }
      }
      Object.assign(tests, { leafCount: leaves.size, allBodiesInTree: leaves.size === count });
      if (leaves.size !== count) throw new Error('Missing tree leaves');
    }
    await report({ type: 'compute', count, twin, samples: iterations, warmup: 4, gravity, evolving: options.has('evolve'),
      milliseconds: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarize(values)])), usedNodes, tests });
    if (!finite || usedNodes > maxNodes || !Number.isFinite(rmsRelative) || rmsRelative > .03 || maxAccelerationDifference > .001 || gpuErrors.length) throw new Error('Compute correctness check failed');
    if (workgroupPipelines.length && count > 4097) {
      const sizes = [64, 128, 256];
      const timings: number[][] = [[], [], []];
      const bindings = workgroupPipelines.map(p => bind(p, [params, bodies, nodes]));
      // Interleave variants on the SAME tree to avoid random node allocation and clock bias.
      for (let round = -3; round < 15; round++) for (const index of (round % 2 ? [2, 1, 0] : [0, 1, 2])) {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass({ timestampWrites: { querySet: queries, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } });
        pass.setPipeline(workgroupPipelines[index]); pass.setBindGroup(0, bindings[index]);
        pass.dispatchWorkgroups(Math.ceil(count / sizes[index])); pass.end();
        encoder.resolveQuerySet(queries, 0, 2, resolved, 0);
        device.queue.submit([encoder.finish()]);
        const ticks = new BigUint64Array(await read(resolved, 16));
        if (round >= 0) timings[index].push(Number(ticks[1] - ticks[0]) / 1e6);
      }
      await report({ type: 'workgroup-sweep', count, twin, gpuMs: Object.fromEntries(sizes.map((size, i) => [size, summarize(timings[i])])) });
    }
    for (const buffer of [params, bodiesIn, bodies, nodes, allocator, bounds, reset, resolved, clearArgs]) buffer.destroy();
    queries.destroy();
  }
  device.destroy();
}

try {
  if (options.has('render')) {
    const { renderBench } = await import('./render');
    await renderBench();
  } else {
    await computeBench();
  }
  status.textContent = 'Finished';
  await report({ type: 'complete' });
} catch (error) {
  status.textContent = String(error);
  await report({ type: 'failure', error: String(error), stack: (error as Error).stack });
}
