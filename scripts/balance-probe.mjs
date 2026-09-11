// Измеряет DPS/TTK каждого слота персонажа против неподвижного манекена.
// Балансный инструмент, не тест: ядро и моды не меняются, матч идёт в headless world.
//   node scripts/balance-probe.mjs                 # все пакеты в characters/
//   node scripts/balance-probe.mjs mage bud        # только указанные
//   node scripts/balance-probe.mjs mage --dist 60  # своя дистанция для всех слотов
import { readFile, readdir } from "node:fs/promises";
import { createRuntime } from "../src/mods/runtime.js";
import { createWorld } from "../src/engine/world.js";
import { emptyInput } from "../src/engine/input.js";

const root = new URL("../characters/", import.meta.url);
const args = process.argv.slice(2);
const distIdx = args.indexOf("--dist");
const DIST = distIdx === -1 ? null : Number(args[distIdx + 1]);
const ids = args.filter(
  (a, i) => !a.startsWith("--") && !(distIdx !== -1 && i === distIdx + 1),
);

// Манекен: тот же манифест (ассеты уже валидны), но удерживает позицию,
// иначе knockback уносит его из радиуса и DPS измеряется по бегству, а не по способности.
const dummyCode = (x, y) =>
  `defineCharacter({update(c){const m=c.api.entity(c.selfId);` +
  `if(m&&m.hp>0)c.api.patch(c.selfId,{x:${x},y:${y},vx:0,vy:0});}})`;

async function load(id) {
  return {
    manifest: JSON.parse(
      await readFile(new URL(`${id}/manifest.json`, root), "utf8"),
    ),
    code: await readFile(new URL(`${id}/main.js`, root), "utf8"),
  };
}

// hold: длинное удержание (80 из 90 кадров) — для charge-слотов с логикой на release.
async function probe(pkg, slot, { dist, seconds = 12, hold = false }) {
  const px = 100,
    py = 135,
    ex = px + dist;
  const w = createWorld();
  // tickMs поднят: 8 мс — wall-clock защита для реального матча, а прогон 12 с
  // в плотном цикле даёт ложные срабатывания (та же причина, что --test-concurrency=1).
  const LIMITS = { tickMs: 200 };
  w.addPlayer(await createRuntime(pkg, 1, LIMITS), { x: px, y: py });
  w.addPlayer(
    await createRuntime(
      { manifest: pkg.manifest, code: dummyCode(ex, py) },
      2,
      LIMITS,
    ),
    { x: ex, y: py },
  );
  const enemies = () => [...w.entities.values()].filter((e) => e.ownerId === 2);
  const totalHp = enemies().reduce((s, e) => s + e.hp, 0);
  const frames = Math.round(seconds * 60);
  let prev = false,
    killFrame = null;
  for (let f = 0; f < frames; f++) {
    const inputs = [emptyInput(), emptyInput()];
    const held = hold ? f % 90 < 80 : f % 12 < 1;
    inputs[0].slots[slot] = {
      held,
      pressed: held && !prev,
      released: !held && prev,
    };
    inputs[0].aim = { x: 1, y: 0 };
    prev = held;
    w.step(1 / 60, inputs);
    if (w.error) {
      w.dispose();
      return { error: w.error };
    }
    if (!enemies().some((e) => e.hp > 0)) {
      killFrame = f + 1;
      break;
    }
  }
  const left = enemies().reduce((s, e) => s + Math.max(0, e.hp), 0);
  w.dispose();
  const secs = (killFrame ?? frames) / 60;
  return {
    dealt: totalHp - left,
    secs,
    dps: (totalHp - left) / secs,
    ttk: killFrame ? secs : null,
  };
}

const pad = (s, n) => String(s).padEnd(n);
const targets = ids.length
  ? ids
  : (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

for (const id of targets) {
  const pkg = await load(id);
  const m = pkg.manifest;
  console.log(
    `\n${m.name} (${m.id}) — ${m.body.maxHp} HP, r ${m.body.radius}, moveSpeed ${m.body.moveSpeed}`,
  );
  for (let slot = 0; slot < 4; slot++) {
    const label = m.abilities[slot].label;
    for (const dist of DIST ? [DIST] : [20, 60, 140]) {
      for (const hold of [false, true]) {
        const r = await probe(pkg, slot, { dist, hold });
        if (r.error) {
          console.log(`  slot${slot} ${label}: MOD ERROR ${r.error}`);
          break;
        }
        if (r.dealt <= 0) continue; // молчим там, где слот не достаёт — это и есть его дальность
        console.log(
          `  slot${slot} ${pad(label, 10)} d=${pad(dist, 4)}${hold ? "hold" : "tap "} ` +
            `${pad(r.dps.toFixed(1) + " dps", 11)} ${r.ttk ? `TTK ${r.ttk.toFixed(2)}s` : `${r.dealt.toFixed(0)} dmg / ${r.secs.toFixed(0)}s`}`,
        );
      }
    }
  }
}
