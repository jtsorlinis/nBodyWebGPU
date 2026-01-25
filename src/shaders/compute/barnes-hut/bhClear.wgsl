struct Params {
  numBodies: u32,
  gravity: f32,
  deltaTime: f32,
  blackHoleMass: f32,
  softening: f32,
  theta: f32,
  maxNodes: u32,
  _pad0: u32,
  minPos: vec3<f32>,
  maxPos: vec3<f32>,
}

struct Node {
  massInt: i32,
  comXInt: i32,
  comYInt: i32,
  comZInt: i32,
  center: vec3<f32>,
  halfSize: f32,
  children: array<i32, 8>,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read_write> nodes : array<Node>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.maxNodes) {
    return;
  }
  
  nodes[id.x].massInt = 0;
  nodes[id.x].comXInt = 0;
  nodes[id.x].comYInt = 0;
  nodes[id.x].comZInt = 0;
  // center and halfSize are written during allocation, no need to clear? 
  // actually better to clear just in case (though tree build overwrites them)
  nodes[id.x].center = vec3(0.0); 
  nodes[id.x].halfSize = 0.0;

  for (var i = 0; i < 8; i++) {
    nodes[id.x].children[i] = -1;
  }
}
