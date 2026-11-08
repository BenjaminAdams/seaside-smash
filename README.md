# 🌅 Seaside Smash — Twilight Tennis

A playable **Three.js** recreation of the reference clip (`m2-res_1350p.mp4`):
a twilight tennis rally on a seaside court — violet-to-pink dusk sky, glittering
navy sea, pine & cypress silhouettes, pink bougainvillea, glowing lamp posts,
dark-green court, black-silhouette players and a glowing yellow-green ball.

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
| P / Esc · M | Pause · mute |

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

- `index.html` — page shell, HUD, touch buttons, overlays, import map
- `game.js` — the whole game (scene, physics, AI, audio, input)

No build step, no dependencies to install.
