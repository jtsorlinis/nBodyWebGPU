import { Vector3 } from "@babylonjs/core";

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
