import * as THREE from 'three';
import type { CastId } from '@logbook/core';
import { retroable } from './retro.ts';

/**
 * The people of the walking Library (D116), low-poly as the rest of it: the Librarian, the Clerk,
 * and The Unwritten. Each is built facing -z, as a yaw of 0 faces, with a face painted small and
 * shown with hard pixels.
 */

export interface Figure {
  group: THREE.Group;
  /** Turns to look at you. */
  head: THREE.Object3D;
  /** What a look or a click can land on. */
  meshes: THREE.Mesh[];
  dispose(): void;
}

/** A face (or a blank page), 32 pixels square, drawn by `paint`. */
function face(paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  paint(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function builder() {
  const owned: { dispose(): void }[] = [];
  const meshes: THREE.Mesh[] = [];
  const group = new THREE.Group();
  const mat = (color: number, lit = true) => {
    const m = retroable(lit ? new THREE.MeshLambertMaterial({ color, flatShading: true }) : new THREE.MeshBasicMaterial({ color }));
    owned.push(m);
    return m;
  };
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    owned.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const head = new THREE.Group();
  group.add(head);
  const figure = (): Figure => ({ group, head, meshes, dispose: () => owned.forEach((o) => o.dispose()) });
  return { owned, group, head, mat, add, figure };
}

/** A head: a box with `front` on the face (-z), `top` above, `skin` around. */
function headBox(b: ReturnType<typeof builder>, w: number, h: number, d: number, skin: THREE.Material, top: THREE.Material, front: THREE.Material) {
  // Box faces: +x, -x, +y, -y, +z, -z.
  return b.add(new THREE.BoxGeometry(w, h, d), [skin, skin, top, skin, top, front], 0, 0, 0, b.head);
}

export function librarian(): Figure {
  const b = builder();
  const green = b.mat(0x2f4a3a);
  const cardigan = b.mat(0x7a2f35);
  const skin = b.mat(0xd9b08c);
  const hair = b.mat(0xb9b4ad);
  const book = b.mat(0x5a2a14);
  b.add(new THREE.CylinderGeometry(0.21, 0.3, 0.82, 6), green, 0, 0.41, 0);
  b.add(new THREE.CylinderGeometry(0.16, 0.22, 0.56, 6), cardigan, 0, 1.1, 0);
  for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.08, 0.46, 0.08), cardigan, s * 0.22, 1.08, -0.04).rotation.set(0.35, 0, s * 0.08);
  b.add(new THREE.BoxGeometry(0.2, 0.26, 0.05), book, 0, 0.92, -0.2).rotation.x = -0.3;
  b.add(new THREE.BoxGeometry(0.07, 0.08, 0.07), skin, 0, 1.41, 0);
  b.head.position.set(0, 1.53, 0);
  const tex = face((g) => {
    g.fillStyle = '#d9b08c';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#b9b4ad';
    g.fillRect(0, 0, 32, 7);
    g.fillRect(0, 0, 4, 16);
    g.fillRect(28, 0, 4, 16);
    // Glasses, eyes, a small kind mouth.
    g.strokeStyle = '#3a2a1c';
    g.lineWidth = 2;
    g.strokeRect(6, 12, 8, 6);
    g.strokeRect(18, 12, 8, 6);
    g.fillStyle = '#3a2a1c';
    g.fillRect(14, 14, 4, 1);
    g.fillRect(9, 14, 2, 2);
    g.fillRect(21, 14, 2, 2);
    g.fillStyle = '#9a4a42';
    g.fillRect(13, 24, 6, 2);
  });
  b.owned.push(tex);
  const front = retroable(new THREE.MeshLambertMaterial({ map: tex }));
  b.owned.push(front);
  headBox(b, 0.2, 0.25, 0.2, skin, hair, front);
  // A bun.
  b.add(new THREE.IcosahedronGeometry(0.08, 0), hair, 0, 0.12, 0.08, b.head);
  return b.figure();
}

