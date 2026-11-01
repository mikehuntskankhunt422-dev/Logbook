/** Whether this device can draw the Library in 3D (D113): WebGL, without loading three.js to find out. */
export function canWalk(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    // Let the test context go at once: a page only gets so many.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}
