import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest } from "../src/mods/package.js";
const manifest = JSON.parse(
  await readFile(
    new URL("../characters/stool/manifest.json", import.meta.url),
    "utf8",
  ),
);
const code = await readFile(
  new URL("../characters/stool/main.js", import.meta.url),
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

test("Stool manifest is valid with four slots", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(manifest.id, "stool");
  assert.deepEqual(
    manifest.abilities.map((a) => a.label),
    ["Гвозди", "Наскок", "Оторвать ногу", "Тяжёлый прыжок"],
  );
});

test("slot 0 Nails: a fired nail travels, hits the enemy once, none to self", async () => {
  const w = await arena({ p2: { x: 160, y: 100 } });
  press(w, 1, 0);
  assert.equal(w.error, null);
  assert.equal(body(w, 1).hp, 100, "no self-damage on fire");
  run(w, 30);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100 - 14, "hit exactly once");
  assert.ok(w.snapshot().slots[1][0].cooldown > 0);
  w.dispose();
});

test("slot 0 Nails: a brick in the way blocks the nail", async () => {
  const w = await arena({
    p2: { x: 160, y: 100 },
    obstacles: [{ x: 130, y: 90, w: 4, h: 20 }],
  });
  press(w, 1, 0);
  run(w, 30);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100, "brick blocks the nail");
  w.dispose();
});

test("slot 1 Pounce: dashes into an enemy in its path, then pins it with a nail tick", async () => {
  const w = await arena({ p2: { x: 130, y: 100 } });
  press(w, 1, 1);
  assert.equal(w.error, null);
  assert.ok(
    w.snapshot().slots[1][1].active,
    "pounce marked active while airborne",
  );
  run(w, 60);
  assert.equal(w.error, null);
  assert.ok(
    body(w, 2).hp < 100 - 12,
    "impact damage plus at least one pin tick landed",
  );
  assert.equal(body(w, 1).hp, 100, "own body untouched");
  w.dispose();
});

test("slot 1 Pounce: far enemy is untouched, cooldown still applied", async () => {
  const w = await arena({ p2: { x: 300, y: 100 } });
  press(w, 1, 1);
  run(w, 60);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100, "far enemy untouched");
  assert.ok(w.snapshot().slots[1][1].cooldown > 0);
  w.dispose();
});

test("slot 2 Tear off leg: toggles melee mode, swaps sprite and slot labels, no damage", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  assert.equal(label(w, 1, 0), "Гвозди");
  press(w, 1, 2);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100, "toggling deals no damage");
  assert.equal(body(w, 1).sprite, "body_melee");
  assert.equal(label(w, 1, 0), "Дубина");
  assert.equal(label(w, 1, 2), "Приделать ногу");
  run(w, 90);
  press(w, 1, 2);
  assert.equal(w.error, null);
  assert.equal(body(w, 1).sprite, "body");
  assert.equal(label(w, 1, 0), "Гвозди");
  w.dispose();
});

test("melee mode: slot 0 becomes a short arc club and movement slows by 25%", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  press(w, 1, 2);
  run(w, 5, [{ ...emptyInput(), move: { x: 1, y: 0 } }, emptyInput()]);
  const speed = Math.hypot(body(w, 1).vx, body(w, 1).vy);
  assert.ok(speed < 68 * 0.8, `expected slowed melee speed, got ${speed}`);
  press(w, 1, 0);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100 - 16, "club hit for melee damage");
  w.dispose();
});

test("slot 3 Heavy Pounce: big single hit and knockback on the first enemy in its path", async () => {
  const w = await arena({ p2: { x: 130, y: 100 } });
  const beforeX = body(w, 2).x;
  press(w, 1, 3);
  assert.equal(w.error, null);
  assert.ok(
    w.snapshot().slots[1][3].active,
    "slam marked active while airborne",
  );
  run(w, 60);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100 - 30, "hit exactly once for slam damage");
  assert.ok(body(w, 2).x > beforeX, "knocked back away from the stool");
  w.dispose();
});

test("chaotic movement: net displacement follows the chosen direction despite wobble", async () => {
  const w = await arena({ p2: { x: 300, y: 260 } });
  const start = { x: body(w, 1).x, y: body(w, 1).y };
  run(w, 180, [{ ...emptyInput(), move: { x: 1, y: 0 } }, emptyInput()]);
  assert.equal(w.error, null);
  const end = body(w, 1);
  assert.ok(end.x > start.x + 20, "net progress along the chosen axis");
  w.dispose();
});

test("all four slots in one match run without errors", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  for (const slot of [0, 1, 2, 3]) press(w, 1, slot);
  assert.equal(w.error, null);
  run(w, 400);
  assert.equal(w.error, null);
  assert.ok(body(w, 2).hp < 100, "at least one attack landed");
  w.dispose();
});

test("mirror match Stool/Stool: cooldowns and mode state are isolated per instance", async () => {
  const w = await arena({ enemy: pkg, p2: { x: 118, y: 100 } });
  press(w, 1, 2);
  assert.equal(body(w, 1).sprite, "body_melee");
  assert.equal(body(w, 2).sprite, "body");
  press(w, 2, 0, { x: -1, y: 0 });
  assert.equal(w.error, null);
  run(w, 60);
  assert.equal(w.error, null);
  w.dispose();
});
