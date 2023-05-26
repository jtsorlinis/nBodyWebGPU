struct Cell {
  pos : vec3<f32>,
  mass : f32,
};

struct Params {
  nodesAtDepth : u32,
  dimAtDepth : u32,
  cellSize : f32,
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
@group(0) @binding(1) var<storage,read_write> octree : array<Cell>;

@compute @workgroup_size(512, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if(id.x >= params.nodesAtDepth) {
    return;
  }

  let mortonPos = mortonDecode3d(id.x);
  let x = params.cellSize * (f32(mortonPos.x) + 0.5 - f32(params.dimAtDepth) / 2);
  let y = params.cellSize * (f32(mortonPos.y) + 0.5 - f32(params.dimAtDepth) / 2);
  let z = params.cellSize * (f32(mortonPos.z) + 0.5 - f32(params.dimAtDepth) / 2);
  octree[id.x].pos = vec3<f32>(x, y, z);
  octree[id.x].mass = 0;
}

