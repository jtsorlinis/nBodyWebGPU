# Physics traversal optimization, 27 October 2026

Baseline: `4e790f30fe4b382f4e8fb3556fd91e926792f6fb` (the version present at the
start of this work). The six shaders in `physics-baseline/` are exact snapshots
of that commit. Rendering, tree construction, timestep, softening, theta, and
force arithmetic are unchanged by this round.

## Final production comparison

Median GPU milliseconds for a complete physics step, including integration,
tree construction, and all new preparation passes:

| Bodies | Galaxies | Baseline | Production | Time reduction |
| ---: | --- | ---: | ---: | ---: |
| 131,072 | Single | 8.26 | 5.05 | 38.9% |
| 131,072 | Twin | 8.13 | 5.18 | 36.3% |
| 262,144 | Single | 19.01 | 11.08 | 41.7% |
| 262,144 | Twin | 18.87 | 12.06 | 36.1% |

These are compute timings, not displayed frame rates. The test device exposed
NVIDIA Lovelace, but no exact model, on Windows/Chromium 156. Performance on other
GPUs is unmeasured. The extra buffers use 14.5 MiB at 131,072 bodies and 28 MiB at
262,144. At an artificial 4,096-body workload, preparation overhead increases a
step from 0.46 to 0.72 ms; the app's supported counts are 131,072 and 262,144.

## Changes tested before integration

Each comparison alternated variant order against the baseline on the same
resident tree. Preparation passes were included in every candidate's timing.
All tested candidates produced identical accelerations and velocities.

- **Keep direct node-field reads.** Avoid copying the entire node, including its
  child array, into a local value. Default single-galaxy force time went from
  7.67 to 7.08 ms in the saved screening run. This also helped the other production
  workloads.
- **Keep spatial ordering of force targets.** A GPU histogram, prefix scan, and
  scatter group invocation IDs by Morton cell. The particle buffers and body IDs
  remain in their original order. Nearby lanes follow similar tree paths. Alone,
  ordering reduced default force time from 7.67 to 6.09 ms. With direct reads it
  reached about 5.57 ms. Grids of 16, 32, and 64 cells per axis were compared; 64
  was the best overall choice for the larger and twin-galaxy cases.
- **Keep subtree successor links.** Two passes derive parents and the next
  internal node after each subtree. The force shader follows these links instead
  of maintaining a private 256-index stack. Leaf accumulation remains ascending
  by octant and internal traversal descending, preserving the baseline's exact
  summation order. Combined default force time was about 4.46 ms, versus 5.57 ms
  for direct reads plus spatial ordering and 7.67 ms for the baseline.
- **Reject child-loop unrolling.** It added code without a consistent advantage
  beyond direct reads.
- **Reject 32-thread force workgroups.** They did not improve on the existing 64.
- **Reject predecoded node aggregates.** Preparing a separate mass/center buffer
  increased default force time to 9.11 ms alone, or 6.23 ms with direct reads and
  spatial ordering. Extra memory traffic outweighed the saved arithmetic.

The prototypes are retained in `physics-candidates/`; rejected variants are not
used by the app. The final comparison imports the production force shader and
all six production preparation shaders.

## Correctness checks

- Every body's position, velocity, and acceleration matched the baseline exactly
  in the full-step runs, including a second random seed (`987654321`).
- The high-gravity test rebuilt the tree for 120 measured steps plus four warmup
  steps at gravity 100. All 124 states matched exactly at both production counts,
  in both galaxy modes, and at 4,096 bodies. Each variant starts a step from the
  baseline's preceding state; checking every state makes equality inductive over
  this trajectory. Readback and comparison happen outside the timed region.
- Singleton and partial-workgroup counts: 1, 2, 63, 65, 255, 257, and 4,097.
- Checks validate finite values, allocator capacity, a complete permutation of
  body IDs, unique leaf membership for every body, and every reachable node's
  subtree successor against a CPU traversal of the rebuilt tree.
- Independent double-precision direct summation checks up to 64 sampled bodies,
  including central bodies. The normal full-step tests had about 0.15–0.54%
  relative RMS force error, consistent with the unchanged Barnes–Hut approximation.
  This is an aggregate error, not a per-body error bound.
- `npm run benchmark:check`, `npm run build`, and `git diff --check` passed.
  Live Babylon checks covered startup, restart, doubled body count, twin galaxies,
  and maximum gravity without console/GPU validation errors.

Parent entries for reachable internal nodes are rewritten after every tree build.
The root retains a zero parent sentinel. Allocations abandoned by the tree's CAS
loop contain only a body leaf and cannot overwrite a reachable node's parent.
Stale parent data for unreachable allocations is never used by force traversal;
the successor preparation's ancestor search is bounded to 32 iterations, covering
the tree's existing maximum depth. All new buffers are rebound and disposed on
restart, and all new shaders participate in the startup readiness gate.

## Reproduce

Run `npm run benchmark`, then open one URL at a time in a WebGPU browser. Close
other GPU-intensive pages and wait for **Finished**. The server binds only to
`127.0.0.1:5174`.

| Comparison | URL path |
| --- | --- |
| Current production vs this baseline | `/benchmarks/?run=physics-production&production` |
| All individual candidates | `/benchmarks/?run=physics-suite&physics=suite` |
| Successor and ordering combinations, full step | `/benchmarks/?run=physics-full&physics=rope-suite&mode=full` |
| Every evolving state at maximum gravity | `/benchmarks/?run=physics-evolving&physics=rope-order64&evolve&gravity=100` |
| Production evolving-state regression | `/benchmarks/?run=physics-production-stress&production&evolve&gravity=100` |
| Partial workgroups | `/benchmarks/?run=physics-edge&physics=rope-order64&mode=full&edge` |
| Second seed | `/benchmarks/?run=physics-second-seed&physics=rope-order64&mode=full&seed=987654321` |

Use `physics=direct-loads`, `unrolled`, `wg32`, `ordering`, or `decode-suite` to
select smaller subsets. `&quick` restricts this new harness to 131,072 bodies and
one galaxy. Ordinary comparisons have four warmup rounds and 24 measured rounds;
evolving comparisons have 120 measured rounds. Variant order alternates each
round. Timestamps span all dispatches in a full step, with readbacks and resetting
the shared input outside timing. Timestamp resolution is approximately 0.065536 ms.

[`results/physics-measurements.json`](results/physics-measurements.json) preserves
the latest complete run for each experiment, including medians, minima, p90s,
environment, and correctness results. Interrupted hot-reload runs are excluded.
The previous optimization round remains documented in [README.md](README.md).
