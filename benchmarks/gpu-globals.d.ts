// Babylon supplies WebGPU interface types but omits the browser's global flag objects.
declare const GPUBufferUsage: {
  readonly MAP_READ: number;
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly UNIFORM: number;
  readonly STORAGE: number;
  readonly INDIRECT: number;
  readonly QUERY_RESOLVE: number;
};
declare const GPUMapMode: { readonly READ: number };
