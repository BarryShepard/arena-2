import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest } from "../src/mods/package.js";
const manifest = JSON.parse(
  await readFile(
    new URL("../characters/mage/manifest.json", import.meta.url),
    "utf8",
  ),
);
const code = await readFile(
  new URL("../characters/mage/main.js", import.meta.url),
  "utf8",
);
const pkg = { manifest, code };
// Passive target with the Mage body (100 HP) and no abilities.
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
// One press edge of `slot` for `owner`, then an idle frame sequence.
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

test("Mage manifest is valid with four slots", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(manifest.id, "mage");
  assert.deepEqual(
    manifest.abilities.map((a) => a.label),
    ["Bolt", "Anchor", "Zone", "Turret"],
  );
});

test("slot 0 Bolt: projectile entity flies, hits the enemy and vanishes", async () => {
  const w = await arena();
  press(w, 1, 0);
  const [bolt] = tagged(w, 1, "bolt");
  assert.ok(bolt, "bolt spawned as an entity");
  assert.equal(bolt.solid, false);
  assert.equal(bolt.contact, true);
  assert.equal(bolt.sprite, "bolt");
  assert.ok(bolt.vx > 0 && bolt.x > 100);
  assert.ok(w.snapshot().slots[1][0].cooldown > 0);
  run(w, 30);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100 - 14);
  assert.equal(body(w, 1).hp, 100, "own body untouched");
  assert.equal(tagged(w, 1, "bolt").length, 0, "bolt destroyed on hit");
  w.dispose();
});

test("slot 0 Bolt: a brick in front of the enemy stops the bolt and shields the enemy", async () => {
  const w = await arena({ obstacles: [{ x: 150, y: 90, w: 20, h: 20 }] });
  press(w, 1, 0);
  run(w, 30);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 100);
  assert.equal(tagged(w, 1, "bolt").length, 0, "bolt destroyed on the brick");
  w.dispose();
});

test("slot 0 Bolt: leaving the arena destroys the bolt without error", async () => {
  const w = await arena({ p1: { x: 460, y: 100 }, p2: { x: 100, y: 200 } });
  press(w, 1, 0);
  run(w, 6);
  assert.equal(w.error, null);
  assert.equal(tagged(w, 1, "bolt").length, 0);
  assert.equal(body(w, 2).hp, 100);
  assert.equal(w.entities.size, 2);
  w.dispose();
});

test("slot 1 Anchor/Blink: first press places the anchor, second teleports back to it", async () => {
  const w = await arena();
  assert.equal(label(w, 1, 1), "Anchor");
  press(w, 1, 1);
  assert.equal(label(w, 1, 1), "Blink");
  assert.equal(w.snapshot().slots[1][1].active, true);
  const walk = idle();
  walk[0].move = { x: 1, y: 0 };
  run(w, 20, walk);
  assert.ok(body(w, 1).x > 115, "mage walked away: " + body(w, 1).x);
  press(w, 1, 1);
  assert.equal(w.error, null);
  assert.ok(Math.abs(body(w, 1).x - 100) < 1e-9);
  assert.ok(Math.abs(body(w, 1).y - 100) < 1e-9);
  assert.equal(label(w, 1, 1), "Anchor");
  assert.ok(w.effects.length > 0, "blink effects were emitted");
  run(w, 10);
  assert.equal(w.error, null);
  w.dispose();
});

test("slot 1 Anchor expires by timer and returns to the placing phase", async () => {
  const w = await arena();
  press(w, 1, 1);
  assert.equal(label(w, 1, 1), "Blink");
  run(w, 170);
  assert.equal(label(w, 1, 1), "Blink", "still armed before expiry");
  run(w, 20);
  assert.equal(w.error, null);
  assert.equal(label(w, 1, 1), "Anchor", "expired after 3 s");
  const walk = idle();
  walk[0].move = { x: 0, y: 1 };
  run(w, 10, walk);
  const y = body(w, 1).y;
  press(w, 1, 1);
  assert.equal(
    label(w, 1, 1),
    "Blink",
    "press after expiry places a new anchor",
  );
  assert.equal(body(w, 1).y, y, "no teleport on expired anchor");
  w.dispose();
});

