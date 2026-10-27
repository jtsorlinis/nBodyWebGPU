@group(0) @binding(0) var<storage, read_write> blocks: array<u32>;
var<workgroup> sums: array<u32, 256>;

// One workgroup scans the block totals. Each lane owns a disjoint contiguous chunk.
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) id: vec3<u32>) {
  let chunkSize = BLOCK_COUNT / 256u;
  let start = id.x * chunkSize;
  var total = 0u;
  for (var i = 0u; i < chunkSize; i++) { total += blocks[start + i]; }
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
    let count = blocks[start + i];
    blocks[start + i] = offset;
    offset += count;
  }
}
