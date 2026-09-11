// Infuzoria: giant single-celled creature. Pseudopod for melee damage, Engulf
// grabs a foe and holds/digests them, Enzyme drops a corrosive cloud (a
// harmful substance synthesized on the spot), Cyst hardens against damage.
// On its first death the cell undergoes mitosis and keeps fighting as two
// smaller daughters (group control mirrors Bud's seed-burst pattern).
const SPEED = 66;
const STRIKE = { range: 26, damage: 13, spread: 0.25, push: 45, cd: 0.4 };
const ENGULF = {
  range: 30,
  spread: 0.3,
  bite: 6,
  tickDmg: 3,
  tickInterval: 0.2,
  hold: 1.0,
  pull: 130,
  releasePush: 90,
  cd: 3.5,
};
const CLOUD = { radius: 20, life: 3, tick: 0.3, damage: 4, cd: 4, dist: 26 };
const CYST = { duration: 2.5, reduction: 0.45, cd: 6 };
const DAUGHTER = { hp: 40, radius: 5, count: 2, impulse: 90 };
const labels = ["Pseudopod", "Engulf", "Enzyme", "Cyst"];
let ready = [0, 0, 0, 0],
  grabbedId = null,
  grabberId = null,
  grabUntil = 0,
  nextGrabTick = 0,
  shieldUntil = 0,
  split = false;
const bodies = (ctx) =>
  ctx.world.entities.filter(
    (e) => e.ownerId === ctx.ownerId && e.hp > 0 && e.tags.includes("body"),
  );
