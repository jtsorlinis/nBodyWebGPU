import { Vector3 } from "@babylonjs/core";

export interface Cell {
  pos: Vector3;
  size: number;
  mass: number;
  centerOfMass: Vector3;
  children: Cell[];
}

const createCell = (pos: Vector3, size: number): Cell => {
  return {
    pos,
    size,
    mass: 0,
    centerOfMass: new Vector3(0, 0, 0),
    children: [],
  };
};

const isInCell = (cell: Cell, pos: Vector3) => {
  const { x, y, z } = pos;
  const { x: cx, y: cy, z: cz } = cell.pos;
  const { size } = cell;
  return (
    x >= cx - size / 2 &&
    x <= cx + size / 2 &&
    y >= cy - size / 2 &&
    y <= cy + size / 2 &&
    z >= cz - size / 2 &&
    z <= cz + size / 2
  );
};

const createChildren = (cell: Cell) => {
  const { x, y, z } = cell.pos;
  const childSize = cell.size / 2;
  cell.children.push(
    createCell(
      new Vector3(x - childSize / 2, y - childSize / 2, z - childSize / 2),
      childSize
    ),
    createCell(
      new Vector3(x - childSize / 2, y - childSize / 2, z + childSize / 2),
      childSize
    ),
    createCell(
      new Vector3(x - childSize / 2, y + childSize / 2, z - childSize / 2),
      childSize
    ),
    createCell(
      new Vector3(x - childSize / 2, y + childSize / 2, z + childSize / 2),
      childSize
    ),
    createCell(
      new Vector3(x + childSize / 2, y - childSize / 2, z - childSize / 2),
      childSize
    ),
    createCell(
      new Vector3(x + childSize / 2, y - childSize / 2, z + childSize / 2),
      childSize
    ),
    createCell(
      new Vector3(x + childSize / 2, y + childSize / 2, z - childSize / 2),
      childSize
    ),
    createCell(
      new Vector3(x + childSize / 2, y + childSize / 2, z + childSize / 2),
      childSize
    )
  );
};

const addBodyToCell = (cell: Cell, bodyPos: Vector3, bodyMass: number) => {
  cell.centerOfMass
    .addInPlace(bodyPos.scale(bodyMass))
    .scaleInPlace(1 / (cell.mass + bodyMass));
  cell.mass += bodyMass;
};

const insertBody = (cell: Cell, bodyPos: Vector3, bodyMass: number) => {
  let inserted = false;
  let currCell = cell;
  if (isInCell(currCell, bodyPos)) {
    while (!inserted) {
      if (currCell.mass === 0) {
        // We've reached an empty leaf cell
        addBodyToCell(currCell, bodyPos, bodyMass);
        // we've inserted the body, so we're done
        inserted = true;
      } else {
        // we've reached a non-empty cell
        if (currCell.children.length === 0) {
          // we've reached a leaf cell so we need to subdivide
          createChildren(currCell);
          // Add the previous body to the correct child
          for (let i = 0; i < currCell.children.length; i++) {
            if (isInCell(currCell.children[i], currCell.centerOfMass)) {
              addBodyToCell(
                currCell.children[i],
                currCell.centerOfMass,
                currCell.mass
              );
              break;
            }
          }
        }
        addBodyToCell(currCell, bodyPos, bodyMass);
        // Set the current cell to the correct child
        for (let i = 0; i < currCell.children.length; i++) {
          if (isInCell(currCell.children[i], bodyPos)) {
            currCell = currCell.children[i];
            break;
          }
        }
      }
    }
  }
};

export const createOctree = (bodiesArr: Float32Array, size: number) => {
  const root = createCell(new Vector3(0, 0, 0), size);

  for (let i = 0; i < bodiesArr.length / 12; i++) {
    const bodyPos = new Vector3(
      bodiesArr[i * 12 + 0],
      bodiesArr[i * 12 + 1],
      bodiesArr[i * 12 + 2]
    );
    const bodyMass = bodiesArr[i * 12 + 11];
    insertBody(root, bodyPos, bodyMass);
  }

  return root;
};

export const calculateForceOnBody = (
  bodyPos: Vector3,
  bodyMass: number,
  gravity: number,
  softeningFactor: number,
  cell: Cell,
  theta: number
) => {
  let accel = new Vector3(0, 0, 0);
  const r = cell.centerOfMass.subtract(bodyPos);
  const distSq = Math.max(r.lengthSquared(), softeningFactor);
  if (distSq > Math.pow(cell.size / theta, 2) || cell.children.length === 0) {
    if (cell.mass > 0 && distSq > softeningFactor) {
      const f = gravity * ((bodyMass * cell.mass) / distSq);
      const a = f / bodyMass;
      const direction = r.scale(1 / Math.sqrt(distSq));
      accel.addInPlace(direction.scale(a));
    }
  } else {
    for (let i = 0; i < cell.children.length; i++) {
      const res = calculateForceOnBody(
        bodyPos,
        bodyMass,
        gravity,
        softeningFactor,
        cell.children[i],
        theta
      );
      accel.addInPlace(res);
    }
  }
  return accel;
};
