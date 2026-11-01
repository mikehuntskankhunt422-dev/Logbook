import * as THREE from 'three';
import {
  CAST,
  DOOR_HEIGHT,
  EYE,
  RACK_LENGTH,
  HALL_HEIGHT,
  HALL_START,
  ROOM_APOTHEM,
  ROOM_STEP,
  WALL_HEIGHT,
  QUIET,
  haunted,
  hauntStep,
  placeAt,
  roomAt,
  stepAmong,
  type ArchiveRack,
  type Book,
  type CastId,
  type Haunt,
  type HauntEvent,
  type HorrorLevel,
  type LibraryRoom,
  type Spot,
} from '@logbook/core';
import { paintBookWall, paintFolderRack, paintSign } from './atlas.ts';
import { aisleShell, bookWall, corridorShell, folderRack, galleryShell, pairZ, type Shelved } from './build.ts';
import { CAST_FIGURES, unwritten, type Figure } from './figures.ts';
import { retroable, setRetro } from './retro.ts';
import { createSounds } from './sounds.ts';

/**
 * The Library you walk through (D113), drawn with three.js: the galleries and the storage room
 * near you are built as you come to them and let go as you leave, the books' titles painted only
 * in the room you're in. It draws only while something moves, and not at all while paused (a
 * book open, the page hidden), so standing still costs nothing. The Librarian and the Clerk stand
 * in it to be talked to, and with horror on (D116) The Unwritten walks its empty places, which
 * keeps it drawing while you're there.
 */

/** What's in front of you: a book, a folder, or someone to talk to. */
export type Target = { kind: 'book' | 'folder'; book: Book } | { kind: 'npc'; id: CastId; name: string };
/** The Library's looks and horror, as chosen on this device. */
export interface Mode {
  horror: HorrorLevel;
  ps1: boolean;
  sounds: boolean;
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
  /** Something to say about what's happening (horror's goings-on), for everyone to hear. */
  cue(text: string): void;
  /** The Unwritten caught you (Intense). */
  scare(): void;
  /** The mouse was captured for looking around (the crosshair is the cursor), or let go (D117). */
  lock(locked: boolean): void;
}
export interface World {
  setContent(rooms: LibraryRoom[], racks: ArchiveRack[]): void;
  goTo(spot: Spot): void;
  where(): Spot;
  openTarget(): void;
  setPaused(paused: boolean): void;
  setMode(mode: Mode): void;
  /**
   * In full screen (D117), the mouse is the view's: captured now if it can be, and by a click
   * while it isn't, so moving it looks around and the crosshair is the cursor. Off: let go.
   */
  capture(on: boolean): void;
  /** Sound is allowed from now on (after a tap or a key elsewhere on the page). */
  wakeSound(): void;
  /** Whether you've written today: fresh ink slows The Unwritten (D118). */
  setInked(inked: boolean): void;
  dispose(): void;
}

const WALK = 2.2;
/** Radians a pixel, looking around with a captured mouse. */
const MOUSE_LOOK = 0.0025;
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

/** What horror says when, for everyone (and screen readers) to hear. */
const CUES: Partial<Record<HauntEvent, string>> = {
  appear: 'Something is standing further in, where the light doesn’t reach.',
  near: 'Footsteps. Close behind you.',
  vanish: 'It’s gone.',
  leave: 'The footsteps stop. It stays where nothing is written.',
  pass: 'Something cold passes through you, and is gone.',
};

