import { Vector3 } from "@babylonjs/core";

export const buildOctreeCPU = (depth: number, spaceLimit: number) => {
  const octree: any = [];
  for (let currDepth = 0; currDepth < depth; currDepth++) {
    const nodesAtDepth = Math.pow(8, currDepth);
    const dimAtDepth = Math.pow(2, currDepth);
    octree[currDepth] = [];
    for (let j = 0; j < nodesAtDepth; j++) {
      octree[currDepth][j] = {};
      const { x, y, z } = mortonDecode3D(j);
      const cellSize = (spaceLimit * 4) / Math.pow(2, currDepth);
      octree[currDepth][j].pos = new Vector3(
        cellSize * (x + 1 / 2 - dimAtDepth / 2),
        cellSize * (y + 1 / 2 - dimAtDepth / 2),
        cellSize * (z + 1 / 2 - dimAtDepth / 2)
      );
      octree[currDepth][j].mass = 0;
    }
  }
  return octree;
};

export const clearOctreeCPU = (octree: any) => {
  for (let i = 0; i < octree.length; i++) {
    for (let j = 0; j < octree[i].length; j++) {
      octree[i][j].mass = 0;
    }
  }
};

export const getGridPos = (pos: Vector3, spaceLimit: number, depth: number) => {
  const cellSize = (spaceLimit * 4) / Math.pow(2, depth);
  let x = Math.floor((pos.x + spaceLimit * 2) / cellSize);
  let y = Math.floor((pos.y + spaceLimit * 2) / cellSize);
  let z = Math.floor((pos.z + spaceLimit * 2) / cellSize);
  return new Vector3(x, y, z);
};

export const fillOctreeCPU = (
  octree: any,
  bodiesArr: Float32Array,
  spaceLimit: number
) => {
  let maxDepth = octree.length - 1;
  for (let i = 0; i < bodiesArr.length / 12; i++) {
    let pos = new Vector3(
      bodiesArr[i * 12 + 0],
      bodiesArr[i * 12 + 1],
      bodiesArr[i * 12 + 2]
    );
    const gridPos = getGridPos(pos, spaceLimit, maxDepth);
    let morton = mortonEncode3D(gridPos);
    if (morton < octree[maxDepth].length) {
      for (let depth = maxDepth; depth > 0; depth--) {
        octree[depth][morton].mass += 1;
        morton = morton >> 3;
      }
    }
  }
};

export const calculateBodiesCPU = (
  bodiesArr: Float32Array,
  numBodies: number,
  gravity: number,
  softeningFactor: number,
  dt: number
) => {
  const mass = 1;
  for (let i = 0; i < numBodies; i++) {
    let pos = new Vector3(
      bodiesArr[i * 12 + 0],
      bodiesArr[i * 12 + 1],
      bodiesArr[i * 12 + 2]
    );
    let vel = new Vector3(
      bodiesArr[i * 12 + 4],
      bodiesArr[i * 12 + 5],
      bodiesArr[i * 12 + 6]
    );
    let acc = new Vector3(
      bodiesArr[i * 12 + 8],
      bodiesArr[i * 12 + 9],
      bodiesArr[i * 12 + 10]
    );

    // First "Kick": Half update of the velocity
    vel.addInPlace(acc.scale(dt * 0.5));

    // "Drift": Full update of the position
    pos.addInPlace(vel.scale(dt));

    // Compute new acceleration
    let newAcc = new Vector3(0, 0, 0);
    for (let j = 0; j < numBodies; j++) {
      if (i != j) {
        let otherPos = new Vector3(
          bodiesArr[j * 12 + 0],
          bodiesArr[j * 12 + 1],
          bodiesArr[j * 12 + 2]
        );
        let r = otherPos.subtract(pos);
        let distSq = Math.max(r.lengthSquared(), softeningFactor);
        let f = gravity * ((mass * mass) / distSq);
        let a = f / mass;
        let direction = r.scale(1 / Math.sqrt(distSq));
        newAcc.addInPlace(direction.scale(a));
      }
    }

    // Store the new acceleration for the next timestep
    acc = newAcc;

    // Second "Kick": Another half update of the velocity
    vel.addInPlace(acc.scale(dt * 0.5));

    // Write the updated body back
    bodiesArr[i * 12 + 0] = pos.x;
    bodiesArr[i * 12 + 1] = pos.y;
    bodiesArr[i * 12 + 2] = pos.z;
    bodiesArr[i * 12 + 4] = vel.x;
    bodiesArr[i * 12 + 5] = vel.y;
    bodiesArr[i * 12 + 6] = vel.z;
    bodiesArr[i * 12 + 8] = acc.x;
    bodiesArr[i * 12 + 9] = acc.y;
    bodiesArr[i * 12 + 10] = acc.z;
  }
};

function mortonEncode3D(pos: Vector3) {
  let { x, y, z } = pos;
  x = (x | (x << 16)) & 0x030000ff;
  x = (x | (x << 8)) & 0x0300f00f;
  x = (x | (x << 4)) & 0x030c30c3;
  x = (x | (x << 2)) & 0x09249249;

  y = (y | (y << 16)) & 0x030000ff;
  y = (y | (y << 8)) & 0x0300f00f;
  y = (y | (y << 4)) & 0x030c30c3;
  y = (y | (y << 2)) & 0x09249249;

  z = (z | (z << 16)) & 0x030000ff;
  z = (z | (z << 8)) & 0x0300f00f;
  z = (z | (z << 4)) & 0x030c30c3;
  z = (z | (z << 2)) & 0x09249249;

  return x | (y << 1) | (z << 2);
}

function mortonDecode3D(morton: number) {
  var xyz = [0, 0, 0];

  xyz[0] = morton;
  xyz[1] = morton >> 1;
  xyz[2] = morton >> 2;

  for (var i = 0; i < 3; ++i) {
    xyz[i] &= 0x09249249;
    xyz[i] = (xyz[i] ^ (xyz[i] >> 2)) & 0x030c30c3;
    xyz[i] = (xyz[i] ^ (xyz[i] >> 4)) & 0x0300f00f;
    xyz[i] = (xyz[i] ^ (xyz[i] >> 8)) & 0x030000ff;
    xyz[i] = (xyz[i] ^ (xyz[i] >> 16)) & 0x000003ff;
  }

  return new Vector3(xyz[0], xyz[1], xyz[2]);
}
