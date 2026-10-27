import { WebGPUEngine, Scene, UniversalCamera, Vector3, MeshBuilder, ShaderMaterial, ShaderLanguage, StorageBuffer, DefaultRenderingPipeline } from '@babylonjs/core';
import { initialBodies, report, options, status, summarize } from './common';
import sphereVertex from './baseline/bodiesVertex.wgsl?raw';
import sphereFragment from './baseline/bodiesFragment.wgsl?raw';
import quadVertex from './candidates/particleVertex.wgsl?raw';
import quadFragment from './candidates/particleFragment.wgsl?raw';

export async function renderBench() {
  const canvas = document.querySelector('canvas')!;
  const engine = new WebGPUEngine(canvas, { setMaximumLimits: true, enableAllFeatures: true });
  await engine.initAsync();
  engine.setSize(1920, 1080);
  const device = engine._device;
  device.addEventListener('uncapturederror', e => void report({ type: 'gpu-error', error: e.error.message }));
  const query = device.createQuerySet({ type: 'timestamp', count: 4 });
  const resolved = device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const scene = new Scene(engine); scene.clearColor.set(0, 0, 0, 1);
  const camera = new UniversalCamera('camera', Vector3.Zero(), scene); camera.minZ = .1;
  const pipeline = new DefaultRenderingPipeline('bloom', true, scene, [camera]);
  pipeline.bloomEnabled = true; pipeline.bloomThreshold = 0;
  const meshes = [MeshBuilder.CreateSphere('sphere', { segments: 8 }, scene), MeshBuilder.CreatePlane('quad', { size: 1 }, scene)];
  const materials = [[sphereVertex, sphereFragment], [quadVertex, quadFragment]].map(([vertexSource, fragmentSource], index) => {
    const material = new ShaderMaterial('particles' + index, scene, { vertexSource, fragmentSource }, {
      attributes: ['position'], uniformBuffers: ['Scene', 'Mesh'], storageBuffers: ['bodies'], shaderLanguage: ShaderLanguage.WGSL });
    material.backFaceCulling = false;
    material.setFloat('extrapolationTime', 0);
    meshes[index].material = material;
    meshes[index].buildBoundingInfo(new Vector3(-1e6, -1e6, -1e6), new Vector3(1e6, 1e6, 1e6));
    meshes[index].setEnabled(false);
    return material;
  });
  // The baseline uses default back-face culling; preserve that render state.
  materials[0].backFaceCulling = true;
  const stamp = (index: number) => {
    const encoder = device.createCommandEncoder();
    encoder.beginComputePass({ timestampWrites: { querySet: query, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 } }).end();
    return encoder;
  };
  for (const count of (options.has('quick') ? [131072] : [131072, 262144])) {
    const radius = Math.cbrt(count) * 10;
    camera.position.set(0, radius * 2.25 * .5, -radius * 2.25 * Math.sqrt(.75));
    camera.setTarget(Vector3.Zero());
    const data = initialBodies(count);
    for (let i = 0; i < count; i++) {
      const x = data[i * 12], y = data[i * 12 + 1], z = data[i * 12 + 2];
      const d2 = x*x+y*y+z*z+9, f = -5 * count * 1.5 / (d2 * Math.sqrt(d2));
      data.set([x*f,y*f,z*f], i*12+8);
    }
    const buffer = new StorageBuffer(engine, data.byteLength); buffer.update(data);
    for (const mesh of meshes) mesh.forcedInstanceCount = count;
    for (const material of materials) {
      material.setStorageBuffer('bodies', buffer);
      material.setFloat('maxAcc', Math.sqrt(count * 1.5 * 5) / 15);
    }
    // Alternate the order on the second round to expose clock/thermal bias.
    const variants = [{ name: 'sphere-full', index: 0, bloom: 1 }, { name: 'quad-full', index: 1, bloom: 1 },
      { name: 'sphere-half', index: 0, bloom: .5 }, { name: 'quad-half', index: 1, bloom: .5 }];
    for (let round = 0; round < 2; round++) for (const variant of (round ? [...variants].reverse() : variants)) {
      status.textContent = `Rendering ${variant.name}, ${count} bodies, round ${round + 1}`;
      meshes.forEach((mesh, i) => mesh.setEnabled(i === variant.index));
      pipeline.bloomScale = variant.bloom;
      await scene.whenReadyAsync();
      const samples: number[] = [];
      for (let frame = -30; frame < 30; frame++) {
        device.queue.submit([stamp(0).finish()]);
        engine.beginFrame(); scene.render(); engine.endFrame();
        const encoder = stamp(2);
        encoder.resolveQuerySet(query, 0, 4, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, staging, 0, 32);
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const ticks = new BigUint64Array(staging.getMappedRange());
        if (frame >= 0) samples.push(Number(ticks[2] - ticks[1]) / 1e6);
        staging.unmap();
      }
      await report({ type: 'render', count, variant: variant.name, round, resolution: [1920,1080],
        samples: 30, warmup: 30, gpuMs: summarize(samples), triangles: meshes[variant.index].getTotalIndices() / 3 * count });
      if (round === 0 && count === 131072) {
        engine.beginFrame(); scene.render(); engine.endFrame();
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve));
        if (blob) await fetch('/__bench/image/' + variant.name + '.png', { method: 'POST', body: blob });
      }
    }
    buffer.dispose();
  }
  query.destroy(); resolved.destroy(); staging.destroy(); engine.dispose();
}
