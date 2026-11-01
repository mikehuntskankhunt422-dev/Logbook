import type * as THREE from 'three';

/**
 * The PS1 look (D116): every surface's corners snapped to a coarse grid on the screen, so shapes
 * wobble a little as you move, and its colours cut to 15 bits with an ordered dither, as on a 1995
 * console. (The picture itself is drawn small and shown big, pixelated, by the engine and the page.)
 * The code goes into the materials' shaders only while it's on, so it costs nothing while it's off.
 */

const DEFINE = 'LOGBOOK_RETRO';
const materials = new Set<THREE.Material>();
let on = false;

const VERTEX = `
#ifdef ${DEFINE}
{
  vec2 grid = vec2(160.0, 120.0);
  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * grid + 0.5) / grid * gl_Position.w;
}
#endif`;

const FRAGMENT = `
#ifdef ${DEFINE}
{
  ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
  int i = q.x + q.y * 4;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  gl_FragColor.rgb = floor(gl_FragColor.rgb * 31.0 + m[i] / 16.0) / 31.0;
}
#endif`;

function mark(material: THREE.Material) {
  material.defines ??= {};
  if (on) material.defines[DEFINE] = '';
  else delete material.defines[DEFINE];
  material.needsUpdate = true;
}

/** Makes a material able to take the PS1 look (and keeps track of it until it's let go). */
export function retroable<M extends THREE.Material>(material: M): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${FRAGMENT}`);
  };
  mark(material);
  materials.add(material);
  material.addEventListener('dispose', () => materials.delete(material));
  return material;
}

/** Switches the PS1 look on or off for every material that can take it. */
export function setRetro(next: boolean): void {
  if (next === on) return;
  on = next;
  materials.forEach(mark);
}
