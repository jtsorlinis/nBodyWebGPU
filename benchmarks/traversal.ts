import { initialBodies, options, report, status, summarize } from './common';
import prepare from './traversal-baseline/bhPrepare.wgsl?raw';
import clear from './traversal-baseline/bhClear.wgsl?raw';
import boundsShader from './traversal-baseline/bhBounds.wgsl?raw';
import parentsShader from './traversal-baseline/bhParents.wgsl?raw';
import orderClear from './traversal-baseline/bhOrderClear.wgsl?raw';
import orderKeys from './traversal-baseline/bhOrderKeys.wgsl?raw';
import orderScan from './traversal-baseline/bhOrderScan.wgsl?raw';
import orderScatter from './traversal-baseline/bhOrderScatter.wgsl?raw';
import scanBlocks from './traversal-candidates/scanBlocks.wgsl?raw';
import packBodies from './traversal-candidates/packBodies.wgsl?raw';
import dispatchArgs from './traversal-candidates/dispatchArgs.wgsl?raw';
import { variants as candidates, forceSource, treeSource, decodeSource, ropesSource, integrateSource } from './traversal-candidates/variants';
import productionForce from '../src/shaders/compute/barnes-hut/bhForces.wgsl?raw';
import productionTree from '../src/shaders/compute/barnes-hut/bhTree.wgsl?raw';
import productionIntegrate from '../src/shaders/compute/bodiesIntegrate.wgsl?raw';
import { BH_FORCE_WORKGROUP_SIZE, BH_ORDER_GRID_SIZE, bhTraversalSources } from '../src/shaders';

