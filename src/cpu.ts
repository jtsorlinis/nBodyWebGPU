import { Vector3 } from "@babylonjs/core";
import { Cell, calculateForceOnBody } from "./octree";

const theta = 1;

export const calculateBodiesCPU = (
  bodiesArr: Float32Array,
  numBodies: number,
  gravity: number,
  softeningFactor: number,
  dt: number,
  octree: Cell
) => {
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
    const mass = bodiesArr[i * 12 + 11];

    // First "Kick": Half update of the velocity
    vel.addInPlace(acc.scale(dt * 0.5));

    // "Drift": Full update of the position
    pos.addInPlace(vel.scale(dt));

    // Compute new acceleration
    let newAcc = new Vector3(0, 0, 0);

    // Calculate force from octree
    const accel = calculateForceOnBody(
      pos,
      mass,
      gravity,
      softeningFactor,
      octree,
      theta
    );
    newAcc.addInPlace(accel);

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
