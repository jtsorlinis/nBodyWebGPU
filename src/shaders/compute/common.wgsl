// Declarations the compute kernels share. shaders/index.ts appends this file to each
// kernel, which binds params itself; anything a kernel doesn't use is ignored.

// bhTree's and bhSummarize's workgroup size, which their strides and first-workgroup
// tests are written in terms of
const WORKGROUP_SIZE = 256u;

// The uniform block every kernel reads. Its layout must match updateParams in main.ts.
struct Params {
  numBodies: u32,
  gravity: f32,
  deltaTime: f32,
  softening: f32,
  // How much of a body's acceleration approximating one node may get wrong (see canApproximate)
  tolerance: f32,
  maxNodes: u32,
  massScale: f32,
}

struct Motion {
  vel : vec3<f32>,
  acc : vec3<f32>,
};

// A body's whole state, 48 bytes. The force pass writes the bodies out like this in tree
// order (see bhOrder), for the next step's integration and the renderer to read.
struct Body {
  posMass : vec4<f32>, // xyz = position, w = mass
  motion : Motion,
};

// The bodies bhTree left out of the tree, which bhOrder can't give a rank. Each one
// leaves a rank empty, so the force pass gives those ranks to these bodies instead.
struct Unranked {
  count : atomic<u32>,
  // How many of them the force pass has placed
  taken : atomic<u32>,
  bodies : array<u32>,
};

// An octree node, 64 bytes. bhTree builds it through an atomic view of the same layout.
// A zeroed node is an empty node, which is what bhClear resets nodes to.
struct Node {
  sums: vec4<i32>, // integer mass, then moment relative to the centre (see momentExponent)
  geom: vec4<f32>, // center xyz, half size
  // 0 = empty, > 0 = node index (the root is never a child), < 0 = body (-1 - bodyIdx)
  children: array<i32, 8>,
};

// A node's integer second moment about its centre (mass * offset * offset), in units of
// 2^(2 * momentExponent), 32 bytes. bhTree builds it through an atomic view of the same
// layout. Kept apart from Node so the force pass's node reads stay small.
struct SecondMoment {
  diag: vec3<i32>, // xx, yy, zz
  cross: vec3<i32>, // xy, xz, yz
};

// A node's moment is in units of 2^momentExponent(halfSize), the power of two just above
// its half size. It comes straight from the half size's bits, and scaling by it is exact,
// so every place bhTree works out a body's moment for a node gets the same integers (a
// division could round differently in each, which makes the tree depend on timing).
fn momentExponent(halfSize: f32) -> i32 {
  return i32((bitcast<u32>(halfSize) >> 23u) & 0xFFu) - 126;
}

// A node with this many bodies under it or fewer (and a parent with more) is a bucket.
// bhSummarize puts those bodies in the node's record block in place of its child records,
// and the force pass sums them directly instead of walking the node's subtree, most of
// whose opens would each find a body or two. A block holds 16.
const BUCKET_SIZE = 16u;

// MAX_DEPTH=30 permits internal children through depth 31. A depth-first walk
// needs at most 1 + 7*31 pending nodes, so 256 entries cover every valid tree.
const STACK_SIZE = 256;

// Softened acceleration towards a point mass at offset r
fn attraction(r: vec3<f32>, mass: f32) -> vec3<f32> {
  let invDist = inverseSqrt(dot(r, r) + params.softening * params.softening);
  return r * (params.gravity * mass * invDist * invDist * invDist);
}

// The nearest a node may be approximated, in node sizes from where its mass could be.
// Closer than this, a target can be among the node's own bodies.
const NEAREST_APPROXIMATION = 0.5;
// The theta beyond which a node is approximated whatever the target's acceleration.
// A body with almost no acceleration would otherwise open most of the tree. On the first
// step no body has one yet, so that step's force pass takes about four times as long.
const BACKSTOP_THETA = 0.6;

