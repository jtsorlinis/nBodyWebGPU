struct Cell {
  pos : vec3<f32>,
  mass : u32,
};

struct Params {
  spaceLimit : f32,
  numBodies : u32,
  maxDepth : u32,
  totalNodes : u32,
  minDistSq : f32,
};

struct DepthInfo {
  depthOffset : u32,
  nodesAtDepth : u32,
  dimAtDepth : u32,
  padding : u32,
};

fn mortonDecode3d(morton : u32) -> vec3<u32> {
  var xyz = vec3<u32>(0u, 0u, 0u);
  xyz.x = morton;
  xyz.y = morton >> 1u;
  xyz.z = morton >> 2u;

  xyz.x &= 0x09249249;
  xyz.x = (xyz.x ^ (xyz.x >> 2)) & 0x030c30c3;
  xyz.x = (xyz.x ^ (xyz.x >> 4)) & 0x0300f00f;
  xyz.x = (xyz.x ^ (xyz.x >> 8)) & 0x030000ff;
  xyz.x = (xyz.x ^ (xyz.x >> 16)) & 0x000003ff;

  xyz.y &= 0x09249249;
  xyz.y = (xyz.y ^ (xyz.y >> 2)) & 0x030c30c3;
  xyz.y = (xyz.y ^ (xyz.y >> 4)) & 0x0300f00f;
  xyz.y = (xyz.y ^ (xyz.y >> 8)) & 0x030000ff;
  xyz.y = (xyz.y ^ (xyz.y >> 16)) & 0x000003ff;

  xyz.z &= 0x09249249;
  xyz.z = (xyz.z ^ (xyz.z >> 2)) & 0x030c30c3;
  xyz.z = (xyz.z ^ (xyz.z >> 4)) & 0x0300f00f;
  xyz.z = (xyz.z ^ (xyz.z >> 8)) & 0x030000ff;
  xyz.z = (xyz.z ^ (xyz.z >> 16)) & 0x000003ff;

  return xyz;
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage> depthInfos : array<DepthInfo>;
@group(0) @binding(2) var<storage,read_write> octree : array<Cell>;

@compute @workgroup_size(512, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  for(var i = 0u; i <= params.maxDepth; i++) {
    if(id.x >= depthInfos[i].nodesAtDepth) {
      continue;
    }
    let cellSize = (params.spaceLimit * 4) / f32(depthInfos[i].dimAtDepth);
    let mortonPos = mortonDecode3d(id.x);
    let x = cellSize * (f32(mortonPos.x) + 0.5 - f32(depthInfos[i].dimAtDepth) / 2);
    let y = cellSize * (f32(mortonPos.y) + 0.5 - f32(depthInfos[i].dimAtDepth) / 2);
    let z = cellSize * (f32(mortonPos.z) + 0.5 - f32(depthInfos[i].dimAtDepth) / 2);
    octree[id.x + depthInfos[i].depthOffset].pos = vec3<f32>(x, y, z);
    octree[id.x + depthInfos[i].depthOffset].mass = 0;
  }
}

