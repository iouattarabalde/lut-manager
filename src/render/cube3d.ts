/**
 * WebGL2 3D cube viewer: the LUT's output positions plotted in RGB space.
 *
 * This is what a 1D curve cannot show. Gamut warping, clipping (points pinned
 * flat against a face of the cube), and channel inversions are all immediately
 * visible as shape.
 */

import { type Lut, lutSampleCount } from '../core/lut.js';

const VERT = `#version 300 es
in vec3 aPos;       // LUT output position, 0-1 in RGB space
in vec3 aIdentity;  // where this sample would sit untouched
in vec3 aColor;
uniform mat4 uMVP;
uniform float uPointSize;
uniform float uMix;
out vec3 vColor;
void main() {
  // At mix 0 the cloud is a perfect lattice; winding it up shows exactly how
  // the LUT deforms it.
  vec3 p = mix(aIdentity, aPos, uMix);
  vColor = mix(aIdentity, aColor, uMix);
  gl_Position = uMVP * vec4(p - 0.5, 1.0);
  // Keep distant points from vanishing entirely.
  gl_PointSize = uPointSize / max(gl_Position.w, 0.2);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
uniform float uAlpha;
void main() {
  // Round points read better than squares at this density.
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  fragColor = vec4(vColor, uAlpha);
}`;

const LINE_VERT = `#version 300 es
in vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos - 0.5, 1.0); }`;

const LINE_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec4 uColor;
void main() { fragColor = uColor; }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`Cube shader failed: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, v: string, f: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, v));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, f));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`Cube program failed: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

/** Column-major 4x4 multiply. */
function mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

function orbit(distance: number, yaw: number, pitch: number): Float32Array {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  // Rotate then translate back along z.
  const rot = new Float32Array([
    cy, sp * sy, -cp * sy, 0,
    0, cp, sp, 0,
    sy, -sp * cy, cp * cy, 0,
    0, 0, 0, 1,
  ]);
  const trans = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, -distance, 1,
  ]);
  return mul(trans, rot);
}

/** Twelve edges of the unit cube, as line segments. */
const CUBE_EDGES = (() => {
  const corners: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) corners.push([(i >> 0) & 1, (i >> 1) & 1, (i >> 2) & 1]);
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      const d =
        Math.abs(corners[i][0] - corners[j][0]) +
        Math.abs(corners[i][1] - corners[j][1]) +
        Math.abs(corners[i][2] - corners[j][2]);
      if (d === 1) pts.push(...corners[i], ...corners[j]);
    }
  }
  return new Float32Array(pts);
})();

export class CubeView {
  private gl: WebGL2RenderingContext;
  private pointProgram: WebGLProgram;
  private lineProgram: WebGLProgram;
  private posBuf: WebGLBuffer;
  private idBuf: WebGLBuffer;
  private colBuf: WebGLBuffer;
  private edgeBuf: WebGLBuffer;
  private count = 0;

  /** LUT strength, matching the image preview. */
  mix = 1;

  private yaw = 0.7;
  private pitch = 0.45;
  private distance = 2.9;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    this.pointProgram = link(gl, VERT, FRAG);
    this.lineProgram = link(gl, LINE_VERT, LINE_FRAG);
    this.posBuf = gl.createBuffer()!;
    this.idBuf = gl.createBuffer()!;
    this.colBuf = gl.createBuffer()!;
    this.edgeBuf = gl.createBuffer()!;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE_EDGES, gl.STATIC_DRAW);

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', (e) => {
      this.dragging = false;
      canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.008;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (e.clientY - this.lastY) * 0.008));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.draw();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = Math.max(1.4, Math.min(7, this.distance + e.deltaY * 0.003));
        this.draw();
      },
      { passive: false },
    );
  }

  setLut(lut: Lut | null): void {
    if (!lut) {
      this.count = 0;
      return;
    }
    const gl = this.gl;
    const count = lutSampleCount(lut);

    // Position is the LUT's OUTPUT: where each input lands in RGB space.
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) pos[i] = lut.data[i];

    // Where each sample sits before the LUT touches it.
    const ident = new Float32Array(count * 3);
    const n = lut.size;
    const step = n > 1 ? 1 / (n - 1) : 0;
    if (lut.dims === 1) {
      for (let i = 0; i < count; i++) {
        ident[i * 3] = ident[i * 3 + 1] = ident[i * 3 + 2] = i * step;
      }
    } else {
      for (let i = 0; i < count; i++) {
        ident[i * 3] = (i % n) * step;
        ident[i * 3 + 1] = (Math.floor(i / n) % n) * step;
        ident[i * 3 + 2] = Math.floor(i / (n * n)) * step;
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.idBuf);
    gl.bufferData(gl.ARRAY_BUFFER, ident, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);

    this.count = count;
    this.draw();
  }

  draw(): void {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.075, 0.075, 0.086, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.count) return;

    const mvp = mul(
      perspective(Math.PI / 4, w / h, 0.1, 40),
      orbit(this.distance, this.yaw, this.pitch),
    );

    // Domain wireframe first, so points read as sitting inside it.
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'uMVP'), false, mvp);
    gl.uniform4f(gl.getUniformLocation(this.lineProgram, 'uColor'), 1, 1, 1, 0.16);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf);
    const lineLoc = gl.getAttribLocation(this.lineProgram, 'aPos');
    gl.enableVertexAttribArray(lineLoc);
    gl.vertexAttribPointer(lineLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, CUBE_EDGES.length / 3);

    gl.useProgram(this.pointProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.pointProgram, 'uMVP'), false, mvp);
    // Thin out the points as the grid gets denser so the shape stays readable.
    const size = this.count > 200000 ? 1.6 : this.count > 40000 ? 2.4 : 4.0;
    gl.uniform1f(gl.getUniformLocation(this.pointProgram, 'uPointSize'), size * dpr * 2.4);
    gl.uniform1f(gl.getUniformLocation(this.pointProgram, 'uAlpha'), this.count > 40000 ? 0.55 : 0.9);
    gl.uniform1f(gl.getUniformLocation(this.pointProgram, 'uMix'), this.mix);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    const pLoc = gl.getAttribLocation(this.pointProgram, 'aPos');
    gl.enableVertexAttribArray(pLoc);
    gl.vertexAttribPointer(pLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.idBuf);
    const iLoc = gl.getAttribLocation(this.pointProgram, 'aIdentity');
    gl.enableVertexAttribArray(iLoc);
    gl.vertexAttribPointer(iLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    const cLoc = gl.getAttribLocation(this.pointProgram, 'aColor');
    gl.enableVertexAttribArray(cLoc);
    gl.vertexAttribPointer(cLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.disable(gl.BLEND);
  }
}
