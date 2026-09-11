import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest, safePath } from "../src/mods/package.js";
const manifest = JSON.parse(
  await readFile(
    new URL("../characters/fighter/manifest.json", import.meta.url),
    "utf8",
  ),
);
const code = await readFile(
  new URL("../characters/fighter/main.js", import.meta.url),
  "utf8",
);
const pkg = { manifest, code };
// Review recommendation M-5: the 8 ms CPU budget is wall-clock, so functional
// tests that only care about behaviour raise it. Otherwise a slow machine (CI
// runners especially) turns "Fighter can use its slots" into a budget failure.
const FUNCTIONAL_TICK_MS = 500;
async function match(overrides = {}) {
  const w = createWorld();
  try {
    w.addPlayer(await createRuntime(pkg, 1, overrides), { x: 100, y: 100 });
    w.addPlayer(await createRuntime(pkg, 2, overrides), { x: 124, y: 100 });
    return w;
  } catch (e) {
    w.dispose();
    throw e;
  }
}
test("Fighter four abilities execute in QuickJS; charge and cooldown are isolated", async () => {
  for (let slot = 0; slot < 4; slot++) {
    const w = await match({ tickMs: FUNCTIONAL_TICK_MS });
    try {
      let inputs = [emptyInput(), emptyInput()];
      inputs[0].slots[slot] = { pressed: true, held: true, released: false };
      w.step(1 / 60, inputs);
      if (slot === 2) {
        inputs[0].slots[slot] = { pressed: false, held: true, released: false };
        for (let i = 0; i < 45; i++) w.step(1 / 60, inputs);
        assert.match(w.snapshot().slots[1][2].label, /Charge [1-9]/);
        assert.equal(w.snapshot().slots[2][2].label, "Charge");
        inputs[0].slots[slot] = { pressed: false, held: false, released: true };
        w.step(1 / 60, inputs);
      } else {
        inputs[0].slots[slot] = { pressed: false, held: false, released: true };
        for (let i = 0; i < 10; i++) w.step(1 / 60, inputs);
      }
      assert.equal(w.error, null);
      assert.ok(
        w.snapshot().entities.find((e) => e.ownerId === 2).hp < 120,
        "slot " + slot + " damages enemy",
      );
      assert.ok(w.snapshot().slots[1][slot].cooldown > 0);
      assert.equal(w.snapshot().slots[2][slot].cooldown, 0);
    } finally {
      w.dispose();
    }
  }
});
test("QuickJS exposes no browser, Node, or network capabilities", async () => {
  const r = await createRuntime(
    {
      ...pkg,
      code: 'defineCharacter({spawn(){if(typeof window!=="undefined"||typeof process!=="undefined"||typeof fetch!=="undefined"||typeof require!=="undefined")throw Error("capability leak")}})',
    },
    1,
  );
  try {
    assert.doesNotThrow(() =>
      r.call({ kind: "spawn", world: { entities: [], time: 0 } }),
    );
  } finally {
    r.dispose();
  }
});
test("infinite loop interrupts and closes its runtime", async () => {
  const r = await createRuntime(
    { ...pkg, code: "defineCharacter({spawn(){while(true){}}})" },
    1,
  );
  const started = performance.now();
  assert.throws(
    () => r.call({ kind: "spawn", world: { entities: [], time: 0 } }),
    /interrupted/,
  );
  assert.ok(performance.now() - started < 1000);
  assert.throws(() => r.call({}), /closed/);
  r.dispose();
});
test("timer and entity limits fail clearly", async () => {
  const r = await createRuntime(
    {
      ...pkg,
      code: "defineCharacter({spawn(c){for(let i=0;i<257;i++)c.api.after(1,()=>{});}})",
    },
    1,
  );
  assert.throws(
    () => r.call({ kind: "spawn", world: { entities: [], time: 0 } }),
    /Timer budget/,
  );
  r.dispose();
  const w = createWorld();
  for (let i = 0; i < 256; i++) w.spawn({ ownerId: 1 });
  assert.throws(() => w.spawn({ ownerId: 1 }), /Entity budget/);
  w.dispose();
});
test("manifest rejects bad API, slots, numerical fields and paths", () => {
  assert.equal(validateManifest(manifest), manifest);
  for (const change of [
    { apiVersion: 2 },
    { abilities: [] },
    { body: { radius: NaN, maxHp: 1, moveSpeed: 1 } },
    { entry: "../secret.js" },
  ])
    assert.throws(() => validateManifest({ ...manifest, ...change }));
  for (const p of ["../x", "/x", "https://x", "a/../x", "a\\x"])
    assert.equal(safePath(p), false);
  // Malformed shapes give a readable Error, never a TypeError from a property read.
  const readable = (pattern) => (e) =>
    e.constructor === Error && pattern.test(e.message);
  for (const [change, pattern] of [
    [{ id: 5 }, /Invalid manifest identity/],
    [{ id: ["fighter"] }, /Invalid manifest identity/],
    [{ id: null }, /Invalid manifest identity/],
    [
      { abilities: [null, { label: "a" }, { label: "b" }, { label: "c" }] },
      /four labelled/,
    ],
    [
      { abilities: ["Slash", { label: "a" }, { label: "b" }, { label: "c" }] },
      /four labelled/,
    ],
    [{ body: 7 }, /Invalid body/],
    [{ appearance: "body" }, /Invalid appearance/],
    [{ assets: [] }, /Invalid assets/],
    [{ assets: "sprites" }, /Invalid assets/],
    [{ assets: { ...manifest.assets, x: null } }, /Invalid asset entry x/],
    [
      { assets: { ...manifest.assets, x: "sprites/x.png" } },
      /Invalid asset entry x/,
    ],
    [{ assets: { ...manifest.assets, x: [] } }, /Invalid asset entry x/],
    [
      { appearance: { ...manifest.appearance, sprite: "constructor" } },
      /Missing appearance sprite/,
    ],
    [
      { appearance: { ...manifest.appearance, sprite: "__proto__" } },
      /Missing appearance sprite/,
    ],
    [
      { appearance: { ...manifest.appearance, sprite: 5 } },
      /Missing appearance sprite/,
    ],
  ])
    assert.throws(
      () => validateManifest({ ...manifest, ...change }),
      readable(pattern),
      JSON.stringify(change),
    );
  for (const m of [null, undefined, 5, "fighter", [], () => {}])
    assert.throws(
      () => validateManifest(m),
      readable(/Invalid manifest identity/),
      String(m),
    );
});
test("foreign patch from guest stops match, attributes offender and closes both runtimes", async () => {
  const w = createWorld();
  const bad = await createRuntime(
    {
      ...pkg,
      code: `defineCharacter({update(c){const enemy=c.world.entities.find(e=>e.ownerId!==c.ownerId);c.api.patch(enemy.id,{x:1});}})`,
    },
    1,
  );
  const other = await createRuntime(pkg, 2);
  w.addPlayer(bad, { x: 100, y: 100 });
  w.addPlayer(other, { x: 124, y: 100 });
  w.step(1 / 60);
  assert.match(w.error, /fighter P1:.*foreign/);
  assert.equal(
    w.error,
    "fighter P1: Cannot mutate foreign entity",
    "single owner prefix",
  );
  for (const r of [bad, other]) assert.throws(() => r.call({}), /closed/);
  w.dispose();
  const fresh = await match();
  fresh.step(1 / 60);
  assert.equal(fresh.error, null);
  fresh.dispose();
});

