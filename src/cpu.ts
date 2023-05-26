import { Vector3 } from "@babylonjs/core";

interface Cell {
  pos: Vector3;
  mass: number;
}
export type Octree = Array<{
  size: number;
  cells: Array<Cell>;
}>;

export const buildOctreeCPU = (depth: number, spaceLimit: number) => {
  const octree: Octree = [];
  for (let currDepth = 0; currDepth < depth; currDepth++) {
    const nodesAtDepth = Math.pow(8, currDepth);
    const dimAtDepth = Math.pow(2, currDepth);
    const cellSize = (spaceLimit * 4) / Math.pow(2, currDepth);
    octree[currDepth] = {
      size: cellSize,
      cells: [],
    };
    for (let j = 0; j < nodesAtDepth; j++) {
      const { x, y, z } = mortonDecode3D(j);
      const pos = new Vector3(
        cellSize * (x + 1 / 2 - dimAtDepth / 2),
        cellSize * (y + 1 / 2 - dimAtDepth / 2),
        cellSize * (z + 1 / 2 - dimAtDepth / 2)
      );
      const mass = 0;
      octree[currDepth].cells[j] = {
        pos,
        mass,
      };
    }
  }
  return octree;
};

export const clearOctreeCPU = (octree: Octree) => {
  for (let i = 0; i < octree.length; i++) {
    for (let j = 0; j < octree[i].cells.length; j++) {
      octree[i].cells[j].mass = 0;
    }
  }
};

export const getGridPos = (
  pos: Vector3,
  spaceLimit: number,
  cellSize: number
) => {
  let x = Math.floor((pos.x + spaceLimit * 2) / cellSize);
  let y = Math.floor((pos.y + spaceLimit * 2) / cellSize);
  let z = Math.floor((pos.z + spaceLimit * 2) / cellSize);
  return new Vector3(x, y, z);
};

export const fillOctreeCPU = (
  octree: Octree,
  bodiesArr: Float32Array,
  spaceLimit: number
) => {
  let maxDepth = octree.length - 1;
  const cellSize = (spaceLimit * 4) / Math.pow(2, maxDepth);
  for (let i = 0; i < bodiesArr.length / 12; i++) {
    let pos = new Vector3(
      bodiesArr[i * 12 + 0],
      bodiesArr[i * 12 + 1],
      bodiesArr[i * 12 + 2]
    );
    const gridPos = getGridPos(pos, spaceLimit, cellSize);
    let morton = mortonEncode3D(gridPos);
    if (morton < octree[maxDepth].cells.length) {
      for (let depth = maxDepth; depth >= 0; depth--) {
        octree[depth].cells[morton].mass += 1;
        morton = morton >> 3;
      }
    }
  }
};

export const calculateBodiesCPU = (
  bodiesArr: Float32Array,
  numBodies: number,
  octree: Octree,
  gravity: number,
  softeningFactor: number,
  dt: number
) => {
  let bodyMass = 1;
  const theta = 1;
  const minDistSq = Math.max(0.5, Math.pow(octree[octree.length - 1].size, 2));
  const path = new Array(octree.length).fill(0);

  const boxes = [];

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
    let depth = 0;
    path[depth] = 0;

    while (depth >= 0) {
      let morton = path[depth];
      let cell = octree[depth].cells[morton];

      // If cell isn't empty calculate distance from body to cell
      if (cell.mass > 0) {
        let r = cell.pos.subtract(pos);
        let distSq = Math.max(r.lengthSquared(), softeningFactor);
        let distCheck = (octree[depth].size / theta) ** 2;

        // We are far enough away that we can use this as an approximation
        if (distSq > distCheck || depth == octree.length - 1) {
          if (distSq > minDistSq) {
            let f = gravity * ((bodyMass * cell.mass) / distSq);
            let a = f / bodyMass;
            let direction = r.scale(1 / Math.sqrt(distSq));
            newAcc.addInPlace(direction.scale(a));
          }

          // add visualization
          if (i === 0) {
            boxes.push({
              pos: cell.pos,
              size: octree[depth].size,
              mass: cell.mass,
            });
          }
        } else {
          // We are not far enough away so we need to go deeper
          ++depth;
          path[depth] = morton << 3;
          continue;
        }
      }

      // Move to next sibling
      if (depth >= 0) {
        ++path[depth];
        while ((path[depth] & 7) === 0) {
          // We've visited all siblings so backtrack up to parent
          --depth;
          if (depth > 0) {
            ++path[depth];
          } else {
            // We've finished visiting the tree
            depth = -1;
            break;
          }
        }
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
  return boxes;
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
