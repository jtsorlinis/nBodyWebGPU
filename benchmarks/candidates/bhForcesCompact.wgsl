struct Params {
  numBodies: u32,
  gravity: f32,
  deltaTime: f32,
  blackHoleMass: f32,
  softening: f32,
  theta: f32,
  maxNodes: u32,
  massScale: f32,
}

struct Body {
  pos : vec3<f32>,
  vel : vec3<f32>,
  acc : vec3<f32>,
  mass : f32,
};

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
@group(0) @binding(1) var<storage, read_write> bodies : array<Body>;
@group(0) @binding(2) var<storage, read> nodes : array<Node>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= params.numBodies) {
    return;
  }

  var body = bodies[id.x];
  var newAcc = vec3(0.0);

  // One parent/cursor pair per tree level instead of one entry per pending sibling.
  // bhTree stops descending after depth 30, so 32 frames cover every allocated node.
  var parents: array<i32, 32>;
  var nextChildren: array<i32, 32>;
  var depth = 0;
  var nodeIdx = 0;
  let thetaSq = params.theta * params.theta;
  let softeningSq = params.softening * params.softening;

  loop {
    let node = nodes[nodeIdx];
    let mass = f32(node.massInt) / params.massScale;
    if (mass > 0.0) {
      let moment = vec3(f32(node.comXInt), f32(node.comYInt), f32(node.comZInt));
      let com = node.center + moment / f32(node.massInt) * node.halfSize;
      let r = com - body.pos;
      let distSq = dot(r, r);
      let size = node.halfSize * 2.0;
      if (distSq > 0.0 && size * size < thetaSq * distSq) {
        let invDist = inverseSqrt(distSq + softeningSq);
        newAcc += r * (params.gravity * mass * invDist * invDist * invDist);
      } else {
        // Preserve the original order: body leaves ascending, internal nodes descending.
        for (var i = 0; i < 8; i++) {
          let child = node.children[i];
          if (child <= -2) {
            let otherBodyIdx = -child - 2;
            if (u32(otherBodyIdx) != id.x) {
              let otherBody = bodies[otherBodyIdx];
              let r_b = otherBody.pos - body.pos;
              let invD = inverseSqrt(dot(r_b, r_b) + softeningSq);
              newAcc += r_b * (params.gravity * otherBody.mass * invD * invD * invD);
            }
          }
        }
        var cursor = 7;
        var child = -1;
        while (cursor >= 0) {
          child = node.children[cursor];
          if (child >= 0) { break; }
          cursor--;
        }
        if (cursor >= 0) {
          parents[depth] = nodeIdx;
          nextChildren[depth] = cursor - 1;
          depth++;
          nodeIdx = child;
          continue;
        }
      }
    }

    var foundNext = false;
    loop {
      if (depth == 0) { break; }
      let frame = depth - 1;
      var cursor = nextChildren[frame];
      while (cursor >= 0) {
        let child = nodes[parents[frame]].children[cursor];
        cursor--;
        if (child >= 0) {
          nextChildren[frame] = cursor;
          nodeIdx = child;
          foundNext = true;
          break;
        }
      }
      if (foundNext) { break; }
      depth--;
    }
    if (!foundNext) { break; }
  }

  // Limit acceleration
  let accLen = length(newAcc);
  if (accLen > 1000.0) {
    newAcc = normalize(newAcc) * 1000.0;
  }

  bodies[id.x].acc = newAcc;
  
  // Second Kick
  bodies[id.x].vel += 0.5 * newAcc * params.deltaTime;
  
  // Limit velocity
  let speed = length(bodies[id.x].vel);
  if (speed > 1000.0) {
     bodies[id.x].vel = normalize(bodies[id.x].vel) * 1000.0;
  }
}
