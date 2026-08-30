/**
 * WebGL2 image preview: applies a LUT to a source image on the GPU.
 *
 * Interpolation is done in the shader with texelFetch rather than by hardware
 * texture filtering. That costs a few lines but buys two things: tetrahedral
 * interpolation, which is what Resolve and most LUT hardware actually use and
 * which differs visibly from trilinear on saturated colors; and freedom from
 * OES_texture_float_linear, which is not universally available.
 */

import { type Lut, lutSampleCount } from '../core/lut.js';

export type Interpolation = 'tetrahedral' | 'trilinear';

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSource;
uniform sampler3D uLut;
uniform int  uSize;
uniform bool uIs1D;
uniform bool uTetrahedral;
uniform float uMix;        // 0 = original, 1 = full LUT
uniform vec3 uDomainMin;
uniform vec3 uDomainMax;
// Region of the canvas the image actually covers, in UV. Everything outside
// is matte, painted after grading so the bars don't shift between A and B.
uniform vec4 uImageRect;

vec3 fetch3(ivec3 p) {
  ivec3 c = clamp(p, ivec3(0), ivec3(uSize - 1));
  return texelFetch(uLut, c, 0).rgb;
}

vec3 apply1D(vec3 rgb) {
  vec3 outc;
  for (int c = 0; c < 3; c++) {
    float p = clamp(rgb[c], 0.0, 1.0) * float(uSize - 1);
    int i = int(floor(p));
    float f = p - float(i);
    float a = fetch3(ivec3(i, 0, 0))[c];
    float b = fetch3(ivec3(i + 1, 0, 0))[c];
    outc[c] = mix(a, b, f);
  }
  return outc;
}

