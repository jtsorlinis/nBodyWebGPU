// The uniform block every compute kernel reads. shaders/index.ts appends it to each
// kernel, and its layout must match updateParams in main.ts.
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