async function scriptedWorld(
  first,
  second = "defineCharacter({})",
  overrides = {},
) {
  const w = createWorld();
  try {
    w.addPlayer(await createRuntime({ ...pkg, code: first }, 1, overrides), {
      x: 100,
      y: 100,
    });
    w.addPlayer(await createRuntime({ ...pkg, code: second }, 2, overrides), {
      x: 124,
      y: 100,
    });
    return w;
  } catch (e) {
    w.dispose();
    throw e;
  }
}
test("event storm shares an owner CPU budget across callbacks", async () => {
  const w = await scriptedWorld(
    `defineCharacter({update(c){const e=c.world.entities.find(e=>e.ownerId===2);for(let i=0;i<60;i++)c.api.damage(e.id,0,c.selfId);}})`,
    `defineCharacter({event(){const end=Date.now()+2;while(Date.now()<end){}}})`,
  );
  const started = performance.now();
  w.step(1 / 60);
  const elapsed = performance.now() - started;
  assert.match(w.error, /fighter P2:.*(interrupted|CPU tick budget)/);
  assert.ok(
    elapsed < 100,
    "event storm must not take hundreds of ms: " + elapsed,
  );
  w.dispose();
});
test("configured event limit counts callbacks rather than ignoring override", async () => {
  const w = await scriptedWorld(
    `defineCharacter({update(c){const e=c.world.entities.find(e=>e.ownerId===2);for(let i=0;i<3;i++)c.api.damage(e.id,0,c.selfId);}})`,
    undefined,
    { events: 3 },
  );
  w.step(1 / 60);
  assert.match(w.error, /fighter P2:.*Event budget/);
  w.dispose();
});
test("guest internals are inaccessible and shadowing names cannot bypass timer cap", async () => {
  const probe = await createRuntime(
    {
      ...pkg,
      code: `if(typeof LIMITS!=='undefined'||typeof timers!=='undefined'||typeof commands!=='undefined'||typeof __dispatch!=='undefined')throw Error('bridge leaked');defineCharacter({});`,
    },
    1,
  );
  probe.dispose();
  const r = await createRuntime(
    {
      ...pkg,
      code: `globalThis.LIMITS={timers:1000};globalThis.timers=new Map();globalThis.commands=[];globalThis.__dispatch=()=> '{}';Map.prototype.set=function(){return this};defineCharacter({spawn(c){for(let i=0;i<300;i++)c.api.after(1,()=>{});}});`,
    },
    1,
  );
  assert.throws(
    () =>
      r.call({
        kind: "spawn",
        world: { entities: [], time: 0, obstacles: [] },
      }),
    /Timer budget/,
  );
  assert.throws(() => r.call({}), /closed/);
  r.dispose();
  const fresh = await match();
  fresh.step(1 / 60);
  assert.equal(fresh.error, null);
  fresh.dispose();
});
test("malformed effects fail in world before render with owner attribution", async () => {
  for (const effect of [
    { x: 80, y: 135, radius: -1, duration: 1 },
    { x: 80, y: 135, radius: 1, duration: 1, arc: -1 },
    { x: "80", y: 135, radius: 1, duration: 1 },
    { x: 80, y: 135, radius: 1, duration: 1, color: {} },
    { x: 80, y: 135, radius: 1, duration: 1, extra: true },
  ]) {
    const w = await scriptedWorld(
      "defineCharacter({update(c){c.api.effect(" +
        JSON.stringify(effect) +
        ");}})",
    );
    w.step(1 / 60);
    assert.match(w.error, /fighter P1:.*effect/i);
    assert.equal(w.effects.length, 0);
    assert.throws(() => w.players.get(1).runtime.call({}), /closed/);
    w.dispose();
  }
});
test("Fighter melee is occluded by brick corner but hits without obstruction", async () => {
  for (const blocked of [true, false]) {
    const w = createWorld({
      obstacles: blocked ? [{ x: 112, y: 48, w: 32, h: 64 }] : [],
    });
    w.addPlayer(await createRuntime(pkg, 1), { x: 105, y: 100 });
    w.addPlayer(await createRuntime(pkg, 2), { x: 120, y: 119 });
    const inputs = [emptyInput(), emptyInput()];
    inputs[0].slots[0] = { pressed: true, held: false, released: true };
    w.step(1 / 60, inputs);
    assert.equal(w.error, null);
    assert.equal(
      w.snapshot().entities.find((e) => e.ownerId === 2).hp,
      blocked ? 120 : 105,
    );
    w.dispose();
  }
});

