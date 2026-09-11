// Puffer: постоянно разливает под собой воду (лужи слегка тормозят врагов, что
// в них встали — движок не даёт менять чужую скорость напрямую, поэтому "замедление"
// это гасящий встречный impulse). Плевок ставит лужу на попадании, колючий взрыв
// бьёт по кругу, Surge — рывок по прямой, Mech Suit на время меняет slot 0 на
// тяжёлый панч с усиленной лужей вместо дальнего плевка.
const SPEED = 66;
// radius stays below the body's own radius (7): a same-center puddle bigger
// than the body would shield Puffer from incoming raycasts/projectiles,
// which always hit the nearer (larger) circle first.
const TRAIL = { interval: 0.12, radius: 5, life: 0.9 };
const SPIT = { speed: 210, damage: 14, cd: 0.4, life: 1.5, push: 55 };
const PUDDLE = { radius: 16, life: 1.4 };
const QUILLS = { radius: 32, damage: 11, cd: 1.8, push: 80 };
const DASH = { speed: 210, duration: 0.22, cd: 2 };
const SUIT = { duration: 5, cd: 7, speedMul: 0.85 };
const PUNCH = { radius: 26, damage: 16, cd: 0.45, push: 90 };
const HEAVY_PUDDLE = { radius: 24, life: 1.8 };
const SLOW = { weak: 5, strong: 12, heavy: 22 };
const labels = ["Spit", "Quills", "Surge", "Mech Suit"];
let ready = [0, 0, 0, 0],
  rushUntil = 0,
  rushAim = { x: 1, y: 0 },
  suited = false,
  trailAt = 0;
