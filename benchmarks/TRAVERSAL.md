# Further physics optimization, 28 October 2026

Baseline: `c03ea56f65635fe37d6e655b1f06f2daf1a80114` (the version present at the
start of this round). `traversal-baseline/` contains all 12 compute shaders from
that commit, verified against Git. Every candidate was benchmarked and checked
before integrating the winning combination.

## Integrated result

Median GPU milliseconds per complete physics step, including integration, tree
construction, ordering, traversal preparation, and forces:

| Bodies | Galaxies | Starting version | New production | Reduction |
| ---: | --- | ---: | ---: | ---: |
| 131,072 | Single | 5.77 | 4.39 | 23.9% |
| 131,072 | Twin | 5.64 | 4.00 | 29.1% |
| 262,144 | Single | 10.81 | 8.32 | 23.0% |
| 262,144 | Twin | 11.86 | 8.65 | 27.1% |

The 4,096-body check also improved, from 0.72 to 0.52 ms. These are physics GPU
times, not displayed FPS. Windows/Chromium 156 exposed an NVIDIA Lovelace adapter
without its exact model. Other GPU architectures were not tested. Absolute times
varied between runs; each comparison alternates candidates with the same baseline
in the same run. Use these paired results rather than comparing different days.

Additional GPU storage versus the starting version is 7.03125 MiB at either
supported body count: the histogram grows from 1 to 8 MiB, plus 32 KiB of block
totals. Node decoding reuses existing storage. Rendering and the numerical
integration, gravity, softening, theta, and force summation order are unchanged.

## Kept changes

1. **Parallel histogram scan.** The previous single workgroup spent about 0.26 ms
   scanning the entire histogram. The new first pass scans independent 256-bin
   blocks with contiguous reads. A second pass scans their totals. Scatter adds
   the block offset, local bin offset, and particle rank. All offsets are integer
   and the resulting body IDs form a complete permutation.
2. **128 spatial cells per axis.** Grids of 64, 128, and 256 were compared with
   the parallel scan. The 128-cell grid gave the best overall tradeoff for the
   supported workloads, especially doubled bodies with twin galaxies. It changes
   invocation ordering only; particle storage and physical body IDs stay stable.
3. **Decode mass and center of mass once per node.** The existing successor-link
   pass converts the four integer accumulation slots in place into f32 COM xyz
   and mass. Force traversal reinterprets those values instead of repeatedly
   converting integers and dividing. The next clear resets those slots before
   tree construction. The conversion leaves children and geometry unchanged, and
   other invocations in this pass read only children from neighboring nodes.
4. **256-thread force groups.** Sizes 32, 64, 128, and 256 were measured. The
   smaller arithmetic workload benefits from 256 threads. The earlier preference
   for 64 threads applied to a different force kernel; it was retested here.

The scan, grid sizes, workgroup sizes, and in-place decoding were first measured
as separate or incremental candidates. The final combination was then tested
with the actual application shaders. Combining decoding with the successor pass
avoids adding another dispatch and retains the measured gain.

## Rejected candidates

- A separate packed position/mass buffer gave small gains in some cases but did
  not consistently help the final combination, even when populated by integration.
- Capturing parents inside tree construction and indirectly dispatching only
  allocated nodes did not consistently improve full-step time.
- A 256-cell grid increased histogram work and memory enough to offset traversal
  gains. Its prototype uses a 2D dispatch to respect WebGPU's per-axis limit.
- Precomputing gravity-times-mass and squared node sizes preserved the checked
  outputs but was slower than decoding only mass and center of mass.
- 32-thread groups were slower; 128 threads were an intermediate improvement.

All prototypes remain in `traversal-candidates/`, isolated from the app.

## Validation

- Every body's position, velocity, and acceleration matched the baseline exactly
  in each checked state. The benchmark fails on any nonzero component difference.
- The evolving test runs 120 measured steps plus four warmup steps at gravity 100,
  checking every state for 4,096 bodies and both production counts in both galaxy
  modes. All 124 states per workload passed. Each candidate starts a step from
  the preceding baseline output; per-step equality establishes equality along
  that trajectory, including reuse and clearing of decoded node memory.
- A second seed (`987654321`) passed using the production shaders at both body
  counts and galaxy modes.
- Counts 1, 2, 63, 65, 255, 257, and 4,097 passed, including a production run at
  zero gravity. Checks include finite values, allocator capacity, permutations,
  unique membership of every body in the tree, and all reachable successor links.
- Independent double-precision direct summation checks up to 64 sampled bodies,
  including central bodies. Relative RMS force errors were about 0.15–0.54%,
  consistent with the unchanged approximation. This is not a per-body error bound.
- The TypeScript benchmark check, production build, and whitespace check passed.
  Live app validation covered startup, restart, both body counts, twin galaxies,
  and gravity changes without GPU/console errors.

The new block buffer is allocated, bound, and disposed alongside the histogram.
The block scan writes every block total each step. Its shader participates in
the existing startup readiness gate, preventing partial initial simulation steps.

## Reproduce

Run `npm run benchmark` and open one URL at a time after `http://127.0.0.1:5174`.
Wait for **Finished**. Avoid other GPU-intensive pages while measuring.

| Experiment | URL path |
| --- | --- |
| Current production vs `c03ea56` | `/benchmarks/?run=traversal-production&production` |
| All candidates | `/benchmarks/?run=traversal-suite&traversal=suite` |
| First screening batch | `/benchmarks/?run=traversal-screen&traversal=parallel64,parallel128,wg32,wg128,packed,parallel128-packed,tree-parents,indirect` |
| Finalists | `/benchmarks/?run=traversal-finalists&traversal=wg256,fused256,fused64-wg256,precompute256` |
| Evolving candidate regression | `/benchmarks/?run=traversal-evolving&traversal=fused256&evolve&gravity=100` |
| Evolving production regression | `/benchmarks/?run=traversal-production-evolving&production&evolve&gravity=100` |
| Second seed | `/benchmarks/?run=traversal-second-seed&production&seed=987654321` |
| Edge counts | `/benchmarks/?run=traversal-edge&traversal=fused256&edge` |
| Zero gravity | `/benchmarks/?run=traversal-zero-gravity&production&edge&gravity=0` |

`&quick` selects 131,072 bodies and one galaxy. Normal runs use four warmup rounds
and 24 measured rounds; evolving runs use 120 measured rounds. Dispatch order is
the app's order. Each phase has GPU timestamps, and total time spans the first
phase's start to the final force phase's end. CPU work, buffer readback, and
restoring inputs are outside that interval. The timestamp granularity is about
0.065536 ms; a zero phase measurement means below resolution, not zero work.

[`results/traversal-measurements.json`](results/traversal-measurements.json) saves
the latest complete run for each experiment, including per-phase profiles,
medians, minima, p90s, and correctness checks. Failed or interrupted development
runs are excluded. The earlier reports remain in [PHYSICS.md](PHYSICS.md) and
[README.md](README.md); `&round2` reproduces the second-round result and `&previous`
selects the first-round result without using today's changed constants.
