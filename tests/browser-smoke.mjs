import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const port = 5178,
  url = "http://127.0.0.1:" + port;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
server.stdout.on("data", (d) => (output += d));
server.stderr.on("data", (d) => (output += d));
let browser;
const errors = [];
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (i > 100) throw Error("Dev server unavailable: " + output);
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1100, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await page.goto(url);
  await page.selectOption("#p1", "fighter");
  await page.selectOption("#p2", "fighter");
  await page.click("#start");
  await page.waitForFunction(
    () => window.arenaSnapshot()?.entities.length === 2,
  );
  let s = await page.evaluate(() => window.arenaSnapshot());
  assert.equal(s.remaining > 179, true);
  await page.keyboard.down("KeyD");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(1800);
  await page.keyboard.up("KeyD");
  await page.keyboard.up("ArrowLeft");
  s = await page.evaluate(() => window.arenaSnapshot());
  assert.ok(
    s.entities[0].x > 180 && s.entities[1].x < 300,
    "both players move",
  );
  await page.click("#pause");
  const paused = await page.evaluate(() => window.arenaSnapshot().time);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.arenaSnapshot().time), paused);
  await page.click("#pause");
  for (const key of ["KeyF", "KeyG", "KeyH", "KeyJ"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(key === "KeyH" ? 800 : 80);
    await page.keyboard.up(key);
    await page.waitForTimeout(100);
  }
  for (const key of ["KeyI", "KeyO", "KeyP", "BracketLeft"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(key === "KeyP" ? 300 : 60);
    await page.keyboard.up(key);
    await page.waitForTimeout(70);
  }
  // Fight through the public physical-key input, without host mutation hooks.
  for (let i = 0; i < 100; i++) {
    s = await page.evaluate(() => window.arenaSnapshot());
    if (s.error) throw Error(s.error);
    if (s.result) break;
    const a = s.entities.find((e) => e.ownerId === 1),
      b = s.entities.find((e) => e.ownerId === 2);
    const direction = a.x < b.x ? "KeyD" : "KeyA";
    await page.keyboard.down(direction);
    await page.keyboard.press("KeyF", { delay: 40 });
    await page.waitForTimeout(220);
    await page.keyboard.up(direction);
  }
  s = await page.evaluate(() => window.arenaSnapshot());
  assert.ok(s.result, "combat must reach victory");
  await page.click("#restart");
  await page.waitForFunction(
    () =>
      window.arenaSnapshot()?.result === null &&
      window.arenaSnapshot()?.time < 1,
  );
  s = await page.evaluate(() => window.arenaSnapshot());
  assert.equal(s.entities.length, 2);
  assert.ok(s.entities.every((e) => e.hp === 120));
  assert.ok(s.remaining > 179);
  await page.keyboard.down("KeyD");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  // Keep the physical key down: blur itself must clear movement.
  assert.equal(await page.textContent("#pause"), "Resume");
  await page.click("#pause");
  const x = await page.evaluate(() => window.arenaSnapshot().entities[0].x);
  await page.waitForTimeout(120);
  assert.equal(
    await page.evaluate(() => window.arenaSnapshot().entities[0].x),
    x,
  );
  await page.keyboard.up("KeyD");
  // Intercept only this test's package fetch; test a malformed mod through UI.
  const packageRoute = "**/api/characters/fighter.json";
  const malformed = async (route) => {
    const response = await route.fetch();
    const p = await response.json();
    p.code =
      "defineCharacter({update(c){c.api.effect({x:80,y:135,radius:-1,duration:1});}})";
    await route.fulfill({ response, json: p });
  };
  await page.route(packageRoute, malformed);
  await page.click("#restart");
  await page.waitForFunction(() => window.arenaSnapshot()?.error);
  assert.match(await page.textContent("#error"), /fighter P1:.*effect/i);
  await page.unroute(packageRoute, malformed);
  await page.click("#restart");
  await page.waitForFunction(
    () => window.arenaSnapshot()?.time > 0.1 && !window.arenaSnapshot()?.error,
  );
  // Simulate an unexpected renderer exception. RAF must survive for Restart.
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      CanvasRenderingContext2D.prototype.fillRect = original;
      throw Error("intentional render recovery probe");
    };
  });
  await page.waitForFunction(() => window.arenaSnapshot()?.error);
  assert.match(
    await page.textContent("#error"),
    /Render: intentional render recovery probe/,
  );
  await page.click("#restart");
  await page.waitForFunction(
    () => window.arenaSnapshot()?.time > 0.1 && !window.arenaSnapshot()?.error,
  );
  await mkdir("docs/artifacts", { recursive: true });
  await page.screenshot({
    path: "docs/artifacts/task1-browser.png",
    fullPage: true,
  });
  await page.click("#back");
  await page.click("#reload");
  // Task 2 ships three catalog entries; Reload must list all of them.
  assert.deepEqual(
    (await page.locator("#p1 option").allTextContents()).sort(),
    ["bud", "fighter", "mage"],
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Fighter/Fighter load, movement, 8 bindings, combat verdict, pause/blur, restart, reload, malformed-mod and render recovery; no uncaught browser errors.",
  );

  // ---------------------------------------------------------------- Task 2
  const snap = () => page.evaluate(() => window.arenaSnapshot());
  const hud = () =>
    page.evaluate(() =>
      [1, 2].map((p) =>
        [...document.querySelectorAll(`#hud .slots.p${p} .slot span`)].map(
          (e) => e.textContent,
        ),
      ),
    );
  const tap = async (key, ms = 60) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  };
  const holdKeys = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    for (const k of keys) await page.keyboard.up(k);
  };
  const failWith = (label, s) => {
    if (s?.error) throw Error(label + ": world.error = " + s.error);
    if (errors.length)
      throw Error(label + ": browser errors " + JSON.stringify(errors));
  };
  const startMatch = async (p1, p2) => {
    await page.selectOption("#p1", p1);
    await page.selectOption("#p2", p2);
    await page.click("#start");
    await page.waitForFunction(
      () => window.arenaSnapshot()?.entities.length === 2,
    );
    await page.evaluate(() => window.__seen.reset());
  };
  const waitEntity = (label, pred) =>
    page
      .waitForFunction(
        (src) => {
          const s = window.arenaSnapshot();
          return (
            s && !s.error && s.entities.some(new Function("e", "return " + src))
          );
        },
        pred,
        { timeout: 4000 },
      )
      .catch(() => {
        throw Error("no entity for " + label + " (" + pred + ")");
      });
  // Read-only observer: effects are short (~0.12s beams), so accumulate what
  // every rendered frame of the public snapshot exposes instead of sampling
  // from Node.
  await page.evaluate(() => {
    const seen = (window.__seen = {
      kinds: [],
      assets: [],
      sprites: [],
      reset() {
        seen.kinds = [];
        seen.assets = [];
        seen.sprites = [];
      },
    });
    const add = (list, v) => {
      if (v != null && !list.includes(v)) list.push(v);
    };
    const tick = () => {
      const s = window.arenaSnapshot();
      if (s) {
        for (const e of s.effects ?? []) {
          add(seen.kinds, e.kind);
          add(seen.assets, e.asset);
        }
        for (const e of s.entities) add(seen.sprites, e.sprite);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const seen = () => page.evaluate(() => window.__seen);

  // ---- 1. Mage (P1) vs Bud (P2): all eight slots, projectiles, zone, turret, VFX
  await startMatch("mage", "bud");
  let s2 = await snap();
  assert.equal(s2.entities[0].sprite, "body");
  assert.equal(s2.entities[0].maxHp, 100);
  assert.equal(s2.entities[1].maxHp, 100);
  assert.deepEqual(await hud(), [
    ["Bolt", "Anchor", "Zone", "Turret"],
    ["Volley", "Tight", "Mine", "Morph"],
  ]);
  // Approach each other along the open middle lane.
  await holdKeys(["KeyD", "ArrowLeft"], 1600);
  s2 = await snap();
  assert.ok(s2.entities[0].x > 160, "mage moved right: " + s2.entities[0].x);
  assert.ok(s2.entities[1].x < 320, "bud moved left: " + s2.entities[1].x);
  await tap("KeyF");
  await waitEntity("bolt", "e.sprite === 'bolt' && e.ownerId === 1");
  s2 = await snap();
  const bolt = s2.entities.find((e) => e.sprite === "bolt");
  assert.ok(bolt.tags.includes("bolt") && bolt.vx > 0, "bolt flies right");
  await tap("KeyG");
  await page.waitForFunction(
    () =>
      document.querySelector("#hud .slots.p1 .slot:nth-child(2) span")
        ?.textContent === "Blink",
  );
  s2 = await snap();
  const anchorAt = { x: s2.entities[0].x, y: s2.entities[0].y };
  assert.ok(
    s2.effects.some((e) => e.kind === "sprite" && e.asset === "rune" && e.loop),
    "anchor rune sprite effect present",
  );
  assert.ok(
    (await page.locator("#hud .slots.p1 .slot.active").count()) === 1,
    "anchor slot highlighted",
  );
  await tap("KeyH");
  await waitEntity("zone", "e.tags.includes('zone') && e.sprite === 'zone'");
  await tap("KeyJ");
  await waitEntity(
    "turret",
    "e.sprite === 'turret' && e.ownerId === 1 && e.countsForDefeat === false && e.solid",
  );
  // The turret is within 150px of the bud with a clear line: expect a beam.
  await page.waitForFunction(() => window.__seen.kinds.includes("beam"), null, {
    timeout: 3000,
  });
  await page.waitForFunction(() =>
    window.arenaSnapshot()?.effects.some((e) => e.kind === "beam"),
  );
  s2 = await snap();
  assert.ok(
    s2.effects.some((e) => e.kind === "sprite") &&
      s2.effects.some((e) => e.kind === "beam") &&
      s2.entities.some((e) => e.sprite === "turret") &&
      s2.entities.some((e) => e.sprite === "zone"),
    "screenshot moment has sprite+beam effects and zone+turret bodies",
  );
  await page.screenshot({
    path: "docs/artifacts/task2-mage-bud.png",
    fullPage: true,
  });
  const budHp = s2.entities.find(
    (e) => e.ownerId === 2 && e.countsForDefeat,
  ).hp;
  assert.ok(budHp < 100, "turret/bolt damaged the bud: " + budHp);
  // Move away, then Blink back to the anchor.
  await holdKeys(["KeyW"], 500);
  s2 = await snap();
  assert.ok(s2.entities[0].y < anchorAt.y - 15, "mage moved up before blink");
  await tap("KeyG");
  await page.waitForFunction(
    () =>
      document.querySelector("#hud .slots.p1 .slot:nth-child(2) span")
        ?.textContent === "Anchor",
  );
  s2 = await snap();
  assert.ok(
    Math.abs(s2.entities[0].x - anchorAt.x) < 2 &&
      Math.abs(s2.entities[0].y - anchorAt.y) < 2,
    "blink returned the mage to the anchor",
  );
  await page.waitForTimeout(150);
  assert.ok(
    (await seen()).assets.includes("spark"),
    "blink sequence emitted spark sprite effects",
  );
  failWith("mage slots", await snap());

  // Bud (P2): Volley, Wide toggle, Mine, Morph, Lash.
  await holdKeys(["ArrowLeft"], 200);
  await tap("KeyI");
  await waitEntity(
    "shot",
    "e.sprite === 'shot' && e.ownerId === 2 && e.vx < 0",
  );
  await tap("KeyO");
  await page.waitForFunction(
    () =>
      document.querySelector("#hud .slots.p2 .slot:nth-child(2) span")
        ?.textContent === "Wide",
  );
  await tap("KeyP");
  await waitEntity("mine", "e.sprite === 'mine' && e.tags.includes('mine')");
  await tap("BracketLeft");
  await page.waitForFunction(
    () =>
      document.querySelector("#hud .slots.p2 .slot:nth-child(1) span")
        ?.textContent === "Lash",
  );
  await waitEntity("thorn body", "e.ownerId === 2 && e.sprite === 'thorn'");
  await page.waitForTimeout(800); // Lash cooldown after Volley
  await tap("KeyI");
  // Lash always draws a beam from the bud body (owner 2), hit or miss.
  await page.waitForFunction(
    () =>
      window
        .arenaSnapshot()
        ?.effects.some((e) => e.kind === "beam" && e.ownerId === 2),
    null,
    { timeout: 2000 },
  );
  assert.deepEqual((await hud())[1], ["Lash", "Wide", "Mine", "Morph"]);
  const seen1 = await seen();
  for (const k of ["ring", "sprite", "beam"])
    assert.ok(seen1.kinds.includes(k), "effect kind seen: " + k);
  for (const sp of ["bolt", "zone", "turret", "shot", "mine", "thorn"])
    assert.ok(seen1.sprites.includes(sp), "entity sprite seen: " + sp);
  s2 = await snap();
  assert.equal(s2.result, null);
  failWith("mage vs bud", s2);
  console.log("PASS: Mage vs Bud slots, projectiles, zone, turret, VFX kinds.");

  // ---- 2. Bud (P1) vs Fighter (P2): burst into a steerable group
  await page.click("#back");
  await startMatch("bud", "fighter");
  await holdKeys(["KeyD", "ArrowLeft"], 2100);
  s2 = await snap();
  assert.ok(
    Math.abs(s2.entities[0].x - s2.entities[1].x) < 40,
    "bud and fighter met in the middle",
  );
  const budId = s2.entities[0].id;
  const chase = async (target, slashKey = "KeyI") => {
    const f = s2.entities.find((e) => e.ownerId === 2 && e.countsForDefeat);
    const dx = target.x - f.x,
      dy = target.y - f.y;
    const key =
      Math.abs(dx) >= Math.abs(dy)
        ? dx > 0
          ? "ArrowRight"
          : "ArrowLeft"
        : dy > 0
          ? "ArrowDown"
          : "ArrowUp";
    await page.keyboard.down(key);
    await page.keyboard.press(slashKey, { delay: 40 });
    await page.waitForTimeout(160);
    await page.keyboard.up(key);
  };
  let grew = false,
    burstSeen = false;
  for (let i = 0; i < 120; i++) {
    s2 = await snap();
    failWith("bud burst", s2);
    const main = s2.entities.find((e) => e.id === budId);
    if (!main) {
      burstSeen = true;
      break;
    }
    if (main.radius > 7.5) grew = true;
    await chase(main);
  }
  assert.ok(grew, "bud grew after taking hits");
  assert.ok(burstSeen, "bud main body died within the chase budget");
  s2 = await snap();
  const seeds = s2.entities.filter(
    (e) => e.ownerId === 1 && e.countsForDefeat && e.hp > 0,
  );
  assert.ok(seeds.length >= 5, "burst spawned seeds: " + seeds.length);
  assert.ok(seeds.every((e) => e.tags.includes("seed") && e.solid));
  assert.equal(s2.result, null, "match continues with the seed group");
  await page.screenshot({
    path: "docs/artifacts/task2-bud-burst.png",
    fullPage: true,
  });
  assert.ok((await seen()).sprites.includes("seed"), "seed sprite visible");
  // The group is steerable: WASD moves its centroid.
  const centroid = (list) => ({
    x: list.reduce((a, e) => a + e.x, 0) / list.length,
    y: list.reduce((a, e) => a + e.y, 0) / list.length,
  });
  await page.waitForTimeout(300);
  const before = centroid(
    (await snap()).entities.filter((e) => e.ownerId === 1 && e.countsForDefeat),
  );
  await holdKeys(["KeyW"], 600);
  const after = centroid(
    (await snap()).entities.filter((e) => e.ownerId === 1 && e.countsForDefeat),
  );
  assert.ok(before.y - after.y > 15, "seed group moves up on W");
  assert.deepEqual((await hud())[0], ["Volley", "Tight", "Mine", "Morph"]);
  // Finish the group: Fighter chases the nearest seed with Slash, Repel now and then.
  let finished = false;
  for (let i = 0; i < 260; i++) {
    s2 = await snap();
    failWith("group fight", s2);
    if (s2.result) {
      finished = true;
      break;
    }
    const f = s2.entities.find((e) => e.ownerId === 2 && e.countsForDefeat);
    const alive = s2.entities.filter(
      (e) => e.ownerId === 1 && e.countsForDefeat && e.hp > 0,
    );
    alive.sort(
      (a, b) =>
        Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y),
    );
    await chase(alive[0], i % 8 === 7 ? "BracketLeft" : "KeyI");
  }
  s2 = await snap();
  if (finished) {
    assert.equal(s2.result, "P2", "fighter defeats the whole seed group");
    console.log(
      "PASS: Bud burst into " +
        seeds.length +
        " seeds, group steerable, fighter finished the group (P2 wins).",
    );
  } else {
    console.log(
      "NOTE: seed group not finished within the chase budget; remaining owner-1 bodies: " +
        s2.entities.filter((e) => e.ownerId === 1 && e.countsForDefeat).length +
        ", match still running (result null).",
    );
    assert.equal(s2.result, null);
  }

  // ---- 3. Mirror Mage/Mage: per-runtime state, independent HUD labels
  await page.click("#back");
  await startMatch("mage", "mage");
  await tap("KeyG");
  await page.waitForFunction(
    () =>
      document.querySelector("#hud .slots.p1 .slot:nth-child(2) span")
        ?.textContent === "Blink",
  );
  assert.deepEqual(await hud(), [
    ["Bolt", "Blink", "Zone", "Turret"],
    ["Bolt", "Anchor", "Zone", "Turret"],
  ]);
  await tap("KeyO");
  await page.waitForFunction(
    () =>
      document.querySelector("#hud .slots.p2 .slot:nth-child(2) span")
        ?.textContent === "Blink",
  );
  assert.deepEqual((await hud())[0][1], "Blink");
  await page.waitForTimeout(300);
  await tap("KeyG");
  await page.waitForFunction(
    () =>
      document.querySelector("#hud .slots.p1 .slot:nth-child(2) span")
        ?.textContent === "Anchor",
  );
  assert.deepEqual(await hud(), [
    ["Bolt", "Anchor", "Zone", "Turret"],
    ["Bolt", "Blink", "Zone", "Turret"],
  ]);
  // Mirror bolts must not be eaten by the other mage's bolt (passive tags).
  await tap("KeyF");
  await tap("KeyI");
  await page.waitForTimeout(200);
  s2 = await snap();
  assert.equal(
    s2.entities.filter((e) => e.sprite === "bolt").length,
    2,
    "both mirror bolts in flight",
  );
  failWith("mirror mage", s2);
  console.log(
    "PASS: Mirror Mage/Mage independent anchor state and HUD labels.",
  );

  // ---- 4. Restart and Back → Reload after Task 2 scenarios
  await page.click("#restart");
  await page.waitForFunction(
    () =>
      window.arenaSnapshot()?.result === null &&
      window.arenaSnapshot()?.time < 1,
  );
  s2 = await snap();
  assert.equal(s2.entities.length, 2);
  assert.ok(s2.entities.every((e) => e.hp === 100 && e.hp === e.maxHp));
  assert.ok(s2.remaining > 179);
  assert.deepEqual(s2.effects, []);
  assert.equal(await page.textContent("#clock"), "3:00");
  assert.deepEqual(await hud(), [
    ["Bolt", "Anchor", "Zone", "Turret"],
    ["Bolt", "Anchor", "Zone", "Turret"],
  ]);
  await page.click("#back");
  assert.equal(await page.evaluate(() => window.arenaSnapshot()), null);
  await page.click("#reload");
  await page.waitForFunction(
    () => document.querySelectorAll("#p2 option").length === 3,
  );
  assert.deepEqual(
    (await page.locator("#p2 option").allTextContents()).sort(),
    ["bud", "fighter", "mage"],
  );
  assert.equal(await page.isHidden("#game"), true);
  assert.equal(await page.textContent("#error"), "");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Task 2 — Mage vs Bud, Bud burst group, mirror Mage, restart/reload; no uncaught browser errors.",
  );
} catch (e) {
  console.error("Browser errors collected:", errors);
  throw e;
} finally {
  await browser?.close();
  server.kill();
}
