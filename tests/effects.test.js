import test from "node:test";
import assert from "node:assert/strict";
import {
  validateEffect,
  resolveEffect,
  spriteFrame,
  pruneEffects,
} from "../src/engine/effects.js";
import { render } from "../src/view/renderer.js";
import { Assets } from "../src/view/assets.js";
// Mod-chosen keys that resolve through Object.prototype on a plain object.
const PROTO_KEYS = ["constructor", "__proto__", "hasOwnProperty", "toString"];
const manifest = {
  assets: {
    body: {
      type: "sprite",
      frameWidth: 16,
      frameHeight: 16,
      frames: 2,
      fps: 6,
    },
    hit: { type: "sound" },
  },
};
const ent = (id, x, y, hp = 10) => [
  id,
  { id, ownerId: 1, x, y, hp, maxHp: 10 },
];
const near = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 1e-9, msg ?? `${a} ~ ${b}`);
test("validateEffect keeps Task 1 ring specs and fills defaults", () => {
  const ring = validateEffect({ x: 1, y: 2, radius: 3, duration: 4 }, manifest);
  assert.deepEqual(ring, {
    kind: "ring",
    x: 1,
    y: 2,
    radius: 3,
    duration: 4,
    delay: 0,
    fadeIn: 0,
    fadeOut: 4,
  });
  const full = validateEffect(
    {
      x: 1,
      y: 2,
      radius: 3,
      duration: 4,
      angle: 1,
      arc: Math.PI,
      color: "#aabbcc",
    },
    manifest,
  );
  assert.equal(full.arc, Math.PI);
  assert.equal(full.color, "#aabbcc");
  assert.equal(full.ownerId, undefined);
  assert.equal(full.at, undefined);
  const sprite = validateEffect(
    { kind: "sprite", attach: { id: "1:1" }, asset: "body", duration: 1 },
    manifest,
  );
  assert.deepEqual(sprite, {
    kind: "sprite",
    attach: { id: "1:1", dx: 0, dy: 0 },
    asset: "body",
    scale: 1,
    loop: false,
    duration: 1,
    delay: 0,
    fadeIn: 0,
    fadeOut: 0,
  });
  const beam = validateEffect(
    { kind: "beam", x: 0, y: 0, attachTo: { id: "2:1", dx: 1 }, duration: 0.5 },
    manifest,
  );
  assert.equal(beam.width, 2);
  assert.equal(beam.fadeOut, 0);
  assert.deepEqual(beam.attachTo, { id: "2:1", dx: 1, dy: 0 });
  assert.equal(
    validateEffect(
      { kind: "beam", x: 0, y: 0, to: { x: 1, y: 1 }, width: 3, duration: 1 },
      manifest,
    ).width,
    3,
  );
});
test("validateEffect rejects every malformed branch with an 'effect' message", () => {
  const bad = [
    null,
    [],
    { x: 0, y: 0, radius: 1, duration: 1, kind: "blob" },
    { x: 0, y: 0, radius: 1, duration: 1, extra: true },
    { radius: 1, duration: 1 },
    { x: 0, radius: 1, duration: 1 },
    { x: 0, y: 0, attach: { id: "1:1" }, radius: 1, duration: 1 },
    { attach: { id: 5 }, radius: 1, duration: 1 },
    { attach: { id: "1:1", dz: 1 }, radius: 1, duration: 1 },
    { attach: { id: "1:1", dx: NaN }, radius: 1, duration: 1 },
    { x: "0", y: 0, radius: 1, duration: 1 },
    { x: 0, y: 0, radius: -1, duration: 1 },
    { x: 0, y: 0, radius: Infinity, duration: 1 },
    { x: 0, y: 0, radius: 1 },
    { x: 0, y: 0, radius: 1, duration: 0 },
    { x: 0, y: 0, radius: 1, duration: 1, delay: -1 },
    { x: 0, y: 0, radius: 1, duration: 1, fadeIn: -1 },
    { x: 0, y: 0, radius: 1, duration: 1, fadeOut: NaN },
    { x: 0, y: 0, radius: 1, duration: 1, arc: -1 },
    { x: 0, y: 0, radius: 1, duration: 1, arc: Math.PI + 0.01 },
    { x: 0, y: 0, radius: 1, duration: 1, angle: "a" },
    { x: 0, y: 0, radius: 1, duration: 1, color: {} },
    { x: 0, y: 0, radius: 1, duration: 1, color: "#fff" },
    { x: 0, y: 0, radius: 1, duration: 1, asset: "body" },
    { kind: "sprite", x: 0, y: 0, duration: 1 },
    { kind: "sprite", x: 0, y: 0, duration: 1, asset: "hit" },
    { kind: "sprite", x: 0, y: 0, duration: 1, asset: "nope" },
    { kind: "sprite", x: 0, y: 0, duration: 1, asset: "body", scale: 0 },
    { kind: "sprite", x: 0, y: 0, duration: 1, asset: "body", loop: 1 },
    { kind: "sprite", x: 0, y: 0, duration: 1, asset: "body", radius: 1 },
    { kind: "beam", x: 0, y: 0, duration: 1 },
    {
      kind: "beam",
      x: 0,
      y: 0,
      duration: 1,
      to: { x: 1, y: 1 },
      attachTo: { id: "1:1" },
    },
    { kind: "beam", x: 0, y: 0, duration: 1, to: { x: 1 } },
    { kind: "beam", x: 0, y: 0, duration: 1, to: { x: 1, y: 1, z: 0 } },
    { kind: "beam", x: 0, y: 0, duration: 1, to: { x: 1, y: 1 }, width: 0 },
    { kind: "beam", x: 0, y: 0, duration: 1, to: { x: 1, y: 1 }, radius: 1 },
  ];
  for (const spec of bad)
    assert.throws(
      () => validateEffect(spec, manifest),
      /effect/i,
      JSON.stringify(spec),
    );
});
test("attached effects follow the entity and vanish when it is gone", () => {
  const entities = new Map([ent("1:1", 10, 20), ent("2:1", 100, 20)]);
  const e = {
    ...validateEffect(
      { attach: { id: "1:1", dx: 2, dy: -3 }, radius: 1, duration: 2 },
      manifest,
    ),
    ownerId: 1,
    at: 0,
  };
  let r = resolveEffect(e, entities, 0.5);
  assert.equal(r.x, 12);
  assert.equal(r.y, 17);
  entities.get("1:1").x = 50;
  entities.get("1:1").y = 60;
  r = resolveEffect(e, entities, 0.5);
  assert.equal(r.x, 52);
  assert.equal(r.y, 57);
  entities.get("1:1").hp = 0;
  assert.equal(resolveEffect(e, entities, 0.5), null);
  entities.delete("1:1");
  assert.equal(resolveEffect(e, entities, 0.5), null);
  const beam = {
    ...validateEffect(
      { kind: "beam", x: 0, y: 0, attachTo: { id: "2:1", dy: 5 }, duration: 1 },
      manifest,
    ),
    ownerId: 1,
    at: 0,
  };
  r = resolveEffect(beam, entities, 0.1);
  assert.deepEqual([r.x, r.y, r.x2, r.y2], [0, 0, 100, 25]);
  entities.get("2:1").x = 200;
  assert.equal(resolveEffect(beam, entities, 0.1).x2, 200);
  entities.delete("2:1");
  assert.equal(resolveEffect(beam, entities, 0.1), null);
  const fixed = {
    ...validateEffect(
      { kind: "beam", x: 1, y: 2, to: { x: 3, y: 4 }, duration: 1 },
      manifest,
    ),
    ownerId: 1,
    at: 0,
  };
  r = resolveEffect(fixed, entities, 0);
  assert.deepEqual([r.x, r.y, r.x2, r.y2, r.alpha], [1, 2, 3, 4, 1]);
});
test("alpha at boundaries: fadeIn, plateau, fadeOut, and Task 1 linear ring", () => {
  const none = new Map();
  const e = {
    ...validateEffect(
      { x: 0, y: 0, radius: 1, duration: 4, fadeIn: 1, fadeOut: 2 },
      manifest,
    ),
    ownerId: 1,
    at: 10,
  };
  near(resolveEffect(e, none, 10).alpha, 0);
  near(resolveEffect(e, none, 10.5).alpha, 0.5);
  near(resolveEffect(e, none, 11).alpha, 1);
  near(resolveEffect(e, none, 11.5).alpha, 1);
  near(resolveEffect(e, none, 12).alpha, 1, "start of fadeOut is 1");
  near(resolveEffect(e, none, 13).alpha, 0.5);
  near(resolveEffect(e, none, 14 - 1e-6).alpha, 0.5e-6);
  assert.equal(resolveEffect(e, none, 14), null);
  assert.equal(resolveEffect(e, none, 9.999), null);
  const ring = {
    ...validateEffect({ x: 0, y: 0, radius: 1, duration: 2 }, manifest),
    ownerId: 1,
    at: 0,
  };
  near(resolveEffect(ring, none, 0).alpha, 1);
  near(resolveEffect(ring, none, 0.5).alpha, 0.75);
  near(resolveEffect(ring, none, 1.5).alpha, 0.25);
  const hard = {
    ...validateEffect(
      { kind: "beam", x: 0, y: 0, to: { x: 1, y: 0 }, duration: 2 },
      manifest,
    ),
    ownerId: 1,
    at: 0,
  };
  near(resolveEffect(hard, none, 0).alpha, 1);
  near(resolveEffect(hard, none, 1.999).alpha, 1);
  assert.equal(resolveEffect(hard, none, 0).t, 0);
  assert.equal(resolveEffect(hard, none, 1.5).t, 1.5);
});
test("delay hides the effect until start and extends its life", () => {
  const none = new Map();
  const e = {
    ...validateEffect(
      { x: 0, y: 0, radius: 1, duration: 1, delay: 2, fadeIn: 0.5, fadeOut: 0 },
      manifest,
    ),
    ownerId: 1,
    at: 5,
  };
  assert.equal(resolveEffect(e, none, 5), null);
  assert.equal(resolveEffect(e, none, 6.99), null);
  near(resolveEffect(e, none, 7).alpha, 0);
  near(resolveEffect(e, none, 7).t, 0);
  near(resolveEffect(e, none, 7.5).alpha, 1);
  assert.equal(resolveEffect(e, none, 8), null);
  assert.equal(pruneEffects([e], none, 6).length, 1);
  assert.equal(pruneEffects([e], none, 7.99).length, 1);
  assert.equal(pruneEffects([e], none, 8).length, 0);
});
test("pruneEffects drops expired effects and those whose attach target is gone", () => {
  const entities = new Map([ent("1:1", 0, 0), ent("2:1", 0, 0)]);
  const mk = (spec, at = 0) => ({
    ...validateEffect(spec, manifest),
    ownerId: 1,
    at,
  });
  const plain = mk({ x: 0, y: 0, radius: 1, duration: 1 });
  const attached = mk({ attach: { id: "1:1" }, radius: 1, duration: 1 });
  const beam = mk({
    kind: "beam",
    x: 0,
    y: 0,
    attachTo: { id: "2:1" },
    duration: 1,
  });
  const beamFrom = mk({
    kind: "beam",
    attach: { id: "2:1" },
    to: { x: 1, y: 1 },
    duration: 1,
  });
  let all = [plain, attached, beam, beamFrom];
  assert.deepEqual(pruneEffects(all, entities, 0.5), all);
  assert.deepEqual(pruneEffects(all, entities, 1), []);
  entities.get("1:1").hp = 0;
  assert.deepEqual(pruneEffects(all, entities, 0.5), [plain, beam, beamFrom]);
  entities.delete("2:1");
  assert.deepEqual(pruneEffects(all, entities, 0.5), [plain]);
});
test("spriteFrame clamps without loop and wraps with loop", () => {
  const spec = { frames: 4, fps: 10 };
  assert.equal(spriteFrame(0, spec, false), 0);
  assert.equal(spriteFrame(0.25, spec, false), 2);
  assert.equal(spriteFrame(0.39, spec, false), 3);
  assert.equal(spriteFrame(5, spec, false), 3);
  assert.equal(spriteFrame(0.39, spec, true), 3);
  assert.equal(spriteFrame(0.4, spec, true), 0);
  assert.equal(spriteFrame(0.55, spec, true), 1);
});
test("render smoke: rings, sprites, beams and bodies without assets draw on a fake ctx", () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, a])),
      set: (t, k, v) => ((t[k] = v), true),
    },
  );
  const spec = manifest.assets.body;
  // Assets.load builds prototype-less tables; the renderer must work with both.
  const assets = {
    images: {
      1: Object.assign(Object.create(null), { body: { img: {}, spec } }),
      2: {},
    },
  };
  const body = (id, ownerId, extra = {}) => ({
    id,
    ownerId,
    x: 40,
    y: 40,
    angle: 0,
    radius: 7,
    hp: 5,
    maxHp: 10,
    sprite: "body",
    scale: 1,
    ...extra,
  });
  const mk = (spec, at = 0, ownerId = 1) => ({
    ...validateEffect(spec, manifest),
    ownerId,
    at,
  });
  const s = {
    width: 480,
    height: 270,
    time: 1,
    obstacles: [{ x: 96, y: 64, w: 32, h: 16 }],
    shake: { amount: 4, until: 2 },
    entities: [
      body("1:1", 1, { width: 24, height: 12, scale: 2 }),
      body("2:1", 2, { x: 100, sprite: "missing", width: 10 }),
      body("2:2", 2, { x: 120, sprite: "missing" }),
      // Prototype keys are not assets: drawn as squares, never a TypeError.
      ...PROTO_KEYS.map((sprite, i) =>
        body("1:" + (i + 2), 1, { x: 60 + i * 10, sprite }),
      ),
      ...PROTO_KEYS.map((sprite, i) =>
        body("2:" + (i + 3), 2, { x: 60 + i * 10, sprite }),
      ),
    ],
    effects: [
      mk({
        x: 10,
        y: 10,
        radius: 8,
        duration: 2,
        angle: 1,
        arc: 1,
        color: "#ff0000",
      }),
      mk({
        kind: "sprite",
        attach: { id: "1:1", dx: 3 },
        asset: "body",
        duration: 2,
        angle: 0.5,
        scale: 2,
        loop: true,
      }),
      mk({ kind: "sprite", x: 5, y: 5, asset: "body", duration: 2 }, 0, 2),
      mk({
        kind: "beam",
        attach: { id: "1:1" },
        attachTo: { id: "2:1" },
        duration: 2,
        width: 3,
        color: "#00ff00",
      }),
      mk({ kind: "beam", x: 0, y: 0, to: { x: 50, y: 50 }, duration: 2 }),
      mk({ kind: "beam", x: 0, y: 0, attachTo: { id: "gone" }, duration: 2 }),
      mk({ x: 0, y: 0, radius: 1, duration: 1, delay: 5 }),
      { x: 3, y: 3, radius: 2, duration: 2, ownerId: 1, at: 0 },
      // validateEffect rejects these asset names; a hand-built record is skipped.
      ...PROTO_KEYS.map((asset) => ({
        kind: "sprite",
        x: 5,
        y: 5,
        asset,
        duration: 2,
        ownerId: 1,
        at: 0,
      })),
    ],
  };
  assert.doesNotThrow(() => render(ctx, s, assets));
  const names = calls.map((c) => c[0]);
  assert.equal(
    names.filter((n) => n === "drawImage").length,
    2,
    "one body + one sprite effect drawn",
  );
  assert.equal(
    names.filter((n) => n === "arc").length,
    2,
    "ring effect + legacy ring",
  );
  assert.equal(names.filter((n) => n === "lineTo").length, 2, "two live beams");
  assert.equal(names.filter((n) => n === "rotate").length, 1);
  const bodyDraw = calls.find((c) => c[0] === "drawImage")[1];
  assert.deepEqual(bodyDraw.slice(7), [48, 24]);
  assert.equal(
    names.filter((n) => n === "save").length,
    names.filter((n) => n === "restore").length,
  );
  assert.equal(ctx.globalAlpha, 1);
  // Each prototype-named body is drawn as an 8x8 square (the no-asset branch).
  const squares = calls.filter(
    (c) => c[0] === "fillRect" && c[1][2] === 8 && c[1][3] === 8,
  );
  assert.equal(squares.length, PROTO_KEYS.length * 2 + 1, "2:2 + proto bodies");
});
test("prototype keys never resolve as assets: validateEffect rejects them, Assets tables are prototype-less, play skips them", () => {
  for (const asset of PROTO_KEYS)
    assert.throws(
      () =>
        validateEffect(
          { kind: "sprite", x: 0, y: 0, duration: 1, asset },
          manifest,
        ),
      /Invalid effect asset/,
      asset,
    );
  const a = new Assets();
  assert.equal(Object.getPrototypeOf(a.images), null);
  assert.equal(Object.getPrototypeOf(a.buffers), null);
  let started = 0;
  const node = {
    connect: () => node,
    disconnect() {},
    start: () => started++,
    stop() {},
    gain: {},
  };
  a.audio = {
    createBufferSource: () => ({ ...node }),
    createGain: () => ({ ...node }),
    destination: {},
    close() {},
  };
  a.buffers[1] = Object.assign(Object.create(null), { hit: {} });
  a.buffers[2] = { hit: {} };
  a.play([
    ...PROTO_KEYS.map((asset) => ({ ownerId: 1, asset })),
    ...PROTO_KEYS.map((asset) => ({ ownerId: 2, asset })),
    { ownerId: 3, asset: "hit" },
    { ownerId: 1, asset: "hit", volume: 0.5 },
  ]);
  assert.equal(started, 1, "only the real buffer plays");
  a.dispose();
  assert.equal(Object.getPrototypeOf(a.images), null);
});
