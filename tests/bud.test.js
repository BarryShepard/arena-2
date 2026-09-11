import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest } from "../src/mods/package.js";
const load = async (id) => ({
  manifest: JSON.parse(
    await readFile(
      new URL(`../characters/${id}/manifest.json`, import.meta.url),
      "utf8",
    ),
  ),
  code: await readFile(
    new URL(`../characters/${id}/main.js`, import.meta.url),
    "utf8",
  ),
});
const bud = await load("bud"),
  fighter = await load("fighter");
// Static opponent: a Fighter manifest with a script that does nothing.
const dummy = { ...fighter, code: "defineCharacter({})" };
async function match({
  p1 = bud,
  p2 = dummy,
  at1 = { x: 100, y: 100 },
  at2 = { x: 400, y: 200 },
  obstacles = [],
} = {}) {
  const w = createWorld({ obstacles });
  try {
    w.addPlayer(await createRuntime(p1, 1), at1);
    w.addPlayer(await createRuntime(p2, 2), at2);
    return w;
  } catch (e) {
    w.dispose();
    throw e;
  }
}
const press = (slot, move = { x: 0, y: 0 }, aim = { x: 1, y: 0 }) => {
  const i = emptyInput();
  i.move = move;
  i.aim = aim;
  if (slot !== null)
    i.slots[slot] = { pressed: true, held: true, released: false };
  return i;
};
const steps = (w, n, inputs) => {
  for (let i = 0; i < n; i++) w.step(1 / 60, inputs);
};
const own = (w, owner, tag) =>
  [...w.entities.values()].filter(
    (e) => e.ownerId === owner && e.hp > 0 && (!tag || e.tags.includes(tag)),
  );
