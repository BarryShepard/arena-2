// Task 3: mod-only mutation recipe. A copy of characters/fighter with a new
// id/name and a rewritten first ability must be discovered by the server's own
// package logic and change runtime behaviour without touching src/ or any
// registry. The temporary package is removed in `finally`, even on failure.
import test from "node:test";
import assert from "node:assert/strict";
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// listPackages is the server's own roster discovery (the /api/characters
// middleware calls it), so the test sees exactly what Reload mods sees.
import { readPackage, listPackages } from "../vite.config.js";
import { validateManifest } from "../src/mods/package.js";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
// vite.config.js resolves `characters` against process.cwd(); `npm test` runs
// from the project root, so both roots coincide.
const charactersRoot = path.join(project, "characters");
const TEMP_PREFIX = path.join(charactersRoot, "zz_mutant_");
const MUTANT_ID = "zz_mutant_" + process.pid;
const MUTANT_DIR = TEMP_PREFIX + process.pid;
const MUTANT_NAME = "Mutant Fighter";
const KEEP = ["bud", "fighter", "mage"];

// The recipe: replace Slash (slot 0) with a radial impulse + self heal +
// attached sprite effect. Everything else in main.js stays as shipped.
const ORIGINAL_SLOT0 = 'attack(ctx, 24, 15, 0.25, 45, "#fff1c1");';
const BLAST = `
function blast(ctx) {
  const me = ctx.api.entity(ctx.selfId);
  if (!me || me.hp <= 0) return;
  for (const e of ctx.api.queryCircle({ x: me.x, y: me.y, radius: 60 })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0) continue;
    const dx = e.x - me.x,
      dy = e.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    ctx.api.impulse(e.id, { x: (dx / d) * 300, y: (dy / d) * 300 });
  }
  ctx.api.heal(me.id, 30);
  ctx.api.effect({
    kind: "sprite",
    asset: "body",
    attach: { id: me.id },
    scale: 2,
    duration: 0.5,
  });
}
`;

