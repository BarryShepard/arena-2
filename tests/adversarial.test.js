// Task 3 adversarial cases: every hostile mod must end in a *bounded* failure —
// an attributed, readable world.error (or an attributed throw at load/spawn time),
// both runtimes closed, and a fresh fighter/fighter match starting afterwards.
// This is not a sandbox security audit; it only proves bounded failure for the
// listed cases. Cases already covered by tests/mods.test.js are referenced, not
// duplicated: infinite loop in spawn, timer budget at spawn, foreign patch,
// event storm CPU sharing, configured event limit, malformed effects, guest
// internals/shadowing, foreign live damage source, sequence with 65 steps,
// forbidden patch fields (ownerId/countsForDefeat/hp), NaN/Infinity in spawn/patch.
import test from "node:test";
import assert from "node:assert/strict";
import {
  cp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, DEFAULT_LIMITS } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";
import { validateManifest } from "../src/mods/package.js";
import { readPackage } from "../vite.config.js";

const charactersDir = new URL("../characters/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("fighter/manifest.json", charactersDir), "utf8"),
);
const code = await readFile(new URL("fighter/main.js", charactersDir), "utf8");
const pkg = { manifest, code };
const D = (body) => `defineCharacter({${body}})`;
const ENEMY = "c.world.entities.find(e=>e.ownerId!==c.ownerId)";