const enemy = (w) => w.entities.get(w.players.get(2).selfId);
const main = (w) => w.entities.get(w.players.get(1).selfId);
const spread = (list) => {
  const cx = list.reduce((s, e) => s + e.x, 0) / list.length,
    cy = list.reduce((s, e) => s + e.y, 0) / list.length;
  return (
    list.reduce((s, e) => s + Math.hypot(e.x - cx, e.y - cy), 0) / list.length
  );
};
function kill(w, ids) {
  for (const id of ids) w.queueDamage(id, 1000, w.players.get(2).selfId);
  w.step(1 / 60);
}
test("Bud manifest is valid with exactly four slots", () => {
  assert.equal(validateManifest(bud.manifest), bud.manifest);
  assert.equal(bud.manifest.id, "bud");
  assert.equal(bud.manifest.abilities.length, 4);
});
test("growth: real damage scales radius/scale by exactly 10%, zero damage does not, cap holds", async () => {
  const w = await match();
  const id = w.players.get(1).selfId,
    p2 = w.players.get(2).selfId;
  w.queueDamage(id, 10, p2);
  w.step(1 / 60);
  assert.equal(w.error, null);
  assert.equal(main(w).hp, 90);
  assert.ok(Math.abs(main(w).radius - 7.7) < 1e-9);
  assert.ok(Math.abs(main(w).scale - 1.1) < 1e-9);
  assert.ok(
    w.effects.some((e) => e.attach?.id === id && e.kind === "ring"),
    "growth ring attached to body",
  );
  w.queueDamage(id, 0, p2);
  w.step(1 / 60);
  assert.ok(Math.abs(main(w).radius - 7.7) < 1e-9, "no growth at amount 0");
  for (let i = 0; i < 15; i++) {
    w.queueDamage(id, 1, p2);
    w.step(1 / 60);
  }
  assert.equal(w.error, null);
  assert.equal(main(w).radius, 20);
  assert.equal(main(w).scale, 20 / 7);
  assert.ok(main(w).hp > 0);
  w.dispose();
});
test("burst: first death spawns five countsForDefeat seeds in the same tick; verdict waits for the last seed; seeds do not split", async () => {
  const w = await match();
  const mainId = w.players.get(1).selfId;
  kill(w, [mainId]);
  assert.equal(w.error, null);
  assert.equal(w.result, null);
  assert.equal(w.entities.has(mainId), false);
  const seeds = own(w, 1);
  assert.equal(seeds.length, 5);
  for (const s of seeds) {
    assert.equal(s.countsForDefeat, true);
    assert.equal(s.solid, true);
    assert.ok(s.hp > 0 && s.hp === s.maxHp);
    assert.ok(
      Math.hypot(s.x - 100, s.y - 100) <= 10.01,
      "spawned around death point",
    );
  }
  assert.ok(w.effects.length > 0 && w.sounds.some((s) => s.asset === "pop"));
  kill(
    w,
    seeds.slice(0, 4).map((s) => s.id),
  );
  assert.equal(w.result, null);
  assert.equal(own(w, 1).length, 1);
  kill(w, [seeds[4].id]);
  assert.equal(w.result, "P2");
  assert.equal(own(w, 1).length, 0, "seeds do not burst again");
  assert.equal(w.error, null);
  w.dispose();
});
test("group: move input drives every live body; Formation toggles wide/tight spacing and label", async () => {
  const w = await match();
  kill(w, [w.players.get(1).selfId]);
  steps(w, 40, [press(null), press(null)]);
  const before = new Map(own(w, 1).map((e) => [e.id, e.x]));
  steps(w, 20, [press(null, { x: 1, y: 0 }), press(null)]);
  for (const e of own(w, 1))
    assert.ok(e.x - before.get(e.id) > 12, "body followed move input");
  const tight = spread(own(w, 1));
  assert.equal(w.snapshot().slots[1][1].label, "Tight");
  w.step(1 / 60, [press(1), press(null)]);
  steps(w, 60, [press(null), press(null)]);
  const wide = spread(own(w, 1));
  assert.equal(w.snapshot().slots[1][1].label, "Wide");
  assert.equal(w.snapshot().slots[1][1].active, true);
  assert.ok(wide > tight + 6, `wide ${wide} > tight ${tight}`);
  w.step(1 / 60, [press(1), press(null)]);
  steps(w, 60, [press(null), press(null)]);
  assert.equal(w.snapshot().slots[1][1].label, "Tight");
  assert.ok(spread(own(w, 1)) < wide - 6);
  assert.equal(w.error, null);
  w.dispose();
});
test("Volley: shots hurt the enemy, never own bodies, and die on a brick shielding the enemy", async () => {
  const w = await match({ at2: { x: 200, y: 100 } });
  w.step(1 / 60, [press(0), press(null)]);
  assert.equal(own(w, 1, "shot").length, 1);
  steps(w, 30, [press(null), press(null)]);
  assert.equal(enemy(w).hp, 110);
  assert.equal(own(w, 1, "shot").length, 0, "shot consumed on hit");
  w.dispose();
  const g = await match({ at2: { x: 200, y: 100 } });
  kill(g, [g.players.get(1).selfId]);
  steps(g, 30, [press(null), press(null)]);
  g.step(1 / 60, [press(0), press(null)]);
  assert.equal(own(g, 1, "shot").length, 5, "each seed fires");
  steps(g, 40, [press(null), press(null)]);
  assert.equal(g.error, null);
  assert.ok(enemy(g).hp <= 110, "group volley reached enemy");
  const seeds = own(g, 1, "seed");
  assert.equal(seeds.length, 5);
  for (const s of seeds) assert.equal(s.hp, s.maxHp, "shots pass own bodies");
  g.dispose();
  const b = await match({
    at2: { x: 200, y: 100 },
    obstacles: [{ x: 150, y: 90, w: 20, h: 20 }],
  });
  b.step(1 / 60, [press(0), press(null)]);
  steps(b, 30, [press(null), press(null)]);
  assert.equal(b.error, null);
  assert.equal(enemy(b).hp, 120);
  assert.equal(own(b, 1, "shot").length, 0, "shot destroyed on brick");
  b.dispose();
});
test("Mine: creeps toward the enemy, explodes on contact, expires by lifetime otherwise", async () => {
  const w = await match({ at2: { x: 160, y: 100 } });
  w.step(1 / 60, [press(2), press(null)]);
  let [mine] = own(w, 1, "mine");
  assert.ok(mine && mine.contact && !mine.solid && mine.lifetime > 7.9);
  const x0 = mine.x;
  steps(w, 12, [press(null), press(null)]);
  [mine] = own(w, 1, "mine");
  assert.ok(mine.x > x0 + 3, "mine moved toward enemy");
  let boom = false;
  for (let i = 0; i < 110; i++) {
    w.step(1 / 60);
    if (w.sounds.some((s) => s.asset === "boom_sfx")) boom = true;
  }
  assert.equal(w.error, null);
  assert.equal(enemy(w).hp, 90);
  assert.equal(own(w, 1, "mine").length, 0, "mine removed after explosion");
  assert.ok(boom && w.shake.amount === 4);
  w.dispose();
  const far = await match({ at2: { x: 460, y: 250 } });
  far.step(1 / 60, [press(2), press(null)]);
  steps(far, 470, [press(null), press(null)]);
  assert.equal(own(far, 1, "mine").length, 1);
  steps(far, 15, [press(null), press(null)]);
  assert.equal(far.error, null);
  assert.equal(own(far, 1, "mine").length, 0, "mine expired");
  assert.equal(enemy(far).hp, 120);
  far.dispose();
});
test("Morph: slot 0 label flips and Lash fires a raycast beam instead of projectiles", async () => {
  const w = await match({ at2: { x: 150, y: 100 } });
  assert.equal(w.snapshot().slots[1][0].label, "Volley");
  w.step(1 / 60, [press(3), press(null)]);
  assert.equal(w.snapshot().slots[1][0].label, "Lash");
  assert.equal(w.snapshot().slots[1][3].active, true);
  steps(w, 10, [press(null), press(null)]);
  assert.equal(main(w).sprite, "thorn");
  w.step(1 / 60, [press(0), press(null)]);
  assert.equal(w.error, null);
  const beam = w.effects.find((e) => e.kind === "beam");
  assert.ok(beam && beam.ownerId === 1 && beam.attach.id === main(w).id);
  assert.ok(
    Math.abs(beam.to.x - 143) < 1e-6 && Math.abs(beam.to.y - 100) < 1e-6,
  );
  assert.equal(own(w, 1, "shot").length, 0);
  assert.equal(enemy(w).hp, 106);
  steps(w, 60, [press(null), press(null)]);
  w.step(1 / 60, [press(3), press(null)]);
  assert.equal(w.snapshot().slots[1][0].label, "Volley");
  steps(w, 10, [press(null), press(null)]);
  assert.equal(main(w).sprite, "body");
  w.dispose();
});
test("mirror match: P1 morph does not leak into P2; both instances act independently", async () => {
  const w = await match({ p2: bud, at2: { x: 300, y: 100 } });
  w.step(1 / 60, [press(3), press(null)]);
  assert.equal(w.snapshot().slots[1][0].label, "Lash");
  assert.equal(w.snapshot().slots[2][0].label, "Volley");
  w.step(1 / 60, [press(0), press(0, undefined, { x: -1, y: 0 })]);
  assert.equal(w.error, null);
  assert.ok(w.effects.some((e) => e.kind === "beam" && e.ownerId === 1));
  assert.ok(!w.effects.some((e) => e.kind === "beam" && e.ownerId === 2));
  assert.equal(own(w, 1, "shot").length, 0);
  assert.equal(own(w, 2, "shot").length, 1);
  steps(w, 60, [press(null), press(null)]);
  assert.equal(w.error, null);
  assert.equal(main(w).hp, 90, "P2 volley hit P1");
  assert.ok(Math.abs(main(w).radius - 7.7) < 1e-9);
  assert.equal(enemy(w).radius, 7, "P2 did not grow");
  w.dispose();
});
test("all four slots before and after the burst against a live Fighter without world error", async () => {
  const w = await match({ p2: fighter, at2: { x: 220, y: 100 } });
  const idle = press(null);
  for (const slot of [1, 2, 0, 3, 0]) {
    w.step(1 / 60, [press(slot), idle]);
    steps(w, 45, [idle, idle]);
  }
  kill(w, [w.players.get(1).selfId]);
  assert.equal(own(w, 1, "seed").length, 5);
  for (const slot of [0, 3, 0, 2, 1]) {
    w.step(1 / 60, [press(slot, { x: 1, y: 0 }), idle]);
    steps(w, 65, [idle, idle]);
  }
  assert.equal(w.error, null);
  assert.equal(w.result, null);
  assert.ok(enemy(w).hp < 120);
  assert.deepEqual(
    w.snapshot().slots[1].map((s) => s.label),
    ["Volley", "Tight", "Mine", "Morph"],
  );
  w.dispose();
});