const alive = (ctx) => {
  const m = ctx.api.entity(ctx.selfId);
  return m && m.hp > 0 ? m : null;
};
function slowGrade(e) {
  if (e.tags.includes("heavy")) return "heavy";
  if (e.tags.includes("strong")) return "strong";
  return "weak";
}
// No API to touch a foreign entity's own vx/vy: a "slow" can only be a small
// impulse that cancels part of the enemy's current motion each tick it stands in water.
function applySlow(ctx, e, amount) {
  const vx = e.vx + (e.ix || 0),
    vy = e.vy + (e.iy || 0),
    v = Math.hypot(vx, vy);
  if (v < 1) return;
  ctx.api.impulse(e.id, { x: (-vx / v) * amount, y: (-vy / v) * amount });
}
function puddleSlows(ctx) {
  const puddles = ctx.world.entities.filter(
    (e) => e.ownerId === ctx.ownerId && e.tags.includes("water"),
  );
  if (!puddles.length) return;
  const hit = new Set();
  for (const p of puddles)
    for (const e of ctx.api.queryCircle(p)) {
      if (e.ownerId === ctx.ownerId || e.hp <= 0 || hit.has(e.id)) continue;
      hit.add(e.id);
      applySlow(ctx, e, SLOW[slowGrade(p)]);
    }
}
function spawnPuddle(ctx, x, y, radius, life, grade) {
  ctx.api.spawn({
    x,
    y,
    radius,
    hp: 5,
    solid: false,
    sprite: "water",
    lifetime: life,
    tags: ["water", grade],
  });
}
function castSpit(ctx, me, aim) {
  const r = me.radius + 4;
  ctx.api.spawn({
    x: me.x + aim.x * r,
    y: me.y + aim.y * r,
    vx: aim.x * SPIT.speed,
    vy: aim.y * SPIT.speed,
    angle: Math.atan2(aim.y, aim.x),
    radius: 3,
    hp: 1,
    solid: false,
    contact: true,
    lifetime: SPIT.life,
    sprite: "spit",
    tags: ["spit"],
  });
  ctx.api.sound("splash", { volume: 0.5 });
}
function spitContact(ctx, ev) {
  const shot = ctx.api.entity(ev.entityId);
  if (!shot || !shot.tags.includes("spit")) return;
  if (ev.kind === "entity") {
    if (ev.otherOwnerId === ctx.ownerId) return;
    const other = ctx.api.entity(ev.otherId);
    if (!other || other.hp <= 0) return;
    ctx.api.damage(other.id, SPIT.damage, shot.id);
    ctx.api.impulse(other.id, {
      x: -ev.normal.x * SPIT.push,
      y: -ev.normal.y * SPIT.push,
    });
  }
  spawnPuddle(
    ctx,
    ev.point.x,
    ev.point.y,
    PUDDLE.radius,
    PUDDLE.life,
    "strong",
  );
  ctx.api.effect({
    kind: "sprite",
    asset: "water",
    x: ev.point.x,
    y: ev.point.y,
    scale: 2,
    duration: 0.3,
  });
  ctx.api.sound("splash", { volume: ev.kind === "entity" ? 0.9 : 0.4 });
  ctx.api.destroy(shot.id);
}
function quills(ctx, me) {
  let any = false;
  for (const e of ctx.api.queryCircle({
    x: me.x,
    y: me.y,
    radius: QUILLS.radius,
  })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(me, e))
      continue;
    any = true;
    const dx = e.x - me.x,
      dy = e.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    ctx.api.damage(e.id, QUILLS.damage, me.id);
    ctx.api.impulse(e.id, {
      x: (dx / d) * QUILLS.push,
      y: (dy / d) * QUILLS.push,
    });
  }
  ctx.api.effect({
    kind: "sprite",
    asset: "spike",
    attach: { id: me.id },
    scale: 2,
    duration: 0.3,
  });
  ctx.api.effect({
    attach: { id: me.id },
    radius: QUILLS.radius,
    color: "#ffe27a",
    duration: 0.2,
  });
  ctx.api.sound("thud", { volume: any ? 0.9 : 0.5 });
  ctx.api.shake(any ? 2 : 1, 0.15);
}
function punch(ctx, me, aim) {
  let any = false;
  for (const e of ctx.api.queryCircle({
    x: me.x,
    y: me.y,
    radius: PUNCH.radius,
  })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(me, e))
      continue;
    const dx = e.x - me.x,
      dy = e.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    if ((dx * aim.x + dy * aim.y) / d < 0.2) continue;
    any = true;
    ctx.api.damage(e.id, PUNCH.damage, me.id);
    ctx.api.impulse(e.id, {
      x: (dx / d) * PUNCH.push,
      y: (dy / d) * PUNCH.push,
    });
    spawnPuddle(ctx, e.x, e.y, HEAVY_PUDDLE.radius, HEAVY_PUDDLE.life, "heavy");
  }
  ctx.api.effect({
    x: me.x,
    y: me.y,
    radius: PUNCH.radius,
    angle: Math.atan2(aim.y, aim.x),
    arc: Math.acos(0.2),
    color: "#bfe9ff",
    duration: 0.2,
  });
  ctx.api.sound("thud", { volume: any ? 1 : 0.5 });
  ctx.api.shake(any ? 3 : 1, any ? 0.2 : 0.1);
}
defineCharacter({
  update(ctx) {
    const me = alive(ctx);
    if (!me) return;
    const t = ctx.world.time;
    const rushing = t < rushUntil;
    const aim = rushing ? rushAim : ctx.input.aim;
    const baseSpeed = SPEED * (suited ? SUIT.speedMul : 1);
    ctx.api.patch(me.id, {
      vx:
        (rushing ? aim.x : ctx.input.move.x) *
        (rushing ? DASH.speed : baseSpeed),
      vy:
        (rushing ? aim.y : ctx.input.move.y) *
        (rushing ? DASH.speed : baseSpeed),
      angle: Math.atan2(aim.y, aim.x),
    });
    if (t >= trailAt) {
      trailAt = t + (rushing ? TRAIL.interval / 2 : TRAIL.interval);
      spawnPuddle(ctx, me.x, me.y, TRAIL.radius, TRAIL.life, "weak");
    }
    puddleSlows(ctx);
    for (let i = 0; i < 4; i++)
      ctx.api.slot(i, {
        label: i === 0 && suited ? "Punch" : labels[i],
        cooldown: Math.max(0, ready[i] - t),
        active: (i === 2 && rushing) || (i === 3 && suited),
      });
  },
  ability(ctx, { slot, phase }) {
    const me = alive(ctx),
      t = ctx.world.time;
    if (!me || phase !== "press" || t < ready[slot]) return;
    if (slot === 0) {
      if (suited) {
        punch(ctx, me, ctx.input.aim);
        ready[0] = t + PUNCH.cd;
      } else {
        castSpit(ctx, me, ctx.input.aim);
        ready[0] = t + SPIT.cd;
      }
    } else if (slot === 1) {
      quills(ctx, me);
      ready[1] = t + QUILLS.cd;
    } else if (slot === 2) {
      rushAim = { ...ctx.input.aim };
      rushUntil = t + DASH.duration;
      ready[2] = t + DASH.cd;
      ctx.api.sound("splash", { volume: 0.4 });
    } else if (slot === 3) {
      suited = true;
      ready[3] = t + SUIT.cd;
      ctx.api.patch(me.id, { sprite: "robot" });
      ctx.api.effect({
        attach: { id: me.id },
        radius: me.radius + 6,
        color: "#9fd8ff",
        duration: 0.3,
      });
      ctx.api.sound("thud", { volume: 0.7 });
      ctx.api.after(
        SUIT.duration,
        (c) => {
          suited = false;
          const m = c.api.entity(c.selfId);
          if (!m || m.hp <= 0) return;
          c.api.patch(m.id, { sprite: "body" });
          c.api.effect({
            attach: { id: m.id },
            radius: m.radius + 6,
            color: "#67e39b",
            duration: 0.3,
          });
        },
        { entityId: null },
      );
    }
  },
  event(ctx, ev) {
    if (ev.type === "contact") spitContact(ctx, ev);
  },
});
