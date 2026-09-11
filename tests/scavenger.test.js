import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest } from "../src/mods/package.js";
const manifest = JSON.parse(
  await readFile(
    new URL("../characters/scavenger/manifest.json", import.meta.url),
    "utf8",
  ),
);
const code = await readFile(
  new URL("../characters/scavenger/main.js", import.meta.url),
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
const label = (w, owner, slot) => w.snapshot().slots[owner][slot].label;

test("Scavenger manifest is valid with four slots", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(manifest.id, "scavenger");
  assert.deepEqual(
    manifest.abilities.map((a) => a.label),
    ["Резак", "Ракетный рывок", "Магнит", "Колючий доспех"],
  );
});

test("slot 0 Cutter: melee arc hits an adjacent enemy, none to self", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  press(w, 1, 0);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 105 - 12);
  assert.equal(body(w, 1).hp, 105);
  assert.ok(w.snapshot().slots[1][0].cooldown > 0);
  w.dispose();
});

test("slot 0 Cutter: out of range does nothing, a brick in the way blocks it", async () => {
  const far = await arena({ p2: { x: 300, y: 100 } });
  press(far, 1, 0);
  assert.equal(body(far, 2).hp, 105, "out of range: untouched");
  far.dispose();

  const w = await arena({
    p2: { x: 118, y: 100 },
    obstacles: [{ x: 108, y: 90, w: 4, h: 20 }],
  });
  press(w, 1, 0);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 105, "brick blocks line of sight");
  w.dispose();
});

test("slot 1 Rocket Dash: cuts an enemy in its path once, not twice while overlapping", async () => {
  const w = await arena({ p2: { x: 140, y: 100 } });
  press(w, 1, 1);
  assert.equal(w.error, null);
  assert.ok(w.snapshot().slots[1][1].active, "dash marked active while flying");
  run(w, 20);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 105 - 18, "hit exactly once despite overlap");
  w.dispose();
});

test("slot 2 Magnet: pulls a distant enemy toward the scavenger without damage", async () => {
  const w = await arena({ p2: { x: 150, y: 100 } });
  const before = body(w, 2).x;
  press(w, 1, 2);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 105, "no damage from the pull");
  run(w, 10);
  assert.equal(w.error, null);
  assert.ok(body(w, 2).x < before, "enemy dragged toward the scavenger");
  w.dispose();
});

test("slot 2 Magnet: out of range does nothing", async () => {
  const w = await arena({ p2: { x: 300, y: 100 } });
  const before = body(w, 2).x;
  press(w, 1, 2);
  run(w, 10);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).x, before, "far enemy unaffected");
  w.dispose();
});

test("slot 3 Thorn Plating: aura ticks damage on anyone touching the scavenger, then expires", async () => {
  const w = await arena({ p2: { x: 112, y: 100 } });
  press(w, 1, 3);
  assert.equal(w.error, null);
  assert.ok(w.snapshot().slots[1][3].active, "plating marked active");
  run(w, 40);
  assert.equal(w.error, null);
  assert.ok(body(w, 2).hp < 105, "aura damaged the adjacent enemy");
  assert.equal(body(w, 1).hp, 105, "own body untouched by its own aura");
  run(w, 260);
  assert.equal(w.snapshot().slots[1][3].active, false, "plating expired");
  w.dispose();
});

test("slot 3 Thorn Plating: no one nearby, no damage, cooldown still applied", async () => {
  const w = await arena({ p2: { x: 300, y: 100 } });
  press(w, 1, 3);
  assert.equal(w.error, null);
  run(w, 40);
  assert.equal(body(w, 2).hp, 105, "far enemy untouched");
  assert.ok(w.snapshot().slots[1][3].cooldown > 0);
  w.dispose();
});

test("all four slots in one match run without errors", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  for (const slot of [0, 1, 2, 3]) press(w, 1, slot);
  assert.equal(w.error, null);
  run(w, 200);
  assert.equal(w.error, null);
  assert.ok(body(w, 2).hp < 105, "at least one attack landed");
  w.dispose();
});

test("mirror match Scavenger/Scavenger: cooldowns and dash state are isolated per instance", async () => {
  const w = await arena({ enemy: pkg, p2: { x: 118, y: 100 } });
  press(w, 1, 1);
  assert.equal(label(w, 1, 1), "Ракетный рывок");
  assert.equal(w.snapshot().slots[1][1].active, true);
  assert.equal(w.snapshot().slots[2][1].active, false);
  press(w, 2, 0, { x: -1, y: 0 });
  assert.equal(w.error, null);
  run(w, 30);
  assert.equal(w.error, null);
  w.dispose();
});
