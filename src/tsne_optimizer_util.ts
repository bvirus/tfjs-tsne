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

import * as tf from '@tensorflow/tfjs-core';
import * as gl_util from './gl_util';
import { setInputMatrixTexture, uniform1f, uniform2f } from './webgl_util';
let DEBUG_MODE = false;

const { bindCanvasToFramebuffer, 
    callAndCheck, bindVertexBufferToProgramAttribute} = tf.webgl.webgl_util;
const { bindVertexProgramAttributeStreams } = tf.webgl.gpgpu_util;

///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////

export function createEmbeddingSplatterProgram(gpgpu: tf.webgl.GPGPUContext):
    WebGLProgram {
  const vertexShaderSource = `#version 300 es
    precision highp float;
    in float vertex_id;

    uniform sampler2D embedding_tex;
    uniform vec2 minV;
    uniform vec2 maxV;
    uniform float kernel_support;
    uniform float points_per_row;
    uniform float num_rows;

    out vec2 kernel_coords;

    void main() {
      //TODO Clean up and check performance loss due to the conversions
      uint pnt_id = uint((vertex_id / 4.0) + 0.1);
      uint quad_id = uint(mod(vertex_id + 0.1,4.));

      uint row    = uint((float(pnt_id) + 0.1)/points_per_row);
      uint column = uint(float(pnt_id) - float(row) * points_per_row);

      float width = (points_per_row * 2.0);
      float row_tex = (float(row) + 0.5) / num_rows;
      vec2 tex_coords_x = vec2((float(column) * 2. + 0.5) / width, row_tex);
      vec2 tex_coords_y = vec2((float(column) * 2. + 1.5) / width, row_tex);

      float x_pnt = texture(embedding_tex,tex_coords_x).r;
      float y_pnt = texture(embedding_tex,tex_coords_y).r;
      vec2 vertex_coords = vec2(x_pnt,y_pnt);

      if(quad_id == uint(0)) {kernel_coords = vec2(-1,-1);}
      else if(quad_id == uint(1)) {kernel_coords = vec2(1,-1);}
      else if(quad_id == uint(2)) {kernel_coords = vec2(1,1);}
      else if(quad_id == uint(3)) {kernel_coords = vec2(-1,1);}

      vertex_coords += kernel_coords * kernel_support;      // embedding space
      vertex_coords = (vertex_coords - minV) / (maxV-minV); //  0:1 space
      vertex_coords = vertex_coords * 2.0 - 1.0;            // -1:1 space

      gl_Position = vec4(vertex_coords,0,1);
    }
  `;
  const fragmentShaderSource = `#version 300 es
    precision highp float;
    uniform sampler2D kernel_tex;
    in vec2 kernel_coords;
    out vec4 fragmentColor;

    void main() {
      fragmentColor = texture(kernel_tex,(kernel_coords + 1.) / 2.0);
    }
  `;
  return gl_util.createVertexProgram(
      gpgpu.gl, vertexShaderSource, fragmentShaderSource);
}

