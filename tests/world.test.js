import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/engine/world.js";
import { spatial, createSpatial } from "../src/engine/spatial.js";
test("simultaneous elimination is a draw", () => {
  const w = createWorld({ width: 480, height: 270 });
  const a = w.spawn({
    ownerId: 1,
    x: 80,
    y: 100,
    radius: 7,
    hp: 10,
    countsForDefeat: true,
  });
  const b = w.spawn({
    ownerId: 2,
    x: 400,
    y: 100,
    radius: 7,
    hp: 10,
    countsForDefeat: true,
  });
  w.queueDamage(a, 10, b);
  w.queueDamage(b, 10, a);
  w.step(1 / 60, []);
  assert.equal(w.snapshot().result, "draw");
});
test("bodies stay within boundary and separate", () => {
  const w = createWorld({ width: 480, height: 270 });
  w.spawn({ ownerId: 1, x: -10, y: 10, radius: 7, hp: 10, solid: true });
  w.spawn({ ownerId: 2, x: 0, y: 10, radius: 7, hp: 10, solid: true });
  w.step(1 / 60, []);
  const [a, b] = w.snapshot().entities;
  assert.ok(a.x >= 7 && b.x >= 7);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 13.99);
});
test("timeout draw occurs at 180s, after damage/death verdict", () => {
  const w = createWorld({ duration: 180 });
  const a = w.spawn({ ownerId: 1, hp: 10, countsForDefeat: true });
  w.spawn({ ownerId: 2, hp: 10, countsForDefeat: true });
  w.time = 180 - 1 / 60;
  w.queueDamage(a, 10);
  w.step(1 / 60);
  assert.equal(w.result, "P2");
  const draw = createWorld({ duration: 180 });
  for (const ownerId of [1, 2]) draw.spawn({ ownerId, countsForDefeat: true });
  draw.time = 180 - 1 / 60;
  draw.step(1 / 60);
  assert.equal(draw.result, "draw");
});
test("circle body cannot enter brick rectangle", () => {
  const w = createWorld({ obstacles: [{ x: 100, y: 80, w: 32, h: 64 }] });
  w.spawn({ ownerId: 1, x: 98, y: 100, radius: 7, solid: true });
  w.spawn({ ownerId: 2, x: 400, y: 100, radius: 7, solid: true });
  w.step(1 / 60);
  assert.equal(w.snapshot().entities[0].x, 93);
});
test("non-solid entity is never clamped: passes through brick and leaves the arena", () => {
  const w = createWorld({ obstacles: [{ x: 100, y: 80, w: 32, h: 64 }] });
  const a = w.spawn({ ownerId: 1, x: 98, y: 100, radius: 7 });
  const b = w.spawn({ ownerId: 2, x: 470, y: 100, radius: 7, vx: 1200 });
  w.step(1 / 60);
  assert.equal(w.entities.get(a).x, 98);
  assert.equal(w.entities.get(b).x, 490);
});
test("spawn whitelist, hp→maxHp default, sizes, lifetime expiry and patch guards", () => {
  const w = createWorld();
  for (const ownerId of [1, 2]) w.spawn({ ownerId, countsForDefeat: true });
  assert.throws(
    () => w.spawn({ ownerId: 1, bogus: 1 }),
    /Invalid spawn field bogus/,
  );
  assert.throws(() => w.spawn({ ownerId: 1, x: NaN }), /Invalid finite/);
  assert.throws(() => w.spawn({ ownerId: 1, width: 0 }), /Invalid size/);
  assert.throws(
    () => w.spawn({ ownerId: 1, sprite: "x".repeat(41) }),
    /Invalid sprite/,
  );
  assert.throws(() => w.spawn({ ownerId: 1, tags: "a" }), /Invalid tags/);
  assert.throws(
    () => w.spawn({ ownerId: 1, tags: ["a".repeat(65)] }),
    /Invalid tags/,
  );
  const fromMax = w.entities.get(w.spawn({ ownerId: 1, maxHp: 30 }));
  assert.deepEqual([fromMax.hp, fromMax.maxHp, fromMax.tags], [30, 30, []]);
  const id = w.spawn({ ownerId: 1, hp: 40, lifetime: 0.03, contact: 1 });
  const e = w.entities.get(id);
  assert.equal(e.maxHp, 40);
  assert.equal(e.contact, true);
  assert.equal(e.visible, true);
  assert.equal("width" in e, false);
  const invisible = w.entities.get(w.spawn({ ownerId: 1, visible: 0 }));
  assert.equal(invisible.visible, false);
  w.applyCommands(1, [
    { op: "patch", id: invisible.id, changes: { visible: 1 } },
  ]);
  assert.equal(invisible.visible, true);
  assert.throws(
    () => w.applyCommands(1, [{ op: "patch", id, changes: { hp: 1 } }]),
    /Forbidden patch field hp/,
  );
  for (const k of ["ownerId", "countsForDefeat", "maxHp", "id"])
    assert.throws(
      () => w.applyCommands(1, [{ op: "patch", id, changes: { [k]: 1 } }]),
      /Forbidden patch field/,
    );
  assert.throws(
    () => w.applyCommands(1, [{ op: "patch", id, changes: { x: Infinity } }]),
    /Invalid finite/,
  );
  w.applyCommands(1, [
    { op: "patch", id, changes: { lifetime: null, width: 3 } },
  ]);
  assert.equal("lifetime" in e, false);
  assert.equal(e.width, 3);
  w.applyCommands(1, [
    { op: "patch", id: "1:999", changes: { x: 1 } },
    { op: "destroy", id: "1:999" },
  ]);
  w.applyCommands(1, [{ op: "patch", id, changes: { lifetime: 0.03 } }]);
  w.step(1 / 60);
  assert.ok(w.entities.has(id));
  w.step(1 / 60);
  assert.equal(w.entities.has(id), false);
  assert.equal(w.queue.length, 0);
});
test("spatial sweep: numeric point/normal for bricks, entities and bounds; sorted; ignore", () => {
  const world = {
    width: 480,
    height: 270,
    obstacles: [{ x: 150, y: 90, w: 20, h: 20 }],
    entities: [
      { id: "a", ownerId: 1, x: 100, y: 100, radius: 7, hp: 1 },
      { id: "b", ownerId: 2, x: 200, y: 100, radius: 7, hp: 1 },
      { id: "dead", ownerId: 2, x: 130, y: 100, radius: 7, hp: 0 },
    ],
  };
  const hits = spatial.sweep(
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    2,
    world,
    [],
  );
  assert.deepEqual(
    hits.map((h) => [h.kind, h.id, +h.t.toFixed(4)]),
    [
      ["entity", "a", 0],
      ["brick", undefined, 0.12],
      ["entity", "b", 0.2275],
      ["bounds", undefined, 0.945],
    ],
  );
  assert.deepEqual(hits[1].point, { x: 148, y: 100 });
  assert.deepEqual(hits[1].normal, { x: -1, y: 0 });
  assert.deepEqual(hits[2].point, { x: 191, y: 100 });
  assert.deepEqual(hits[2].normal, { x: -1, y: 0 });
  assert.deepEqual(hits[3].point, { x: 478, y: 100 });
  assert.deepEqual(hits[3].normal, { x: -1, y: 0 });
  const ignored = spatial.sweep(
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    2,
    world,
    ["a", "b"],
  );
  assert.deepEqual(
    ignored.map((h) => h.kind),
    ["brick", "bounds"],
  );
  // Vertical approach from below: axis-aligned normal (0,1), diagonal entity normal.
  const up = spatial.sweep({ x: 160, y: 150 }, { x: 160, y: 100 }, 2, world, [
    "a",
    "b",
  ]);
  assert.deepEqual(up[0].normal, { x: 0, y: 1 });
  assert.equal(up[0].point.y, 112);
  const diag = spatial.segmentCircle(
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 10, y: 10 },
    Math.SQRT2,
  );
  assert.ok(
    Math.abs(diag.t - 0.9) < 1e-9 &&
      Math.abs(diag.normal.x + Math.SQRT1_2) < 1e-9,
  );
  assert.equal(
    spatial.segmentCircle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }, 3),
    null,
  );
  // Segment fully outside the arena at start reports t=0 with an inward normal.
  assert.deepEqual(
    spatial
      .sweep({ x: -5, y: 50 }, { x: -20, y: 50 }, 1, world, ["a", "b"])
      .map((h) => [h.kind, h.t, h.normal.x]),
    [["bounds", 0, 1]],
  );
  // Equal t: the brick precedes the entity standing exactly at its face.
  assert.deepEqual(
    spatial
      .sweep(
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        2,
        {
          ...world,
          entities: [{ id: "c", ownerId: 2, x: 155, y: 100, radius: 5, hp: 1 }],
        },
        [],
      )
      .map((h) => [h.kind, h.t]),
    [
      ["brick", 0.24],
      ["entity", 0.24],
    ],
  );
  // createSpatial is self-contained: its source text evaluates in a bare scope.
  const rebuilt = new Function("return (" + createSpatial + ")();")();
  assert.deepEqual(
    rebuilt
      .sweep({ x: 100, y: 100 }, { x: 500, y: 100 }, 2, world, [])
      .map((h) => h.t),
    hits.map((h) => h.t),
  );
});
test("spatial: absurd (overflowing) coordinates miss instead of producing NaN hits; host rejects a non-finite pose", () => {
  const world = {
    width: 480,
    height: 270,
    obstacles: [{ x: 150, y: 90, w: 20, h: 20 }],
    entities: [{ id: "b", ownerId: 2, x: 200, y: 100, radius: 7, hp: 1 }],
  };
  const finiteHit = (h) =>
    [h.t, h.point.x, h.point.y, h.normal.x, h.normal.y].every(
      Number.isFinite,
    ) &&
    h.t >= 0 &&
    h.t <= 1;
  for (const [from, to] of [
    [
      { x: 100, y: 100 },
      { x: 1e308, y: 100 },
    ],
    [
      { x: -1e308, y: 100 },
      { x: 1e308, y: 100 },
    ],
    [
      { x: 100, y: 100 },
      { x: 1e308, y: 1e308 },
    ],
    [
      { x: 1e308, y: 1e308 },
      { x: -1e308, y: -1e308 },
    ],
    [
      { x: 100, y: 100 },
      { x: -1.7e308, y: 1.7e308 },
    ],
    [
      { x: 100, y: 100 },
      { x: 100, y: -1e308 },
    ],
  ]) {
    for (const s of [
      spatial,
      new Function("return (" + createSpatial + ")();")(),
    ]) {
      const hits = s.sweep(from, to, 2, world, []);
      assert.ok(hits.every(finiteHit), JSON.stringify([from, to, hits]));
      assert.ok(hits.every((h) => h.t !== null && h.point !== null));
    }
  }
  // Huge but non-overflowing coordinates still resolve every obstacle exactly.
  const far = spatial.sweep(
    { x: 100, y: 100 },
    { x: 1e100, y: 100 },
    2,
    world,
    [],
  );
  assert.deepEqual(
    far.map((h) => h.kind),
    ["brick", "entity", "bounds"],
  );
  assert.ok(far.every(finiteHit));
  assert.ok(Math.abs(far[0].point.x - 148) < 1e-6);
  assert.ok(Math.abs(far[1].point.x - 191) < 1e-6);
  assert.ok(Math.abs(far[2].point.x - 478) < 1e-6);
  // Individual primitives return null (never {t:NaN}) once an intermediate overflows.
  assert.equal(
    spatial.segmentCircle(
      { x: 0, y: 0 },
      { x: 1e308, y: 0 },
      { x: 1e308, y: 0 },
      1,
    ),
    null,
  );
  assert.equal(
    spatial.segmentCircle(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 1e308, y: 0 },
      1e308,
    ),
    null,
  );
  assert.equal(
    spatial.segmentRect(
      { x: -1e308, y: 100 },
      { x: 1e308, y: 100 },
      { x: 150, y: 90, w: 20, h: 20 },
      2,
    ),
    null,
  );
  // Host invariant: a non-finite pose after integration stops the match with a
  // 'world:' error naming the entity, instead of propagating NaN silently.
  const w = createWorld();
  const id = w.spawn({ ownerId: 1, x: 100, y: 100 });
  w.spawn({ ownerId: 2, x: 200, y: 100 });
  w.entities.get(id).ix = Infinity;
  w.step(1 / 60);
  assert.equal(
    w.error,
    "world: Non-finite x (Infinity) on entity host:1 of entity P1 after integration",
  );
  const v = createWorld();
  const vid = v.spawn({ ownerId: 2, x: 100, y: 100 });
  v.entities.get(vid).vy = NaN;
  v.step(1 / 60);
  assert.match(
    v.error,
    /^world: Non-finite y \(NaN\) on entity host:1 of entity P2/,
  );
  // The cap itself: 1e6 passes, anything beyond is rejected by name.
  assert.throws(
    () => w.spawn({ ownerId: 1, x: 1e6 + 1 }),
    /Invalid magnitude x/,
  );
  assert.throws(
    () => w.applyCommands(1, [{ op: "patch", id, changes: { vy: -1e7 } }]),
    /Invalid magnitude vy/,
  );
  assert.throws(
    () =>
      w.applyCommands(1, [{ op: "impulse", id, vector: { x: 0, y: 1e300 } }]),
    /Invalid magnitude impulse y/,
  );
  assert.doesNotThrow(() => w.spawn({ ownerId: 1, x: 1e6, y: -1e6, vx: 1e6 }));
});
test("radius/scale/width/height share the 1e6 magnitude cap; huge solid radii cannot poison poses", () => {
  const w = createWorld();
  for (const spec of [
    { radius: 1e308 },
    { scale: 1e7 },
    { width: 2e6 },
    { height: Infinity },
  ])
    assert.throws(
      () => w.spawn({ ownerId: 1, ...spec }),
      /Invalid (magnitude|finite)/,
      JSON.stringify(spec),
    );
  w.spawn({ ownerId: 1, x: 200, y: 200, radius: 1e6, solid: true });
  w.spawn({ ownerId: 2, x: 220, y: 200, radius: 1e6, solid: true });
  w.step(1 / 60);
  assert.equal(w.error, null);
  for (const e of w.snapshot().entities)
    for (const k of ["x", "y"]) assert.ok(Number.isFinite(e[k]), k);
  // Poisoned by hand: the post-collision check names the phase.
  const bad = createWorld();
  const id = bad.spawn({ ownerId: 1, x: 10, y: 10, solid: true });
  const orig = bad.clamp.bind(bad);
  bad.clamp = (e) => {
    orig(e);
    e.y = NaN;
  };
  bad.step(1 / 60);
  assert.match(
    bad.error,
    /^world: Non-finite y \(NaN\) on entity host:1 .* after collision$/,
  );
});
