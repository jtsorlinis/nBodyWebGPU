@group(0) @binding(0) var<storage, read_write> counts: array<u32>;
@group(0) @binding(1) var<storage, read_write> blocks: array<u32>;
var<workgroup> sums: array<u32, 256>;

// One workgroup per complete 256-bin block. Keep local exclusive offsets in
// counts and write each block's total for the second scan level.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>,
        @builtin(local_invocation_id) local: vec3<u32>,
        @builtin(workgroup_id) group: vec3<u32>) {
  let value = counts[id.x];
  sums[local.x] = value;
  workgroupBarrier();
  for (var stride = 1u; stride < 256u; stride <<= 1u) {
    var addend = 0u;
    if (local.x >= stride) { addend = sums[local.x - stride]; }
    workgroupBarrier();
    sums[local.x] += addend;
    workgroupBarrier();
  }
  counts[id.x] = sums[local.x] - value;
  if (local.x == 255u) { blocks[group.x] = sums[local.x]; }
}
