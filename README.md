# Tomate

Live at https://tomate-pomodoro-three.vercel.app

A slow pomodoro. The timer is drawn as a living tomato (a hand-written WebGL shader) that shrinks as each focus session drains, with topographic contour lines rippling out from it. Breaks make the fruit breathe on a 4s in / 4s out cycle.

It has two styles, which you switch between with the toggle, `V`, or the URL (`/#sketch`):

- **Fruit:** the WebGL tomato, in warm orange on cream.
- **Sketch:** black and white ink with boiling, variable-weight lines. A hooded hero fights a scribbled foe whose HP is the time left. The foe throws notification bubbles, gets scribbled out when the session ends, and the hero rests by a campfire during breaks.

Plain HTML, CSS and JS with no build step and no dependencies.

**Keys:** `Space` to start or pause, `R` to reset, `S` to skip, `1`–`3` to switch mode, `V` to switch style.

Run it locally with `python3 -m http.server` and open http://localhost:8000.
