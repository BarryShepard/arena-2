import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest } from "../src/mods/package.js";
const manifest = JSON.parse(
  await readFile(
    new URL("../characters/puffer/manifest.json", import.meta.url),
    "utf8",
  ),
);
const code = await readFile(
  new URL("../characters/puffer/main.js", import.meta.url),
  "utf8",
);
const pkg = { manifest, code };
// Passive target with the Puffer body (100 HP) and no abilities.
const DUMMY = { manifest, code: "defineCharacter({})" };
// Same body, but it actually drives vx/vy from move input, so passive drag has something to fight.
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
const tagged = (w, owner, tag) =>
  [...w.entities.values()].filter(
    (e) => e.ownerId === owner && e.tags.includes(tag),
  );
const label = (w, owner, slot) => w.snapshot().slots[owner][slot].label;

test("Puffer manifest is valid with four slots", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(manifest.id, "puffer");
  assert.deepEqual(
    manifest.abilities.map((a) => a.label),
    ["Spit", "Quills", "Surge", "Mech Suit"],
  );
});

test("passive: standing still spills a water trail under the body", async () => {
  const w = await arena();
  run(w, 20);
  assert.equal(w.error, null);
  assert.ok(tagged(w, 1, "water").length > 0, "trail puddles exist");
  assert.ok(
    tagged(w, 1, "water").every((e) => e.tags.includes("weak")),
    "idle trail is the weak grade",
  );
  w.dispose();
});

test("passive: an enemy moving through the trail gets dampened, one out of range doesn't", async () => {
  const walkLeft = idle();
  walkLeft[1].move = { x: -1, y: 0 };
  const w = await arena({ p2: { x: 108, y: 100 }, enemy: MOVER });
  run(w, 20, walkLeft);
  assert.equal(w.error, null);
  const near = body(w, 2);
  assert.ok(
    Math.abs(near.ix) > 0 || Math.abs(near.iy) > 0,
    "an enemy walking through the trail accumulated a counter-impulse",
  );
  const w2 = await arena({ p2: { x: 400, y: 100 }, enemy: MOVER });
  run(w2, 20, walkLeft);
  const far = body(w2, 2);
  assert.equal(far.ix, 0);
  assert.equal(far.iy, 0);
  w.dispose();
  w2.dispose();
});

test("slot 0 Spit: projectile flies, hits the enemy, vanishes and leaves a puddle", async () => {
  const w = await arena();
  press(w, 1, 0);
  const [shot] = tagged(w, 1, "spit");
  assert.ok(shot, "spit spawned as an entity");
  assert.equal(shot.solid, false);
  assert.equal(shot.contact, true);
  assert.ok(shot.vx > 0 && shot.x > 100);
  assert.ok(w.snapshot().slots[1][0].cooldown > 0);
  run(w, 30);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100 - 14);
  assert.equal(body(w, 1).hp, 100, "own body untouched");
  assert.equal(tagged(w, 1, "spit").length, 0, "spit destroyed on hit");
  assert.ok(
    tagged(w, 1, "water").some((e) => e.tags.includes("strong")),
    "a strong puddle formed on the hit",
  );
  w.dispose();
});

test("slot 0 Spit: a brick in front of the enemy stops the spit and shields the enemy", async () => {
  const w = await arena({ obstacles: [{ x: 150, y: 90, w: 20, h: 20 }] });
  press(w, 1, 0);
  run(w, 30);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100);
  assert.equal(tagged(w, 1, "spit").length, 0, "spit destroyed on the brick");
  w.dispose();
});

test("slot 1 Quills: radial burst damages and pushes back everything in range, none to self", async () => {
  const w = await arena({ p2: { x: 120, y: 100 } });
  press(w, 1, 1);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100 - 11);
  assert.equal(body(w, 1).hp, 100);
  assert.ok(body(w, 2).ix < 0 || body(w, 2).x > 120, "knockback applied");
  const far = await arena({ p2: { x: 300, y: 100 } });
  press(far, 1, 1);
  assert.equal(body(far, 2).hp, 100, "out of range: untouched");
  w.dispose();
  far.dispose();
});

test("slot 2 Surge: brief burst of speed along the aim direction, then cooldown", async () => {
  const w = await arena();
  const before = body(w, 1).x;
  press(w, 1, 2, { x: 1, y: 0 });
  run(w, 10);
  assert.equal(w.error, null);
  assert.ok(
    body(w, 1).x - before > 66 * (10 / 60),
    "moved faster than base speed while surging",
  );
  assert.ok(w.snapshot().slots[1][2].cooldown > 0);
  w.dispose();
});

test("slot 3 Mech Suit: swaps slot 0 to Punch for its duration, then reverts", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  assert.equal(label(w, 1, 0), "Spit");
  press(w, 1, 3);
  assert.equal(label(w, 1, 0), "Punch");
  assert.equal(w.snapshot().slots[1][3].active, true);
  assert.equal(body(w, 1).sprite, "robot");
  press(w, 1, 0, { x: 1, y: 0 });
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100 - 16, "punch hit in melee range");
  assert.ok(
    tagged(w, 1, "water").some((e) => e.tags.includes("heavy")),
    "punch leaves a heavy puddle on the target",
  );
  run(w, 300);
  assert.equal(w.error, null);
  assert.equal(label(w, 1, 0), "Spit", "reverted after the suit expired");
  assert.equal(body(w, 1).sprite, "body");
  w.dispose();
});

test("all four slots in one match run without errors", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  for (const slot of [0, 1, 2, 3]) press(w, 1, slot);
  assert.equal(w.error, null);
  run(w, 120);
  assert.equal(w.error, null);
  assert.equal(w.result, null);
  assert.ok(body(w, 2).hp < 100, "at least one attack landed");
  w.dispose();
});

test("mirror match Puffer/Puffer: cooldown and suit state are isolated per instance", async () => {
  const w = await arena({ enemy: pkg });
  press(w, 1, 3);
  assert.equal(label(w, 1, 0), "Punch");
  assert.equal(label(w, 2, 0), "Spit");
  press(w, 2, 0, { x: -1, y: 0 });
  assert.equal(w.error, null);
  assert.equal(tagged(w, 2, "spit").length, 1);
  assert.equal(tagged(w, 1, "spit").length, 0);
  run(w, 30);
  assert.equal(w.error, null);
  w.dispose();
});
