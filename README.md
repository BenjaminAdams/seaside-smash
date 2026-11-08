# 🌅 Seaside Smash — Twilight Tennis

A playable **Three.js** recreation of the reference clip (`m2-res_1350p.mp4`):
a twilight tennis rally on a seaside court — violet-to-pink dusk sky, glittering
navy sea, pine & cypress silhouettes, pink bougainvillea, glowing lamp posts,
dark-green court, black-silhouette players and a glowing yellow-green ball.

**How it matches the clip:** `assets/plate.jpg` is a clean plate made from the
clip itself (per-pixel median of every frame, so the moving players drop out).
A fixed 3D camera was solved against the plate's court lines (max error 0.16 m),
so the 3D players, ball and shadows land exactly on the painted court. The net
and the front hedge re-draw plate pixels over anything behind them, the sea gets
animated glints and the lamps flicker. The view keeps the clip's 4:5 framing;
extra window space shows a soft blurred copy of the scene.

**Sound (all synthesized live, no audio files):** ocean swells with foam hiss,
wind in the pines, crickets, distant gulls and wind chimes, and a generative
lo-fi score (warm pad, electric piano, sub bass, swung drums that come in when
the match starts, vinyl crackle). Effects: racket thwock (perfect hits sparkle),
hard-court bounces panned to the ball, net-cord rattle, swing whooshes, shoe
squeaks and footsteps, a rising charge tone, garden-party applause, and point,
game and match stingers in the music's key. Pausing muffles the music.

## Run it

ES modules + CDN import, so open it over **http** (not `file://`):

```bash
# any one of these, from this folder:
npx serve .
python -m http.server 8000
npx http-server .
```

Then open the printed URL (e.g. http://localhost:3000) —
desktop and mobile browsers both work. An internet connection is needed once
to fetch Three.js from the jsDelivr CDN.

## Controls

**Keyboard**
| Key | Action |
|---|---|
| ← → ↑ ↓ / WASD | Move (your movement direction also **aims** the shot) |
| Hold SPACE (or J) | Charge shot — release to strike (↑ deep · ↓ drop shot) |
| K or L | High defensive lob |
| SPACE ×2 | Serve: toss, then strike near the peak |
| P / Esc · M · N | Pause · mute all · music on/off |

**Touch**
| Gesture | Action |
|---|---|
| Drag left half | Virtual stick — run around your half |
| HOLD HIT | Charge — release to strike (stick direction aims) |
| LOB | High defensive lob |
| HIT ×2 | Serve: toss, then strike near the peak |

Tips: hit the ball **close to your body** for PERFECT strikes (faster, deeper).
Watch the landing ring — green = coming to you. First to **3 games** wins.

## Files

- `index.html` — page shell, 4:5 stage, HUD, touch buttons, overlays, import map
- `game.js` — scene, calibrated camera, physics, AI, input
- `audio.js` — synthesized ambience, music and effects (Web Audio)
- `assets/plate.jpg` — clean background plate pulled from the clip

No build step, no dependencies to install.