export function executeEmbeddingSplatterProgram(
    gpgpu: tf.webgl.GPGPUContext, program: WebGLProgram,
    targetTex: WebGLTexture, embeddingTex: WebGLTexture,
    kernelTex: WebGLTexture, targetTexDiameter: number, numPoints: number,
    minX: number, minY: number, maxX: number, maxY: number,
    kernelSupport: number, pntsPerRow: number, numRows: number,
    vertexIdBuffer: WebGLBuffer) {
  const gl = gpgpu.gl;
  const oldProgram: WebGLProgram = gpgpu.program;

  if (targetTex != null) {
    gpgpu.setOutputMatrixTexture(
        targetTex, targetTexDiameter, targetTexDiameter);
  } else {
    bindCanvasToFramebuffer(gpgpu.gl, DEBUG_MODE);
  }

  gpgpu.setProgram(program);

  gl.clearColor(0., 0., 0., 0.);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  callAndCheck(
      gl, DEBUG_MODE, () => gl.bindBuffer(gl.ARRAY_BUFFER, vertexIdBuffer));

  bindVertexBufferToProgramAttribute(
      gl, DEBUG_MODE, program, 'vertex_id', vertexIdBuffer, 1, 0, 0);

  setInputMatrixTexture(gpgpu, program, embeddingTex, 0, 'embedding_tex');
  setInputMatrixTexture(gpgpu, program, kernelTex, 1, 'kernel_tex');
  uniform1f(gpgpu.gl, program, kernelSupport, 'kernel_support');
  uniform1f(gpgpu.gl, program, pntsPerRow, 'points_per_row');
  uniform1f(gpgpu.gl, program, numRows, 'num_rows');
  uniform2f(gpgpu.gl, program, minX, minY, 'minV');
  uniform2f(gpgpu.gl, program, maxX, maxY, 'maxV');

  callAndCheck(
      gl, DEBUG_MODE, () => gl.drawArrays(gl.TRIANGLES, 0, numPoints * 2 * 3));

  gl.disable(gl.BLEND);

  // Restore the old program and its vertex buffers
  // TOCHECK if it can be improved
  if (oldProgram != null) {
    gpgpu.setProgram(oldProgram);
    bindVertexProgramAttributeStreams(
        gpgpu.gl, DEBUG_MODE, oldProgram, gpgpu.vertexBuffer);
  }
}

///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////

export function createQInterpolatorProgram(gpgpu: tf.webgl.GPGPUContext):
    WebGLProgram {
  const fragmentShaderSource = `#version 300 es
    precision highp float;
    uniform sampler2D embedding_tex;
    uniform sampler2D splat_tex;
    uniform vec2 minV;
    uniform vec2 maxV;
    uniform float points_per_row;
    uniform float num_rows;
    uniform float num_points;

    out vec4 fragColor; 

    void main() {
      vec2 pnt_location = gl_FragCoord.xy - vec2(0.5,0.5);

      if(pnt_location.y * points_per_row + pnt_location.x >= num_points) {
        fragColor = vec4(0,0,0,0);
        return;
      }

      float emb_width = (points_per_row * 2.0);
      float emb_row_coord = (pnt_location.y + 0.5) / num_rows;
      vec2 emb_coords_x
              = vec2((pnt_location.x * 2.+0.5) / emb_width, emb_row_coord);
      vec2 emb_coords_y
              = vec2((pnt_location.x * 2. + 1.5) / emb_width, emb_row_coord);

      float x_pnt = texture(embedding_tex,emb_coords_x).r;
      float y_pnt = texture(embedding_tex,emb_coords_y).r;

      vec2 splat_coords = vec2(x_pnt,y_pnt);
      splat_coords = (splat_coords - minV) / (maxV - minV); //  0:1 space

      float q = (texture(splat_tex,splat_coords).r - 1.);

      fragColor = vec4(q, 0, 0, 1);
    }
  `;
  return gpgpu.createProgram(fragmentShaderSource);
}

export function executeQInterpolatorProgram(
    gpgpu: tf.webgl.GPGPUContext, program: WebGLProgram, splatTex: WebGLTexture,
    embeddingTex: WebGLTexture, numPoints: number, minX: number, minY: number,
    maxX: number, maxY: number, pntsPerRow: number, numRows: number,
    targetTex?: WebGLTexture) {

  if (targetTex != null) {
    gpgpu.setOutputMatrixTexture(targetTex, numRows, pntsPerRow);
  } else {
    bindCanvasToFramebuffer(gpgpu.gl, DEBUG_MODE);
  }

  gpgpu.setProgram(program);

  setInputMatrixTexture(gpgpu, program, embeddingTex, 0, 'embedding_tex');
  setInputMatrixTexture(gpgpu, program, splatTex, 1, 'splat_tex');
  uniform1f(gpgpu.gl, program, pntsPerRow, 'points_per_row');
  uniform1f(gpgpu.gl, program, numRows, 'num_rows');
  uniform1f(gpgpu.gl, program, numPoints, 'num_points');
  uniform2f(gpgpu.gl, program, minX, minY, 'minV');
  uniform2f(gpgpu.gl, program, maxX, maxY, 'maxV');

  gpgpu.executeProgram();
}

