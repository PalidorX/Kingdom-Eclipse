// High-DPI render zoom: the framebuffer is GAME size x ZOOM and every scene
// camera zooms by ZOOM, so pixel art scales crisply and text renders at
// native device resolution instead of being upscaled blurry.
export const ZOOM = Math.min(3, Math.max(1, Math.round(
  (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1
)));