test("slot 2 Zone: periodic damage inside, none to self, stops when the zone expires", async () => {
  const w = await arena({ p2: { x: 140, y: 100 } });
  press(w, 1, 2);
  const [zone] = tagged(w, 1, "zone");
  assert.ok(zone, "zone entity spawned");
  assert.equal(zone.solid, false);
  assert.equal(zone.countsForDefeat, false);
  assert.ok(zone.lifetime > 2.9 && zone.lifetime <= 3);
  run(w, 60);
  assert.equal(w.error, null);
  const mid = body(w, 2).hp;
  assert.ok(mid < 100 && (100 - mid) % 4 === 0, "damage ticks of 4: " + mid);
  assert.equal(body(w, 1).hp, 100, "zone never hurts its owner");
  run(w, 140);
  assert.equal(tagged(w, 1, "zone").length, 0, "zone expired after lifetime");
  const after = body(w, 2).hp;
  assert.ok(after < mid, "kept ticking until expiry");
  run(w, 30);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, after, "no damage after expiry");
  w.dispose();
});

test("slot 3 Turret: fires at a visible enemy, not through a brick, then expires", async () => {
  for (const blocked of [false, true]) {
    const w = await arena({
      obstacles: blocked ? [{ x: 150, y: 90, w: 20, h: 20 }] : [],
    });
    press(w, 1, 3);
    const [turret] = tagged(w, 1, "turret");
    assert.ok(turret, "turret spawned");
    assert.equal(turret.countsForDefeat, false);
    assert.equal(turret.solid, true);
    assert.ok(turret.lifetime > 4.9 && turret.lifetime <= 5);
    assert.ok(
      Math.abs(turret.x - 122) < 1e-6 && Math.abs(turret.y - 100) < 1e-6,
    );
    let beam = false;
    for (let i = 0; i < 60; i++) {
      w.step(1 / 60);
      beam ||= w.effects.some((e) => e.kind === "beam");
    }
    assert.equal(w.error, null);
    assert.equal(body(w, 2).hp < 100, !blocked, "blocked=" + blocked);
    assert.equal(beam, !blocked, "beam effect only when it fires");
    assert.equal(body(w, 1).hp, 100);
    run(w, 100, idle(), 0.05);
    assert.equal(w.error, null);
    assert.equal(tagged(w, 1, "turret").length, 0, "turret expired");
    w.dispose();
  }
});

test("slot 3 Turret does not hold the match: mage death is a loss with a live turret", async () => {
  const w = await arena();
  press(w, 1, 3);
  assert.equal(tagged(w, 1, "turret").length, 1);
  w.queueDamage(w.players.get(1).selfId, 1000, w.players.get(2).selfId);
  w.step(1 / 60);
  assert.equal(w.error, null);
  assert.equal(w.result, "P2");
  w.dispose();
});

test("mirror match Mage/Mage: anchor and cooldown state are isolated per instance", async () => {
  const w = await arena({ enemy: pkg });
  const inputs = idle();
  inputs[0].slots[1] = { pressed: true, held: true, released: false };
  inputs[1].slots[0] = { pressed: true, held: true, released: false };
  inputs[1].aim = { x: 0, y: 1 };
  w.step(1 / 60, inputs);
  assert.equal(w.error, null);
  assert.equal(label(w, 1, 1), "Blink");
  assert.equal(label(w, 2, 1), "Anchor");
  assert.ok(w.snapshot().slots[2][0].cooldown > 0);
  assert.equal(w.snapshot().slots[1][0].cooldown, 0);
  assert.equal(tagged(w, 2, "bolt").length, 1);
  assert.equal(tagged(w, 1, "bolt").length, 0);
  run(w, 30);
  assert.equal(w.error, null);
  assert.equal(body(w, 1).hp, 100);
  assert.equal(body(w, 2).hp, 100);
  press(w, 2, 1);
  assert.equal(label(w, 2, 1), "Blink");
  press(w, 1, 1);
  assert.equal(label(w, 1, 1), "Anchor", "P1 blinked");
  assert.equal(label(w, 2, 1), "Blink", "P2 anchor untouched by P1");
  w.dispose();
});

test("all four slots in one match run without errors", async () => {
  const w = await arena();
  for (const slot of [0, 1, 2, 3]) press(w, 1, slot);
  assert.equal(tagged(w, 1, "bolt").length, 1);
  assert.equal(tagged(w, 1, "zone").length, 1);
  assert.equal(tagged(w, 1, "turret").length, 1);
  assert.equal(label(w, 1, 1), "Blink");
  run(w, 120);
  assert.equal(w.error, null);
  assert.equal(w.result, null);
  assert.ok(body(w, 2).hp < 100 - 14, "bolt and turret both landed");
  assert.equal(body(w, 1).hp, 100);
  press(w, 1, 1);
  run(w, 200);
  assert.equal(w.error, null);
  assert.equal(
    [...w.entities.values()].filter((e) => e.ownerId === 1).length,
    1,
    "only the mage remains after lifetimes",
  );
  w.dispose();
});