///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////

export function createXYInterpolatorProgram(gpgpu: tf.webgl.GPGPUContext):
    WebGLProgram {
  const fragmentShaderSource = `#version 300 es
    precision highp float;
    uniform sampler2D embedding_tex;
    uniform sampler2D splat_tex;
    uniform vec2 minV;
    uniform vec2 maxV;
    uniform float points_per_row;
    uniform float num_rows;
    uniform float num_points;
    uniform float eta;

    out vec4 fragColor;
    //in highp vec4 gl_FragCoord;

    void main() {
      vec2 pnt_location = gl_FragCoord.xy - vec2(0.5,0.5);
      pnt_location.x = floor(pnt_location.x/2.+0.1);

      if(pnt_location.y*points_per_row + pnt_location.x >= num_points) {
        fragColor = vec4(0,0,0,0);
        return;
      }

      float emb_width = (points_per_row * 2.0);
      float emb_row_coord = (pnt_location.y + 0.5) / num_rows;
      vec2 emb_coords_x
              = vec2((pnt_location.x * 2. + 0.5) / emb_width, emb_row_coord);
      vec2 emb_coords_y
              = vec2((pnt_location.x * 2. + 1.5) / emb_width, emb_row_coord);

      float x_pnt = texture(embedding_tex,emb_coords_x).r;
      float y_pnt = texture(embedding_tex,emb_coords_y).r;

      vec2 splat_coords = vec2(x_pnt,y_pnt);
      splat_coords = (splat_coords - minV) / (maxV - minV); //  0:1 space

      float q = 0.;
      if(mod(gl_FragCoord.x - 0.5,2.) < 0.5 ) {
        q = texture(splat_tex,splat_coords).g * eta * 2.;
      }else{
        q = texture(splat_tex,splat_coords).b * eta * 2.;
      }

      fragColor = vec4(q,0.0,0.0,1);
    }
  `;
  return gpgpu.createProgram(fragmentShaderSource);
}

export function executeXYInterpolatorProgram(
    gpgpu: tf.webgl.GPGPUContext, program: WebGLProgram, splatTex: WebGLTexture,
    embeddingTex: WebGLTexture, targetTex: WebGLTexture, numPoints: number,
    minX: number, minY: number, maxX: number, maxY: number, pntsPerRow: number,
    numRows: number, eta: number) {
  if (targetTex != null) {
    gpgpu.setOutputMatrixTexture(targetTex, numRows, pntsPerRow * 2);
  } else {
    bindCanvasToFramebuffer(gpgpu.gl, DEBUG_MODE);
  }
  gpgpu.setProgram(program);

  setInputMatrixTexture(gpgpu, program, embeddingTex, 0, 'embedding_tex');
  setInputMatrixTexture(gpgpu, program, splatTex, 1, 'splat_tex');
  uniform1f(gpgpu.gl, program, pntsPerRow, 'points_per_row');
  uniform1f(gpgpu.gl, program, numRows, 'num_rows');
  uniform1f(gpgpu.gl, program, numPoints, 'num_points');
  uniform1f(gpgpu.gl, program, eta, 'eta');
  uniform2f(gpgpu.gl, program, minX, minY, 'minV');
  uniform2f(gpgpu.gl, program, maxX, maxY, 'maxV');

  gpgpu.executeProgram();
}

///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////