// Task 2: guest scripts report observations through tags on their own body.
// tags are capped at 16 strings of 64 chars, so recorders write short strings.
async function arena(first, second = "defineCharacter({})", options = {}) {
  const {
    p1 = { x: 100, y: 100 },
    p2 = { x: 124, y: 100 },
    ...worldOptions
  } = options;
  const w = createWorld(worldOptions);
  try {
    w.addPlayer(await createRuntime({ ...pkg, code: first }, 1), p1);
    w.addPlayer(await createRuntime({ ...pkg, code: second }, 2), p2);
    return w;
  } catch (e) {
    w.dispose();
    throw e;
  }
}
const body = (w, owner) => w.entities.get(w.players.get(owner).selfId);
const tags = (w, owner = 1) => body(w, owner).tags;
const RECORDER = `let log=[];function note(c,v){log.push(typeof v==='string'?v:JSON.stringify(v));c.api.patch(c.selfId,{tags:log});}`;
// Contact hits are recorded as "kind|entityId|otherId|otherOwnerId|t|px|py|nx|ny" (≤ 64 chars).
const HIT = `function hit(ev){return [ev.kind,ev.entityId,ev.otherId??'',ev.otherOwnerId??'',ev.t,ev.point.x,ev.point.y,ev.normal.x,ev.normal.y].join('|');}`;
const hits = (w, owner = 1) =>
  tags(w, owner).map((s) => {
    const [kind, entityId, otherId, otherOwnerId, t, px, py, nx, ny] =
      s.split("|");
    return {
      kind,
      entityId,
      otherId: otherId || undefined,
      otherOwnerId: otherOwnerId ? +otherOwnerId : undefined,
      t: +t,
      point: { x: +px, y: +py },
      normal: { x: +nx, y: +ny },
    };
  });
