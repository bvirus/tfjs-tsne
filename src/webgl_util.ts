import { webgl } from '@tensorflow/tfjs-core';

const { getProgramUniformLocationOrThrow } = webgl.webgl_util;
import DEBUG_MODE from './debug_mode';

/* helper functions that abstract over repeated configuration steps */
/* they all find the appropriate program location, and then call a function on it */
export function setInputMatrixTexture(
    gpgpu: webgl.GPGPUContext, program: WebGLProgram, tex: WebGLTexture, x: number, name: string) {
    const loc = getProgramUniformLocationOrThrow(gpgpu.gl, DEBUG_MODE, program, name);
    gpgpu.setInputMatrixTexture(tex, loc, x);
    return loc;
} 

export function uniform1f(gl: WebGLRenderingContext, program: WebGLProgram, x: number, name: string) {
    const loc = getProgramUniformLocationOrThrow(gl, DEBUG_MODE, program, name);
    gl.uniform1f(loc, x);
    return loc;
} 

export function uniform2f(gl: WebGLRenderingContext, program: WebGLProgram, x: number, y: number, name: string) {
    const loc =
        getProgramUniformLocationOrThrow(gl, DEBUG_MODE, program, name);
    gl.uniform2f(loc, x, y);
    return loc;
}