export function createAttractiveForcesComputationProgram(
    gpgpu: tf.webgl.GPGPUContext): WebGLProgram {
  const fragmentShaderSource = `#version 300 es
    precision highp float;

    uniform sampler2D embedding_tex;
    uniform sampler2D offset_tex;
    uniform sampler2D neigh_id_tex;
    uniform sampler2D neigh_prob_tex;

    uniform float points_per_row;
    uniform float num_rows;
    uniform float num_points;
    uniform float num_neighs_per_row;
    uniform float eta;

    out vec4 fragColor;
    //in highp vec4 gl_FragCoord;

    void main() {
      //add for nearest pixel interpolation
      vec2 half_pxl = vec2(0.5,0.5);

      // Dimension of the fragment
      // 0 -> x :1 -> y
      float dimension = mod(gl_FragCoord.x - 0.4,2.);

      //Point location in the [points_per_row,num_rows] space
      vec2 i_location = gl_FragCoord.xy - half_pxl;
      i_location.x = floor(i_location.x / 2. + 0.1);

      //just an extra fragment -> return
      if(i_location.y*points_per_row + i_location.x >= num_points) {
        fragColor = vec4(0,0,0,0);
        return;
      }

      //Offset coordinates for the point
      vec2 offset_coord = (i_location + half_pxl) /
                                              vec2(points_per_row,num_rows);
      //Offset information ...
      vec4 offset_info  = texture(offset_tex,offset_coord);
      //... contains the number of neighbors for the point ...
      float num_neighs  = offset_info.z;
      //... and the coordinates of the firts neigh in the neigh textures
      vec2 offset_neigh = offset_info.xy;

      //Computing the coordinates of the point in the texture
      //_i represent the point to move, _j the neighbors
      float emb_width = (points_per_row * 2.0);
      float emb_row_i = (i_location.y + 0.5) / num_rows;
      vec2 x_i_coord = vec2((i_location.x * 2. + 0.5) / emb_width, emb_row_i);
      vec2 y_i_coord = vec2((i_location.x * 2. + 1.5) / emb_width, emb_row_i);
      //getting the coordinates in the embedding
      float x_i = texture(embedding_tex,x_i_coord).r;
      float y_i = texture(embedding_tex,y_i_coord).r;

      //Sum of all attractive forces
      float sum_pos = 0.;

      //Can't be higher than 1000 (perplexity is usually around 30)
      //and a 'while' can't be used
      for(int n = 0; n < 2000; ++n) {
        //Actual check on number of neighbors
        if(float(n) >= num_neighs) {
          break;
        }

        //Get the id and the probability for the neighbor
        float pij = texture(neigh_prob_tex,
                              (offset_neigh + half_pxl) / num_neighs_per_row
                             ).r;
        float neigh_id = texture(neigh_id_tex,
                                  (offset_neigh + half_pxl) / num_neighs_per_row
                                  ).r;

        //Getting the coordinates of the neighbor
        vec2 j_location = vec2(mod(neigh_id + 0.1, points_per_row),
                               floor(neigh_id / points_per_row + 0.1));
        float emb_row_j = (j_location.y + 0.5) / num_rows;
        vec2 x_j_coord = vec2((j_location.x * 2. + 0.5) / emb_width, emb_row_j);
        vec2 y_j_coord = vec2((j_location.x * 2. + 1.5) / emb_width, emb_row_j);
        float x_j = texture(embedding_tex,x_j_coord).r;
        float y_j = texture(embedding_tex,y_j_coord).r;

        //Actual computation of the attractive forces
        float dist_x    = (x_i - x_j);
        float dist_y    = (y_i - y_j);
        float qij       = 1. / (1. + dist_x * dist_x + dist_y * dist_y);
        //the update depends on the dimension that this fragment represents
        if(dimension < 0.5) {
          // * 4 / (num_points*2) -> * 2 / num_points
          sum_pos += eta * 2. * pij * qij * dist_x / (num_points);
        }else{
          sum_pos += eta * 2. * pij * qij * dist_y / (num_points);
        }

        //Increase the coordinate of the neigh in the neigh_id texture
        offset_neigh.x += 1.;
        //check if the new neigh is in the next row
        if(offset_neigh.x + 0.2 > num_neighs_per_row) {
          //in that case reset the column and increase the row
          offset_neigh.x = 0.1;
          offset_neigh.y += 1.0;
        }
      }

      //The output is the sum of the attractive forces
      fragColor = vec4(sum_pos,0,0,0);
    }
  `;
  return gpgpu.createProgram(fragmentShaderSource);
}

