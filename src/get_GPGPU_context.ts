import { GPGPUContext } from "@tensorflow/tfjs-core/dist/webgl";

let canvas = document.createElement("canvas");
let gl = canvas.getContext("webgl");
let gpgpu = new GPGPUContext(gl);

export function getGLContext(): WebGLRenderingContext {
    return gl;
}

export default function getGPGPUContext(): GPGPUContext {
  return gpgpu;
}

  // const backend =  tf.backend() as tf.webgl.MathBackendWebGL;
  // if (backend === null) {
  //   throw Error('WebGL backend is not available');
  // }
  // const gpgpu = backend.getGPGPUContext();