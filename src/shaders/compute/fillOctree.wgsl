struct Cell {
  pos : vec3<f32>,
  mass : atomic<u32>,
};

struct Params {
  spaceLimit : f32,
  numBodies : u32,
  maxDepth : u32,
  totalNodes : u32,
};

struct DepthInfo {
  depthOffset : u32,
  nodesAtDepth : u32,
  dimAtDepth : u32,
  padding : u32,
};

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
  colFloat : f32,
};

fn mortonEncode3d(pos: vec3<u32>) -> u32 {
  var x = pos.x;
  var y = pos.y;
  var z = pos.z;

  x = (x ^ (x << 16)) & 0x030000ff;
  x = (x ^ (x << 8)) & 0x0300f00f;
  x = (x ^ (x << 4)) & 0x030c30c3;
  x = (x ^ (x << 2)) & 0x09249249;

  y = (y ^ (y << 16)) & 0x030000ff;
  y = (y ^ (y << 8)) & 0x0300f00f;
  y = (y ^ (y << 4)) & 0x030c30c3;
  y = (y ^ (y << 2)) & 0x09249249;

  z = (z ^ (z << 16)) & 0x030000ff;
  z = (z ^ (z << 8)) & 0x0300f00f;
  z = (z ^ (z << 4)) & 0x030c30c3;
  z = (z ^ (z << 2)) & 0x09249249;

  return x | (y << 1) | (z << 2);
}

fn getGridPos(pos : vec3<f32>, spaceLimit: f32, cellSize: f32 ) -> vec3<u32> {
  let x = u32((pos.x + spaceLimit * 2) / cellSize);
  let y = u32((pos.y + spaceLimit * 2) / cellSize);
  let z = u32((pos.z + spaceLimit * 2) / cellSize);
  return vec3<u32>(x, y, z);
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage,read> bodies : array<Body>;
@group(0) @binding(2) var<storage,read_write> octree : array<Cell>;
@group(0) @binding(3) var<storage> depthInfos : array<DepthInfo>;

@compute @workgroup_size(512, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if(id.x >= params.numBodies) {
    return;
  }

  let cellSize = (params.spaceLimit * 4) / f32(depthInfos[params.maxDepth].dimAtDepth);
  let body = bodies[id.x];
  let gridPos = getGridPos(body.pos, params.spaceLimit, cellSize);
  let morton = mortonEncode3d(gridPos);

  if(morton >= depthInfos[params.maxDepth].nodesAtDepth) {
    return;
  }

  var index = morton;
  var depth = params.maxDepth;
  var offset = depthInfos[depth].depthOffset;
  atomicAdd(&octree[index + offset].mass, 1);
  if(depth == 0) {
    return;
  }

  index >>= 3;
  depth -= 1;
  offset = depthInfos[depth].depthOffset;
  atomicAdd(&octree[index + offset].mass, 1);
  if(depth == 0) {
    return;
  }

  index >>= 3;
  depth -= 1;
  offset = depthInfos[depth].depthOffset;
  atomicAdd(&octree[index + offset].mass, 1);
  if(depth == 0) {
    return;
  }

  index >>= 3;
  depth -= 1;
  offset = depthInfos[depth].depthOffset;
  atomicAdd(&octree[index + offset].mass, 1);
  if(depth == 0) {
    return;
  }

  index >>= 3;
  depth -= 1;
  offset = depthInfos[depth].depthOffset;
  atomicAdd(&octree[index + offset].mass, 1);
  if(depth == 0) {
    return;
  }

  index >>= 3;
  depth -= 1;
  offset = depthInfos[depth].depthOffset;
  atomicAdd(&octree[index + offset].mass, 1);
  if(depth == 0) {
    return;
  }

  index >>= 3;
  depth -= 1;
  offset = depthInfos[depth].depthOffset;
  atomicAdd(&octree[index + offset].mass, 1);
  if(depth == 0) {
    return;
  }

  index >>= 3;
  depth -= 1;
  offset = depthInfos[depth].depthOffset;
  atomicAdd(&octree[index + offset].mass, 1);
  if(depth == 0) {
    return;
  }

  index >>= 3;
  depth -= 1;
  offset = depthInfos[depth].depthOffset;
  atomicAdd(&octree[index + offset].mass, 1);
  if(depth == 0) {
    return;
  }
}

