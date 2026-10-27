@group(0) @binding(0) var<storage, read_write> counts: array<u32>;
var<workgroup> sums: array<u32, 256>;

// One workgroup scans the histogram. Each lane owns a disjoint contiguous chunk.
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) id: vec3<u32>) {
  let chunkSize = BIN_COUNT / 256u;
  let start = id.x * chunkSize;
  var total = 0u;
  for (var i = 0u; i < chunkSize; i++) { total += counts[start + i]; }
  sums[id.x] = total;
  workgroupBarrier();
  for (var stride = 1u; stride < 256u; stride <<= 1u) {
    var addend = 0u;
    if (id.x >= stride) { addend = sums[id.x - stride]; }
    workgroupBarrier();
    sums[id.x] += addend;
    workgroupBarrier();
  }
  var offset = 0u;
  if (id.x > 0u) { offset = sums[id.x - 1u]; }
  for (var i = 0u; i < chunkSize; i++) {
    let count = counts[start + i];
    counts[start + i] = offset;
    offset += count;
  }
}
