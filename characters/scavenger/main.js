// Scavenger: steampunk junkyard fighter. A single-leg rocket booster fires a
// short dash and the blade-fin on his arm cuts everyone he flies past. A
// hand-mounted magnet has two uses: Slot 2 yanks enemies toward him (no
// damage, pure setup), Slot 3 pulls scrap onto his own frame into a spiky
// shell that punishes anything touching him for a few seconds.
const SPEED = 70;
const CUTTER = { range: 25, damage: 12, spread: 0.25, push: 45, cd: 0.35 };
const DASH = {
  speed: 230,
  duration: 0.22,
  cd: 1.8,
  hitRadius: 13,
  damage: 18,
  push: 120,
};
const MAGNET = { radius: 65, pull: 130, cd: 4 };
const PLATING = {
  duration: 4,
  cd: 7,
  tickInterval: 0.3,
  tickDamage: 5,
  auraRadius: 10,
  push: 40,
};
const labels = ["Резак", "Ракетный рывок", "Магнит", "Колючий доспех"];
let ready = [0, 0, 0, 0],
  dashUntil = 0,
  dashAim = { x: 1, y: 0 },
  dashHits = [],
  platingUntil = 0,
  nextPlatingTick = 0;
const alive = (ctx) => {
  const m = ctx.api.entity(ctx.selfId);
  return m && m.hp > 0 ? m : null;
};
function cutter(ctx, me) {
  const aim = ctx.input.aim;
  let any = false;
  for (const e of ctx.api.queryCircle({
    x: me.x,
    y: me.y,
    radius: CUTTER.range,
  })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(me, e))
      continue;
    const dx = e.x - me.x,
      dy = e.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    if ((dx * aim.x + dy * aim.y) / d < CUTTER.spread) continue;
    any = true;
    ctx.api.damage(e.id, CUTTER.damage, me.id);
    ctx.api.impulse(e.id, {
      x: (dx / d) * CUTTER.push,
      y: (dy / d) * CUTTER.push,
    });
  }
  ctx.api.effect({
    x: me.x,
    y: me.y,
    radius: CUTTER.range,
    angle: Math.atan2(aim.y, aim.x),
    arc: Math.acos(CUTTER.spread),
    color: "#cfd8e3",
    duration: 0.16,
  });
  ctx.api.sound("clang", { volume: any ? 0.9 : 0.5 });
  ctx.api.shake(any ? 2 : 1, 0.1);
}
function magnet(ctx, me) {
  let any = false;
  for (const e of ctx.api.queryCircle({
    x: me.x,
    y: me.y,
    radius: MAGNET.radius,
  })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(me, e))
      continue;
    any = true;
    const dx = me.x - e.x,
      dy = me.y - e.y,
      d = Math.hypot(dx, dy) || 1;
    ctx.api.impulse(e.id, {
      x: (dx / d) * MAGNET.pull,
      y: (dy / d) * MAGNET.pull,
    });
  }
  ctx.api.effect({
    attach: { id: me.id },
    radius: MAGNET.radius,
    color: "#7fd1ff",
    duration: 0.3,
    fadeOut: 0.3,
  });
  ctx.api.sound("hum", { volume: any ? 0.9 : 0.4 });
}
function plating(ctx, me, t) {
  platingUntil = t + PLATING.duration;
  nextPlatingTick = t;
  ctx.api.effect({
    kind: "sprite",
    asset: "spike",
    attach: { id: me.id },
    scale: 1.6,
    loop: true,
    duration: PLATING.duration,
  });
  ctx.api.effect({
    attach: { id: me.id },
    radius: me.radius + PLATING.auraRadius,
    color: "#c96a2a",
    duration: 0.3,
  });
  ctx.api.sound("hum", { volume: 0.7 });
  ctx.api.shake(2, 0.15);
}
defineCharacter({
  update(ctx) {
    const me = alive(ctx);
    if (!me) return;
    const t = ctx.world.time;
    const dashing = t < dashUntil;
    const aim = dashing ? dashAim : ctx.input.aim;
    ctx.api.patch(me.id, {
      vx: (dashing ? aim.x : ctx.input.move.x) * (dashing ? DASH.speed : SPEED),
      vy: (dashing ? aim.y : ctx.input.move.y) * (dashing ? DASH.speed : SPEED),
      angle: Math.atan2(aim.y, aim.x),
    });
    if (dashing) {
      for (const e of ctx.api.queryCircle({
        x: me.x,
        y: me.y,
        radius: DASH.hitRadius,
      })) {
        if (
          e.ownerId === ctx.ownerId ||
          e.hp <= 0 ||
          dashHits.includes(e.id) ||
          !ctx.api.lineOfSight(me, e)
        )
          continue;
        dashHits.push(e.id);
        ctx.api.damage(e.id, DASH.damage, me.id);
        ctx.api.impulse(e.id, {
          x: aim.x * DASH.push,
          y: aim.y * DASH.push,
        });
        ctx.api.effect({
          kind: "sprite",
          asset: "spark",
          x: e.x,
          y: e.y,
          scale: 1.5,
          duration: 0.25,
        });
        ctx.api.sound("clang", { volume: 0.9 });
        ctx.api.shake(2, 0.12);
      }
    }
    if (t < platingUntil && t >= nextPlatingTick) {
      nextPlatingTick = t + PLATING.tickInterval;
      let any = false;
      for (const e of ctx.api.queryCircle({
        x: me.x,
        y: me.y,
        radius: me.radius + PLATING.auraRadius,
      })) {
        if (e.ownerId === ctx.ownerId || e.hp <= 0) continue;
        any = true;
        const dx = e.x - me.x,
          dy = e.y - me.y,
          d = Math.hypot(dx, dy) || 1;
        ctx.api.damage(e.id, PLATING.tickDamage, me.id);
        ctx.api.impulse(e.id, {
          x: (dx / d) * PLATING.push,
          y: (dy / d) * PLATING.push,
        });
      }
      ctx.api.effect({
        attach: { id: me.id },
        radius: me.radius + PLATING.auraRadius,
        color: "#c96a2a",
        duration: PLATING.tickInterval,
      });
      if (any) ctx.api.sound("clang", { volume: 0.5 });
    }
    for (let i = 0; i < 4; i++)
      ctx.api.slot(i, {
        label: labels[i],
        cooldown: Math.max(0, ready[i] - t),
        active: (i === 1 && dashing) || (i === 3 && t < platingUntil),
      });
  },
  ability(ctx, { slot, phase }) {
    const me = alive(ctx),
      t = ctx.world.time;
    if (!me || phase !== "press" || t < ready[slot]) return;
    if (slot === 0) {
      cutter(ctx, me);
      ready[0] = t + CUTTER.cd;
    } else if (slot === 1) {
      dashAim = { ...ctx.input.aim };
      dashUntil = t + DASH.duration;
      dashHits = [];
      ready[1] = t + DASH.cd;
    } else if (slot === 2) {
      magnet(ctx, me);
      ready[2] = t + MAGNET.cd;
    } else if (slot === 3) {
      plating(ctx, me, t);
      ready[3] = t + PLATING.cd;
    }
  },
});
