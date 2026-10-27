# GPU performance experiments

Run `npm run benchmark`, then open one of the URLs below in a WebGPU browser.
The server listens only on `127.0.0.1:5174`. `npm run benchmark:check` type-checks
the harness. Results append to `results/runs.jsonl`; render comparisons also save
PNG images there. These generated files are ignored by Git.

The immutable `baseline/` shaders were copied from commit
`3d96af0e7fa5f79955f2677016458df2a93661fb`. `candidates/` contains the isolated
experiments, including the rejected compact traversal. The production route reads
the current application shaders. The normal build does not include this harness.

## Reproduce

Run one page at a time, with other GPU-intensive pages closed:

| Experiment | URL after `http://127.0.0.1:5174` |
| --- | --- |
| Original compute | `/benchmarks/?run=baseline` |
| Production compute | `/benchmarks/?run=production&production` |
| Spheres/quads, full/half bloom | `/benchmarks/?run=render&render` |
| Root reduction only | `/benchmarks/?run=root&reducedTree` |
| Skip clearing node geometry | `/benchmarks/?run=geometry&clear=geometry` |
| GPU-driven clearing of used nodes | `/benchmarks/?run=used&clear=used` |
| 64-thread force workgroups | `/benchmarks/?run=wg64&workgroup=64` |
| 128-thread force workgroups | `/benchmarks/?run=wg128&workgroup=128` |
| Interleaved workgroup comparison on identical trees | `/benchmarks/?run=sweep&production&sweep` |
| Compact traversal stack | `/benchmarks/?run=compact&compact` |
| Partial workgroups and small counts | `/benchmarks/?run=edge&production&edge` |
| 120 evolving steps at maximum gravity | `/benchmarks/?run=stress&production&evolve&gravity=100` |

Append `&quick` to use 4,096 and 131,072 bodies instead of including 262,144.
Keep the page open until it says **Finished**. Errors are displayed and recorded.

## Method

- Windows, Chromium 156, NVIDIA Lovelace adapter. The browser did not expose the
  exact GPU model. Measurements are specific to this device.
- Seed `123456789`, the application's disk distribution, softening 3, theta 0.5,
  and a fixed 1/60-second timestep. One and two galaxies at both production counts.
- Compute: WebGPU timestamp queries around each actual WGSL pass, four warmup
  steps and 15 measured steps. Each ordinary sample starts from the same body
  state; tree allocation order can vary because it uses atomics.
- Render: actual Babylon scene/material/postprocessing, fixed 1920×1080 canvas,
  30 warmup frames and 30 measured frames per variant. Two rounds, with the
  second in reverse order. The render interval is bracketed by GPU timestamped
  passes and includes gaps between command submissions. It excludes RAF/vsync
  waiting; these values are not measurements of displayed FPS.
- The browser quantizes timestamps in approximately 0.065536 ms increments.
  A reported zero for a short pass means below this resolution, not zero cost.
- The final baseline was repeated after the experiments. Workgroup sizes were
  also compared in alternating order against the exact same resident tree.

## Results, 27 October 2026

Representative median times in milliseconds. Full measurements, including
individual experiments, variability, and correctness results, are in
[`results/measurements.json`](results/measurements.json).

| Workload | Original | Optimized |
| --- | ---: | ---: |
| Render, 131,072 bodies, 1080p | 5.96–6.03 | 0.59 |
| Render, 262,144 bodies, 1080p | about 10.3 | 0.72–0.79 |
| Physics step, 131,072, single galaxy | 10.0–10.7 | 9.04 |
| Physics step, 131,072, twin galaxies | about 10.0 | 8.91 |
| Physics step, 262,144, single galaxy | about 22.1 | 20.64 |
| Physics step, 262,144, twin galaxies | 22.5–22.7 | 20.71 |

Decisions made before integrating candidates into the application:

- **Keep particle quads.** With full bloom, 131,072 bodies dropped from about
  6 ms to 0.85–0.92 ms. Each quad draws a circular silhouette and writes spherical
  depth. Geometry falls from 400 to two triangles per body.
- **Keep half-resolution bloom.** It reduced quad rendering to about 0.59 ms.
  Saved full-resolution images were visually inspected. The combined quad/half
  image differed from the original by mean absolute RGB values of approximately
  0.21, 0.19, and 0.51 on a 0–255 scale. It is visually close, not pixel-identical.
- **Keep root reduction.** Tree construction alone fell from about 0.9 to 0.5 ms
  at 131,072 bodies, and about 1.6 to 0.9 ms at 262,144. Contributions are still
  rounded per body before integer reduction. This is a focused change to the
  existing tree; a Morton-sorted tree rewrite was not attempted.
- **Keep clearing only used nodes.** Prepare plus clear measured at or below
  roughly 0.066 ms, versus 0.13–0.20 ms / 0.33 ms for full clearing. The GPU
  generates the dispatch count from the previous allocator value, including
  abandoned allocations. A full first clear is retained after every restart.
- **Keep 64-thread force workgroups.** The matched-tree comparison improved
  force time by approximately 2–5% at the production counts. Acceleration outputs
  were identical to the original traversal on the same tree.
- **Reject the compact stack.** Its 32 parent/cursor pairs produced the same
  accelerations but increased force time to about 9.7 ms / 21–22 ms. Keep the
  original 256-index traversal stack. The 128-thread variant was also slower than
  64 threads in the matched-tree experiment.

## Correctness and integration

The harness checks finite particle data, allocator capacity, all leaf membership
for small cases, and forces against an independent double-precision CPU direct
summation for up to 64 sampled bodies (including the central bodies). It also
compares every acceleration against the original GPU traversal on the same tree.
That comparison had zero component difference in the tested cases. CPU-relative
RMS force errors stayed around 0.15–0.54%, matching the baseline approximation.
Maximum individual relative errors can be larger where net forces nearly cancel;
this is not a claim that every body's force is within 0.54%.

Small-count tests cover 1, 2, 255, 257, 513, and 4,097 bodies. The evolving stress
test runs 120 measured steps plus warmup at gravity 100, including both large
counts and both galaxy modes. These checks passed.

The application also gates its first simulation step on all compute shaders being
ready, so an incomplete startup cannot reset the allocation count before clearing.
The live Babylon integration was checked for startup, restart, body-count changes,
and twin galaxies. The indirect buffer retains COPY_DST support because Babylon
initializes its storage buffers with a queue upload.