// Both players run the given scripts (P2 defaults to the real fighter).
async function arena(first, second = code, overrides = {}) {
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
// Steps until the match errors (or `ticks` run out); returns wall time of the last step.
function stepUntilError(w, ticks = 1) {
  let elapsed = 0;
  for (let i = 0; i < ticks && !w.error; i++) {
    const t0 = performance.now();
    w.step(1 / 60);
    elapsed = performance.now() - t0;
  }
  return elapsed;
}
function assertClosed(w) {
  for (const [owner, p] of w.players)
    assert.throws(
      () => p.runtime.call({}),
      /closed/,
      `P${owner} runtime closed`,
    );
}
async function assertFreshMatchWorks(ticks = 3) {
  const fresh = await arena(code);
  try {
    for (let i = 0; i < ticks; i++) fresh.step(1 / 60);
    assert.equal(fresh.error, null, "fresh fighter/fighter match runs");
    assert.equal(fresh.result, null);
  } finally {
    fresh.dispose();
  }
}
// The standard bounded-failure contract for a hostile P1 script.
async function expectBounded(
  script,
  pattern,
  { ticks = 1, maxMs = 1000, second, overrides } = {},
) {
  const w = await arena(script, second, overrides);
  try {
    const elapsed = stepUntilError(w, ticks);
    assert.ok(elapsed < maxMs, `step bounded: ${elapsed.toFixed(1)} ms`);
    assert.match(w.error ?? "", pattern);
    assert.doesNotMatch(w.error, /P[12]:.*P[12]:/, "single owner prefix");
    assertClosed(w);
    assert.equal(w.result, null, "no verdict after failure");
    w.step(1 / 60); // a failed match stays failed and does not throw
    assert.match(w.error, pattern);
    return w.error;
  } finally {
    w.dispose();
  }
}

test("1. while(true) in update: interrupted through world.step, both runtimes closed, next match starts", async () => {
  await expectBounded(
    D("update(){while(true){}}"),
    /^fighter P1: interrupted$/,
  );
  await assertFreshMatchWorks();
});

test("2. excessive allocation hits the 16 MiB heap or the CPU interrupt, never the host", async () => {
  const cases = [
    ["update(){new Uint8Array(64*1024*1024)}", /^fighter P1: out of memory$/],
    ["update(){new Array(1e7).fill(0)}", /^fighter P1: out of memory$/],
    ["update(){'x'.repeat(2**27)}", /^fighter P1: out of memory$/],
    [
      "update(){JSON.parse('['+'1,'.repeat(3e6)+'1]')}",
      /^fighter P1: out of memory$/,
    ],
    // Growth loops are stopped by whichever budget trips first.
    [
      "update(){const a=[];while(true)a.push('x'.repeat(4096));}",
      /^fighter P1: (out of memory|interrupted)$/,
    ],
    [
      "update(){let s='x';while(true)s+=s;}",
      /^fighter P1: (out of memory|string too long|interrupted)$/,
    ],
  ];
  for (const [body, pattern] of cases) await expectBounded(D(body), pattern);
  // Allocation at load time fails createRuntime with the same attribution.
  await assert.rejects(
    createRuntime(
      {
        ...pkg,
        code: "const a=new Uint8Array(64*1024*1024);defineCharacter({})",
      },
      1,
    ),
    { message: /^fighter P1: out of memory$/ },
  );
  await assertFreshMatchWorks();
});

test("3. infinite recursion is a clean attributed 'stack overflow' at the default stack limit and below", async () => {
  // DEFAULT_LIMITS.stack must stay small enough for QuickJS's own check to fire
  // before the native V8 stack overflows (see test 3b and the comment in runtime.js).
  assert.ok(DEFAULT_LIMITS.stack <= 128 * 1024, "stack limit ≤ 128 KiB");
  const overrides = { stack: 64 * 1024 };
  await expectBounded(
    D("update(){function f(){return f()+1}f()}"),
    /^fighter P1: stack overflow$/,
    { overrides },
  );
  // Recursion the guest catches itself is not an error at all with this limit.
  const w = await arena(
    D(
      "update(c){let d=0;function f(){d++;f()}try{f()}catch(e){}c.api.patch(c.selfId,{tags:[String(d>100)]});}",
    ),
    code,
    overrides,
  );
  try {
    w.step(1 / 60);
    assert.equal(w.error, null);
    assert.deepEqual(w.entities.get(w.players.get(1).selfId).tags, ["true"]);
  } finally {
    w.dispose();
  }
  await assert.rejects(
    createRuntime(
      { ...pkg, code: "function f(){return f()+1}f();defineCharacter({})" },
      1,
      overrides,
    ),
    { message: /^fighter P1: stack overflow$/ },
  );
  await assertFreshMatchWorks();
});

test("4. spawn flood: 300 in one update and 200 per tick both stop at the entity budget", async () => {
  await expectBounded(
    D("update(c){for(let i=0;i<300;i++)c.api.spawn({x:1,y:1});}"),
    /^fighter P1: Entity budget exceeded$/,
  );
  const w = await arena(
    D("update(c){for(let i=0;i<200;i++)c.api.spawn({x:1,y:1,hp:1});}"),
  );
  try {
    w.step(1 / 60);
    assert.equal(w.error, null, "first 200 fit under the 256 budget");
    assert.equal(
      [...w.entities.values()].filter((e) => e.ownerId === 1).length,
      201,
    );
    w.step(1 / 60);
    assert.match(w.error, /^fighter P1: Entity budget exceeded$/);
    assertClosed(w);
    assert.ok(
      [...w.entities.values()].filter((e) => e.ownerId === 1).length <=
        DEFAULT_LIMITS.entities,
    );
  } finally {
    w.dispose();
  }
  await assertFreshMatchWorks();
});

test("5. timer recursion (exponential after()), sync sequence recursion and self-damage event recursion are bounded", async () => {
  // 1 → 2 → 4 … timers per tick; crosses 256 on the 9th tick.
  const w = await arena(
    D(
      "spawn(c){const f=()=>{c.api.after(0,f);c.api.after(0,f);};c.api.after(0,f);}",
    ),
  );
  try {
    const elapsed = stepUntilError(w, 20);
    assert.ok(elapsed < 1000);
    assert.match(w.error, /^fighter P1: Timer budget exceeded$/);
    assert.ok(w.time < 20 / 60, "failed within the first ticks");
    assertClosed(w);
  } finally {
    w.dispose();
  }
  // Synchronous re-entrancy through sequence run steps at spawn time: addPlayer
  // throws the attributed error (the caller — main.js — disposes and shows it).
  // Each nested sequence level costs ~850 B of guest C stack, so at
  // DEFAULT_LIMITS.stack (128 KiB) the stack cap (~150 levels) fires before the
  // 256-timer cap; either way the failure is bounded and attributed to P1.
  const sync = createWorld();
  try {
    const r = await createRuntime(
      {
        ...pkg,
        code: D("spawn(c){const f=()=>c.api.sequence([{run:f}]);f();}"),
      },
      1,
    );
    assert.throws(() => sync.addPlayer(r, { x: 100, y: 100 }), {
      message: /^fighter P1: (Timer budget exceeded|stack overflow)$/,
    });
    assert.throws(() => r.call({}), /closed/);
  } finally {
    sync.dispose();
  }
  // Damage to self from beforeHit/damageReceived forever: stopped by the owner's
  // CPU budget or the event budget, attributed to the recursing owner.
  await expectBounded(
    D(
      `event(c,ev){if(ev.type==='beforeHit'||ev.type==='damageReceived')c.api.damage(c.selfId,1,c.selfId);},update(c){if(c.world.time<0.02)c.api.damage(c.selfId,1,c.selfId);}`,
    ),
    /^fighter P1: (CPU tick budget exceeded|interrupted|Event budget exceeded|Queue event budget exceeded)$/,
  );
  // Ping-pong between two mods: whoever runs out of CPU first is named, never the host.
  const pingpong = D(
    `event(c,ev){if(ev.type==='damageReceived'&&ev.sourceId)c.api.damage(ev.sourceId,0,c.selfId);},update(c){if(c.world.time<0.02)c.api.damage(${ENEMY}.id,0,c.selfId);}`,
  );
  await expectBounded(
    pingpong,
    /^fighter P[12]: (CPU tick budget exceeded|interrupted|Event budget exceeded)$/,
    { second: pingpong, maxMs: 200 },
  );
  await assertFreshMatchWorks();
});

test("6. sequence flood: 300 sequences in one update stop at the timer budget", async () => {
  // A sequence with 65 steps → 'Invalid sequence' is covered in tests/mods.test.js.
  await expectBounded(
    D("update(c){for(let i=0;i<300;i++)c.api.sequence([{wait:1}]);}"),
    /^fighter P1: Timer budget exceeded$/,
  );
  await assertFreshMatchWorks();
});

test("7. NaN, Infinity and negative damage are rejected with attribution before reaching the queue", async () => {
  await expectBounded(
    D(`update(c){c.api.damage(${ENEMY}.id,NaN);}`),
    /^fighter P1: Invalid finite amount$/,
  );
  await expectBounded(
    D(`update(c){c.api.damage(${ENEMY}.id,Infinity,c.selfId);}`),
    /^fighter P1: Invalid finite amount$/,
  );
  await expectBounded(
    D(`update(c){c.api.damage(${ENEMY}.id,-5);}`),
    /^fighter P1: Negative damage$/,
  );
  await expectBounded(
    D(`update(c){c.api.heal(c.selfId,NaN);}`),
    /^fighter P1: Invalid finite amount$/,
  );
  await assertFreshMatchWorks();
});

test("8. cross-owner destroy/heal, spawn with ownerId and forbidden patch fields fail with attribution", async () => {
  // Foreign patch, foreign live damage source and patch of ownerId/countsForDefeat/hp
  // are covered in tests/mods.test.js. impulse on a foreign body is allowed by design (knockback).
  await expectBounded(
    D(`update(c){c.api.destroy(${ENEMY}.id);}`),
    /^fighter P1: Cannot mutate foreign entity$/,
  );
  await expectBounded(
    D(`update(c){c.api.heal(${ENEMY}.id,50);}`),
    /^fighter P1: Cannot mutate foreign entity$/,
  );
  await expectBounded(
    D("update(c){c.api.spawn({ownerId:2,x:1,y:1});}"),
    /^fighter P1: Invalid entity ownership$/,
  );
  await expectBounded(
    D("update(c){c.api.spawn({ownerId:1,x:1,y:1});}"),
    /^fighter P1: Invalid entity ownership$/,
  );
  await expectBounded(
    D("update(c){c.api.patch(c.selfId,{maxHp:9999});}"),
    /^fighter P1: Forbidden patch field maxHp$/,
  );
  await expectBounded(
    D("update(c){c.api.patch(c.selfId,{id:'2:1'});}"),
    /^fighter P1: Forbidden patch field id$/,
  );
  // The victim is untouched by any of the above.
  const w = await arena(
    D(`update(c){c.api.heal(${ENEMY}.id,50);c.api.destroy(${ENEMY}.id);}`),
  );
  try {
    w.step(1 / 60);
    assert.match(w.error, /^fighter P1: /);
    const enemy = w.entities.get(w.players.get(2).selfId);
    assert.equal(enemy.hp, 120);
    assert.equal(w.queue.length, 0, "no kill queued for the victim");
  } finally {
    w.dispose();
  }
  await assertFreshMatchWorks();
});

test("9. command, effect and JSON floods stop at their budgets with attribution", async () => {
  const slotFlood = (n) =>
    D(
      `update(c){for(let i=0;i<${n};i++)c.api.slot(0,{label:'a',cooldown:0,active:false});}`,
    );
  await expectBounded(slotFlood(1100), /^fighter P1: Command budget exceeded$/);
  // Doubling every push through Array.prototype cannot slip past the host-side count.
  await expectBounded(
    "const o=Array.prototype.push;Array.prototype.push=function(x){o.call(this,x);return o.call(this,x)};" +
      slotFlood(600),
    /^fighter P1: Command budget exceeded$/,
  );
  await expectBounded(
    D(
      "update(c){for(let i=0;i<300;i++)c.api.effect({x:1,y:1,radius:1,duration:1});}",
    ),
    /^fighter P1: Effect budget exceeded$/,
  );
  await expectBounded(
    D(
      "update(c){for(let i=0;i<200;i++)c.api.effect({x:1,y:1,radius:1,duration:1});}",
    ),
    /^fighter P1: Effect budget exceeded$/,
    { ticks: 3 },
  );
  await expectBounded(
    D("update(c){c.api.patch(c.selfId,{tags:new Array(17).fill('a')});}"),
    /^fighter P1: Invalid tags$/,
  );
  await expectBounded(
    D("update(c){c.api.patch(c.selfId,{sprite:'x'.repeat(41)});}"),
    /^fighter P1: Invalid sprite$/,
  );
  await expectBounded(
    D(
      "update(c){c.api.slot(0,{label:'x'.repeat(41),cooldown:0,active:false});}",
    ),
    /^fighter P1: Invalid slot$/,
  );
  // Oversized strings never reach the host validators: the guest-side JSON cap fires first.
  await expectBounded(
    D("update(c){c.api.spawn({sprite:'x'.repeat(2e6)});}"),
    /^fighter P1: Output JSON budget exceeded$/,
  );
  await expectBounded(
    D(
      "event(){return {x:'a'.repeat(2e6)};},update(c){c.api.damage(c.selfId,1);}",
    ),
    /^fighter P1: Output JSON budget exceeded$/,
  );
  await assertFreshMatchWorks();
});

test("10. contact flood and raycast/queryCircle floods are charged to the flooder, not the victim, within 100 ms", async () => {
  const flood = D(
    "spawn(c){for(let i=0;i<200;i++)c.api.spawn({x:110,y:100,vx:60,radius:3,hp:1,contact:true});}",
  );
  for (const flooder of [1, 2]) {
    const w = await arena(
      flooder === 1 ? flood : code,
      flooder === 2 ? flood : code,
    );
    try {
      const elapsed = stepUntilError(w, 1);
      assert.ok(
        elapsed < 100,
        `contact flood bounded: ${elapsed.toFixed(1)} ms`,
      );
      assert.match(
        w.error,
        new RegExp(
          `^fighter P${flooder}: (CPU tick budget exceeded|interrupted|Event budget exceeded)$`,
        ),
      );
      assertClosed(w);
    } finally {
      w.dispose();
    }
  }
  const pattern = /^fighter P1: (interrupted|CPU tick budget exceeded)$/;
  await expectBounded(
    D(
      "update(c){for(let i=0;i<1e6;i++)c.api.raycast({from:{x:0,y:0},to:{x:480,y:270}});}",
    ),
    pattern,
    { maxMs: 100 },
  );
  await expectBounded(
    D(
      "update(c){for(let i=0;i<1e6;i++)c.api.queryCircle({x:0,y:0,radius:1e4});}",
    ),
    pattern,
    { maxMs: 100 },
  );
  await expectBounded(
    D(
      `update(c){for(let i=0;i<1e6;i++)c.api.lineOfSight(c.api.entity(c.selfId),${ENEMY});}`,
    ),
    pattern,
    { maxMs: 100 },
  );
  await assertFreshMatchWorks();
});

test("11. package level: traversal, absolute/URL paths, missing or fake PNG, escaping symlinks are rejected; fighter still loads", async () => {
  const root = path.resolve("characters");
  assert.equal(
    path.resolve(fileURLToPath(charactersDir)),
    root,
    "npm test runs from the project root",
  );
  const made = [];
  const make = async (suffix, mutate, files = {}) => {
    const id = `zz_adv_${process.pid}_${suffix}`,
      dir = path.join(root, id);
    made.push(dir);
    await cp(path.join(root, "fighter"), dir, { recursive: true });
    const m = structuredClone(manifest);
    m.id = id;
    m.name = "Adversarial " + suffix;
    mutate?.(m);
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(m));
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(dir, rel);
      await rm(target, { force: true });
      if (content === null) continue;
      if (typeof content === "object" && !Buffer.isBuffer(content))
        await symlink(content.link, target);
      else await writeFile(target, content);
    }
    return id;
  };
  try {
    const cases = [
      [
        "entry ../x",
        await make("entry", (m) => (m.entry = "../x.js")),
        /Invalid manifest identity\/API\/entry/,
      ],
      [
        "asset ..",
        await make(
          "assetdots",
          (m) => (m.assets.body.path = "../fighter/sprites/body.png"),
        ),
        /Invalid asset path\/type/,
      ],
      [
        "asset absolute",
        await make("assetabs", (m) => (m.assets.body.path = "/etc/hosts")),
        /Invalid asset path\/type/,
      ],
      [
        "asset URL",
        await make(
          "asseturl",
          (m) => (m.assets.body.path = "https://example.com/x.png"),
        ),
        /Invalid asset path\/type/,
      ],
      [
        "missing PNG",
        await make("missing", null, { "sprites/body.png": null }),
        /ENOENT.*body\.png/,
      ],
      [
        "text file as PNG",
        await make("textpng", null, { "sprites/body.png": "not a png at all" }),
        /Invalid PNG/,
      ],
      [
        "symlink sprite → /etc/hosts",
        await make("sym", null, { "sprites/body.png": { link: "/etc/hosts" } }),
        /Symlink escapes package/,
      ],
      [
        "symlink entry → /etc/hosts",
        await make("symentry", null, { "main.js": { link: "/etc/hosts" } }),
        /Symlink escapes package/,
      ],
      [
        "bad WAV",
        await make("badwav", null, { "sounds/hit.wav": "RIFFxxxxNOPE" }),
        /Invalid WAV/,
      ],
      [
        "script > 256 KiB",
        await make("huge", null, {
          "main.js": "//" + "x".repeat(300 * 1024) + "\ndefineCharacter({})",
        }),
        /Script exceeds 256 KiB/,
      ],
      [
        "id ≠ folder",
        await make("idmis", (m) => (m.id = "fighter")),
        /ID does not match folder/,
      ],
    ];
    // A package folder that is itself a symlink out of characters/.
    const dirLink = path.join(root, `zz_adv_${process.pid}_dirlink`);
    made.push(dirLink);
    await symlink("/etc", dirLink);
    cases.push([
      "package dir symlink → /etc",
      path.basename(dirLink),
      /Package escape/,
    ]);
    cases.push(["id traversal", "../fighter", /Invalid package ID/]);
    cases.push([
      "id traversal (nested)",
      "zz/../fighter",
      /Invalid package ID/,
    ]);
    cases.push(["id absent", `zz_adv_${process.pid}_nope`, /ENOENT/]);
    for (const [label, id, pattern] of cases)
      await assert.rejects(readPackage(id), pattern, label);
    // A symlink that stays inside the package is fine.
    const inside = await make("symin", null, {
      "sprites/alt.png": await readFile(
        path.join(root, "fighter/sprites/body.png"),
      ),
      "sprites/body.png": { link: "alt.png" },
    });
    assert.equal((await readPackage(inside)).manifest.id, inside);
    const good = await readPackage("fighter");
    assert.equal(good.manifest.id, "fighter");
    assert.ok(good.assets.body.startsWith("data:image/png;base64,"));
    assert.ok(good.assets.hit.startsWith("data:audio/wav;base64,"));
    // The runtime accepts what readPackage produced.
    const r = await createRuntime(good, 1);
    r.dispose();
  } finally {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
  }
  assert.deepEqual(
    (await readdir(root)).filter((n) => n.startsWith("zz_adv_")),
    [],
    "temporary packages removed",
  );
  for (const entry of [
    "../x",
    "/abs/main.js",
    "https://x/main.js",
    "a\\b.js",
    "./main.js",
    "main.js/",
  ])
    assert.throws(
      () => validateManifest({ ...manifest, entry }),
      /Invalid manifest identity\/API\/entry/,
      entry,
    );
  for (const p of ["../a.png", "/a.png", "https://x/a.png", "sprites/../a.png"])
    assert.throws(
      () =>
        validateManifest({
          ...manifest,
          assets: {
            ...manifest.assets,
            body: { ...manifest.assets.body, path: p },
          },
        }),
      /Invalid asset path\/type/,
      p,
    );
});

