# SKILL: scroll-driven spline camera

## When to use
Any site where the camera flies through a 3D scene as the page scrolls, each section a composed
shot. Load this before writing any camera code.

## The mechanic (do exactly this)
1. Define `CAM[]` — one waypoint per section: `{ p:[x,y,z], t:[x,y,z], fov }`
   (position, look-at target, field of view).
2. Thread positions and targets onto two separate `THREE.CatmullRomCurve3` curves (smooth spline).
3. Map scroll to a progress float in `[0, N]` (N = CAM.length - 1):
   `progress = scrollY / maxScroll * N`. (Better: anchor to each section's on-screen midpoint.)
4. Each frame, EASE toward it, frame-rate-independent:
   `smooth = lerp(smooth, progress, 1 - Math.exp(-rate * dt))`, with `rate` ≈ the `--cam-damp` token.
5. Sample and apply:
   `u = smooth / N` → `curveP.getPoint(u, _p)` and `curveT.getPoint(u, _t)`;
   `fov = lerp(CAM[i].fov, CAM[i+1].fov, f)` where `i = floor(smooth)`, `f = smooth - i`;
   then `camera.position.copy(_p); camera.lookAt(_t)`.
6. Add a small mouse-parallax drift on top of `_p` / `_t`, faded down after the intro.

## Defaults
- Damping `rate` 4–6 (lower = floatier, higher = tighter).
- Curve tension ~0.4. FOV 44–52.
- The scroll listener is passive and does nothing but let the rAF loop read `scrollY`.

## Pitfalls (each of these is a common slop tell)
- Never animate off frame count or assume 60fps — always use `dt` in seconds.
- Don't `lookAt` a raw waypoint; look at the SAMPLED target curve, or the camera snaps at joints.
- Recompute `maxScroll` and `camera.aspect` on resize.
- Keep DOM text in normal flow, z-index above the canvas; toggle an `.active` class by rounded progress.

## Reference implementation
A minimal, heavily-commented working version of this exact mechanic (waypoints → spline →
progress → damping → lookAt, plus fog + CSS vignette + mouse parallax) lives in
`scroll-camera-demo.html`, shared alongside this kit. Read its comments, then apply the pattern.
