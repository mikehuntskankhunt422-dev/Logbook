import * as THREE from 'three';
import {
  DOOR_HEIGHT,
  EYE,
  RACK_LENGTH,
  HALL_HEIGHT,
  HALL_START,
  ROOM_APOTHEM,
  ROOM_STEP,
  WALL_HEIGHT,
  placeAt,
  roomAt,
  step,
  type ArchiveRack,
  type Book,
  type LibraryRoom,
  type Spot,
} from '@logbook/core';
import { paintBookWall, paintFolderRack, paintSign } from './atlas.ts';
import { aisleShell, bookWall, corridorShell, folderRack, galleryShell, pairZ, type Shelved } from './build.ts';

/**
 * The Library you walk through (D113), drawn with three.js: the galleries and the storage room
 * near you are built as you come to them and let go as you leave, the books' titles painted only
 * in the room you're in. It draws only while something moves, and not at all while paused (a
 * book open, the page hidden), so standing still costs nothing.
 */

export interface Target {
  book: Book;
  kind: 'book' | 'folder';
}
export interface Place {
  world: 'library' | 'storage';
  label: string;
  detail: string;
  /** The gallery's number (0 the first), or in the storage room the aisle's (-1 the corridor). */
  at: number;
}
export interface WorldEvents {
  place(place: Place): void;
  target(target: Target | null): void;
  open(target: Target): void;
}
export interface World {
  setContent(rooms: LibraryRoom[], racks: ArchiveRack[]): void;
  goTo(spot: Spot): void;
  where(): Spot;
  openTarget(): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

const WALK = 2.2;
const RUN = 4.4;
const TURN = 1.9;
const LOOK = 0.0042;
const REACH = 4.2;
const PULL = 0.07;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const span = (first?: string, last?: string) => (!first || !last ? '' : shortDate(first) === shortDate(last) ? shortDate(first) : `${shortDate(first)} – ${shortDate(last)}`);
const many = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

interface Wall {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  shelved: Shelved;
  kind: 'book' | 'folder';
  paint: (close: boolean) => HTMLCanvasElement;
  close: boolean | null;
}
interface Chunk {
  group: THREE.Group;
  walls: Wall[];
  owned: { dispose(): void }[];
}

export function createWorld(canvas: HTMLCanvasElement, events: WorldEvents, start: Spot, reduced: boolean, thisYear: number): World {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 40);
  camera.rotation.order = 'YXZ';
  const sky = new THREE.Color();
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 5, 26);
  const ambient = new THREE.HemisphereLight(0xffe8c8, 0x3a2616, 1.5);
  scene.add(ambient);
  const lamps = Array.from({ length: 4 }, () => {
    const l = new THREE.PointLight(0xffd59a, 26, 15, 1.2);
    scene.add(l);
    return l;
  });

  const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });
  const mats = {
    wall: lambert(0x3e4b40),
    case: lambert(0x5a3820),
    shelf: lambert(0x8a5d36),
    floor: lambert(0x4a2f1b),
    rug: lambert(0x7a2228),
    ceiling: lambert(0x2c2018),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffe2a8 }),
    chain: lambert(0x2a2a2a),
    concrete: lambert(0x9a958c),
    hall: lambert(0xc4beb1),
    metal: lambert(0x7d858c),
    tube: new THREE.MeshBasicMaterial({ color: 0xf2f6ff }),
  };
  // Beyond what's built: a veil as far off as the haze is thick, so the world fades rather than ending.
  const veilMaterial = new THREE.MeshBasicMaterial({ color: sky, side: THREE.DoubleSide });
  const veilGeometry = new THREE.PlaneGeometry(60, 30);
  const veils = [0, 1].map(() => {
    const v = new THREE.Mesh(veilGeometry, veilMaterial);
    v.visible = false;
    scene.add(v);
    return v;
  });
  const gallery = galleryShell();
  const aisle = aisleShell();
  const corridor = corridorShell();
  const shared = [...Object.values(gallery), ...Object.values(aisle), ...Object.values(corridor), ...Object.values(mats), veilMaterial, veilGeometry];

  let rooms: LibraryRoom[] = [];
  let racks: ArchiveRack[] = [];
  const chunks = new Map<string, Chunk>();
  const pos = { x: start.x, z: start.z };
  let yaw = start.yaw;
  let pitch = start.pitch;
  let walked = 0;
  let paused = false;
  let disposed = false;
  let running = false;
  let frameId = 0;
  let last = 0;
  let aimedAt = 0;
  let placeKey = '';
  /** What's in front of you (or under the pointer), and the book pulled out a little to show it. */
  let target: (Target & { wall: Wall; index: number }) | null = null;
  let pulled: { wall: Wall; index: number } | null = null;

  // ── building what's near ──
  const sign = (text: string, sub: string, style: 'library' | 'storage', owned: Chunk['owned']) => {
    const texture = new THREE.CanvasTexture(paintSign(text, sub, style));
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, fog: true });
    const geometry = new THREE.PlaneGeometry(1.7, 0.425);
    owned.push(texture, material, geometry);
    return new THREE.Mesh(geometry, material);
  };
  const addWall = (chunk: Chunk, shelved: Shelved | null, kind: 'book' | 'folder', paint: (close: boolean) => HTMLCanvasElement) => {
    if (!shelved) return;
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(shelved.geometry, material);
    chunk.group.add(mesh);
    chunk.owned.push(shelved.geometry, material);
    chunk.walls.push({ mesh, shelved, kind, paint, close: null });
  };
  const roomName = (k: number) => (k < 0 ? 'Storage room' : roomAt(rooms, k, thisYear).label);
  const roomSub = (k: number) => {
    if (k < 0) return 'Every entry in a folder';
    const room = roomAt(rooms, k, thisYear);
    return room.books ? `${many(room.books, 'book')} · ${span(room.first, room.last)}` : 'Empty shelves, for what’s to come';
  };

  function buildGallery(k: number): Chunk {
    const chunk: Chunk = { group: new THREE.Group(), walls: [], owned: [] };
    chunk.group.position.z = k * ROOM_STEP;
    chunk.group.add(
      new THREE.Mesh(gallery.walls, mats.wall),
      new THREE.Mesh(gallery.cases, mats.case),
      new THREE.Mesh(gallery.shelves, mats.shelf),
      new THREE.Mesh(gallery.chain, mats.chain),
      new THREE.Mesh(gallery.floor, mats.floor),
      new THREE.Mesh(gallery.rug, mats.rug),
      new THREE.Mesh(gallery.ceiling, mats.ceiling),
      new THREE.Mesh(gallery.lamp, mats.lamp),
    );
    // Over each doorway, where it leads.
    const ahead = sign(roomName(k + 1), roomSub(k + 1), 'library', chunk.owned);
    ahead.position.set(0, DOOR_HEIGHT + 0.35, ROOM_APOTHEM - 0.12);
    ahead.rotation.y = Math.PI;
    const behind = sign(roomName(k - 1), roomSub(k - 1), 'library', chunk.owned);
    behind.position.set(0, DOOR_HEIGHT + 0.35, -ROOM_APOTHEM + 0.12);
    chunk.group.add(ahead, behind);
    const room = roomAt(rooms, k, thisYear);
    for (let w = 0; w < 4; w++) addWall(chunk, bookWall(room, w), 'book', (close) => paintBookWall(room.walls[w]!, close));
    return chunk;
  }

  function buildPair(p: number): Chunk {
    const chunk: Chunk = { group: new THREE.Group(), walls: [], owned: [] };
    chunk.group.position.z = pairZ(p);
    chunk.group.add(new THREE.Mesh(aisle.floor, mats.concrete), new THREE.Mesh(aisle.ceiling, mats.hall), new THREE.Mesh(aisle.walls, mats.hall), new THREE.Mesh(aisle.racks, mats.metal), new THREE.Mesh(aisle.light, mats.tube));
    const pair = [racks[2 * p], racks[2 * p + 1]];
    const first = pair.map((r) => r?.first).find(Boolean);
    const lastDay = [...pair].reverse().map((r) => r?.last).find(Boolean);
    const label = sign(`Aisle ${p + 1}`, first ? span(first, lastDay) : 'Empty racks', 'storage', chunk.owned);
    label.position.set(0, HALL_HEIGHT - 0.6, 0);
    const back = label.clone();
    back.rotation.y = Math.PI;
    chunk.group.add(label, back);
    pair.forEach((rack, i) => rack && addWall(chunk, folderRack(rack.shelves, i), 'folder', (close) => paintFolderRack(rack.shelves, close)));
    return chunk;
  }

  function buildCorridor(): Chunk {
    const chunk: Chunk = { group: new THREE.Group(), walls: [], owned: [] };
    chunk.group.add(new THREE.Mesh(corridor.walls, mats.wall), new THREE.Mesh(corridor.floor, mats.floor), new THREE.Mesh(corridor.hall, mats.hall));
    const toStorage = sign('Storage room', 'Every entry in a folder', 'storage', chunk.owned);
    toStorage.position.set(0, DOOR_HEIGHT + 0.4, HALL_START + 0.22);
    const toLibrary = sign('The Library', 'Every entry a book', 'library', chunk.owned);
    toLibrary.position.set(0, DOOR_HEIGHT + 0.4, HALL_START - 0.02);
    toLibrary.rotation.y = Math.PI;
    chunk.group.add(toStorage, toLibrary);
    return chunk;
  }

  function dropChunk(key: string) {
    const chunk = chunks.get(key);
    if (!chunk) return;
    if (pulled && chunk.walls.includes(pulled.wall)) pulled = null;
    for (const w of chunk.walls) w.mesh.material.map?.dispose();
    for (const o of chunk.owned) o.dispose();
    scene.remove(chunk.group);
    chunks.delete(key);
  }

  /** Builds what's in sight, lets go of the rest, and paints titles close by. */
  function refresh(force = false) {
    const place = placeAt(pos.z);
    const key = place.world === 'library' ? `g${place.room}` : `s${place.aisle}${pos.z > HALL_START ? 'c' : ''}`;
    if (key === placeKey && !force) return;
    placeKey = key;
    const want = new Map<string, () => Chunk>([['corridor', buildCorridor]]);
    const close = new Set<string>();
    // Where the veils hang: past the furthest gallery and rack built, either way.
    const edges: number[] = [];
    if (place.world === 'library') {
      const from = Math.max(0, place.room - 1);
      for (let k = from; k <= place.room + 2; k++) want.set(`g${k}`, () => buildGallery(k));
      edges.push((place.room + 2) * ROOM_STEP + ROOM_APOTHEM + 0.05);
      if (place.room <= 1) {
        for (let p = 0; p <= 1; p++) want.set(`s${p}`, () => buildPair(p));
        edges.push(pairZ(1) - RACK_LENGTH / 2 - 0.05);
      } else edges.push(from * ROOM_STEP - ROOM_APOTHEM - 0.05);
      close.add(`g${place.room}`);
    } else {
      const from = Math.max(0, place.aisle - 3);
      for (let p = from; p <= place.aisle + 8; p++) want.set(`s${p}`, () => buildPair(p));
      edges.push(pairZ(place.aisle + 8) - RACK_LENGTH / 2 - 0.05);
      if (place.aisle <= 2) {
        for (let k = 0; k <= 1; k++) want.set(`g${k}`, () => buildGallery(k));
        edges.push(ROOM_STEP + ROOM_APOTHEM + 0.05);
      } else edges.push(pairZ(from) + RACK_LENGTH / 2 + 0.05);
      for (let p = Math.max(0, place.aisle - 1); p <= place.aisle + 1; p++) close.add(`s${p}`);
    }
    veils.forEach((v, i) => {
      v.visible = edges[i] !== undefined;
      v.position.set(0, 5, edges[i] ?? 0);
    });
    for (const k of [...chunks.keys()]) if (!want.has(k)) dropChunk(k);
    for (const [k, build] of want) {
      if (chunks.has(k)) continue;
      const chunk = build();
      chunks.set(k, chunk);
      scene.add(chunk.group);
    }
    for (const [k, chunk] of chunks) {
      for (const w of chunk.walls) {
        const near = close.has(k);
        if (w.close === near) continue;
        const texture = new THREE.CanvasTexture(w.paint(near));
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;
        w.mesh.material.map?.dispose();
        w.mesh.material.map = texture;
        w.mesh.material.needsUpdate = true;
        w.close = near;
      }
    }
    // The world's light: warm lamps and dusk in the Library, cool tubes in the storage room.
    const storage = place.world === 'storage';
    sky.set(storage ? 0xb3aea3 : 0x1a110a);
    const fog = scene.fog as THREE.Fog;
    // (The haze and the veils keep copies of the colour, not the colour itself.)
    fog.color.copy(sky);
    veilMaterial.color.copy(sky);
    fog.near = storage ? 4 : 5;
    fog.far = storage ? 19 : 26;
    ambient.intensity = storage ? 1.25 : 1.5;
    lamps.forEach((l, i) => {
      l.intensity = storage ? 9 : 26;
      if (storage) {
        l.color.set(0xeef3ff);
        l.position.set(0, HALL_HEIGHT - 0.4, pairZ(Math.max(0, place.aisle - 1 + i)));
      } else {
        l.color.set(0xffd59a);
        l.position.set(0, WALL_HEIGHT - 0.7, (Math.max(0, place.room - 1) + i) * ROOM_STEP);
      }
    });
    if (storage) {
      const label = pos.z > HALL_START ? 'The corridor' : `Storage room · Aisle ${place.aisle + 1}`;
      const pair = [racks[2 * place.aisle], racks[2 * place.aisle + 1]];
      const first = pair.map((r) => r?.first).find(Boolean);
      const lastDay = [...pair].reverse().map((r) => r?.last).find(Boolean);
      events.place({ world: 'storage', label, detail: pos.z > HALL_START ? 'Storage room ahead, the Library behind' : first ? span(first, lastDay) : 'Empty racks, for what’s to come', at: pos.z > HALL_START ? -1 : place.aisle });
    } else events.place({ world: 'library', label: roomName(place.room), detail: roomSub(place.room), at: place.room });
  }

  // ── what you're looking at ──
  const raycaster = new THREE.Raycaster();
  raycaster.far = REACH;
  const pointer = { x: 0, y: 0, over: false };
  let aimWithPointer = false;

  function pull(wall: Wall, index: number, by: number) {
    const attr = wall.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = wall.shelved.n;
    for (let v = index * 24; v < index * 24 + 24; v++) attr.setXYZ(v, attr.getX(v) - n[0] * by, attr.getY(v), attr.getZ(v) - n[2] * by);
    attr.needsUpdate = true;
  }

  function aim() {
    // Freshly built rooms, and the camera, where they are now (not as last drawn).
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    const ndc = aimWithPointer && pointer.over ? new THREE.Vector2(pointer.x, pointer.y) : new THREE.Vector2(0, 0);
    raycaster.setFromCamera(ndc, camera);
    const meshes = [...chunks.values()].flatMap((c) => c.walls.map((w) => w.mesh));
    const hit = raycaster.intersectObjects(meshes, false)[0];
    let next: typeof target = null;
    if (hit && hit.faceIndex != null) {
      const wall = [...chunks.values()].flatMap((c) => c.walls).find((w) => w.mesh === hit.object);
      const index = Math.floor(hit.faceIndex / 12);
      const book = wall?.shelved.items[index];
      if (wall && book) next = { book, kind: wall.kind, wall, index };
    }
    if (next?.book.id === target?.book.id && next?.wall === target?.wall) return;
    if (pulled) pull(pulled.wall, pulled.index, -PULL);
    pulled = next ? { wall: next.wall, index: next.index } : null;
    if (pulled) pull(pulled.wall, pulled.index, PULL);
    target = next;
    events.target(next ? { book: next.book, kind: next.kind } : null);
  }

  // ── moving ──
  const keys = new Set<string>();
  const stick = { id: -1, x: 0, y: 0, ox: 0, oy: 0 };
  let look: { id: number; x: number; y: number; moved: number; at: number } | null = null;
  const knob = document.createElement('div');
  knob.className = 'walk-stick';
  knob.hidden = true;
  canvas.parentElement?.append(knob);

  function update(dt: number): boolean {
    const turn = (keys.has('tl') ? 1 : 0) - (keys.has('tr') ? 1 : 0);
    yaw += turn * TURN * dt;
    let fwd = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0);
    let side = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
    if (stick.id >= 0) {
      fwd += -stick.y;
      side += stick.x;
    }
    const len = Math.hypot(fwd, side);
    if (len > 1) {
      fwd /= len;
      side /= len;
    }
    const speed = keys.has('run') ? RUN : WALK;
    const dx = (-Math.sin(yaw) * fwd + Math.cos(yaw) * side) * speed * dt;
    const dz = (-Math.cos(yaw) * fwd - Math.sin(yaw) * side) * speed * dt;
    const moving = len > 0.05;
    if (moving) {
      // In small steps, so nothing is walked through however long the frame.
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08));
      for (let i = 0; i < steps; i++) Object.assign(pos, step(pos.x, pos.z, dx / steps, dz / steps));
      walked += speed * dt;
      refresh();
    }
    camera.position.set(pos.x, EYE + (moving && !reduced ? Math.sin(walked * 4.2) * 0.025 : 0), pos.z);
    camera.rotation.set(pitch, yaw, 0);
    return moving || turn !== 0 || look !== null || stick.id >= 0;
  }

  function frame(now: number) {
    frameId = 0;
    if (paused || disposed) {
      running = false;
      return;
    }
    // Real time even when frames are slow (a slow phone): each move is taken in small steps anyway.
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const busy = update(dt);
    // What's in front of you, a few times a second while moving (each look goes through every book
    // nearby), and once more when you stop.
    if ((!aimWithPointer || busy) && (!busy || now - aimedAt > 120)) {
      aim();
      aimedAt = now;
    }
    renderer.render(scene, camera);
    if (busy || keys.size) frameId = requestAnimationFrame(frame);
    else running = false;
  }
  /** Draws again, and keeps drawing while anything moves. */
  function kick() {
    if (running || paused || disposed) return;
    running = true;
    last = performance.now();
    frameId = requestAnimationFrame(frame);
  }

  const KEYS: Record<string, string> = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr', ShiftLeft: 'run', ShiftRight: 'run' };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' || e.code === 'KeyE' || e.code === 'Space') {
      e.preventDefault();
      aimWithPointer = false;
      aim();
      world.openTarget();
      return;
    }
    const k = KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    aimWithPointer = false;
    keys.add(k);
    kick();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const k = KEYS[e.code];
    if (k) keys.delete(k);
  };
  const ndcOf = (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * 2 - 1, y: -((e.clientY - box.top) / box.height) * 2 + 1, box };
  };
  const onPointerDown = (e: PointerEvent) => {
    canvas.focus({ preventScroll: true });
    const { box } = ndcOf(e);
    const lx = e.clientX - box.left;
    const ly = e.clientY - box.top;
    if (e.pointerType !== 'mouse' && stick.id < 0 && lx < box.width * 0.4 && ly > box.height * 0.45) {
      Object.assign(stick, { id: e.pointerId, x: 0, y: 0, ox: e.clientX, oy: e.clientY });
      knob.hidden = false;
      knob.style.left = `${lx}px`;
      knob.style.top = `${ly}px`;
    } else if (!look && e.button === 0) look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, at: performance.now() };
    else return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer knows: followed without capture.
    }
    kick();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId === stick.id) {
      stick.x = Math.max(-1, Math.min(1, (e.clientX - stick.ox) / 50));
      stick.y = Math.max(-1, Math.min(1, (e.clientY - stick.oy) / 50));
      knob.style.transform = `translate(${stick.x * 30}px, ${stick.y * 30}px)`;
      return;
    }
    if (look && e.pointerId === look.id) {
      const dx = e.clientX - look.x;
      const dy = e.clientY - look.y;
      look.moved += Math.abs(dx) + Math.abs(dy);
      look.x = e.clientX;
      look.y = e.clientY;
      yaw -= dx * LOOK;
      pitch = Math.max(-1.2, Math.min(1.2, pitch - dy * LOOK));
      return;
    }
    if (e.pointerType === 'mouse') {
      const p = ndcOf(e);
      Object.assign(pointer, { x: p.x, y: p.y, over: true });
      aimWithPointer = true;
      if (!running) {
        aim();
        renderer.render(scene, camera);
      }
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === stick.id) {
      Object.assign(stick, { id: -1, x: 0, y: 0 });
      knob.hidden = true;
      knob.style.transform = '';
      return;
    }
    if (!look || e.pointerId !== look.id) return;
    const tap = look.moved < 8 && performance.now() - look.at < 500;
    look = null;
    if (!tap || e.type === 'pointercancel') return;
    // A click or a tap: what's under it opens.
    const p = ndcOf(e);
    Object.assign(pointer, { x: p.x, y: p.y, over: true });
    aimWithPointer = true;
    aim();
    world.openTarget();
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    pointer.over = false;
    if (aimWithPointer && !running) {
      aim();
      renderer.render(scene, camera);
    }
  };
  const onBlur = () => keys.clear();
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!running && !paused) renderer.render(scene, camera);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  const onHidden = () => document.hidden && keys.clear();
  document.addEventListener('visibilitychange', onHidden);

  const world: World = {
    setContent(nextRooms, nextRacks) {
      rooms = nextRooms;
      racks = nextRacks;
      for (const k of [...chunks.keys()]) dropChunk(k);
      target = null;
      pulled = null;
      events.target(null);
      refresh(true);
      update(0);
      aim();
      if (!paused) renderer.render(scene, camera);
    },
    goTo(spot) {
      Object.assign(pos, { x: spot.x, z: spot.z });
      yaw = spot.yaw;
      pitch = spot.pitch;
      aimWithPointer = false;
      refresh();
      update(0);
      aim();
      if (!paused) renderer.render(scene, camera);
    },
    where: () => ({ x: pos.x, z: pos.z, yaw, pitch }),
    openTarget() {
      if (target) events.open({ book: target.book, kind: target.kind });
    },
    setPaused(next) {
      paused = next;
      keys.clear();
      look = null;
      if (!paused) {
        resize();
        renderer.render(scene, camera);
      } else if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
        running = false;
      }
    },
    dispose() {
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      ro.disconnect();
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onHidden);
      knob.remove();
      for (const k of [...chunks.keys()]) dropChunk(k);
      for (const s of shared) s.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  resize();
  return world;
}
