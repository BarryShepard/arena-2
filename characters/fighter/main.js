let ready = [0, 0, 0, 0],
  charging = false,
  charge = 0,
  rushUntil = 0,
  rushAim = { x: 1, y: 0 },
  rushHits = [];
const labels = ["Slash", "Rush", "Charge", "Repel"];
function attack(ctx, range, damage, spread, push, color) {
  const me = ctx.api.entity(ctx.selfId);
  if (!me || me.hp <= 0) return;
  const aim = ctx.input.aim;
  for (const e of ctx.api.queryCircle({ x: me.x, y: me.y, radius: range })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(me, e))
      continue;
    const dx = e.x - me.x,
      dy = e.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    if ((dx * aim.x + dy * aim.y) / d >= spread) {
      ctx.api.damage(e.id, damage, me.id);
      ctx.api.impulse(e.id, { x: (dx / d) * push, y: (dy / d) * push });
    }
  }
  ctx.api.effect({
    x: me.x,
    y: me.y,
    radius: range,
    angle: Math.atan2(aim.y, aim.x),
    arc: spread < 0 ? Math.PI : Math.acos(spread),
    color,
    duration: 0.18,
  });
  ctx.api.sound("hit");
  ctx.api.shake(1, 0.1);
}
defineCharacter({
  update(ctx, dt) {
    const me = ctx.api.entity(ctx.selfId);
    if (!me) return;
    const rushing = ctx.world.time < rushUntil;
    const aim = rushing ? rushAim : ctx.input.aim;
    ctx.api.patch(me.id, {
      vx:
        (rushing ? aim.x : ctx.input.move.x) *
        (rushing ? 240 : charging ? 30 : 72),
      vy:
        (rushing ? aim.y : ctx.input.move.y) *
        (rushing ? 240 : charging ? 30 : 72),
      angle: Math.atan2(aim.y, aim.x),
    });
    if (charging) charge = Math.min(1.5, charge + dt);
    if (rushing) {
      for (const e of ctx.api.queryCircle({ x: me.x, y: me.y, radius: 13 })) {
        if (
          e.ownerId !== ctx.ownerId &&
          !rushHits.includes(e.id) &&
          ctx.api.lineOfSight(me, e)
        ) {
          rushHits.push(e.id);
          ctx.api.damage(e.id, 20, me.id);
          ctx.api.impulse(e.id, { x: aim.x * 120, y: aim.y * 120 });
          ctx.api.effect({
            x: e.x,
            y: e.y,
            radius: 12,
            color: "#fff4b0",
            duration: 0.2,
          });
        }
      }
    }
    for (let i = 0; i < 4; i++)
      ctx.api.slot(i, {
        label:
          i === 2 && charging
            ? "Charge " + Math.round((charge / 1.5) * 100) + "%"
            : labels[i],
        cooldown: Math.max(0, ready[i] - ctx.world.time),
        active: (i === 2 && charging) || (i === 1 && rushing),
      });
  },
  ability(ctx, { slot, phase }) {
    if (slot === 2 && phase === "release" && charging) {
      charging = false;
      attack(
        ctx,
        23 + charge * 9,
        16 + charge * 26,
        0.2,
        120 + charge * 90,
        "#ffbd69",
      );
      ready[2] = ctx.world.time + 1.2;
      return;
    }
    if (phase !== "press" || ctx.world.time < ready[slot]) return;
    if (slot === 0) {
      attack(ctx, 24, 15, 0.25, 45, "#fff1c1");
      ready[0] = ctx.world.time + 0.38;
    }
    if (slot === 1) {
      rushAim = { ...ctx.input.aim };
      rushUntil = ctx.world.time + 0.22;
      rushHits = [];
      ready[1] = ctx.world.time + 1.6;
    }
    if (slot === 2) {
      charging = true;
      charge = 0;
    }
    if (slot === 3) {
      attack(ctx, 34, 10, -1, 240, "#7ffff5");
      ready[3] = ctx.world.time + 2;
    }
  },
});