test("12. exceptions in callbacks and broken definitions are attributed; spawn-time failures throw from addPlayer", async () => {
  await expectBounded(
    D(
      "event(){throw Error('boom event')},update(c){c.api.damage(c.selfId,1);}",
    ),
    /^fighter P1: boom event$/,
  );
  await expectBounded(
    D(
      "event(c,ev){if(ev.type==='death')throw Error('boom death')},update(c){c.api.damage(c.selfId,1000);}",
    ),
    /^fighter P1: boom death$/,
  );
  const pressed = await arena(D("ability(){throw Error('boom ability')}"));
  try {
    const input = emptyInput();
    input.slots[0] = { pressed: true, held: true, released: false };
    pressed.step(1 / 60, [input, emptyInput()]);
    assert.match(pressed.error, /^fighter P1: boom ability$/);
    assertClosed(pressed);
  } finally {
    pressed.dispose();
  }
  await expectBounded(
    D("update(){throw new TypeError('boom update')}"),
    /^fighter P1: boom update$/,
  );
  await expectBounded(
    D("update(){null.x}"),
    /^fighter P1: cannot read property 'x' of null$/,
  );
  // Spawn callback failures surface as an attributed throw from addPlayer (world.error stays
  // null); main.js catches it, disposes the runtime and shows the message.
  const w = createWorld();
  try {
    const r = await createRuntime(
      { ...pkg, code: D("spawn(){throw Error('boom spawn')}") },
      1,
    );
    assert.throws(() => w.addPlayer(r, { x: 100, y: 100 }), {
      message: /^fighter P1: boom spawn$/,
    });
    assert.throws(() => r.call({}), /closed/);
    assert.equal(w.error, null);
    const notFn = await createRuntime(
      { ...pkg, code: "defineCharacter({spawn:5})" },
      1,
    );
    assert.throws(() => w.addPlayer(notFn, { x: 100, y: 100 }), {
      message: /^fighter P1: not a function$/,
    });
    assert.throws(() => notFn.call({}), /closed/);
  } finally {
    w.dispose();
  }
  for (const [source, pattern] of [
    ["1+1", /^fighter P1: Missing defineCharacter$/],
    ["defineCharacter(null)", /^fighter P1: Missing defineCharacter$/],
    [
      "defineCharacter({});defineCharacter({})",
      /^fighter P1: Character already defined$/,
    ],
    ["throw Error('top level')", /^fighter P1: top level$/],
    [
      "this is not javascript",
      /^fighter P1: .*(unexpected|expecting|SyntaxError)/i,
    ],
  ])
    await assert.rejects(
      createRuntime({ ...pkg, code: source }, 1),
      { message: pattern },
      source,
    );
  await assertFreshMatchWorks();
});

