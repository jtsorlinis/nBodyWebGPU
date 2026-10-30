// Declarations the compute kernels share. shaders/index.ts appends this file to each
// kernel, which binds params itself; anything a kernel doesn't use is ignored.

// The uniform block every kernel reads. Its layout must match updateParams in main.ts.
struct Params {
  numBodies: u32,
  gravity: f32,
  deltaTime: f32,
  blackHoleMass: f32,
  softening: f32,
  theta: f32,
  maxNodes: u32,
  massScale: f32,
}

struct Motion {
  vel : vec3<f32>,
  acc : vec3<f32>,
};

// An octree node, 64 bytes. bhTree builds it through an atomic view of the same layout.
// A zeroed node is an empty node, which is what bhClear resets nodes to.
struct Node {
  sums: vec4<i32>, // integer mass, then moment relative to the centre (see momentExponent)
  geom: vec4<f32>, // center xyz, half size
  // 0 = empty, > 0 = node index (the root is never a child), < 0 = body (-1 - bodyIdx)
  children: array<i32, 8>,
};

// A node's moment is in units of 2^momentExponent(halfSize), the power of two just above
// its half size. It comes straight from the half size's bits, and scaling by it is exact,
// so every place bhTree works out a body's moment for a node gets the same integers (a
// division could round differently in each, which makes the tree depend on timing).
fn momentExponent(halfSize: f32) -> i32 {
  return i32((bitcast<u32>(halfSize) >> 23u) & 0xFFu) - 126;
}

// bhTree drops bodies that would need nodes deeper than this
const MAX_DEPTH = 30u;

// bhTree's complete three-level prefix: 1 + 8 + 64 + 512 nodes. bhBounds reserves it
// before bhTree allocates the rest.
const TOP_NODES = 585u;

// Small trees seed only the root, so the prefix doesn't consume most of their
// allocation budget
fn seedsTopPrefix() -> bool {
  return params.numBodies >= 1024u && params.maxNodes >= TOP_NODES;
}