export function executeAttractiveForcesComputationProgram(
    gpgpu: tf.webgl.GPGPUContext, program: WebGLProgram,
    embeddingTex: WebGLTexture, offsetTex: WebGLTexture,
    neighIdTex: WebGLTexture,  // Float for now...
    // better to use an integer texture
    neighProbTex: WebGLTexture, numPoints: number, neighsPerRow: number,
    pntsPerRow: number, numRows: number, eta: number,
    targetTex?: WebGLTexture) {

  if (targetTex != null) {
    gpgpu.setOutputMatrixTexture(targetTex, numRows, pntsPerRow * 2);
  } else {
    bindCanvasToFramebuffer(gpgpu.gl, DEBUG_MODE);
  }

  gpgpu.setProgram(program);
  setInputMatrixTexture(gpgpu, program, embeddingTex, 3, 'embedding_tex');
  setInputMatrixTexture(gpgpu, program, offsetTex, 2, 'offset_tex');
  setInputMatrixTexture(gpgpu, program, neighIdTex, 1, 'neigh_id_tex');
  setInputMatrixTexture(gpgpu, program, neighProbTex, 0, 'neigh_prob_tex');
  uniform1f(gpgpu.gl, program, numRows, 'num_rows');
  uniform1f(gpgpu.gl, program, eta, 'eta');
  uniform1f(gpgpu.gl, program, neighsPerRow, 'num_neighs_per_row');
  uniform1f(gpgpu.gl, program, numPoints, 'num_points');
  uniform1f(gpgpu.gl, program, pntsPerRow, 'points_per_row');

  gpgpu.executeProgram();
}

///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////

export function createEmbeddingInitializationProgram(
    gpgpu: tf.webgl.GPGPUContext): WebGLProgram {
  const fragmentShaderSource = `#version 300 es
    precision highp float;

    uniform sampler2D random_tex;
    uniform float points_per_row;
    uniform float num_rows;
    uniform float num_points;

    out vec4 fragColor;
    //in highp vec4 gl_FragCoord;

    void main() {
      //add for nearest pixel interpolation
      vec2 half_pxl = vec2(0.5,0.5);

      // Dimension of the fragment
      // 0 -> x :1 -> y
      float dimension = mod(gl_FragCoord.x - 0.4,2.);
      vec2 pnt_location = gl_FragCoord.xy - half_pxl;
      pnt_location.x = floor(pnt_location.x / 2.);

      //just an extra fragment -> return
      if(pnt_location.y*points_per_row + pnt_location.x >= num_points) {
        fragColor = vec4(0,0,0,1);
        return;
      }

      float width = (points_per_row * 2.0);
      float row_coord = (pnt_location.y + 0.5)/num_rows;
      vec2 rad_coord = vec2((pnt_location.x * 2. + 0.5) / width, row_coord);
      vec2 ang_coord = vec2((pnt_location.x * 2. + 1.5) / width, row_coord);

      float rad = texture(random_tex,rad_coord).r * 3.;
      float ang = texture(random_tex,ang_coord).r * 3.1415 * 2.;

      fragColor = vec4(rad,ang,0,1);

      if(dimension < 0.5) {
        fragColor = vec4(cos(ang) * rad,0,0,0);
      }else{
        fragColor = vec4(sin(ang) * rad,0,0,0);
      }
    }
  `;
  return gpgpu.createProgram(fragmentShaderSource);
}