test("death callback spawns five countsForDefeat bodies; a turret without the flag does not hold", async () => {
  const w = await arena(
    `defineCharacter({event(c,ev){if(ev.type==='death'&&ev.entityId===c.selfId){for(let i=0;i<5;i++)c.api.spawn({x:50+i*20,y:50,hp:5,countsForDefeat:true});c.api.spawn({x:200,y:50,hp:5});}}})`,
  );
  const p2 = w.players.get(2).selfId;
  w.queueDamage(w.players.get(1).selfId, 1000, p2);
  w.step(1 / 60);
  assert.equal(w.error, null);
  assert.equal(w.result, null);
  const mine = [...w.entities.values()].filter((e) => e.ownerId === 1);
  assert.equal(mine.length, 6);
  assert.equal(mine.filter((e) => e.countsForDefeat).length, 5);
  for (const e of mine.filter((e) => e.countsForDefeat))
    w.queueDamage(e.id, 5, p2);
  w.step(1 / 60);
  assert.equal(w.result, "P2");
  assert.equal(
    [...w.entities.values()].filter((e) => e.ownerId === 1).length,
    1,
  );
  w.dispose();
});
test("damage dealt from a death callback resolves before the verdict (draw)", async () => {
  const w = await arena(
    `defineCharacter({event(c,ev){if(ev.type==='death'&&ev.entityId===c.selfId){const e=c.world.entities.find(e=>e.ownerId===2);c.api.damage(e.id,1000,c.selfId);}}})`,
  );
  w.queueDamage(w.players.get(1).selfId, 1000, w.players.get(2).selfId);
  w.step(1 / 60);
  assert.equal(w.error, null);
  assert.equal(w.result, "draw");
  w.dispose();
});
const PROJECTILE = (spec, onBrick, update = "") =>
  RECORDER +
  HIT +
  `defineCharacter({spawn(c){c.api.spawn(${JSON.stringify(spec)});},update(c){${update}},event(c,ev){if(ev.type==='contact'){note(c,hit(ev));${onBrick}if(ev.kind==='entity')c.api.damage(ev.otherId,50,ev.entityId);}}})`;