vec3 applyTrilinear(vec3 p) {
  ivec3 i = ivec3(floor(p));
  vec3 f = p - floor(p);
  vec3 c000 = fetch3(i + ivec3(0,0,0));
  vec3 c100 = fetch3(i + ivec3(1,0,0));
  vec3 c010 = fetch3(i + ivec3(0,1,0));
  vec3 c110 = fetch3(i + ivec3(1,1,0));
  vec3 c001 = fetch3(i + ivec3(0,0,1));
  vec3 c101 = fetch3(i + ivec3(1,0,1));
  vec3 c011 = fetch3(i + ivec3(0,1,1));
  vec3 c111 = fetch3(i + ivec3(1,1,1));
  vec3 x00 = mix(c000, c100, f.x);
  vec3 x10 = mix(c010, c110, f.x);
  vec3 x01 = mix(c001, c101, f.x);
  vec3 x11 = mix(c011, c111, f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

// Standard six-tetrahedron decomposition of the unit cell.
vec3 applyTetrahedral(vec3 p) {
  ivec3 i = ivec3(floor(p));
  vec3 f = p - floor(p);

  vec3 c000 = fetch3(i + ivec3(0,0,0));
  vec3 c111 = fetch3(i + ivec3(1,1,1));

  if (f.x > f.y) {
    if (f.y > f.z) {
      vec3 c100 = fetch3(i + ivec3(1,0,0));
      vec3 c110 = fetch3(i + ivec3(1,1,0));
      return c000 + (c100 - c000) * f.x + (c110 - c100) * f.y + (c111 - c110) * f.z;
    } else if (f.x > f.z) {
      vec3 c100 = fetch3(i + ivec3(1,0,0));
      vec3 c101 = fetch3(i + ivec3(1,0,1));
      return c000 + (c100 - c000) * f.x + (c111 - c101) * f.y + (c101 - c100) * f.z;
    } else {
      vec3 c001 = fetch3(i + ivec3(0,0,1));
      vec3 c101 = fetch3(i + ivec3(1,0,1));
      return c000 + (c101 - c001) * f.x + (c111 - c101) * f.y + (c001 - c000) * f.z;
    }
  } else {
    if (f.z > f.y) {
      vec3 c001 = fetch3(i + ivec3(0,0,1));
      vec3 c011 = fetch3(i + ivec3(0,1,1));
      return c000 + (c111 - c011) * f.x + (c011 - c001) * f.y + (c001 - c000) * f.z;
    } else if (f.z > f.x) {
      vec3 c010 = fetch3(i + ivec3(0,1,0));
      vec3 c011 = fetch3(i + ivec3(0,1,1));
      return c000 + (c111 - c011) * f.x + (c010 - c000) * f.y + (c011 - c010) * f.z;
    } else {
      vec3 c010 = fetch3(i + ivec3(0,1,0));
      vec3 c110 = fetch3(i + ivec3(1,1,0));
      return c000 + (c110 - c010) * f.x + (c010 - c000) * f.y + (c111 - c110) * f.z;
    }
  }
}

void main() {
  if (vUV.x < uImageRect.x || vUV.x > uImageRect.z ||
      vUV.y < uImageRect.y || vUV.y > uImageRect.w) {
    fragColor = vec4(0.075, 0.075, 0.086, 1.0);
    return;
  }

  vec3 src = texture(uSource, vec2(vUV.x, 1.0 - vUV.y)).rgb;

  vec3 graded;
  if (uIs1D) {
    graded = apply1D(src);
  } else {
    // Normalise through the LUT's domain before indexing the grid.
    vec3 n = (src - uDomainMin) / max(uDomainMax - uDomainMin, vec3(1e-6));
    vec3 p = clamp(n, 0.0, 1.0) * float(uSize - 1);
    graded = uTetrahedral ? applyTetrahedral(p) : applyTrilinear(p);
  }

  // Dialling the LUT back toward the untouched source, the way a colorist
  // would think of LUT strength.
  vec3 result = mix(src, graded, uMix);

  fragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Could not create shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

export class PreviewRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private sourceTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  private lut: Lut | null = null;
  private sourceW = 0;
  private sourceH = 0;

  interpolation: Interpolation = 'tetrahedral';
  /** LUT strength, 0 = bypass, 1 = full. */
  mix = 1;
  /** Fraction of the canvas the image covers: [x0, y0, x1, y1] in UV. */
  imageRect: [number, number, number, number] = [0, 0, 1, 1];

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    const program = gl.createProgram();
    if (!program) throw new Error('Could not create program');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    gl.useProgram(program);

    for (const name of [
      'uSource', 'uLut', 'uSize', 'uIs1D', 'uTetrahedral',
      'uMix', 'uDomainMin', 'uDomainMax', 'uImageRect',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    // Full-screen triangle pair.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.sourceTex = gl.createTexture()!;
    this.lutTex = gl.createTexture()!;
  }

  /** Upload a scene-referred source image, already encoded into the LUT's input space. */
  setSource(data: Float32Array, w: number, h: number): void {
    const gl = this.gl;
    this.sourceW = w;
    this.sourceH = h;

    // RGBA rather than RGB: float RGB uploads hit row-alignment issues on
    // some drivers, and the alpha channel costs nothing here.
    const rgba = new Float32Array(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      rgba[j] = data[i * 3];
      rgba[j + 1] = data[i * 3 + 1];
      rgba[j + 2] = data[i * 3 + 2];
      rgba[j + 3] = 1;
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, rgba);
  }

  setLut(lut: Lut | null): void {
    this.lut = lut;
    if (!lut) return;

    const gl = this.gl;
    const n = lut.size;
    const count = lutSampleCount(lut);
    const rgba = new Float32Array(count * 4);
    for (let i = 0, j = 0; i < count; i++, j += 4) {
      rgba[j] = lut.data[i * 3];
      rgba[j + 1] = lut.data[i * 3 + 1];
      rgba[j + 2] = lut.data[i * 3 + 2];
      rgba[j + 3] = 1;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    // A 1D LUT rides in an N x 1 x 1 volume; the shader indexes it per channel.
    const [w, h, d] = lut.dims === 1 ? [n, 1, 1] : [n, n, n];
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, w, h, d, 0, gl.RGBA, gl.FLOAT, rgba);
  }

  get sourceSize(): { w: number; h: number } {
    return { w: this.sourceW, h: this.sourceH };
  }

  /**
   * Read back the rendered frame for the scopes, at the current mix — so the
   * scopes show exactly what the image shows.
   */
  readGraded(): { data: Uint8Array; w: number; h: number } {
    const gl = this.gl;
    this.draw();
    const w = this.canvas.width;
    const h = this.canvas.height;
    const data = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { data, w, h };
  }

  draw(): void {
    const gl = this.gl;
    const lut = this.lut;
    if (!lut || !this.sourceW) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);

    gl.uniform1i(this.uniforms.uSource, 0);
    gl.uniform1i(this.uniforms.uLut, 1);
    gl.uniform1i(this.uniforms.uSize, lut.size);
    gl.uniform1i(this.uniforms.uIs1D, lut.dims === 1 ? 1 : 0);
    gl.uniform1i(this.uniforms.uTetrahedral, this.interpolation === 'tetrahedral' ? 1 : 0);
    gl.uniform1f(this.uniforms.uMix, this.mix);
    gl.uniform3fv(this.uniforms.uDomainMin, lut.domainMin);
    gl.uniform3fv(this.uniforms.uDomainMax, lut.domainMax);
    gl.uniform4fv(this.uniforms.uImageRect, this.imageRect);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
