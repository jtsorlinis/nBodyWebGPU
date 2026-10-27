import { createRotationCurve } from '../src/utils';
export const options = new URLSearchParams(location.search);
const run = options.get('run') ?? 'baseline';
const output = document.querySelector('#results')!;
export const status = document.querySelector('#status')!;
export async function report(row: Record<string, unknown>) {
  const entry = { run, ...row };
  output.textContent += JSON.stringify(entry) + '\n';
  await fetch('/__bench', { method: 'POST', body: JSON.stringify(entry) });
}

export function initialBodies(count: number, twin = false, seed = 123456789) {
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const radius = Math.cbrt(count / (twin ? 2 : 1)) * 10;
  const speedAt = createRotationCurve({ gravity: 5, centralMass: count / 2,
    diskMass: count / (twin ? 2 : 1), rMin: radius * .1, rMax: radius,
    halfThickness: radius * .05, softening: 3 });
  const result = new Float32Array(count * 12);
  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt(.01 + random() * .99);
    const angle = random() * Math.PI * 2;
    const x = r * Math.cos(angle), z = r * Math.sin(angle);
    const offset = twin ? (i < count / 2 ? -1.5 : 1.5) * radius : 0;
    result[i * 12] = x + offset;
    result[i * 12 + 1] = (random() - .5) * radius * .1;
    result[i * 12 + 2] = z;
    const speed = speedAt(r) * (.8 + random() * .4);
    result[i * 12 + 4] = -z / r * speed;
    result[i * 12 + 6] = x / r * speed;
    result[i * 12 + 11] = .5 + random();
  }
  for (let i = 0; i < (twin ? 2 : 1); i++) {
    result.set([twin ? (i === 0 ? -1.5 : 1.5) * radius : 0, 0, 0, 0, 0, 0, 0], i * 12);
    result[i * 12 + 11] = count / 2;
  }
  return result;
}

export function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0],
    p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .9))] };
}

