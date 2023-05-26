struct Cell {
  pos : vec3<f32>,
  mass : u32,
};

struct Params {
  spaceLimit : f32,
  numBodies : u32,
  maxDepth : u32,
  totalNodes : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage,read_write> octree : array<Cell>;

@compute @workgroup_size(512, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if(id.x >= params.totalNodes) {
    return;
  }
  octree[id.x].mass = 0;
}