export async function benchmarkTraversal() {
  const selected = options.get('traversal') ?? 'suite';
  const variants = options.has('production') ? [candidates[0], {
    ...candidates.find(v=>v.name==='fused256')!,name:'production',grid:BH_ORDER_GRID_SIZE,workgroup:BH_FORCE_WORKGROUP_SIZE,
  }] : candidates.filter(v => v.name === 'baseline' || selected === 'suite' || selected.split(',').includes(v.name));
  if (variants.length < 2) throw new Error('Select a traversal candidate');
  const adapter = await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
  if (!adapter?.features.has('timestamp-query')) throw new Error('Timestamp queries required');
  const device = await adapter.requestDevice({requiredFeatures:['timestamp-query'],requiredLimits:{
    maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,maxBufferSize:adapter.limits.maxBufferSize,
  }});
  const errors: string[] = [];
  device.addEventListener('uncapturederror', e => errors.push(e.error.message));
  device.lost.then(info => { if(info.reason !== 'destroyed') errors.push(info.message); });
  await report({type:'traversal-environment',baselineCommit:'c03ea56',vendor:adapter.info.vendor,architecture:adapter.info.architecture,userAgent:navigator.userAgent});
  const buffer = (size:number, extra=0, uniform=false) => device.createBuffer({size,
    usage:(uniform?GPUBufferUsage.UNIFORM:GPUBufferUsage.STORAGE)|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST|extra});
  const pipeline = async (label:string,code:string) => {
    const module=device.createShaderModule({label,code});
    const info=await module.getCompilationInfo();
    if(info.messages.some(m=>m.type==='error')) throw new Error(label+': '+info.messages.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
    return device.createComputePipelineAsync({label,layout:'auto',compute:{module,entryPoint:'main'}});
  };
  const bind = (p:GPUComputePipeline,buffers:GPUBuffer[]) => device.createBindGroup({layout:p.getBindGroupLayout(0),
    entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
  const read = async (source:GPUBuffer,size=source.size) => {
    const staging=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    const e=device.createCommandEncoder();e.copyBufferToBuffer(source,0,staging,0,size);device.queue.submit([e.finish()]);
    await staging.mapAsync(GPUMapMode.READ);const result=staging.getMappedRange().slice(0);staging.unmap();staging.destroy();return result;
  };
  const common = {
    prepare:await pipeline('prepare',prepare),
    clear:await pipeline('clear',clear),bounds:await pipeline('bounds',boundsShader),
    parents:await pipeline('parents',parentsShader),
    orderClear:await pipeline('orderClear',orderClear),scanBlocks:await pipeline('scanBlocks',scanBlocks),
    pack:await pipeline('pack',packBodies),args:await pipeline('args',dispatchArgs),
  };
  const variantPipelines = await Promise.all(variants.map(async v => ({
    integrate:await pipeline(v.name+'-integrate',v.name==='production'?productionIntegrate:integrateSource(v)),
    ropes:await pipeline(v.name+'-ropes',v.name==='production'?bhTraversalSources.ropes:ropesSource(v)),decode:await pipeline(v.name+'-decode',decodeSource(v)),
    orderClear:v.name==='production'?await pipeline('production-order-clear',bhTraversalSources.orderClear):v.grid > 128 ? await pipeline('clear-2d',orderClear.replace(
      'fn main(@builtin(global_invocation_id) id: vec3<u32>) {',
      'fn main(@builtin(global_invocation_id) id2: vec3<u32>) {\n  let id = vec3<u32>(id2.x + id2.y * 65536u, 0u, 0u);')) : common.orderClear,
    scanBlocks:v.name==='production'?await pipeline('production-scan-blocks',bhTraversalSources.orderScanBlocks):v.grid > 128 ? await pipeline('scan-2d',scanBlocks
      .replace('  let value =', '  let flat = id.x + id.y * 65536u;\n  let value =')
      .replaceAll('counts[id.x]','counts[flat]').replace('blocks[group.x]','blocks[group.x + group.y * 256u]')) : common.scanBlocks,
    tree:await pipeline(v.name+'-tree',v.name==='production'?productionTree:treeSource(v)),force:await pipeline(v.name+'-force',v.name==='production'?productionForce.replace('FORCE_WORKGROUP_SIZE',String(v.workgroup)):forceSource(v)),
    keys:await pipeline(v.name+'-keys',v.name==='production'?bhTraversalSources.orderKeys:orderKeys.replaceAll('GRID_SIZE',`${v.grid}u`)),
    scan:await pipeline(v.name+'-scan',v.name==='production'?bhTraversalSources.orderScan:orderScan.replaceAll('BIN_COUNT',`${v.grid**3/(v.parallel?256:1)}u`)),
    scatter:await pipeline(v.name+'-scatter',v.name==='production'?bhTraversalSources.orderScatter:v.parallel ? orderScatter
      .replace('@compute @workgroup_size','@group(0) @binding(4) var<storage, read> blocks: array<u32>;\n@compute @workgroup_size')
      .replace('counts[rank.x] + rank.y','counts[rank.x] + blocks[rank.x / 256u] + rank.y') : orderScatter),
  })));
  const counts=options.has('edge')?[1,2,63,65,255,257,4097]:options.has('quick')?[131072]:[4096,131072,262144];
  const seed=Number(options.get('seed')??123456789),gravity=Number(options.get('gravity')??5);
  const evolving=options.has('evolve'),steps=evolving?120:24;
  for(const count of counts) for(const twin of (count<=4097||options.has('quick')?[false]:[false,true])) {
    status.textContent=`Traversal ${count}, twin=${twin}`;
    const data=initialBodies(count,twin,seed),maxNodes=count*8;
    const owned:GPUBuffer[]=[];
    const make=(size:number,extra=0,uniform=false)=>{const b=buffer(size,extra,uniform);owned.push(b);return b;};
    const params=make(32,0,true),p=new ArrayBuffer(32),u=new Uint32Array(p),f=new Float32Array(p);
    u[0]=count;f[1]=gravity;f[2]=1/60;f[3]=count/2;f[4]=3;f[5]=.5;u[6]=maxNodes;
    f[7]=Math.floor(0x7fffffff/((count*1.5+(twin?2:1)*count/2)*1.1));
    device.queue.writeBuffer(params,0,p);
    const input=make(data.byteLength),bodies=make(data.byteLength),nextInput=make(data.byteLength);
    const nodes=make(maxNodes*64),allocator=make(4),bounds=make(24),clearArgs=make(16,GPUBufferUsage.INDIRECT);
    const parents=make(maxNodes*8),ropes=make(maxNodes*4),sources=make(count*16),args=make(12,GPUBufferUsage.INDIRECT);
    device.queue.writeBuffer(input,0,data);device.queue.writeBuffer(allocator,0,new Uint32Array([maxNodes]));
    const groups={
      prepare:bind(common.prepare,[params,allocator,bounds,clearArgs]),
      clear:bind(common.clear,[params,nodes,clearArgs]),bounds:bind(common.bounds,[params,bodies,bounds]),
      parents:bind(common.parents,[params,nodes,allocator,parents]),
      pack:bind(common.pack,[params,bodies,sources]),args:bind(common.args,[params,allocator,args]),
    };
    const resources=variants.map((v,i)=>{
      const p=variantPipelines[i],histogram=make(v.grid**3*4),ranks=make(count*8),order=make(count*4),blocks=make(v.grid**3/256*4);
      return {order,groups:{
        integrate:bind(p.integrate,[params,input,bodies,...(v.fusedPack?[sources]:[])]),
        ropes:bind(p.ropes,[params,nodes,allocator,parents,ropes]),decode:bind(p.decode,[params,nodes,allocator]),
        tree:bind(p.tree,[params,bodies,nodes,allocator,bounds,...(v.treeParents?[parents]:[])]),
        force:bind(p.force,[params,bodies,nodes,order,ropes,...(v.packed?[sources]:[])]),
        orderClear:bind(p.orderClear,[histogram]),keys:bind(p.keys,[params,bodies,bounds,histogram,ranks]),
        scanBlocks:bind(p.scanBlocks,[histogram,blocks]),scan:bind(p.scan,[v.parallel?blocks:histogram]),
        scatter:bind(p.scatter,[params,histogram,ranks,order,...(v.parallel?[blocks]:[])]),
      }};
    });
    const queries=device.createQuerySet({type:'timestamp',count:40});
    const resolved=make(40*8,GPUBufferUsage.QUERY_RESOLVE);
    const times=variants.map(()=>[] as number[]),phaseTimes=variants.map(()=>({} as Record<string,number[]>));
    const checks=variants.map(v=>({variant:v.name,checkedStates:0,finite:true,maxPositionDifference:0,maxVelocityDifference:0,maxAccelerationDifference:0,validPermutation:true}));
    let cpuRelativeRms=0;
    const treeChecks:Record<string,unknown>={};
    const validateTree=async (name:string)=>{
      const used=new Uint32Array(await read(allocator))[0];
      if(used>maxNodes)throw new Error('Allocator overflow');
      const tree=new Int32Array(await read(nodes,used*64)),links=new Int32Array(await read(ropes,used*4));
      const visited=new Uint8Array(used),leaves=new Uint8Array(count),traversal:number[]=[],ends=new Uint32Array(used);
      const walk=(node:number,depth:number)=>{
        if(node<0||node>=used||visited[node]||depth>32)throw new Error('Invalid tree topology');
        visited[node]=1;traversal.push(node);
        for(let c=0;c<8;c++){const child=tree[node*16+8+c];if(child<=-2){const index=-child-2;
          if(index>=count||leaves[index])throw new Error('Invalid leaf');leaves[index]=1;}}
        for(let c=7;c>=0;c--){const child=tree[node*16+8+c];if(child>=0)walk(child,depth+1);}
        ends[node]=traversal.length;
      };
      walk(0,0);
      if(!leaves.every(x=>x===1))throw new Error('Missing leaf');
      for(const node of traversal)if(links[node] !== (traversal[ends[node]]??-1))throw new Error('Wrong subtree successor');
      treeChecks[name]={usedNodes:used,reachableNodes:traversal.length,allBodiesInTree:true,validSuccessors:true};
    };
    for(let round=-4;round<steps;round++){
      const order=variants.map((_,i)=>i);if(round>=0&&round%2)order.reverse();
      const check=evolving||round===-4||round===steps-1;
      const snapshots:Float32Array[]=[];
      for(const i of order){
        const v=variants[i],p=variantPipelines[i],g=resources[i].groups;
        const e=device.createCommandEncoder(),phases:string[]=[];
        const dispatch=(name:string,pipeline:GPUComputePipeline,group:GPUBindGroup,size:number|GPUBuffer)=>{
          const index=phases.length;phases.push(name);
          const pass=e.beginComputePass({timestampWrites:{querySet:queries,beginningOfPassWriteIndex:index*2,endOfPassWriteIndex:index*2+1}});
          pass.setPipeline(pipeline);pass.setBindGroup(0,group);
          if(typeof size==='number'){
            if(size>65535)pass.dispatchWorkgroups(256,Math.ceil(size/256));else pass.dispatchWorkgroups(size);
          }else pass.dispatchWorkgroupsIndirect(size,0);
          pass.end();
        };
        dispatch('integrate',p.integrate,g.integrate,Math.ceil(count/256));
        dispatch('prepare',common.prepare,groups.prepare,1);
        dispatch('clear',common.clear,groups.clear,clearArgs);
        dispatch('bounds',common.bounds,groups.bounds,Math.ceil(count/256));
        dispatch('tree',p.tree,g.tree,Math.ceil(count/256));
        if(v.indirect)dispatch('args',common.args,groups.args,1);
        if(!v.treeParents)dispatch('parents',common.parents,groups.parents,v.indirect?args:Math.ceil(maxNodes/256));
        dispatch('ropes',p.ropes,g.ropes,v.indirect?args:Math.ceil(maxNodes/256));
        dispatch('orderClear',p.orderClear,g.orderClear,v.grid**3/256);
        dispatch('keys',p.keys,g.keys,Math.ceil(count/256));
        if(v.parallel)dispatch('scanBlocks',p.scanBlocks,g.scanBlocks,v.grid**3/256);
        dispatch('scan',p.scan,g.scan,1);
        dispatch('scatter',p.scatter,g.scatter,Math.ceil(count/256));
        if(v.packed&&!v.fusedPack)dispatch('pack',common.pack,groups.pack,Math.ceil(count/256));
        if(v.inplace&&!v.fused)dispatch('decode',p.decode,g.decode,Math.ceil(maxNodes/256));
        dispatch('force',p.force,g.force,Math.ceil(count/v.workgroup));
        if(evolving&&i===0)e.copyBufferToBuffer(bodies,0,nextInput,0,data.byteLength);
        e.resolveQuerySet(queries,0,phases.length*2,resolved,0);device.queue.submit([e.finish()]);
        const ticks=new BigUint64Array(await read(resolved));
        if(round>=0){
          times[i].push(Number(ticks[phases.length*2-1]-ticks[0])/1e6);
          phases.forEach((name,j)=>(phaseTimes[i][name]??=[]).push(Number(ticks[j*2+1]-ticks[j*2])/1e6));
        }
        if(check){
          snapshots[i]=new Float32Array(await read(bodies));
          const permutation=new Uint32Array(await read(resources[i].order)),seen=new Uint8Array(count);
          for(const index of permutation){if(index>=count||seen[index])throw new Error('Invalid permutation');seen[index]=1;}
          if(round===steps-1)await validateTree(v.name);
        }
      }
      if(check){
        const baseline=snapshots[0];
        for(let i=0;i<variants.length;i++){
          const actual=snapshots[i],c=checks[i];c.checkedStates++;c.finite&&=actual.every(Number.isFinite);
          for(let b=0;b<count;b++)for(let k=0;k<3;k++){
            c.maxPositionDifference=Math.max(c.maxPositionDifference,Math.abs(actual[b*12+k]-baseline[b*12+k]));
            c.maxVelocityDifference=Math.max(c.maxVelocityDifference,Math.abs(actual[b*12+4+k]-baseline[b*12+4+k]));
            c.maxAccelerationDifference=Math.max(c.maxAccelerationDifference,Math.abs(actual[b*12+8+k]-baseline[b*12+8+k]));
          }
          if(!c.finite||c.maxPositionDifference!==0||c.maxVelocityDifference!==0||c.maxAccelerationDifference!==0)throw new Error('Numerical regression: '+JSON.stringify(c));
        }
        if(round===steps-1){
          let error=0,norm=0;
          for(let sample=0;sample<Math.min(count,64);sample++){
            const i=sample<2?sample:Math.floor(sample*count/Math.min(count,64)),expected=[0,0,0];
            for(let j=0;j<count;j++)if(i!==j){
              const x=baseline[j*12]-baseline[i*12],y=baseline[j*12+1]-baseline[i*12+1],z=baseline[j*12+2]-baseline[i*12+2];
              const d2=x*x+y*y+z*z+9,g=gravity*baseline[j*12+11]/(d2*Math.sqrt(d2));
              expected[0]+=x*g;expected[1]+=y*g;expected[2]+=z*g;
            }
            const length=Math.hypot(...expected);if(length>1000)for(let k=0;k<3;k++)expected[k]*=1000/length;
            for(let k=0;k<3;k++){error+=(baseline[i*12+8+k]-expected[k])**2;norm+=expected[k]**2;}
          }
          cpuRelativeRms=Math.sqrt(error/Math.max(norm,1e-20));
          if(!Number.isFinite(cpuRelativeRms)||cpuRelativeRms>.03)throw new Error('CPU direct reference failed');
        }
      }
      if(evolving){const e=device.createCommandEncoder();e.copyBufferToBuffer(nextInput,0,input,0,data.byteLength);device.queue.submit([e.finish()]);}
      if(errors.length)throw new Error(errors.join('\n'));
    }
    await report({type:'traversal-full-step',count,twin,seed,gravity,evolving,samples:steps,warmup:4,
      gpuMs:Object.fromEntries(variants.map((v,i)=>[v.name,summarize(times[i])])),
      phases:Object.fromEntries(variants.map((v,i)=>[v.name,Object.fromEntries(Object.entries(phaseTimes[i]).map(([name,times])=>[name,summarize(times)]))])),
      checks,treeChecks,cpuRelativeRms});
    for(const b of owned)b.destroy();queries.destroy();
  }
  device.destroy();
}