export function clerk(): Figure {
  const b = builder();
  const coat = b.mat(0x8a6a3a);
  const trousers = b.mat(0x34363a);
  const skin = b.mat(0xc99a78);
  const cap = b.mat(0x3a3530);
  const board = b.mat(0xc9b79a);
  for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.12, 0.6, 0.13), trousers, s * 0.09, 0.3, 0);
  b.add(new THREE.CylinderGeometry(0.19, 0.26, 0.82, 6), coat, 0, 0.98, 0);
  for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.09, 0.5, 0.09), coat, s * 0.24, 1.08, -0.05).rotation.set(0.45, 0, s * 0.06);
  b.add(new THREE.BoxGeometry(0.22, 0.3, 0.02), board, 0.02, 1.02, -0.24).rotation.x = -0.5;
  b.add(new THREE.BoxGeometry(0.08, 0.08, 0.08), skin, 0, 1.44, 0);
  b.head.position.set(0, 1.57, 0);
  const tex = face((g) => {
    g.fillStyle = '#c99a78';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#2a201a';
    g.fillRect(8, 13, 3, 3);
    g.fillRect(21, 13, 3, 3);
    g.fillRect(6, 10, 7, 1);
    g.fillRect(19, 10, 7, 1);
    // A moustache that has seen things.
    g.fillStyle = '#5a4a3e';
    g.fillRect(9, 21, 14, 3);
    g.fillRect(8, 23, 3, 2);
    g.fillRect(21, 23, 3, 2);
  });
  b.owned.push(tex);
  const front = retroable(new THREE.MeshLambertMaterial({ map: tex }));
  b.owned.push(front);
  headBox(b, 0.21, 0.25, 0.21, skin, skin, front);
  b.add(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 8), cap, 0, 0.15, 0, b.head);
  b.add(new THREE.BoxGeometry(0.2, 0.02, 0.09), cap, 0, 0.12, -0.13, b.head);
  return b.figure();
}

/** The Unwritten: too tall, too thin, a long black coat, and a blank page where a face should be. */
export function unwritten(): Figure {
  const b = builder();
  const coat = b.mat(0x110e0c);
  const pale = b.mat(0xcfc8b8);
  b.add(new THREE.CylinderGeometry(0.15, 0.34, 1.8, 5), coat, 0, 0.9, 0);
  b.add(new THREE.BoxGeometry(0.52, 0.12, 0.22), coat, 0, 1.82, 0);
  for (const s of [-1, 1]) {
    b.add(new THREE.BoxGeometry(0.07, 1.1, 0.07), coat, s * 0.27, 1.27, 0.02).rotation.z = s * 0.05;
    // Hands, long and pale, nearly at the knees.
    b.add(new THREE.BoxGeometry(0.06, 0.22, 0.04), pale, s * 0.3, 0.62, 0.02);
  }
  b.add(new THREE.BoxGeometry(0.06, 0.14, 0.06), pale, 0, 1.94, 0);
  b.head.position.set(0, 2.15, 0);
  const tex = face((g) => {
    g.fillStyle = '#ece6d6';
    g.fillRect(0, 0, 32, 32);
    // Ruled lines and a margin: a page with nothing written on it.
    g.fillStyle = '#b8c4d6';
    for (let y = 6; y < 32; y += 5) g.fillRect(0, y, 32, 1);
    g.fillStyle = '#d9a3a3';
    g.fillRect(6, 0, 1, 32);
  });
  b.owned.push(tex);
  // Unlit, so the page shows pale in the dark.
  const page = retroable(new THREE.MeshBasicMaterial({ map: tex }));
  b.owned.push(page);
  headBox(b, 0.24, 0.36, 0.2, pale, pale, page);
  // A slight lean towards you.
  for (const c of b.group.children) if (c !== b.head) c.rotation.x += 0.04;
  return b.figure();
}

export const CAST_FIGURES: Record<CastId, () => Figure> = { librarian, clerk };