test("12b. beforeHit garbage (string, object, negative, Infinity/NaN amount) is rejected with the victim's attribution", async () => {
  // Validation runs inside invoke → runtime.withBudget of the entity's owner, so
  // the prefix names the mod that produced the garbage (P1 hitting itself here).
  const garbage = (ret) =>
    D(`event(c,ev){if(ev.type==='beforeHit')return ${ret};}`);
  for (const [ret, pattern] of [
    ["{amount:'x'}", /^fighter P1: Invalid finite hit$/],
    ["{amount:{}}", /^fighter P1: Invalid finite hit$/],
    ["{amount:-5}", /^fighter P1: Negative hit$/],
    // Guest-side finite check on the response: Infinity/NaN must not turn into
    // JSON null and silently fall back to the original amount.
    ["{amount:Infinity}", /^fighter P1: Invalid finite amount$/],
    ["{amount:NaN}", /^fighter P1: Invalid finite amount$/],
    ["{nested:{deep:NaN}}", /^fighter P1: Invalid finite deep$/],
  ])
    await expectBounded(
      D(
        `event(c,ev){if(ev.type==='beforeHit')return ${ret};},update(c){if(c.world.time<0.02)c.api.damage(c.selfId,10);}`,
      ),
      pattern,
    );
  // The victim (P2) is blamed when P1 legitimately hits it and P2's beforeHit misbehaves.
  await expectBounded(
    D(`update(c){if(c.world.time<0.02)c.api.damage(${ENEMY}.id,10);}`),
    /^fighter P2: Negative hit$/,
    { second: garbage("{amount:-1}") },
  );
  // Legitimate overrides still work: cancel, explicit amount, null amount (= keep), non-object.
  for (const [ret, hp] of [
    ["{cancel:true}", 120],
    ["{amount:3}", 117],
    ["{amount:null}", 110],
    ["{amount:undefined}", 110],
    ["5", 110],
    ["undefined", 110],
  ]) {
    const w = await arena(
      D(
        `event(c,ev){if(ev.type==='beforeHit')return ${ret};},update(c){if(c.world.time<0.02)c.api.damage(c.selfId,10);}`,
      ),
    );
    try {
      w.step(1 / 60);
      assert.equal(w.error, null, ret);
      assert.equal(w.entities.get(w.players.get(1).selfId).hp, hp, ret);
    } finally {
      w.dispose();
    }
  }
  await assertFreshMatchWorks();
});

