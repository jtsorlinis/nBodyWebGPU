struct Params {
  numBodies: u32,
  gravity: f32,
  softeningFactor: f32,
  deltaTime: f32,
}

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
  colFloat : f32,
};

struct OctreeParams {
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

struct Cell {
  pos : vec3<f32>,
  mass : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<uniform> octreeParams : OctreeParams;
@group(0) @binding(2) var<storage> depthInfos : array<DepthInfo>;
@group(0) @binding(3) var<storage,read> octree : array<Cell>;
@group(0) @binding(4) var<storage,read> bodiesIn : array<Body>;
@group(0) @binding(5) var<storage,read_write> bodiesOut : array<Body>;

const mass : f32 = 1.0;

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if(id.x >= params.numBodies) {
    return;
  }

  var body = bodiesIn[id.x];

  // First "Kick": Half update of the velocity
  body.vel += 0.5 * body.acc * params.deltaTime;

  // "Drift": Full update of the position
  body.pos += body.vel * params.deltaTime;

  // Compute new acceleration
  var newAcc = vec3<f32>(0.0, 0.0, 0.0);
  var depth = 0;
  var depthOffset = 0u;
  var path = array<u32,10>();

  while(depth >= 0) {
    let morton = path[depth];
    let cell = octree[depthOffset + morton];

    // if cell isn't empty calculate distance from body to cell
    if(cell.mass > 0) {
      let r = cell.pos - body.pos;
      let distSq = max(dot(r, r), params.softeningFactor);
      let cellSize = (octreeParams.spaceLimit * 4) / f32(depthInfos[depth].dimAtDepth);
      let distCheck = cellSize * cellSize;

      // We are far enough away that we can approximate with the mass
      if(distSq > distCheck || depth >= i32(octreeParams.maxDepth)) {
        if(distSq > octreeParams.minDistSq) {
          let f = params.gravity * ((mass * f32(cell.mass)) / distSq);
          let a = f / mass;
          let direction = r / sqrt(distSq);
          newAcc += a * direction;
        }
      } else {
        // We are not far enough away to approximate, so we need to go deeper
        depth += 1;
        depthOffset = depthInfos[depth].depthOffset;
        path[depth] = morton << 3;
      }
    }

    // Move to next sibling
    if(depth >= 0) {
      path[depth]++;
      while((path[depth] & 7) == 0) {
        // We've visited all siblings, so move back up the tree
        depth--;
        depthOffset = depthInfos[depth].depthOffset;
        if(depth > 0) {
          path[depth]++;
        } else {
          // We've finished the whole tree
          depth = -1;
          break;
        }
      }
    }
  }

  // Store the new acceleration for the next timestep
  body.acc = newAcc;

  // Second "Kick": Another half update of the velocity
  body.vel += 0.5 * body.acc * params.deltaTime;

  // Write the updated body back to the buffer
  bodiesOut[id.x] = body;
}