export function executeEmbeddingInitializationProgram(
    gpgpu: tf.webgl.GPGPUContext, program: WebGLProgram,
    randomTex: WebGLTexture, numPoints: number, pntsPerRow: number,
    numRows: number, targetTex?: WebGLTexture) {

  if (targetTex != null) {
    gpgpu.setOutputMatrixTexture(targetTex, numRows, pntsPerRow * 2);
  } else {
    bindCanvasToFramebuffer(gpgpu.gl, DEBUG_MODE);
  }

  gpgpu.setProgram(program);
  setInputMatrixTexture(gpgpu, program, randomTex, 3, 'random_tex');
  uniform1f(gpgpu.gl, program, numRows, 'num_rows');
  uniform1f(gpgpu.gl, program, numPoints, 'num_points');
  uniform1f(gpgpu.gl, program, pntsPerRow, 'points_per_row');

  gpgpu.executeProgram();
}

///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////

export function createDistributionParametersComputationProgram(
    gpgpu: tf.webgl.GPGPUContext): WebGLProgram {
  const fragmentShaderSource = `#version 300 es
    precision highp float;

    #define MAX_NEIGHBORS 128
    #define MAX_ITERATIONS 500
    #define FLOAT_MAX 10e30
    #define TOLERANCE 1e-5

    uniform sampler2D knn_graph_tex;
    uniform float points_per_row;
    uniform float num_rows;
    uniform float num_points;
    uniform float num_neighs;
    uniform float perplexity;

    out vec4 fragColor;
    //in highp vec4 gl_FragCoord;

    vec2 half_pixel = vec2(0.5,0.5);
    float distances_squared[MAX_NEIGHBORS];

    void readDistances(vec2 point_location) {
      for(int n = 0; n < MAX_NEIGHBORS; ++n ) {
        if(float(n) >= num_neighs-0.1) {
          break;
        }
        vec2 knn_coordinates = vec2(
            (point_location.x * num_neighs + float(n) + half_pixel.x)
                                        /(points_per_row * num_neighs),
            (point_location.y + half_pixel.y) / num_rows
        );
        distances_squared[n] = texture(knn_graph_tex,knn_coordinates).g;
      }
    }

    void main() {
      vec2 point_location = gl_FragCoord.xy - half_pixel;
      //invalid points
      if(point_location.y*points_per_row + point_location.x >= num_points) {
        fragColor = vec4(0,0,0,0);
        return;
      }
      readDistances(point_location);

      //Beta computation
      float beta = 1.;
      float max_beta = FLOAT_MAX;
      float min_beta = -FLOAT_MAX;
      //To avoid computing the log at every iteration
      float log_perplexity = log(perplexity);
      float entropy_diff = 0.;
      float entropy = 0.;
      float sum_probabilities = 0.;

      //Binary search for a maximum of MAX_ITERATIONS
      for(int iteration = 0; iteration < MAX_ITERATIONS; ++iteration) {
        //At every iteration I compute the
        //entropy enforced by the current beta
        sum_probabilities = 0.;
        entropy = 0.;
        for(int n = 0; n < MAX_NEIGHBORS; ++n ) {
          if(float(n) >= num_neighs-0.1) {
            break;
          }
          float neigh_probability = exp(-beta * distances_squared[n]);
          sum_probabilities += neigh_probability;
          entropy += beta * distances_squared[n] * neigh_probability;
        }

        entropy = entropy / sum_probabilities + log(sum_probabilities);
        entropy_diff = entropy - log_perplexity;

        //the current beta is good enough!
        if(entropy_diff < TOLERANCE && -entropy_diff < TOLERANCE) {
          break;
        }

        if(entropy_diff > 0.) {
          min_beta = beta;
          if(max_beta == FLOAT_MAX || max_beta == -FLOAT_MAX) {
            beta *= 2.;
          }else{
            beta = (beta + max_beta) / 2.;
          }
        }else{
          max_beta = beta;
          if(min_beta == -FLOAT_MAX || min_beta == FLOAT_MAX) {
            beta /= 2.;
          }else{
            beta = (beta + min_beta) / 2.;
          }
        }
      }
      fragColor = vec4(beta,sum_probabilities,0,1);
    }
  `;
  return gpgpu.createProgram(fragmentShaderSource);
}

