import{t as e}from"./shaderStore-D-XQlhUT.js";var t=`gaussianPointSplatting`,n=`const GPS_DEPTH_CLEAR : u32=0xFFFFFFFFu;const GPS_DEPTH_MAX_CODE : u32=65534u;const GPS_TWO_PI : f32=6.2831853071795864;const GPS_U32_TO_UNIT : f32=2.3283064365386963e-10; 
const GPS_PARTITION_BUCKETS : u32=65536u;struct GpsUniforms {view : mat4x4f,
viewProjection : mat4x4f,
resNearFar : vec4f,
params0 : vec4f, 
focal : vec4f, 
camPosDeg : vec4f, 
depthNorm : vec4f, 
hiZInfo : vec4f, 
misc : vec4f, 
pixelMap : vec4f, 
projection : mat4x4f,
inverseProjection : mat4x4f,
projectedDepth : vec4f,};fn gpsProjectedDepth(inverseProjection : mat4x4f,ndcXY : vec2f,viewZ : f32)->vec2f {let origin=inverseProjection*vec4f(ndcXY,0.0,1.0);let direction=inverseProjection[2];let depth=(viewZ*origin.w-origin.z)/(direction.z-viewZ*direction.w);return vec2f(depth,1.0/(origin.w+depth*direction.w));}
fn gpsCov2D(covA : vec3f,covB : vec3f,modelView : mat4x4f,projection : mat4x4f,clip : vec4f,pixelScale : vec2f)->mat3x3f {let rowW=vec3f(projection[0].w,projection[1].w,projection[2].w);let rowX=vec3f(projection[0].x,projection[1].x,projection[2].x);let rowY=vec3f(projection[0].y,projection[1].y,projection[2].y);let jx=(rowX-clip.x/clip.w*rowW)*(0.5*pixelScale.x/clip.w);let jy=(rowY-clip.y/clip.w*rowW)*(0.5*pixelScale.y/clip.w);let J=mat3x3f(jx,jy,vec3f(0.0));let T=transpose(mat3x3f(modelView[0].xyz,modelView[1].xyz,modelView[2].xyz))*J;let covariance=mat3x3f(covA.x,covA.y,covA.z,covA.y,covB.x,covB.y,covA.z,covB.y,covB.z);return transpose(T)*covariance*T;}
struct GpsPart {world : mat4x4f,
vis : vec4f, 
dbg0 : vec4f, 
dbg1 : vec4f, 
dbg2 : vec4f, 
dbg3 : vec4f, 
dbg4 : vec4f, };fn gpsInverseMat3(inMatrix : mat3x3f)->mat3x3f {let a00=inMatrix[0][0]; let a01=inMatrix[0][1]; let a02=inMatrix[0][2];let a10=inMatrix[1][0]; let a11=inMatrix[1][1]; let a12=inMatrix[1][2];let a20=inMatrix[2][0]; let a21=inMatrix[2][1]; let a22=inMatrix[2][2];let b01=a22*a11-a12*a21;let b11=-a22*a10+a12*a20;let b21=a21*a10-a11*a20;let det=a00*b01+a01*b11+a02*b21;return mat3x3f(b01/det,(-a22*a01+a02*a21)/det,(a12*a01-a02*a11)/det,
b11/det,(a22*a00-a02*a20)/det,(-a12*a00+a02*a10)/det,
b21/det,(-a21*a00+a01*a20)/det,(a11*a00-a01*a10)/det);}
struct GpsScreen {pmConicXY : vec4f,
conicZChol : vec4f,
colorOp : vec4f, 
depth : vec4u, };const GPS_FLAG_SATURATE : u32=1u; 
const GPS_FLAG_SCREEN_RECT : u32=2u;const GPS_MAX_ALPHA : f32=0.999;fn gpsPointIntensity(alpha : f32)->f32 {return -log(1.0-min(alpha,GPS_MAX_ALPHA));}
fn gpsGetPixelMean(s : GpsScreen)->vec2f { return s.pmConicXY.xy; }
fn gpsGetConic(s : GpsScreen)->vec3f { return vec3f(s.pmConicXY.z,s.pmConicXY.w,s.conicZChol.x); }
fn gpsGetChol(s : GpsScreen)->vec3f { return s.conicZChol.yzw; }
fn gpsPackRGB565(c : vec3f)->u32 {let r=u32(clamp(c.r,0.0,1.0)*31.0+0.5);let g=u32(clamp(c.g,0.0,1.0)*63.0+0.5);let b=u32(clamp(c.b,0.0,1.0)*31.0+0.5);return (r<<11u) | (g<<5u) | b;}
fn gpsUnpackRGB565(v : u32)->vec3f {return vec3f(
f32((v>>11u) & 31u)/31.0,
f32((v>>5u) & 63u)/63.0,
f32(v & 31u)/31.0
);}
fn gpsPackKey(depthKey : u32,colorKey : u32)->u32 {return (depthKey<<16u) | (colorKey & 0xFFFFu);}
fn gpsKeyColor(key : u32,mask : u32)->vec3f {return gpsUnpackRGB565((key ^ mask) & 0xFFFFu);}
fn gpsPcg(vIn : u32)->u32 {let state=vIn*747796405u+2891336453u;let word=((state>>((state>>28u)+4u)) ^ state)*277803737u;return (word>>22u) ^ word;}
fn gpsHash2(a : u32,b : u32)->u32 {return gpsPcg(a ^ gpsPcg(b));}
fn gpsUnit(state : u32)->f32 {return f32(state)*GPS_U32_TO_UNIT;}
fn gpsBoxMuller(u1 : f32,u2 : f32)->vec2f {let r=sqrt(-2.0*log(max(1e-7,u1)));let theta=GPS_TWO_PI*u2;return vec2f(r*cos(theta),r*sin(theta));}
const GPS_LI2_MAX : f32=1.6449340668482264; 
fn gpsDilog(x : f32)->f32 {var y=-6.09201442e-01;y=y*x+1.79126616e+00;y=y*x+-2.14953223e+00;y=y*x+1.26304372e+00;y=y*x+-4.59069895e-01;y=y*x+-1.87417414e-01;y=y*x+1.99603130e+00;y=y*x+5.99669467e-05;let s=1.0-x;if (s>0.0) {y+=s*log(max(s,1e-37));}
return y;}
fn gpsInvDilog(x : f32)->f32 {let t=min(x/GPS_LI2_MAX,1.0);var y=-1.27463503e+01;y=y*t+5.88993459e+01;y=y*t+-1.16025780e+02;y=y*t+1.26945827e+02;y=y*t+-8.43108826e+01;y=y*t+3.48799862e+01;y=y*t+-8.89606235e+00;y=y*t+1.38640936e+00;y=y*t+-7.80640876e-01;y=y*t+1.64841888e+00;y=y*t+-2.82836687e-05;return y;}
fn gpsCorrectedBoxMuller(u1 : f32,u2 : f32,alpha : f32)->vec2f {var a=(1.0/max(alpha,1e-37))*gpsInvDilog((1.0-u1)*gpsDilog(alpha));a=clamp(a,1e-37,1.0);let r=sqrt(max(-2.0*log(a),0.0));let theta=GPS_TWO_PI*u2;return vec2f(r*cos(theta),r*sin(theta));}
const GPS_POISSON_SMALL_MEAN : f32=12.0;fn gpsPoisson(seed : u32,lambda : f32)->u32 {let st1=gpsPcg(seed);if (lambda<GPS_POISSON_SMALL_MEAN) {let u=gpsUnit(st1);var p=exp(-lambda);var cdf=p;var k=0u;loop {if (u<cdf || (f32(k)>lambda && p<1e-7)) {break;}
k=k+1u;p=p*lambda/f32(k);cdf=cdf+p;}
return k;}
let st2=gpsPcg(st1);let w=gpsBoxMuller(gpsUnit(st1),gpsUnit(st2)).x;let w2=w*w;let w3=w2*w;let w4=w2*w2;let s=sqrt(lambda);let invS=1.0/s;let invL=1.0/lambda;var kf=lambda+s*w+(w2-1.0)/6.0;kf+=invS*(-(1.0/36.0)*w-(1.0/72.0)*w3);kf+=invL*(-(8.0/405.0)+(7.0/810.0)*w2+(1.0/270.0)*w4);return u32(max(i32(round(kf)),0));}
fn gpsGaussianValue(conic : vec3f,d : vec2f)->f32 {let power=-0.5*(conic.x*d.x*d.x+conic.z*d.y*d.y)-conic.y*d.x*d.y;return exp(power);}
`;e.IncludesShadersStoreWGSL[t]||(e.IncludesShadersStoreWGSL[t]=n);var r={name:t,shader:n};export{r as t};