test("contact: brick before enemy fires first; destroy on the brick shields the enemy; point/normal numeric", async () => {
  const shot = { x: 120, y: 100, vx: 6000, radius: 2, hp: 1, contact: true };
  const layout = {
    obstacles: [{ x: 150, y: 90, w: 20, h: 20 }],
    p2: { x: 200, y: 100 },
  };
  const w = await arena(
    PROJECTILE(shot, "if(ev.kind==='brick')c.api.destroy(ev.entityId);"),
    undefined,
    layout,
  );
  w.step(1 / 60);
  assert.equal(w.error, null);
  const recorded = hits(w);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].kind, "brick");
  assert.equal(recorded[0].entityId, "1:1");
  assert.ok(Math.abs(recorded[0].t - 0.28) < 1e-9);
  assert.deepEqual(recorded[0].point, { x: 148, y: 100 });
  assert.deepEqual(recorded[0].normal, { x: -1, y: 0 });
  assert.equal(body(w, 2).hp, 120);
  assert.equal(w.entities.has("1:1"), false);
  w.dispose();
  const open = await arena(PROJECTILE(shot, ""), undefined, layout);
  open.step(1 / 60);
  assert.equal(open.error, null);
  const both = hits(open);
  assert.deepEqual(
    both.map((h) => h.kind),
    ["brick", "entity"],
  );
  assert.equal(both[1].otherId, open.players.get(2).selfId);
  assert.equal(both[1].otherOwnerId, 2);
  assert.ok(Math.abs(both[1].t - 0.71) < 1e-9);
  assert.deepEqual(both[1].point, { x: 191, y: 100 });
  assert.deepEqual(both[1].normal, { x: -1, y: 0 });
  assert.equal(body(open, 2).hp, 70);
  assert.equal(open.entities.get("1:1").x, 220);
  open.dispose();
});
test("contact: patching x/y/vx/vy in a callback drops the remaining hits of that tick", async () => {
  const shot = { x: 120, y: 100, vx: 6000, radius: 2, hp: 1, contact: true };
  const w = await arena(
    PROJECTILE(
      shot,
      "if(ev.kind==='brick')c.api.patch(ev.entityId,{vx:-ev.normal.x*100,x:ev.point.x});",
    ),
    undefined,
    { obstacles: [{ x: 150, y: 90, w: 20, h: 20 }], p2: { x: 200, y: 100 } },
  );
  w.step(1 / 60);
  assert.equal(w.error, null);
  assert.deepEqual(
    hits(w).map((h) => h.kind),
    ["brick"],
  );
  assert.equal(body(w, 2).hp, 120);
  assert.equal(w.entities.get("1:1").x, 148);
  w.dispose();
});
test("contact: an entity destroyed during update receives no contact that tick", async () => {
  const w = await arena(
    PROJECTILE(
      { x: 120, y: 100, vx: 6000, radius: 2, hp: 1, contact: true },
      "",
      "c.api.destroy('1:1');",
    ),
    undefined,
    { p2: { x: 200, y: 100 } },
  );
  w.step(1 / 60);
  assert.equal(w.error, null);
  assert.deepEqual(tags(w), []);
  assert.equal(body(w, 2).hp, 120);
  assert.equal(w.entities.has("1:1"), false);
  w.dispose();
});
test("non-solid contact entity crosses the boundary with a bounds event and is not clamped", async () => {
  const w = await arena(
    PROJECTILE(
      { x: 470, y: 100, vx: 1200, radius: 2, hp: 1, contact: true },
      "",
    ),
  );
  w.step(1 / 60);
  assert.equal(w.error, null);
  const [edge] = hits(w);
  assert.equal(edge.kind, "bounds");
  assert.ok(Math.abs(edge.t - 0.4) < 1e-9);
  assert.deepEqual(edge.point, { x: 478, y: 100 });
  assert.deepEqual(edge.normal, { x: -1, y: 0 });
  assert.equal(w.entities.get("1:1").x, 490);
  assert.equal(body(w, 1).width, 16);
  assert.equal(body(w, 1).height, 16);
  w.dispose();
});
test("death reasons: expired, destroyed and damage", async () => {
  const w = await arena(
    RECORDER +
      `let doomed;defineCharacter({spawn(c){c.api.spawn({x:300,y:100,hp:1,lifetime:0.04});doomed=c.api.spawn({x:320,y:100,hp:1});},update(c){if(doomed){c.api.destroy(doomed);doomed=null;}},event(c,ev){if(ev.type==='death')note(c,[ev.entityId,ev.reason,ev.sourceId??null]);}})`,
  );
  const p2 = w.players.get(2).selfId;
  for (let i = 0; i < 3; i++) w.step(1 / 60);
  assert.equal(w.error, null);
  assert.deepEqual(tags(w).map(JSON.parse), [
    ["1:2", "destroyed", null],
    ["1:1", "expired", null],
  ]);
  assert.equal(w.entities.has("1:1"), false);
  // The dying body is removed right after the callback, so P2 reports via a slot label.
  const p2Script = `defineCharacter({event(c,ev){if(ev.type==='death')c.api.slot(0,{label:ev.entityId+' '+ev.reason+' '+ev.sourceId,cooldown:0,active:false});}})`;
  const v = await arena("defineCharacter({})", p2Script);
  v.queueDamage(v.players.get(2).selfId, 1000, v.players.get(1).selfId);
  v.step(1 / 60);
  assert.equal(v.error, null);
  assert.equal(v.result, "P1");
  assert.equal(v.slots[2][0].label, "host:2 damage host:1");
  w.dispose();
  v.dispose();
});
test("damage with a stale sourceId is accepted as unattributed; a live foreign source is rejected", async () => {
  const w = await arena(
    `defineCharacter({spawn(c){const shot=c.api.spawn({x:300,y:100,hp:1,lifetime:0.01});c.api.every(0.02,c2=>{const e=c2.world.entities.find(e=>e.ownerId===2);c2.api.damage(e.id,5,shot);},{entityId:null});}})`,
  );
  // Projectile expires on tick 1; the timer fires on ticks 2 and 4 with its stale id.
  for (let i = 0; i < 4; i++) w.step(1 / 60);
  assert.equal(w.error, null);
  assert.equal(w.entities.has("1:1"), false, "projectile expired");
  assert.equal(body(w, 2).hp, 110, "two stale-source hits landed");
  w.dispose();
  const bad = await arena(
    `defineCharacter({update(c){const e=c.world.entities.find(e=>e.ownerId===2);c.api.damage(e.id,5,e.id);}})`,
  );
  bad.step(1 / 60);
  assert.match(bad.error, /^fighter P1: Foreign damage source$/);
  bad.dispose();
});
test("guest validation: forbidden patch fields, unknown spawn field, NaN/Infinity, sound options", async () => {
  const cases = [
    ["c.api.patch(c.selfId,{ownerId:2})", /Forbidden patch field ownerId/],
    [
      "c.api.patch(c.selfId,{countsForDefeat:false})",
      /Forbidden patch field countsForDefeat/,
    ],
    ["c.api.patch(c.selfId,{hp:1000})", /Forbidden patch field hp/],
    ["c.api.patch(c.selfId,{width:0})", /Invalid size/],
    ["c.api.spawn({x:1,laser:true})", /Invalid spawn field laser/],
    ["c.api.spawn({x:NaN})", /Invalid finite x/],
    ["c.api.spawn({lifetime:Infinity})", /Invalid finite lifetime/],
    ["c.api.patch(c.selfId,{vx:Infinity})", /Invalid finite vx/],
    ["c.api.impulse(c.selfId,{x:NaN,y:0})", /Invalid finite x/],
    ["c.api.raycast({from:{x:NaN,y:0},to:{x:1,y:1}})", /Invalid raycast/],
    ["c.api.raycast({from:{x:0,y:0},to:{x:Infinity,y:1}})", /Invalid raycast/],
    [
      "c.api.raycast({from:{x:0,y:0},to:{x:1,y:1},ignore:'me'})",
      /Invalid raycast/,
    ],
    ["c.api.sound('hit',{pan:1})", /Invalid sound option pan/],
    ["c.api.sound('hit',{volume:2})", /Invalid sound volume/],
    ["c.api.after(1,()=>{},{entityId:5})", /Invalid timer options/],
    ["c.api.sequence([{jump:1}])", /Invalid sequence/],
    ["c.api.sequence(new Array(65).fill({wait:1}))", /Invalid sequence/],
    ["c.api.every(0,()=>{})", /Invalid timer/],
    ["c.api.after(-1,()=>{})", /Invalid timer/],
    ["c.api.patch(c.selfId,{tags:'bolt'})", /Invalid tags/],
    ["c.api.patch(c.selfId,{tags:[1]})", /Invalid tags/],
    ["c.api.patch(c.selfId,{tags:new Array(17).fill('a')})", /Invalid tags/],
    ["c.api.patch(c.selfId,{tags:['x'.repeat(65)]})", /Invalid tags/],
    ["c.api.spawn({tags:['x'.repeat(65)]})", /Invalid tags/],
    ["c.api.spawn({tags:null})", /Invalid tags/],
  ];
  for (const [call, pattern] of cases) {
    const w = await arena(`defineCharacter({update(c){${call}}})`);
    w.step(1 / 60);
    assert.match(w.error ?? "", new RegExp("^fighter P1: .*" + pattern.source));
    assert.doesNotMatch(
      w.error,
      /fighter P1:.*fighter P1:/,
      "no double prefix",
    );
    w.dispose();
  }
  const ok = await arena(
    `let stale;defineCharacter({spawn(c){stale=c.api.spawn({x:1,y:1});},update(c){if(c.world.time<0.02){c.api.destroy(stale);return;}c.api.patch(stale,{x:5});c.api.destroy(stale);c.api.impulse(stale,{x:1,y:1});c.api.heal(stale,1);c.api.damage(stale,1);c.api.sound('hit',{volume:0.25});}})`,
  );
  for (let i = 0; i < 3; i++) ok.step(1 / 60);
  assert.equal(ok.error, null);
  assert.equal(ok.entities.has("1:1"), false);
  assert.deepEqual(ok.sounds, [{ ownerId: 1, asset: "hit", volume: 0.25 }]);
  ok.dispose();
});
test("raycast sorts hits by t and honours ignore", async () => {
  const w = await arena(
    `defineCharacter({update(c){const cast=ignore=>c.api.raycast({from:{x:100,y:100},to:{x:300,y:100},ignore}).map(h=>[h.kind,h.id??null,h.ownerId??null,+h.t.toFixed(3)]);c.api.patch(c.selfId,{tags:[...cast([]).map(h=>JSON.stringify(h)),'|',...cast([c.selfId]).map(h=>JSON.stringify(h))]});}})`,
    undefined,
    { obstacles: [{ x: 150, y: 90, w: 20, h: 20 }], p2: { x: 200, y: 100 } },
  );
  w.step(1 / 60);
  assert.equal(w.error, null);
  const cut = tags(w).indexOf("|");
  const all = tags(w).slice(0, cut).map(JSON.parse),
    ignored = tags(w)
      .slice(cut + 1)
      .map(JSON.parse);
  assert.deepEqual(all, [
    ["entity", "host:1", 1, 0],
    ["brick", null, null, 0.25],
    ["entity", "host:2", 2, 0.465],
  ]);
  assert.deepEqual(ignored, [
    ["brick", null, null, 0.25],
    ["entity", "host:2", 2, 0.465],
  ]);
  w.dispose();
});
test("timers: entity-bound timer dies with its entity, null scope and context default fire", async () => {
  const w = await arena(
    RECORDER +
      `let id;defineCharacter({spawn(c){id=c.api.spawn({x:300,y:100,hp:1});c.api.after(0.05,()=>note(c,'bound'),{entityId:id});c.api.after(0.05,()=>note(c,'null'),{entityId:null});c.api.after(0.05,c2=>note(c,'self:'+c2.entityId));},update(c){if(id&&c.world.time>0.02){c.api.destroy(id);id=null;}},event(c,ev){if(ev.type==='death')c.api.after(0.02,()=>note(c,'death-scope'));}})`,
  );
  for (let i = 0; i < 6; i++) w.step(1 / 60);
  assert.equal(w.error, null);
  assert.deepEqual(tags(w), ["null", "self:host:1", "death-scope"]);
  w.dispose();
});
test("timers: after(0) fires next tick; a callback cancelling a later same-tick timer suppresses it", async () => {
  const w = await arena(
    RECORDER +
      `let b;defineCharacter({spawn(c){c.api.after(0,()=>note(c,'zero'));c.api.after(0.02,()=>{note(c,'a');c.api.cancel(b);});b=c.api.after(0.02,()=>note(c,'b'));c.api.every(0.02,()=>note(c,'tick'));}})`,
  );
  assert.deepEqual(tags(w), []);
  w.step(1 / 60);
  assert.deepEqual(tags(w), ["zero"]);
  w.step(1 / 60);
  assert.equal(w.error, null);
  assert.deepEqual(tags(w), ["zero", "a", "tick"]);
  w.dispose();
});
test("sequence: immediate steps run now, waits defer, cancel stops remaining steps, sound carries volume", async () => {
  const w = await arena(
    RECORDER +
      `let s3;defineCharacter({spawn(c){c.api.sequence([{run:()=>note(c,'a')},{wait:0.05},{run:c2=>note(c,'b:'+c2.entityId)},{sound:'hit',options:{volume:0.5}},{shake:{amount:1,seconds:0.1}},{wait:0.05},{run:()=>note(c,'c')}]);note(c,'after');const s2=c.api.sequence([{wait:0.02},{run:()=>note(c,'x')}]);c.api.cancel(s2);s3=c.api.sequence([{wait:0.02},{run:()=>{note(c,'y');c.api.cancel(s3);}},{run:()=>note(c,'z')}],{entityId:null});}})`,
  );
  assert.deepEqual(tags(w), ["a", "after"]);
  const sounds = [];
  for (let i = 0; i < 6; i++) {
    w.step(1 / 60);
    sounds.push(...w.sounds);
  }
  assert.equal(w.error, null);
  assert.deepEqual(tags(w), ["a", "after", "y", "b:host:1"]);
  assert.deepEqual(sounds, [{ ownerId: 1, asset: "hit", volume: 0.5 }]);
  assert.ok(w.shake.amount === 1);
  for (let i = 0; i < 6; i++) w.step(1 / 60);
  assert.deepEqual(tags(w), ["a", "after", "y", "b:host:1", "c"]);
  w.dispose();
});
test("world.effects is pruned in step once an effect expires or its attach dies", async () => {
  const w = await arena(
    `let id;defineCharacter({spawn(c){id=c.api.spawn({x:300,y:100,hp:1});c.api.effect({x:1,y:1,radius:2,duration:0.01});c.api.effect({attach:{id},radius:2,duration:5});c.api.effect({x:1,y:1,radius:2,duration:5});},update(c){if(id&&c.world.time>0.02){c.api.destroy(id);id=null;}}})`,
  );
  assert.equal(w.effects.length, 3);
  w.step(1 / 60);
  assert.equal(w.effects.length, 2, "expired ring dropped");
  w.step(1 / 60);
  assert.equal(w.error, null);
  assert.equal(w.entities.has("1:1"), false);
  assert.equal(w.effects.length, 1, "attached effect dropped with its entity");
  w.dispose();
});
test("dispose then a new match carries no old callbacks, effects or sounds", async () => {
  const w = await arena(
    `defineCharacter({spawn(c){c.api.every(0.01,()=>{c.api.effect({x:1,y:1,radius:2,duration:5});c.api.sound('hit');});}})`,
  );
  w.step(1 / 60);
  assert.ok(w.effects.length > 0 && w.sounds.length > 0);
  const old = w.players.get(1).runtime;
  w.dispose();
  assert.deepEqual([w.effects, w.sounds, w.entities.size], [[], [], 0]);
  assert.throws(() => old.call({}), /closed/);
  const fresh = await match();
  for (let i = 0; i < 3; i++) fresh.step(1 / 60);
  assert.equal(fresh.error, null);
  assert.deepEqual([fresh.effects, fresh.sounds], [[], []]);
  fresh.dispose();
});