export function executeDistributionParametersComputationProgram(
    gpgpu: tf.webgl.GPGPUContext, program: WebGLProgram, knnGraph: WebGLTexture,
    numPoints: number, numNeighs: number, pntsPerRow: number, numRows: number,
    perplexity: number, targetTex?: WebGLTexture) {

  if (targetTex != null) {
    gpgpu.setOutputMatrixTexture(targetTex, numRows, pntsPerRow);
  } else {
    bindCanvasToFramebuffer(gpgpu.gl, DEBUG_MODE);
  }

  gpgpu.setProgram(program);
  setInputMatrixTexture(gpgpu, program, knnGraph, 0, 'knn_graph_tex');
  uniform1f(gpgpu.gl, program, numRows, 'num_rows');
  uniform1f(gpgpu.gl, program, numPoints, 'num_points');
  uniform1f(gpgpu.gl, program, pntsPerRow, 'points_per_row');
  uniform1f(gpgpu.gl, program, numNeighs, 'num_neighs');

  uniform1f(gpgpu.gl, program, perplexity, 'perplexity');

  gpgpu.executeProgram();
}

///////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////

export function createGaussiaDistributionsFromDistancesProgram(
    gpgpu: tf.webgl.GPGPUContext): WebGLProgram {
  const fragmentShaderSource = `#version 300 es
    precision highp float;
    uniform sampler2D knn_graph_tex;
    uniform sampler2D parameters_tex;
    uniform float points_per_row;
    uniform float num_rows;
    uniform float num_points;
    uniform float num_neighs;

    vec2 half_pixel = vec2(0.5,0.5);

    out vec4 fragColor;
    //in highp vec4 gl_FragCoord;

    void main() {
      vec2 point_location = gl_FragCoord.xy - half_pixel;
      point_location.x = floor(point_location.x / num_neighs);

      //invalid points
      if(point_location.y*points_per_row + point_location.x >= num_points) {
        fragColor = vec4(0,0,0,0);
        return;
      }
      float distance_squared
            = texture(knn_graph_tex,
                        gl_FragCoord.xy /
                        vec2(points_per_row*num_neighs,num_rows)
                      ).g;
      vec2 parameters
            = texture(parameters_tex,
                        (point_location.xy + half_pixel)/
                        vec2(points_per_row,num_rows)
                      ).rg;
      float beta = parameters.r;
      float normalization = parameters.g;

      float probability = exp(-beta * distance_squared) / normalization;
      //check for NaN for degenerated knn (d = 0 for every point)
      if (!(probability < 0.0 || 0.0 < probability || probability == 0.0)) {
        probability = 0.;
      }

      fragColor = vec4(probability,0,0,1);
    }
  `;
  return gpgpu.createProgram(fragmentShaderSource);
}

export function executeGaussiaDistributionsFromDistancesProgram(
    gpgpu: tf.webgl.GPGPUContext, program: WebGLProgram, knnGraph: WebGLTexture,
    parameters: WebGLTexture, numPoints: number, numNeighs: number,
    pntsPerRow: number, numRows: number, targetTex?: WebGLTexture) {

  if (targetTex != null) {
    gpgpu.setOutputMatrixTexture(targetTex, numRows, pntsPerRow * numNeighs);
  } else {
    bindCanvasToFramebuffer(gpgpu.gl, DEBUG_MODE);
  }

  gpgpu.setProgram(program);

  setInputMatrixTexture(gpgpu, program, knnGraph, 0, 'knn_graph_tex');
  setInputMatrixTexture(gpgpu, program, parameters, 1, 'parameters_tex');
  uniform1f(gpgpu.gl, program, numRows, 'num_rows');
  uniform1f(gpgpu.gl, program, numPoints, 'num_points');
  uniform1f(gpgpu.gl, program, pntsPerRow, 'points_per_row');
  uniform1f(gpgpu.gl, program, numNeighs, 'num_neighs');

  gpgpu.executeProgram();
}
