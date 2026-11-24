# Tomate

Live at https://tomate-pomodoro-three.vercel.app

A slow pomodoro. The timer is drawn as a living tomato (a hand-written WebGL shader) that shrinks as each focus session drains, with topographic contour lines rippling out from it. Breaks make the fruit breathe on a 4s in / 4s out cycle.

It has two styles, which you switch between with the toggle, `V`, or the URL (`/#sketch`):

- **Fruit:** the WebGL tomato, in warm orange on cream.
- **Sketch:** black and white ink with boiling, variable-weight lines. A hooded hero fights a scribbled foe whose HP is the time left. The foe throws notification bubbles, gets scribbled out when the session ends, and the hero rests by a campfire during breaks.

**Fight moves:** the hero starts with Lunge, Feint and Riposte, with a short rest between moves. The boss drops loot every 5 minutes of focus. Weapons unlock new moves (Fountain Pen: Thrust, Ruler Blade: Sweep, Eraser Maul: Slam). Armor changes the hero's look and adds a perk, for example the Ink Shield knocks thrown bubbles back at the boss. The kit is saved in the browser.

**Break Brawl:** during a break, press "Fight it anyway" to play a round against the boss. Jump the rolling ink (`Space`/`↑`, or tap the left half of the screen) and slash notification bubbles back at the boss (`X`/`J`, or tap the right half). You have 3 hearts, or 4 with the Ink Shield, and the Quick Boots jump higher. Each boss you beat brings a faster one. Your best score is saved, and the game ends when the break does.

**Timer:** Classic 25/5/15, Deep 50/10/20, Sprint 15/3/10, or custom lengths and rounds.

**Tasks:** a short list (up to 8). The current task shows under the timer, and in Sketch it becomes the boss's name.

Plain HTML, CSS and JS with no build step and no dependencies.

**Keys:** `Space` to start or pause, `R` to reset, `S` to skip, `1`–`3` to switch mode, `V` to switch style, `T` to open tasks.

Run it locally with `python3 -m http.server` and open http://localhost:8000.
