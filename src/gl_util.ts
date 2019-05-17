/**
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import { webgl } from '@tensorflow/tfjs-core';
import DEBUG_MODE from './debug_mode'
//////////////////////  GPGPU_CONTEXT  /////////////////////////////
// Method of the GPGPUContext class
const { createVertexShader
, createFragmentShader
, callAndCheck
, linkProgram
, validateProgram
, validateTextureSize
, createTexture,
createProgram } = webgl.webgl_util;


export function createVertexProgram(
    // TO REMOVE -> if it goes in the context it should get its own webglcontext
    gl: WebGLRenderingContext, vertexShaderSource: string,
    fragmentShaderSource: string): WebGLProgram {
  // this.throwIfDisposed();
  // const gl = this.gl;

  const vertexShader: WebGLShader =
      createVertexShader(gl, DEBUG_MODE, vertexShaderSource);
  const fragmentShader: WebGLShader =
      createFragmentShader(gl, DEBUG_MODE, fragmentShaderSource);
  const program: WebGLProgram = createProgram(gl, DEBUG_MODE);
  callAndCheck(
      gl, DEBUG_MODE, () => gl.attachShader(program, vertexShader));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.attachShader(program, fragmentShader));
  linkProgram(gl, DEBUG_MODE, program);
  validateProgram(gl, DEBUG_MODE, program);

  return program;
}

///////////////////////  GPGPU_UTIL  //////////////////////////////

// Generates a textures whose access is linearly interpolated
export function createAndConfigureInterpolatedTexture(
    gl: WebGLRenderingContext, width: number, height: number,
    numChannels: number, pixels?: ArrayBufferView): WebGLTexture {
  validateTextureSize(width, height);
  const texture = createTexture(gl, DEBUG_MODE);

  const tex2d = gl.TEXTURE_2D;
  const internalFormat = getTextureInternalFormat(gl, numChannels);
  const format = getTextureFormat(gl, numChannels);

  callAndCheck(gl, DEBUG_MODE, () => gl.bindTexture(tex2d, texture));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_MIN_FILTER, gl.LINEAR));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_MAG_FILTER, gl.LINEAR));
  callAndCheck(
      gl, DEBUG_MODE,
      () => gl.texImage2D(
          tex2d, 0, internalFormat, width, height, 0, format,
          getTextureType(gl), pixels));

  callAndCheck(
      gl, DEBUG_MODE, () => gl.bindTexture(gl.TEXTURE_2D, null));
  return texture;
}

export function createAndConfigureTexture(
    gl: WebGLRenderingContext, width: number, height: number,
    numChannels: number, pixels?: ArrayBufferView): WebGLTexture {
  validateTextureSize(width, height);
  const texture = createTexture(gl, DEBUG_MODE);

  const tex2d = gl.TEXTURE_2D;
  const internalFormat = getTextureInternalFormat(gl, numChannels);
  const format = getTextureFormat(gl, numChannels);

  callAndCheck(gl, DEBUG_MODE, () => gl.bindTexture(tex2d, texture));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_MIN_FILTER, gl.NEAREST));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_MAG_FILTER, gl.NEAREST));
  callAndCheck(
      gl, DEBUG_MODE,
      () => gl.texImage2D(
          tex2d, 0, internalFormat, width, height, 0, format,
          getTextureType(gl), pixels));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.bindTexture(gl.TEXTURE_2D, null));
  return texture;
}

export function createAndConfigureUByteTexture(
    gl: WebGLRenderingContext, width: number, height: number,
    numChannels: number, pixels?: ArrayBufferView): WebGLTexture {
  validateTextureSize(width, height);
  const texture = createTexture(gl, DEBUG_MODE);

  const tex2d = gl.TEXTURE_2D;
  const internalFormat = getTextureInternalUByteFormat(gl, numChannels);
  const format = getTextureFormat(gl, numChannels);

  callAndCheck(gl, DEBUG_MODE, () => gl.bindTexture(tex2d, texture));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_MIN_FILTER, gl.NEAREST));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.texParameteri(tex2d, gl.TEXTURE_MAG_FILTER, gl.NEAREST));
  callAndCheck(
      gl, DEBUG_MODE,
      () => gl.texImage2D(
          tex2d, 0, internalFormat, width, height, 0, format,
          getTextureTypeUByte(gl), pixels));
  callAndCheck(
      gl, DEBUG_MODE, () => gl.bindTexture(gl.TEXTURE_2D, null));
  return texture;
}

///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////

// This functions are not exported by DeepLearnJS but are need from the
// functions that I am hacking to access the backend.
// Ideally my functions will be part of DeepLearnJS and there will be no need
// to have identical external copies

///////////////////////  GPGPU_UTIL  //////////////////////////////
// EXACT COPY DLJS
function getTextureInternalFormat(
    gl: WebGLRenderingContext, numChannels: number): number {
  if (numChannels === 4) {
    // tslint:disable-next-line:no-any
    return (gl as any).RGBA32F;
  } else if (numChannels === 3) {
    // tslint:disable-next-line:no-any
    return (gl as any).RGB32F;
  } else if (numChannels === 2) {
    // tslint:disable-next-line:no-any
    return (gl as any).RG32F;
  }
  // tslint:disable-next-line:no-any
  return (gl as any).R32F;
}

function getTextureInternalUByteFormat(
    gl: WebGLRenderingContext, numChannels: number): number {
  if (numChannels === 4) {
    // tslint:disable-next-line:no-any
    return (gl as any).RGBA8;
  } else if (numChannels === 3) {
    // tslint:disable-next-line:no-any
    return (gl as any).RGB8;
  } else if (numChannels === 2) {
    // tslint:disable-next-line:no-any
    return (gl as any).RG8;
  }
  // tslint:disable-next-line:no-any
  return (gl as any).R8;
}

function getTextureFormat(
    gl: WebGLRenderingContext, numChannels: number): number {
  if (numChannels === 4) {
    // tslint:disable-next-line:no-any
    return (gl as any).RGBA;
  } else if (numChannels === 3) {
    // tslint:disable-next-line:no-any
    return (gl as any).RGB;
  } else if (numChannels === 2) {
    // tslint:disable-next-line:no-any
    return (gl as any).RG;
  }
  // tslint:disable-next-line:no-any
  return (gl as any).RED;
}
// EXACT COPY DLJS
function getTextureType(gl: WebGLRenderingContext) {
  return gl.FLOAT;
}

function getTextureTypeUByte(gl: WebGLRenderingContext) {
  return gl.UNSIGNED_BYTE;
}
