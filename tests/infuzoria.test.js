import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest } from "../src/mods/package.js";
const manifest = JSON.parse(
  await readFile(
    new URL("../characters/infuzoria/manifest.json", import.meta.url),
    "utf8",
  ),
);
const code = await readFile(
  new URL("../characters/infuzoria/main.js", import.meta.url),
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
const tagged = (w, owner, tag) =>
  [...w.entities.values()].filter(
    (e) => e.ownerId === owner && e.tags.includes(tag),
  );
const label = (w, owner, slot) => w.snapshot().slots[owner][slot].label;

test("Infuzoria manifest is valid with four slots", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(manifest.id, "infuzoria");
  assert.deepEqual(
    manifest.abilities.map((a) => a.label),
    ["Pseudopod", "Engulf", "Enzyme", "Cyst"],
  );
});

test("slot 0 Pseudopod: melee arc hits an adjacent enemy, none to self", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  press(w, 1, 0);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 110 - 13);
  assert.equal(body(w, 1).hp, 110);
  assert.ok(w.snapshot().slots[1][0].cooldown > 0);
  w.dispose();
});

test("slot 0 Pseudopod: out of range does nothing, a brick in the way blocks it", async () => {
  const far = await arena({ p2: { x: 300, y: 100 } });
  press(far, 1, 0);
  assert.equal(body(far, 2).hp, 110, "out of range: untouched");
  far.dispose();

  const w = await arena({
    p2: { x: 118, y: 100 },
    obstacles: [{ x: 108, y: 90, w: 4, h: 20 }],
  });
  press(w, 1, 0);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 110, "brick blocks line of sight");
  w.dispose();
});

test("slot 1 Engulf: grabs a nearby foe, bites immediately, then digests over the hold", async () => {
  const w = await arena({ p2: { x: 115, y: 100 } });
  press(w, 1, 1);
  assert.equal(w.error, null);
  const afterBite = body(w, 2).hp;
  assert.equal(afterBite, 110 - 6, "immediate bite damage");
  assert.ok(w.snapshot().slots[1][1].active, "engulf marked active while held");
  run(w, 40);
  assert.equal(w.error, null);
  assert.ok(
    body(w, 2).hp < afterBite,
    "digestion ticks damage during the hold",
  );
  run(w, 40);
  assert.equal(
    w.snapshot().slots[1][1].active,
    false,
    "grab released after hold time",
  );
  w.dispose();
});

test("slot 1 Engulf: no target in range, no damage, cooldown still applied", async () => {
  const w = await arena({ p2: { x: 300, y: 100 } });
  press(w, 1, 1);
  assert.equal(w.error, null);
  assert.equal(body(w, 2).hp, 110);
  assert.ok(w.snapshot().slots[1][1].cooldown > 0);
  w.dispose();
});

test("slot 2 Enzyme: corrosive cloud ticks damage on anyone standing in it", async () => {
  const w = await arena({ p2: { x: 122, y: 100 } });
  press(w, 1, 2);
  const [z] = tagged(w, 1, "cloud");
  assert.ok(z, "cloud spawned");
  assert.equal(z.solid, false);
  run(w, 90);
  assert.equal(w.error, null);
  assert.ok(body(w, 2).hp < 110, "cloud damaged the enemy standing in it");
  assert.equal(body(w, 1).hp, 110, "own body untouched");
  const far = await arena({ p2: { x: 300, y: 100 } });
  press(far, 1, 2);
  run(far, 90);
  assert.equal(body(far, 2).hp, 110, "out of range: untouched");
  w.dispose();
  far.dispose();
});

// A minimal scripted attacker: on slot-0 press, deals a fixed hit to the
// nearest living enemy once. Lets tests drive controlled damage into the
// infuzoria without depending on its own abilities.
function attackerPkg(dmg) {
  return {
    manifest,
    code: `defineCharacter({
      ability(ctx, { slot, phase }) {
        if (slot !== 0 || phase !== 'press') return;
        const m = ctx.api.entity(ctx.selfId);
        if (!m || m.hp <= 0) return;
        for (const e of ctx.world.entities) {
          if (e.ownerId !== ctx.ownerId && e.hp > 0) {
            ctx.api.damage(e.id, ${dmg}, m.id);
            return;
          }
        }
      }
    })`,
  };
}

test("slot 3 Cyst: reduces incoming damage while active, then expires", async () => {
  const w = await arena({ enemy: attackerPkg(13), p2: { x: 118, y: 100 } });
  press(w, 1, 3);
  assert.equal(w.error, null);
  assert.equal(w.snapshot().slots[1][3].active, true);
  press(w, 2, 0, { x: -1, y: 0 });
  assert.equal(w.error, null);
  const dealt = 110 - body(w, 1).hp;
  assert.ok(
    Math.abs(dealt - 13 * (1 - 0.45)) < 1e-9,
    "45% reduction applied to the raw 13 hit",
  );
  run(w, 200);
  assert.equal(w.snapshot().slots[1][3].active, false, "shield expired");
  w.dispose();
});

test("mitosis: on first death the cell splits into two daughters that keep fighting", async () => {
  const w = await arena({ enemy: attackerPkg(500), p2: { x: 112, y: 100 } });
  press(w, 2, 0, { x: -1, y: 0 });
  assert.equal(w.error, null);
  assert.ok(
    !body(w, 1) || body(w, 1).hp <= 0,
    "main body died to the one-shot attacker",
  );
  const daughters = tagged(w, 1, "daughter");
  assert.equal(daughters.length, 2, "split into exactly two daughters");
  assert.ok(
    daughters.every((d) => d.hp === 40 && d.countsForDefeat),
    "each daughter has 40 hp and counts for defeat",
  );
  w.dispose();
});

test("all four slots in one match run without errors", async () => {
  const w = await arena({ p2: { x: 118, y: 100 } });
  for (const slot of [0, 1, 2, 3]) press(w, 1, slot);
  assert.equal(w.error, null);
  run(w, 200);
  assert.equal(w.error, null);
  assert.ok(body(w, 2).hp < 110, "at least one attack landed");
  w.dispose();
});

test("mirror match Infuzoria/Infuzoria: cooldowns and grab state are isolated per instance", async () => {
  const w = await arena({ enemy: pkg, p2: { x: 118, y: 100 } });
  press(w, 1, 1);
  assert.equal(label(w, 1, 1), "Engulf");
  assert.equal(w.snapshot().slots[1][1].active, true);
  assert.equal(w.snapshot().slots[2][1].active, false);
  press(w, 2, 0, { x: -1, y: 0 });
  assert.equal(w.error, null);
  run(w, 30);
  assert.equal(w.error, null);
  w.dispose();
});