// Whether the force pass can use a node's centre of mass and quadrupole in place of its
// bodies, for a target distSq from its centre of mass. gm is gravity * the node's mass,
// and comOffset how far its centre of mass is from its centre.
//
// Approximating leaves an error of about gm * size^3 / dist^5, the next term of the
// expansion. That has to be under a fraction (params.tolerance) of the acceleration the
// target had last step, which toleranceSq is the square of. So light nodes are approximated
// from closer in than heavy ones, where a fixed opening angle treats them alike and spends
// most of its work on nodes too light to matter. For the same median force error this
// opens a third fewer nodes, and the worst 1% of errors are less than half as large.
//
// The test is squared, with distance in node sizes so its tenth power stays in range:
// gm^2 <= (dist / size)^10 * (size^2 * tolerance * acceleration)^2. If the right side
// overflows the node is far enough away, and with no acceleration the backstop decides.
fn canApproximate(distSq: f32, gm: f32, size: f32, comOffset: f32, toleranceSq: f32) -> bool {
  let nearest = size * NEAREST_APPROXIMATION + comOffset;
  let backstop = size / BACKSTOP_THETA + comOffset;
  let sizeSq = size * size;
  let ratio = distSq / sizeSq;
  let ratio5 = ratio * ratio * ratio * ratio * ratio;
  return distSq > nearest * nearest &&
    (ratio5 * (sizeSq * sizeSq * toleranceSq) >= gm * gm || distSq > backstop * backstop);
}

// Softened acceleration towards a node's mass and quadrupole, at offset r from its centre
// of mass. This is the softened point mass's potential expanded to second order about the
// centre of mass (the first-order term is zero there), so it is exact for a single body.
// gm is gravity * mass; quad holds gravity * the traceless quadrupole (3 * second moment
// - trace), and softTrace is gravity * softening^2 * trace (see bhSummarize).
fn quadrupoleAttraction(r: vec3<f32>, gm: f32, quad: mat3x3<f32>, softTrace: f32) -> vec3<f32> {
  let invDist = inverseSqrt(dot(r, r) + params.softening * params.softening);
  let invDistSq = invDist * invDist;
  let qr = quad * r;
  let radial = gm + 2.5 * invDistSq * invDistSq * (dot(r, qr) - softTrace);
  return (radial * r - invDistSq * qr) * (invDistSq * invDist);
}

// Unpacks a child's quadrupole record (see bhSummarize) for quadrupoleAttraction. The
// record is normalized by the child's mass * size^2; scale is gravity times that.
struct Quadrupole {
  quad: mat3x3<f32>,
  softTrace: f32,
};
fn unpackQuadrupole(packed: vec4<u32>, scale: f32) -> Quadrupole {
  let diag = unpack2x16float(packed.x) * scale; // xx, yy
  let cross = unpack2x16float(packed.y) * scale; // xy, xz
  let rest = unpack2x16float(packed.z) * scale; // yz, trace
  let quad = mat3x3<f32>(
    vec3(diag.x, cross.x, cross.y),
    vec3(cross.x, diag.y, rest.x),
    vec3(cross.y, rest.x, -diag.x - diag.y));
  return Quadrupole(quad, params.softening * params.softening * rest.y);
}

// bhTree drops bodies that would need nodes deeper than this
const MAX_DEPTH = 30u;

// The child octant of a node centred at center that pos falls in
fn octantOf(pos: vec3<f32>, center: vec3<f32>) -> u32 {
  var octant = 0u;
  if (pos.x > center.x) { octant |= 1u; }
  if (pos.y > center.y) { octant |= 2u; }
  if (pos.z > center.z) { octant |= 4u; }
  return octant;
}

// Bounds are reduced as uints with atomicMin/Max. Positive floats get the sign bit set and
// negative floats have all bits flipped, so comparing the uints orders them like the floats.
fn floatToOrdered(f: f32) -> u32 {
  let bits = bitcast<u32>(f);
  return select(bits | 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

fn orderedToFloat(bits: u32) -> f32 {
  return bitcast<f32>(select(~bits, bits & 0x7FFFFFFFu, (bits & 0x80000000u) != 0u));
}

// bhTree seeds a complete prefix, the root and the TOP_LEVELS levels below it: 1 + 8 + 64
// + 512 nodes, in breadth-first order, so it can sum them per workgroup instead of
// contending on global atomics near the root. bhBounds reserves it before bhTree
// allocates the rest.
const TOP_LEVELS = 3u;
const TOP_NODES = 585u;
// The prefix nodes above its last level: 1 + 8 + 64
const TOP_INTERNAL = 73u;

// Small trees seed only the root, so the prefix doesn't consume most of their
// allocation budget
fn seedsTopPrefix() -> bool {
  return params.numBodies >= 1024u && params.maxNodes >= TOP_NODES;
}

// The nodes bhBounds reserves and bhTree seeds: the prefix, or just the root
fn seededNodes() -> u32 {
  return select(1u, TOP_NODES, seedsTopPrefix());
}