test("12c. thrown undefined/Symbol/empty objects get a reason; huge messages are clipped to 512 chars", async () => {
  await expectBounded(
    D("update(){throw undefined}"),
    /^fighter P1: Unknown guest error$/,
  );
  await expectBounded(
    D("update(){throw Symbol('s')}"),
    /^fighter P1: Unknown guest error$/,
  );
  await expectBounded(D("update(){throw null}"), /^fighter P1: null$/);
  await expectBounded(D("update(){throw 5}"), /^fighter P1: 5$/);
  await expectBounded(
    D("update(){throw {message:''}}"),
    /^fighter P1: \{"message":""\}$/,
  );
  const long = await expectBounded(
    D("update(){throw {message:'m'.repeat(1e6)}}"),
    /^fighter P1: m{512}…$/,
  );
  assert.ok(long.length < 600, "world.error bounded");
  await expectBounded(
    D("update(){throw Error('e'.repeat(1e6))}"),
    /^fighter P1: e{512}…$/,
  );
  await expectBounded(
    D("update(){throw {a:'x'.repeat(1e6)}}"),
    /^fighter P1: \{"a":"x{50}/,
  );
  // Load-time throws are clipped the same way.
  await assert.rejects(
    createRuntime({ ...pkg, code: "throw {message:'q'.repeat(1e5)}" }, 1),
    { message: /^fighter P1: q{512}…$/ },
  );
  await assert.rejects(createRuntime({ ...pkg, code: "throw undefined" }, 1), {
    message: /^fighter P1: Unknown guest error$/,
  });
  await assertFreshMatchWorks();
});

test("9b. the command budget is per owner per tick: 1024 from P1 never blames P2; 1025 across P1's callbacks does blame P1", async () => {
  const flood = (n) =>
    `for(let i=0;i<${n};i++)c.api.slot(0,{label:'a',cooldown:0,active:false});`;
  // This case is about the command budget, not the CPU budget: issuing ~1024
  // commands costs real time, and on a slow machine the wall-clock 8 ms budget
  // would fire first and mask what is under test (review recommendation M-5).
  const slack = { tickMs: 500 };
  // Exactly the budget from P1 in update, then the fighter P2 sends its own commands: fine.
  const w = await arena(D(`update(c){${flood(1024)}}`), code, slack);
  try {
    for (let i = 0; i < 3; i++) w.step(1 / 60);
    assert.equal(w.error, null, "P2 is not charged for P1's commands");
    assert.equal(w.commandCounts.get(1), 1024);
    assert.ok(w.commandCounts.get(2) > 0, "fighter P2 issued commands");
  } finally {
    w.dispose();
  }
  // Host-side accumulation across callbacks of the same owner within one tick:
  // 1023 + damage(self) in update, then one more command from beforeHit → 1025.
  await expectBounded(
    D(
      `event(c,ev){if(ev.type==='beforeHit')${flood(1)}},update(c){if(c.world.time<0.02){${flood(1023)}c.api.damage(c.selfId,1);}}`,
    ),
    /^fighter P1: Command budget exceeded$/,
    { overrides: slack },
  );
  // The same flood from P2 is attributed to P2 while P1 is the innocent fighter.
  await expectBounded(code, /^fighter P2: Command budget exceeded$/, {
    second: D(
      `event(c,ev){if(ev.type==='beforeHit')${flood(1)}},update(c){if(c.world.time<0.02){${flood(1023)}c.api.damage(c.selfId,1);}}`,
    ),
    overrides: slack,
  });
  // Both owners at exactly the budget in the same tick: still no error.
  const both = await arena(
    D(`update(c){${flood(1024)}}`),
    D(`update(c){${flood(1024)}}`),
    slack,
  );
  try {
    both.step(1 / 60);
    assert.equal(both.error, null);
    assert.deepEqual([...both.commandCounts.values()], [1024, 1024]);
  } finally {
    both.dispose();
  }
  await assertFreshMatchWorks();
});

test("5b. queue budget with raised tickMs is attributed to the owner whose command queued the overflowing item, even for missing targets", async () => {
  // At DEFAULT_LIMITS the CPU budget fires first and is attributed to P1. With a
  // raised tickMs the host-side queue cap is reached; the overflowing item targets
  // a missing entity ('nope'), so attribution comes from the queuing owner.
  const script = D(
    "spawn(c){for(let i=0;i<200;i++)c.api.spawn({x:300,y:100,hp:1,lifetime:0.01});},event(c,ev){if(ev.type==='death'&&ev.entityId==='1:1')for(let i=0;i<900;i++)c.api.damage('nope',1);}",
  );
  await expectBounded(
    script,
    /^fighter P1: (CPU tick budget exceeded|interrupted)$/,
    { second: D("update(){}") },
  );
  await expectBounded(script, /^fighter P1: Queue event budget exceeded$/, {
    second: D("update(){}"),
    overrides: { tickMs: 500 },
  });
  // Host-originated items have no owner and never produce "Pundefined".
  const w = createWorld();
  try {
    assert.equal(w.describeOwner(undefined), "world");
    assert.equal(w.describeOwner(null), "world");
    assert.equal(w.describeOwner(3), "entity P3");
    for (let i = 0; i < DEFAULT_LIMITS.events + 1; i++)
      w.queueDamage("nope", 1);
    w.step(1 / 60);
    assert.equal(w.error, "world: Queue event budget exceeded");
  } finally {
    w.dispose();
  }
  await assertFreshMatchWorks();
});

test("13. slot state is whitelisted: a junk field is rejected with P1 attribution and never inflates P2's input JSON", async () => {
  await expectBounded(
    D("update(c){c.api.slot(0,{label:'a',cooldown:0,active:false,junk:1});}"),
    /^fighter P1: Invalid slot field junk$/,
  );
  for (const state of [
    "null",
    "5",
    "[]",
    "{cooldown:0,active:false}",
    "{label:'a',active:false}",
    "{label:'a',cooldown:-1,active:false}",
  ])
    await expectBounded(
      D(`update(c){c.api.slot(0,${state});}`),
      /^fighter P1: Invalid slot$/,
      { second: D("update(){}") },
    );
  // 250 KB of junk per tick into a fresh slot: stored verbatim, the fourth tick's
  // P2 snapshot would exceed the 1 MiB input budget and blame P2 for it.
  const w = await arena(
    "let n=0;" +
      D(
        "update(c){c.api.slot(Math.min(3,n++),{label:'a',cooldown:0,active:false,junk:'x'.repeat(250000)});}",
      ),
  );
  try {
    stepUntilError(w, 6);
    assert.match(w.error, /^fighter P1: Invalid slot field junk$/);
    assert.doesNotMatch(w.error, /P2/, "the victim is never blamed");
    assert.ok(
      JSON.stringify(w.slots).length < 1000,
      "no junk reached the shared slot table",
    );
    assertClosed(w);
  } finally {
    w.dispose();
  }
  // `active` is coerced; the stored state is exactly {label, cooldown, active}.
  const ok = await arena(
    D("update(c){c.api.slot(1,{label:'b',cooldown:2,active:1});}"),
  );
  try {
    ok.step(1 / 60);
    assert.equal(ok.error, null);
    assert.deepEqual(ok.slots[1][1], { label: "b", cooldown: 2, active: true });
    for (const owner of [1, 2])
      for (const slot of ok.slots[owner])
        assert.deepEqual(Object.keys(slot), ["label", "cooldown", "active"]);
  } finally {
    ok.dispose();
  }
  await assertFreshMatchWorks();
});

test("14. finite but absurd magnitudes (1e308) in impulse/patch/spawn are rejected at the initiator; the victim stays finite and unblamed", async () => {
  await expectBounded(
    D("update(c){c.api.impulse(c.selfId,{x:1e308,y:0});}"),
    /^fighter P1: Invalid magnitude impulse x$/,
  );
  await expectBounded(
    D("update(c){c.api.impulse(c.selfId,{x:0,y:-1e7});}"),
    /^fighter P1: Invalid magnitude impulse y$/,
  );
  await expectBounded(
    D("update(c){c.api.patch(c.selfId,{vx:1e308});}"),
    /^fighter P1: Invalid magnitude vx$/,
  );
  await expectBounded(
    D("update(c){c.api.patch(c.selfId,{y:-1e7});}"),
    /^fighter P1: Invalid magnitude y$/,
  );
  await expectBounded(
    D("update(c){c.api.spawn({x:1e7,y:1});}"),
    /^fighter P1: Invalid magnitude x$/,
  );
  // A contact projectile with an absurd velocity never reaches the sweep,
  // whether the velocity comes from spawn or from a later patch.
  await expectBounded(
    D(
      "update(c){c.api.spawn({x:120,y:100,vx:1e308,radius:2,hp:1,contact:true});}",
    ),
    /^fighter P1: Invalid magnitude vx$/,
  );
  await expectBounded(
    D(
      "spawn(c){c.api.spawn({x:120,y:100,radius:2,hp:1,contact:true});},update(c){c.api.patch('1:1',{vx:1e308});}",
    ),
    /^fighter P1: Invalid magnitude vx$/,
  );
  // Knockback on the foreign body: the initiator is blamed, the victim keeps a
  // finite pose and no impulse (previously ix became Infinity → null in JSON).
  const w = await arena(
    D(`update(c){c.api.impulse(${ENEMY}.id,{x:1e308,y:1e308});}`),
  );
  try {
    w.step(1 / 60);
    assert.match(w.error, /^fighter P1: Invalid magnitude impulse x$/);
    const enemy = w.entities.get(w.players.get(2).selfId);
    assert.equal(enemy.x, 124);
    assert.equal(enemy.ix ?? 0, 0);
    assert.ok(
      [enemy.x, enemy.y, enemy.vx, enemy.vy].every(Number.isFinite),
      "victim pose finite",
    );
    assert.doesNotMatch(JSON.stringify(w.snapshot().entities), /null/);
  } finally {
    w.dispose();
  }
  // Exactly the cap passes and stays finite through integration and clamp; the
  // shipped characters use velocities in the hundreds.
  const cap = await arena(
    D(
      "update(c){c.api.patch(c.selfId,{vx:1e6,vy:-1e6,x:1e6,y:-1e6});c.api.impulse(c.selfId,{x:1e6,y:1e6});}",
    ),
  );
  try {
    for (let i = 0; i < 3; i++) cap.step(1 / 60);
    assert.equal(cap.error, null);
    const me = cap.entities.get(cap.players.get(1).selfId);
    assert.ok([me.x, me.y, me.ix, me.iy].every(Number.isFinite));
  } finally {
    cap.dispose();
  }
  await assertFreshMatchWorks();
});

// Kept last: repeated native-stack aborts used to degrade the shared wasm module.
test("3b. infinite recursion at DEFAULT_LIMITS.stack: attributed 'stack overflow', clean dispose, 20 times in a row, then a valid fighter still loads", async () => {
  for (let i = 0; i < 20; i++) {
    const w = await arena(D("update(){function f(){return f()+1}f()}"));
    try {
      const elapsed = stepUntilError(w, 1);
      assert.ok(elapsed < 1000, `run ${i}: ${elapsed.toFixed(1)} ms`);
      assert.equal(w.error, "fighter P1: stack overflow", `run ${i}`);
      assertClosed(w);
    } finally {
      assert.doesNotThrow(() => w.dispose(), `run ${i}: dispose`);
    }
  }
  // The same at load time, also repeatedly.
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      createRuntime(
        { ...pkg, code: "function f(){return f()+1}f();defineCharacter({})" },
        1,
      ),
      { message: /^fighter P1: stack overflow$/ },
    );
  await assertFreshMatchWorks(10);
});
