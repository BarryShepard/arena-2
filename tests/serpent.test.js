import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest } from "../src/mods/package.js";
const manifest = JSON.parse(
  await readFile(
    new URL("../characters/serpent/manifest.json", import.meta.url),
    "utf8",
  ),
);
const code = await readFile(
  new URL("../characters/serpent/main.js", import.meta.url),
  "utf8",
);
const pkg = { manifest, code };
// Passive target with the Serpent body (108 HP) and no abilities.
const DUMMY = { manifest, code: "defineCharacter({})" };
// Same body, but it actively drives vx/vy from move input, so the poison
// counter-impulse has an attempted movement to actually cancel.
const MOVER = {
  manifest,
  code: `defineCharacter({update(c){const m=c.api.entity(c.selfId);
    if(m&&m.hp>0)c.api.patch(m.id,{vx:c.input.move.x*70,vy:c.input.move.y*70});}})`,
};
async function arena({
  p1 = { x: 100, y: 100 },
  p2 = { x: 200, y: 100 },
  enemy = DUMMY,
  ...worldOptions
} = {}) {
  const w = createWorld(worldOptions);
  try {
    w.addPlayer(await createRuntime(pkg, 1), p1);
    w.addPlayer(await createRuntime(enemy, 2), p2);
    return w;
  } catch (e) {
    w.dispose();
    throw e;
  }
}
const idle = () => [emptyInput(), emptyInput()];
function press(w, owner, slot) {
  const inputs = idle();
  inputs[owner - 1].slots[slot] = {
    pressed: true,
    held: true,
    released: false,
  };
  w.step(1 / 60, inputs);
}
const run = (w, n, inputs = idle(), dt = 1 / 60) => {
  for (let i = 0; i < n; i++) w.step(dt, inputs);
};
const body = (w, owner) => w.entities.get(w.players.get(owner).selfId);
const tagged = (w, owner, tag) =>
  [...w.entities.values()].filter(
    (e) => e.ownerId === owner && e.tags.includes(tag),
  );

test("Serpent manifest is valid with four slots", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(manifest.id, "serpent");
  assert.deepEqual(
    manifest.abilities.map((a) => a.label),
    ["Укус", "Ядовитый плевок", "Сброс кожи", "Невидимость"],
  );
});

test("passive: cannot stand still — always drifts forward along its facing angle", async () => {
  const w = await arena();
  const before = body(w, 1).x;
  run(w, 30);
  assert.equal(w.error, null);
  assert.ok(body(w, 1).x > before + 30, "kept moving forward with no input");
  assert.equal(Math.round(body(w, 1).y), 100, "straight along spawn heading");
  w.dispose();
});

test("input turns the heading instantly and it is kept after the key is released", async () => {
  const up = idle();
  up[0].move = { x: 0, y: -1 };
  const w = await arena();
  run(w, 1, up);
  const afterTurnY = body(w, 1).y;
  assert.ok(afterTurnY < 100, "turned upward on the first tick with input");
  run(w, 10); // keys released: idle input, no move
  assert.equal(w.error, null);
  assert.ok(body(w, 1).y < afterTurnY, "kept heading up after release");
  w.dispose();
});

test("slot 0 Bite: melee arc hits an enemy ahead, none to self", async () => {
  const w = await arena({ p2: { x: 120, y: 100 } });
  press(w, 1, 0);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 108 - 13);
  assert.equal(body(w, 1).hp, 108);
  assert.ok(w.snapshot().slots[1][0].cooldown > 0);
  w.dispose();
});

test("slot 0 Bite: behind the head does nothing", async () => {
  const w = await arena({ p2: { x: 80, y: 100 } });
  press(w, 1, 0);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 108, "behind the facing arc: untouched");
  w.dispose();
});

test("slot 1 Ядовитый плевок: no damage, but paralyzes a moving enemy for a short time", async () => {
  // The snake turns away after casting so it doesn't chase into (and shove)
  // the target; the enemy flees in the spit's own direction the whole time.
  const away = idle();
  away[0].move = { x: 0, y: -1 };
  away[1].move = { x: 1, y: 0 };
  const w = await arena({ p2: { x: 130, y: 100 }, enemy: MOVER });
  press(w, 1, 1);
  assert.equal(w.error, null);
  run(w, 15, away); // let the spit travel and land
  assert.equal(body(w, 2).hp, 108, "poison deals no damage");
  const paralyzedX = body(w, 2).x;
  run(w, 20, away);
  assert.ok(
    Math.abs(body(w, 2).x - paralyzedX) < 2,
    "held roughly in place while paralyzed",
  );
  run(w, 60, away); // paralysis (0.8s) has worn off well before this
  assert.ok(body(w, 2).x > paralyzedX + 5, "moves freely again afterwards");
  w.dispose();
});