async function createMutant() {
  assert.match(MUTANT_ID, /^[-a-z0-9_]+$/);
  await cp(path.join(charactersRoot, "fighter"), MUTANT_DIR, {
    recursive: true,
  });
  const manifestPath = path.join(MUTANT_DIR, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.id = MUTANT_ID;
  manifest.name = MUTANT_NAME;
  manifest.abilities[0] = { label: "Blast" };
  validateManifest(manifest);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const mainPath = path.join(MUTANT_DIR, "main.js");
  const original = await readFile(mainPath, "utf8");
  assert.ok(
    original.includes(ORIGINAL_SLOT0),
    "recipe anchors on fighter's slot 0 call",
  );
  const mutated =
    BLAST +
    original
      .replace(ORIGINAL_SLOT0, "blast(ctx);")
      .replace('"Slash"', '"Blast"');
  await writeFile(mainPath, mutated);
}

async function removeMutant() {
  // Guard: only ever delete our own temporary package.
  assert.ok(
    MUTANT_DIR.startsWith(TEMP_PREFIX) && MUTANT_DIR !== TEMP_PREFIX,
    "refusing to remove anything but the temporary mutant package",
  );
  await rm(MUTANT_DIR, { recursive: true, force: true });
}

async function match(p1, p2) {
  const w = createWorld();
  try {
    w.addPlayer(await createRuntime(p1, 1), { x: 100, y: 100 });
    w.addPlayer(await createRuntime(p2, 2), { x: 124, y: 100 });
    return w;
  } catch (e) {
    w.dispose();
    throw e;
  }
}
const body = (w, owner) => w.entities.get(w.players.get(owner).selfId);
const pressSlot0 = () => {
  const inputs = [emptyInput(), emptyInput()];
  inputs[0].slots[0] = { pressed: true, held: true, released: false };
  return inputs;
};

test("mod-only mutation: copied package is discovered, loaded and changes slot 0 behaviour", async () => {
  const before = await listPackages();
  for (const id of KEEP) assert.ok(before.includes(id), "shipped " + id);
  assert.ok(!before.includes(MUTANT_ID), "no stale mutant with our pid");
  try {
    await createMutant();

    // 2. Discovery with the server's own logic (same as after Reload in the UI).
    const after = await listPackages();
    assert.deepEqual(after, [...before, MUTANT_ID].sort());
    const mutant = await readPackage(MUTANT_ID);
    const fighter = await readPackage("fighter");
    assert.equal(mutant.manifest.id, MUTANT_ID);
    assert.equal(mutant.manifest.name, MUTANT_NAME);
    assert.equal(mutant.manifest.abilities[0].label, "Blast");
    assert.equal(validateManifest(mutant.manifest), mutant.manifest);
    assert.notEqual(mutant.code, fighter.code, "script was rewritten");
    assert.ok(mutant.code.includes("function blast("));
    assert.ok(!mutant.code.includes(ORIGINAL_SLOT0));
    assert.deepEqual(
      Object.keys(mutant.assets).sort(),
      Object.keys(fighter.manifest.assets).sort(),
    );
    assert.match(mutant.assets.body, /^data:image\/png;base64,/);
    assert.match(mutant.assets.hit, /^data:audio\/wav;base64,/);
    assert.deepEqual(mutant.assets, fighter.assets, "assets copied verbatim");

    // 3. Runtime: mutant (P1) vs original fighter (P2).
    const w = await match(mutant, fighter);
    try {
      const me = w.players.get(1).selfId;
      // Pre-damage own body so heal is observable.
      w.queueDamage(me, 50, undefined);
      w.step(1 / 60);
      assert.equal(w.error, null);
      assert.equal(body(w, 1).hp, 70);
      const enemyX = body(w, 2).x;
      assert.equal(enemyX, 124);
      assert.equal(w.effects.length, 0);

      w.step(1 / 60, pressSlot0());
      assert.equal(w.error, null);
      assert.equal(body(w, 2).hp, 120, "no damage from the mutated slot");
      assert.ok(
        body(w, 2).x > enemyX,
        "enemy pushed away from mutant: " + body(w, 2).x,
      );
      assert.equal(body(w, 1).hp, 100, "own body healed by 30");
      assert.equal(body(w, 1).x, 100, "impulse targets enemies only");
      const attached = w.effects.filter((e) => e.attach?.id === me);
      assert.equal(attached.length, 1);
      assert.equal(attached[0].kind, "sprite");
      assert.equal(attached[0].asset, "body");
      assert.equal(attached[0].ownerId, 1);
      assert.equal(w.slots[1][0].label, "Blast");
      assert.ok(w.slots[1][0].cooldown > 0);

      // Impulse keeps acting (decaying) in following ticks; still no damage.
      let x = body(w, 2).x;
      for (let i = 0; i < 5; i++) {
        w.step(1 / 60);
        assert.ok(body(w, 2).x > x, "enemy keeps drifting on tick " + i);
        x = body(w, 2).x;
      }
      assert.equal(w.error, null);
      assert.equal(body(w, 2).hp, 120);
      assert.equal(body(w, 1).hp, 100);
    } finally {
      w.dispose();
    }

    // Control: the shipped fighter's slot 0 still damages in a separate match.
    const control = await match(fighter, fighter);
    try {
      control.step(1 / 60, pressSlot0());
      assert.equal(control.error, null);
      assert.equal(body(control, 2).hp, 105, "original Slash deals 15");
      assert.equal(
        control.effects.filter((e) => e.attach).length,
        0,
        "original Slash has no attached effect",
      );
    } finally {
      control.dispose();
    }

    // 4. Core untouched: no registry, no id anywhere outside the package.
    for (const file of await sourceFiles(path.join(project, "src")))
      assert.ok(
        !(await readFile(file, "utf8")).includes(MUTANT_ID),
        "core references mutant: " + file,
      );
    for (const file of ["vite.config.js", "characters/fighter/main.js"])
      assert.ok(
        !(await readFile(path.join(project, file), "utf8")).includes(MUTANT_ID),
        file + " references mutant",
      );
    const self = await readFile(fileURLToPath(import.meta.url), "utf8");
    const imports = [...self.matchAll(/^import .* from "([^"]+)";$/gm)].map(
      (m) => m[1],
    );
    assert.deepEqual(imports.filter((s) => !s.startsWith("node:")).sort(), [
      "../src/engine/input.js",
      "../src/engine/world.js",
      "../src/mods/package.js",
      "../src/mods/runtime.js",
      "../vite.config.js",
    ]);
  } finally {
    // 5. Cleanup: only our own temporary package.
    await removeMutant();
  }
  assert.deepEqual(await listPackages(), before, "roster restored");
  const shipped = await readPackage("fighter");
  assert.ok(shipped.code.includes(ORIGINAL_SLOT0), "shipped fighter intact");
});

async function sourceFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sourceFiles(p)));
    else out.push(p);
  }
  return out;
}