export function createWorld(canvas: HTMLCanvasElement, events: WorldEvents, start: Spot, reduced: boolean, thisYear: number, initial: Mode): World {
  let mode = initial;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene();
  // (Nothing comes nearer the eye than 0.3 m, so the near plane can sit at 0.1 m, which keeps the
  // depth fine enough that surfaces a centimetre apart never fight, even on a 16-bit depth buffer.)
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 40);
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

  const lambert = (color: number) => retroable(new THREE.MeshLambertMaterial({ color }));
  const mats = {
    wall: lambert(0x3e4b40),
    case: lambert(0x5a3820),
    shelf: lambert(0x8a5d36),
    // The boards are drawn as if a hair nearer than what they lie over (the hall's concrete at its
    // door), and the rug nearer still, so neither ever flickers (D117).
    floor: Object.assign(lambert(0x4a2f1b), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    // Drawn as if a little nearer than it is, so it never flickers into the floor beneath it.
    rug: Object.assign(lambert(0x7a2228), { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    ceiling: lambert(0x2c2018),
    lamp: retroable(new THREE.MeshBasicMaterial({ color: 0xffe2a8 })),
    chain: lambert(0x2a2a2a),
    concrete: lambert(0x9a958c),
    hall: lambert(0xc4beb1),
    metal: lambert(0x7d858c),
    tube: retroable(new THREE.MeshBasicMaterial({ color: 0xf2f6ff })),
  };
  // Beyond what's built: a veil as far off as the haze is thick, so the world fades rather than ending.
  const veilMaterial = retroable(new THREE.MeshBasicMaterial({ color: sky, side: THREE.DoubleSide }));
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

  // The people in it (D116), where they always stand, and The Unwritten, out only when it's out.
  const cast = CAST.map((c) => {
    const figure = CAST_FIGURES[c.id]();
    figure.group.position.set(c.x, 0, c.z);
    figure.group.rotation.y = c.yaw;
    scene.add(figure.group);
    return { ...c, figure };
  });
  const castMeshes = new Map(cast.flatMap((c) => c.figure.meshes.map((m) => [m, c] as const)));
  const shadow: Figure = unwritten();
  shadow.group.visible = false;
  scene.add(shadow.group);
  const sounds = createSounds();
  let haunt: Haunt = QUIET;
  let inked = false;
  let stepClock = 0;
  let lampBase = 26;
  let clock = 0;

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
  let target: { t: Target; key: string; wall?: Wall; index?: number } | null = null;
  let pulled: { wall: Wall; index: number } | null = null;

  // ── building what's near ──
  const sign = (text: string, sub: string, style: 'library' | 'storage', owned: Chunk['owned']) => {
    const texture = new THREE.CanvasTexture(paintSign(text, sub, style));
    texture.colorSpace = THREE.SRGBColorSpace;
    pixels(texture);
    const material = retroable(new THREE.MeshBasicMaterial({ map: texture, fog: true }));
    const geometry = new THREE.PlaneGeometry(1.7, 0.425);
    owned.push(texture, material, geometry);
    return new THREE.Mesh(geometry, material);
  };
  const addWall = (chunk: Chunk, shelved: Shelved | null, kind: 'book' | 'folder', paint: (close: boolean) => HTMLCanvasElement) => {
    if (!shelved) return;
    const material = retroable(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const mesh = new THREE.Mesh(shelved.geometry, material);
    chunk.group.add(mesh);
    chunk.owned.push(shelved.geometry, material);
    chunk.walls.push({ mesh, shelved, kind, paint, close: null });
  };
  const roomName = (k: number) => (k < 0 ? 'Storage room' : roomAt(rooms, k, thisYear).label);
  const roomSub = (k: number) => {
    if (k < 0) return 'Every entry in a folder';
    const room = roomAt(rooms, k, thisYear);
    if (room.books) return `${many(room.books, 'book')} · ${span(room.first, room.last)}`;
    // With horror on, now and then a sign out where it walks isn't quite right.
    return mode.horror !== 'off' && zone(0, k * ROOM_STEP) && k % 3 === 2 ? 'Empty shelves, for who’s to come' : 'Empty shelves, for what’s to come';
  };
  /** Where The Unwritten walks (D116). */
  const zone = (_x: number, z: number) => haunted(z, rooms.length, racks.length);
  /** Hard pixels for the PS1 look; smooth otherwise. */
  function pixels(texture: THREE.Texture) {
    texture.magFilter = mode.ps1 ? THREE.NearestFilter : THREE.LinearFilter;
    texture.minFilter = mode.ps1 ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  }

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
    chunk.group.add(new THREE.Mesh(corridor.walls, mats.wall), new THREE.Mesh(corridor.floor, mats.floor), new THREE.Mesh(corridor.hall, mats.hall), new THREE.Mesh(corridor.hallFloor, mats.concrete));
    // The signs either side of the hall's door, standing a little off it.
    const toStorage = sign('Storage room', 'Every entry in a folder', 'storage', chunk.owned);
    toStorage.position.set(0, DOOR_HEIGHT + 0.4, HALL_START + 0.26);
    const toLibrary = sign('The Library', 'Every entry a book', 'library', chunk.owned);
    toLibrary.position.set(0, DOOR_HEIGHT + 0.4, HALL_START - 0.06);
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
        pixels(texture);
        w.mesh.material.map?.dispose();
        w.mesh.material.map = texture;
        w.mesh.material.needsUpdate = true;
        w.close = near;
      }
    }
    // The world's light: warm lamps and dusk in the Library, cool tubes in the storage room; with
    // horror on, where The Unwritten walks, low lamps and a thick dark.
    const storage = place.world === 'storage';
    const dark = mode.horror !== 'off' && zone(pos.x, pos.z);
    sky.set(dark ? (storage ? 0x1c1b19 : 0x070504) : storage ? 0xb3aea3 : 0x1a110a);
    const fog = scene.fog as THREE.Fog;
    // (The haze and the veils keep copies of the colour, not the colour itself.)
    fog.color.copy(sky);
    veilMaterial.color.copy(sky);
    fog.near = dark ? 1.5 : storage ? 4 : 5;
    fog.far = dark ? 15 : storage ? 19 : 26;
    ambient.intensity = dark ? 0.55 : storage ? 1.25 : 1.5;
    lampBase = dark ? (storage ? 4 : 12) : storage ? 9 : 26;
    lamps.forEach((l, i) => {
      l.intensity = lampBase;
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
    // The nearest thing in the way: a book, or someone standing in front of it.
    const hit = raycaster.intersectObjects([...meshes, ...castMeshes.keys()], false)[0];
    let next: typeof target = null;
    const person = hit && castMeshes.get(hit.object as THREE.Mesh);
    if (person) next = { t: { kind: 'npc', id: person.id, name: person.name }, key: `npc:${person.id}` };
    else if (hit && hit.faceIndex != null) {
      const wall = [...chunks.values()].flatMap((c) => c.walls).find((w) => w.mesh === hit.object);
      const index = Math.floor(hit.faceIndex / 12);
      const book = wall?.shelved.items[index];
      if (wall && book) next = { t: { book, kind: wall.kind }, key: `${wall.mesh.uuid}:${book.id}`, wall, index };
    }
    if (next?.key === target?.key) return;
    if (pulled) pull(pulled.wall, pulled.index, -PULL);
    pulled = next?.wall && next.index !== undefined ? { wall: next.wall, index: next.index } : null;
    if (pulled) pull(pulled.wall, pulled.index, PULL);
    target = next;
    events.target(next ? next.t : null);
  }

  // ── the mouse, captured in full screen (D117): it turns the view, and the crosshair is the cursor ──
  let capturing = false;
  const locked = () => document.pointerLockElement === canvas;
  /** Asks for the mouse (only allowed straight after a click or a key; else the next click asks). */
  const lock = () => {
    if (!capturing || locked() || typeof canvas.requestPointerLock !== 'function') return;
    try {
      void (canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch(() => {});
    } catch {
      // Not now: a click on the view asks again.
    }
  };
  const onLockChange = () => {
    look = null;
    if (locked()) aimWithPointer = false;
    events.lock(locked());
    aim();
    if (!paused) renderer.render(scene, camera);
  };
  const onMouseLook = (e: MouseEvent) => {
    if (!locked() || paused) return;
    yaw -= e.movementX * MOUSE_LOOK;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * MOUSE_LOOK));
    kick();
  };

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
      for (let i = 0; i < steps; i++) Object.assign(pos, stepAmong(pos.x, pos.z, dx / steps, dz / steps));
      walked += speed * dt;
      refresh();
    }
    camera.position.set(pos.x, EYE + (moving && !reduced ? Math.sin(walked * 4.2) * 0.025 : 0), pos.z);
    camera.rotation.set(pitch, yaw, 0);
    // The cast look at you when you're near.
    for (const c of cast) {
      const turnTo = Math.atan2(-(pos.x - c.x), -(pos.z - c.z)) - c.yaw;
      const by = Math.atan2(Math.sin(turnTo), Math.cos(turnTo));
      c.figure.head.rotation.y = Math.hypot(pos.x - c.x, pos.z - c.z) < 5 ? Math.max(-1, Math.min(1, by)) : 0;
    }
    return moving || turn !== 0 || look !== null || stick.id >= 0;
  }

  /** The Unwritten, a moment at a time (D116); whether it, or where it walks, keeps the world moving. */
  function horror(dt: number): boolean {
    if (mode.horror === 'off') return false;
    clock += dt;
    const half = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const was = haunt;
    const out = hauntStep(haunt, mode.horror, { x: pos.x, z: pos.z, yaw, half }, dt, zone, inked);
    haunt = out.haunt;
    for (const e of out.events) {
      const said = CUES[e];
      if (said) events.cue(said);
      if (e === 'vanish' || e === 'pass') sounds.breath();
      if (e === 'scare') {
        sounds.scream();
        keys.clear();
        stick.id = -1;
        knob.hidden = true;
        look = null;
        events.scare();
      }
    }
    const inside = zone(pos.x, pos.z);
    sounds.hum(inside || haunt.here);
    shadow.group.visible = haunt.here;
    const dist = Math.hypot(pos.x - haunt.x, pos.z - haunt.z);
    if (haunt.here) {
      shadow.group.position.set(haunt.x, 0, haunt.z);
      shadow.group.rotation.y = Math.atan2(-(pos.x - haunt.x), -(pos.z - haunt.z));
      // Its footsteps, from where it is, louder as it comes.
      const moved = was.here ? Math.hypot(haunt.x - was.x, haunt.z - was.z) : 0;
      stepClock += moved;
      if (stepClock > 0.75) {
        stepClock = 0;
        const right = (Math.cos(yaw) * (haunt.x - pos.x) - Math.sin(yaw) * (haunt.z - pos.z)) / Math.max(0.01, dist);
        sounds.step(Math.max(0, 1 - dist / 16), right);
      }
    }
    // The lamps falter where it walks, more as it comes near: slowly, never flashing.
    if (!reduced && (inside || haunt.here)) {
      const depth = haunt.here && dist < 10 ? 0.65 : 0.3;
      const wave = 0.5 + 0.5 * Math.sin(clock * 2.3) * Math.sin(clock * 0.9 + 1.3);
      lamps.forEach((l) => (l.intensity = lampBase * (1 - depth * wave)));
    } else lamps.forEach((l) => (l.intensity = lampBase));
    return inside || haunt.here;
  }

  function frame(now: number) {
    frameId = 0;
    if (paused || disposed) {
      running = false;
      return;
    }
    // Real time even when frames are slow (a slow phone, a big window drawn in software): each move
    // is taken in small steps anyway.
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    const moving = update(dt);
    const busy = horror(dt) || moving;
    // What's in front of you, a few times a second while moving (each look goes through every book
    // nearby), and once more when you stop.
    if ((!aimWithPointer || moving) && (!moving || now - aimedAt > 120)) {
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
    sounds.wake();
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
    sounds.wake();
    canvas.focus({ preventScroll: true });
    // Captured: a click is on whatever's under the crosshair. Not yet: a click captures the mouse.
    if (locked()) {
      if (e.button === 0) {
        aim();
        world.openTarget();
      }
      return;
    }
    if (capturing && e.pointerType === 'mouse' && e.button === 0 && typeof canvas.requestPointerLock === 'function') {
      lock();
      return;
    }
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
    if (locked()) return;
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
    if (locked()) return;
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
    // The PS1 look: drawn about 240 pixels high, and shown big with hard pixels by the page.
    renderer.setPixelRatio(mode.ps1 ? Math.min(1, 240 / h) : Math.min(window.devicePixelRatio || 1, 1.5));
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
  document.addEventListener('pointerlockchange', onLockChange);
  // (On the document: a captured mouse's moves go to the canvas and come up to it.)
  document.addEventListener('mousemove', onMouseLook);

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
      if (!target) return;
      // A book or a conversation needs the mouse back.
      if (locked()) document.exitPointerLock();
      events.open(target.t);
    },
    setPaused(next) {
      paused = next;
      keys.clear();
      look = null;
      if (!paused) {
        resize();
        renderer.render(scene, camera);
        // Horror goes on where it was (where the world keeps moving).
        kick();
      } else if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
        running = false;
      }
    },
    setMode(next) {
      // The same as it is (the page's first look): nothing to do.
      if (next.horror === mode.horror && next.ps1 === mode.ps1 && next.sounds === mode.sounds) return;
      mode = next;
      applyMode();
      if (mode.horror === 'off') {
        haunt = QUIET;
        shadow.group.visible = false;
      }
      // Signs, haze and textures, again for the new look.
      for (const k of [...chunks.keys()]) dropChunk(k);
      target = null;
      pulled = null;
      events.target(null);
      refresh(true);
      resize();
      update(0);
      aim();
      if (!paused) renderer.render(scene, camera);
      kick();
    },
    capture(on) {
      capturing = on;
      if (on) lock();
      else if (locked()) document.exitPointerLock();
    },
    wakeSound: () => sounds.wake(),
    setInked(next) {
      inked = next;
    },
    dispose() {
      disposed = true;
      sounds.dispose();
      for (const c of cast) c.figure.dispose();
      shadow.dispose();
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
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseLook);
      if (locked()) document.exitPointerLock();
      knob.remove();
      for (const k of [...chunks.keys()]) dropChunk(k);
      for (const s of shared) s.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  function applyMode() {
    setRetro(mode.ps1);
    sounds.setOn(mode.sounds && mode.horror !== 'off');
  }
  applyMode();
  resize();
  return world;
}
