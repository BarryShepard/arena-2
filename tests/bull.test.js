import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest } from "../src/mods/package.js";
const manifest = JSON.parse(
  await readFile(
    new URL("../characters/bull/manifest.json", import.meta.url),
    "utf8",
  ),
);
const code = await readFile(
  new URL("../characters/bull/main.js", import.meta.url),
  "utf8",
);
const pkg = { manifest, code };
const DUMMY = { manifest, code: "defineCharacter({})" };
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
function press(w, owner, slot, aim = { x: 1, y: 0 }) {
  const inputs = idle();
  inputs[owner - 1].slots[slot] = {
    pressed: true,
    held: true,
    released: false,
  };
  inputs[owner - 1].aim = aim;
  w.step(1 / 60, inputs);
}
const run = (w, n, inputs = idle(), dt = 1 / 60) => {
  for (let i = 0; i < n; i++) w.step(dt, inputs);
};
const body = (w, owner) => w.entities.get(w.players.get(owner).selfId);
const opp = (w, owner) => (owner === 1 ? 2 : 1);

test("Bull manifest is valid with four slots", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(manifest.id, "bull");
  assert.deepEqual(
    manifest.abilities.map((a) => a.label),
    ["Рога", "Аркан", "Наездник", "Минотавр"],
  );
});

test("slot 0 Horns: hits the enemy in front, grants a shield, none to self", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  press(w, 1, 0);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 115 - 16);
  assert.equal(body(w, 1).hp, 115);
  press(w, 2, 0, { x: -1, y: 0 });
  assert.equal(body(w, 1).hp, 115, "22 shield fully absorbs the 16 counter-hit");
  assert.ok(w.snapshot().slots[1][0].cooldown > 0);
  w.dispose();
});

test("Horns shield fully absorbs a small hit", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  press(w, 1, 0);
  const before = body(w, 1).hp;
  w.queueDamage(body(w, 1).id, 5, undefined, 2);
  w.drain();
  assert.equal(body(w, 1).hp, before, "5 dmg should be fully absorbed by the 22 shield");
  w.dispose();
});

test("slot 1 Лasso: pulls and holds the enemy, deals no damage", async () => {
  const w = await arena({ p2: { x: 150, y: 100 } });
  press(w, 1, 1);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 115, "Hook deals no damage");
  const before = body(w, 2).x;
  run(w, 20);
  assert.ok(body(w, 2).x < before, "hooked enemy is pulled toward the Bull");
  w.dispose();
});

test("slot 2 Rider: teleports onto the enemy and chokes for damage over time", async () => {
  const w = await arena({ p2: { x: 175, y: 100 } });
  press(w, 1, 2);
  assert.equal(w.error, null);
  const p1 = body(w, 1),
    p2 = body(w, 2);
  assert.ok(
    Math.abs(Math.hypot(p1.x - p2.x, p1.y - p2.y) - (p1.radius + p2.radius)) <
      1,
    "Bull teleports right onto the target's head (touching, not overlapping)",
  );
  const before = body(w, 2).hp;
  run(w, 90);
  assert.ok(body(w, 2).hp < before, "choke deals damage over time");
  w.dispose();
});

test("passive Bleed: a Horns hit keeps ticking damage for several seconds", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  press(w, 1, 0);
  const afterHit = body(w, 2).hp;
  run(w, 180);
  assert.ok(body(w, 2).hp < afterHit, "bleed should keep dealing damage after the initial hit");
  w.dispose();
});

test("slot 3 Minotaur: transforms, grabs and eats the nearest enemy, heals the Bull", async () => {
  const w = await arena({ p2: { x: 140, y: 100 } });
  const startHp = body(w, 1).hp;
  press(w, 1, 3);
  assert.equal(w.error, null);
  assert.equal(body(w, 1).sprite, "minotaur");
  const enemyBefore = body(w, 2).hp;
  run(w, 60);
  assert.ok(body(w, 2).hp < enemyBefore, "bite deals damage while eating");
  assert.ok(body(w, 1).hp >= startHp, "eating heals the Bull back up");
  run(w, 300);
  assert.equal(body(w, 1).sprite, "body", "transform ends and reverts appearance");
  w.dispose();
});