function center(list) {
  let x = 0,
    y = 0;
  for (const e of list) {
    x += e.x;
    y += e.y;
  }
  return { x: x / list.length, y: y / list.length };
}
function strike(ctx, list, t) {
  const aim = ctx.input.aim;
  const dmg = STRIKE.damage / list.length; // divide per body so mitosis doesn't multiply DPS
  let any = false;
  for (const b of list) {
    for (const e of ctx.api.queryCircle({
      x: b.x,
      y: b.y,
      radius: STRIKE.range,
    })) {
      if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(b, e))
        continue;
      const dx = e.x - b.x,
        dy = e.y - b.y,
        d = Math.hypot(dx, dy) || 1;
      if ((dx * aim.x + dy * aim.y) / d < STRIKE.spread) continue;
      any = true;
      ctx.api.damage(e.id, dmg, b.id);
      ctx.api.impulse(e.id, {
        x: (dx / d) * STRIKE.push,
        y: (dy / d) * STRIKE.push,
      });
    }
    ctx.api.effect({
      x: b.x,
      y: b.y,
      radius: STRIKE.range,
      angle: Math.atan2(aim.y, aim.x),
      arc: Math.acos(STRIKE.spread),
      color: "#8be04a",
      duration: 0.16,
    });
  }
  ctx.api.sound("squelch", { volume: any ? 0.9 : 0.5 });
  ctx.api.shake(any ? 2 : 1, 0.1);
  ready[0] = t + STRIKE.cd;
}
function engulf(ctx, list, t) {
  const aim = ctx.input.aim,
    b = list[0];
  let target = null,
    bestD = Infinity;
  for (const e of ctx.api.queryCircle({
    x: b.x,
    y: b.y,
    radius: ENGULF.range,
  })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(b, e))
      continue;
    const dx = e.x - b.x,
      dy = e.y - b.y,
      d = Math.hypot(dx, dy) || 1;
    if ((dx * aim.x + dy * aim.y) / d < ENGULF.spread) continue;
    if (d < bestD) {
      bestD = d;
      target = e;
    }
  }
  ready[1] = t + ENGULF.cd;
  ctx.api.sound("gloop", { volume: target ? 0.9 : 0.3 });
  if (!target) return;
  ctx.api.damage(target.id, ENGULF.bite, b.id);
  grabbedId = target.id;
  grabberId = b.id;
  grabUntil = t + ENGULF.hold;
  nextGrabTick = t + ENGULF.tickInterval;
  ctx.api.effect({
    attach: { id: target.id },
    radius: target.radius + 5,
    color: "#4a7a2a",
    duration: ENGULF.hold,
  });
  ctx.api.shake(2, 0.15);
}
function tickGrab(ctx, t) {
  if (grabbedId === null) return;
  const foe = ctx.api.entity(grabbedId),
    grabber = ctx.api.entity(grabberId);
  if (!foe || foe.hp <= 0 || !grabber || grabber.hp <= 0 || t >= grabUntil) {
    if (foe && foe.hp > 0 && grabber) {
      const dx = foe.x - grabber.x,
        dy = foe.y - grabber.y,
        d = Math.hypot(dx, dy) || 1;
      ctx.api.impulse(foe.id, {
        x: (dx / d) * ENGULF.releasePush,
        y: (dy / d) * ENGULF.releasePush,
      });
    }
    grabbedId = null;
    return;
  }
  const dx = grabber.x - foe.x,
    dy = grabber.y - foe.y,
    d = Math.hypot(dx, dy) || 1;
  ctx.api.impulse(foe.id, {
    x: (dx / d) * ENGULF.pull,
    y: (dy / d) * ENGULF.pull,
  });
  if (t >= nextGrabTick) {
    nextGrabTick = t + ENGULF.tickInterval;
    ctx.api.damage(foe.id, ENGULF.tickDmg, grabber.id);
    ctx.api.effect({
      attach: { id: foe.id },
      radius: foe.radius + 3,
      color: "#8be04a",
      duration: 0.15,
    });
  }
}
function cloudTick(ctx) {
  const z = ctx.api.entity(ctx.entityId);
  if (!z) return;
  for (const e of ctx.api.queryCircle(z)) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || e.tags.includes("cloud"))
      continue;
    ctx.api.damage(e.id, CLOUD.damage, z.id);
  }
  ctx.api.effect({
    attach: { id: z.id },
    radius: z.radius,
    color: "#8f4fd6",
    duration: CLOUD.tick,
    fadeIn: 0.05,
  });
}
function cloud(ctx, list, t) {
  const aim = ctx.input.aim,
    b = list[0];
  const id = ctx.api.spawn({
    x: b.x + aim.x * CLOUD.dist,
    y: b.y + aim.y * CLOUD.dist,
    radius: CLOUD.radius,
    hp: 20,
    solid: false,
    sprite: "cloud",
    width: 24,
    height: 24,
    lifetime: CLOUD.life,
    tags: ["cloud"],
  });
  ctx.api.every(CLOUD.tick, cloudTick, { entityId: id });
  ctx.api.sound("gloop", { volume: 0.5 });
  ready[2] = t + CLOUD.cd;
}
function cyst(ctx, list, t) {
  shieldUntil = t + CYST.duration;
  ready[3] = t + CYST.cd;
  for (const b of list)
    ctx.api.effect({
      attach: { id: b.id },
      radius: b.radius + 5,
      color: "#c9c9c9",
      duration: CYST.duration,
      fadeOut: 0.3,
    });
  ctx.api.sound("squelch", { volume: 0.4 });
}
function mitosis(ctx, me) {
  for (let i = 0; i < DAUGHTER.count; i++) {
    const a = (i / DAUGHTER.count) * Math.PI * 2;
    const id = ctx.api.spawn({
      x: me.x + Math.cos(a) * 10,
      y: me.y + Math.sin(a) * 10,
      angle: a,
      radius: DAUGHTER.radius,
      hp: DAUGHTER.hp,
      solid: true,
      countsForDefeat: true,
      sprite: "daughter",
      width: 10,
      height: 10,
      tags: ["body", "daughter"],
    });
    ctx.api.impulse(id, {
      x: Math.cos(a) * DAUGHTER.impulse,
      y: Math.sin(a) * DAUGHTER.impulse,
    });
  }
  ctx.api.sequence(
    [
      {
        effect: {
          x: me.x,
          y: me.y,
          radius: me.radius + 6,
          color: "#8be04a",
          duration: 0.3,
        },
      },
      { sound: "gloop" },
      { shake: { amount: 3, seconds: 0.2 } },
      { wait: 0.12 },
      {
        effect: {
          x: me.x,
          y: me.y,
          radius: 24,
          color: "#8be04a",
          duration: 0.3,
        },
      },
    ],
    { entityId: null },
  );
}
defineCharacter({
  spawn(ctx) {
    ctx.api.patch(ctx.selfId, { tags: ["body", "main"] });
  },
  update(ctx) {
    const list = bodies(ctx);
    if (!list.length) return;
    const t = ctx.world.time,
      aim = ctx.input.aim,
      angle = Math.atan2(aim.y, aim.x),
      c = center(list),
      n = list.length;
    list.forEach((e, i) => {
      let fx = 0,
        fy = 0;
      if (n > 1) {
        const a = (i / n) * Math.PI * 2,
          ringR = 10,
          dx = c.x + Math.cos(a) * ringR - e.x,
          dy = c.y + Math.sin(a) * ringR - e.y,
          d = Math.hypot(dx, dy),
          s = Math.min(d * 5, 70);
        if (d > 0.5) {
          fx = (dx / d) * s;
          fy = (dy / d) * s;
        }
      }
      ctx.api.patch(e.id, {
        vx: ctx.input.move.x * SPEED + fx,
        vy: ctx.input.move.y * SPEED + fy,
        angle,
      });
    });
    tickGrab(ctx, t);
    for (let i = 0; i < 4; i++)
      ctx.api.slot(i, {
        label: labels[i],
        cooldown: Math.max(0, ready[i] - t),
        active:
          i === 1 ? grabbedId !== null : i === 3 ? t < shieldUntil : false,
      });
  },
  ability(ctx, { slot, phase }) {
    const list = bodies(ctx),
      t = ctx.world.time;
    if (phase !== "press" || t < ready[slot] || !list.length) return;
    if (slot === 0) strike(ctx, list, t);
    else if (slot === 1) engulf(ctx, list, t);
    else if (slot === 2) cloud(ctx, list, t);
    else cyst(ctx, list, t);
  },
  event(ctx, ev) {
    if (ev.type === "beforeHit") {
      if (ctx.world.time < shieldUntil)
        return { amount: ev.amount * (1 - CYST.reduction) };
      return;
    }
    if (ev.type === "death" && ev.entityId === ctx.selfId && !split) {
      const me = ctx.api.entity(ev.entityId);
      split = true;
      mitosis(ctx, me);
    }
  },
});