test("slot 2 Сброс кожи: leaves a solid, destructible barrier that pushes the caster off it", async () => {
  const w = await arena();
  press(w, 1, 2);
  assert.equal(w.error, null);
  const barrier = tagged(w, 1, "barrier")[0];
  assert.ok(barrier, "barrier spawned");
  assert.equal(barrier.solid, true);
  assert.equal(barrier.countsForDefeat, false);
  assert.equal(barrier.hp, 34);
  run(w, 5);
  const d = Math.hypot(body(w, 1).x - barrier.x, body(w, 1).y - barrier.y);
  assert.ok(
    d >= barrier.radius + body(w, 1).radius - 0.01,
    "solid collision pushed the caster off its own barrier",
  );
  run(w, 500); // past its 8s lifetime
  assert.equal(tagged(w, 1, "barrier").length, 0, "barrier expired");
  w.dispose();
});

test("slot 3 Невидимость: hides body and tail, then reveals them again", async () => {
  const w = await arena();
  press(w, 1, 3);
  assert.equal(w.error, null);
  const tails = tagged(w, 1, "tail");
  assert.equal(tails.length, 2);
  assert.equal(body(w, 1).visible, false);
  assert.ok(tails.every((e) => e.visible === false));
  assert.ok(w.snapshot().slots[1][3].active, "HUD marks veil active");
  run(w, 200); // just under the 3.5s duration
  assert.equal(body(w, 1).visible, false);
  run(w, 20); // past the duration
  assert.equal(w.error, null);
  assert.equal(body(w, 1).visible, true);
  assert.ok(tagged(w, 1, "tail").every((e) => e.visible === true));
  w.dispose();
});

test("wall contact: damages itself on repeat impact, gated by a cooldown", async () => {
  const w = await arena({ p1: { x: 468, y: 100 }, p2: { x: 300, y: 200 } });
  run(w, 6); // heading 0 (+x): drives straight into the right boundary
  assert.equal(w.error, null);
  const afterFirst = body(w, 1).hp;
  assert.ok(afterFirst < 108, "took wall damage on first impact");
  assert.ok(afterFirst >= 108 - 8, "at most one hit while jammed for 0.1s");
  run(w, 32); // still pressed against the wall past the 0.5s cooldown
  assert.equal(w.error, null);
  assert.ok(body(w, 1).hp < afterFirst, "hit again once the cooldown expired");
  w.dispose();
});

test("self-bite: a hard reversal loops the head into its own tail for damage; gentle drift does not", async () => {
  const straight = await arena();
  run(straight, 90); // long straight run, tail trails cleanly behind
  assert.equal(straight.error, null);
  assert.equal(body(straight, 1).hp, 108, "no false positive going straight");
  straight.dispose();

  const reverse = idle();
  reverse[0].move = { x: -1, y: 0 };
  const w = await arena();
  run(w, 60); // build up a straight trail behind the head
  run(w, 30, reverse); // hard U-turn back over its own recent path
  assert.equal(w.error, null);
  assert.ok(body(w, 1).hp <= 108 - 10, "bit its own tail on the reversal");
  w.dispose();
});

test("all four slots in one match run without errors", async () => {
  const w = await arena({ p2: { x: 120, y: 100 } });
  for (const slot of [0, 1, 2, 3]) press(w, 1, slot);
  assert.equal(w.error, null);
  run(w, 300);
  assert.equal(w.error, null);
  w.dispose();
});

test("mirror match Serpent/Serpent: cooldowns and veil state are isolated per instance", async () => {
  const w = await arena({ enemy: pkg, p2: { x: 120, y: 100 } });
  press(w, 1, 3);
  assert.equal(w.snapshot().slots[1][3].active, true);
  assert.equal(w.snapshot().slots[2][3].active, false);
  press(w, 2, 0);
  assert.equal(w.error, null);
  run(w, 60);
  assert.equal(w.error, null);
  w.dispose();
});
