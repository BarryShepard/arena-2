// Бешеная табуретка: a four-legged stool gone feral. Movement wobbles around
// the chosen direction (deterministic sine noise, not Math.random, so replays
// and tests stay reproducible) while aim stays precise. Slot 0 fires nails at
// range; Slot 2 tears off a leg to swap into a melee club (speed -25%, can be
// reattached). Slot 1 pounces and pins the first thing it hits with a burst of
// nails; Slot 3 is the same pounce scaled up into one crushing hit.
const SPEED = 68;
const MELEE_SPEED_MUL = 0.75;
const WOBBLE_MAX = 1.15; // radians, ~66° either side of the chosen direction
const NAIL = {
  speed: 220,
  damage: 14,
  radius: 2,
  life: 1.4,
  push: 55,
  cd: 0.5,
};
const CLUB = { range: 26, damage: 16, spread: 0.3, push: 70, cd: 0.5 };
const POUNCE = {
  speed: 230,
  duration: 0.22,
  cd: 2.6,
  hitRadius: 13,
  damage: 12,
  pull: 50,
  pinRadius: 16,
  pinDuration: 0.45,
  pinInterval: 0.15,
  pinDamage: 5,
  pinPull: 30,
};
const SLAM = {
  speed: 240,
  duration: 0.25,
  cd: 5.5,
  hitRadius: 15,
  damage: 30,
  push: 150,
};
const labels = ["Гвозди", "Наскок", "Оторвать ногу", "Тяжёлый прыжок"];

let ready = [0, 0, 0, 0],
  melee = false,
  pounceUntil = 0,
  pounceAim = { x: 1, y: 0 },
  pounceHits = [],
  pinUntil = 0,
  nextPinTick = 0,
  slamUntil = 0,
  slamAim = { x: 1, y: 0 },
  slamHits = [];

const alive = (ctx) => {
  const m = ctx.api.entity(ctx.selfId);
  return m && m.hp > 0 ? m : null;
};

// Three incommensurate sine waves summed and scaled: same (time, seed) always
// gives the same offset, so the chaos is deterministic instead of relying on
// Math.random (which would make replays and tests non-reproducible).
function chaosOffset(t, seed) {
  const s =
    Math.sin(t * 11 + seed) * 0.5 +
    Math.sin(t * 4.3 + seed * 2.2) * 0.35 +
    Math.sin(t * 23 + seed * 0.6) * 0.15;
  return s * WOBBLE_MAX;
}

function fireNail(ctx, me, aim) {
  ctx.api.spawn({
    x: me.x + aim.x * (me.radius + 4),
    y: me.y + aim.y * (me.radius + 4),
    vx: aim.x * NAIL.speed,
    vy: aim.y * NAIL.speed,
    angle: Math.atan2(aim.y, aim.x),
    radius: NAIL.radius,
    hp: 1,
    solid: false,
    contact: true,
    lifetime: NAIL.life,
    sprite: "nail",
    tags: ["nail"],
  });
  ctx.api.sound("clack", { volume: 0.6 });
}

function club(ctx, me) {
  const aim = ctx.input.aim;
  let any = false;
  for (const e of ctx.api.queryCircle({
    x: me.x,
    y: me.y,
    radius: CLUB.range,
  })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(me, e))
      continue;
    const dx = e.x - me.x,
      dy = e.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    if ((dx * aim.x + dy * aim.y) / d < CLUB.spread) continue;
    any = true;
    ctx.api.damage(e.id, CLUB.damage, me.id);
    ctx.api.impulse(e.id, { x: (dx / d) * CLUB.push, y: (dy / d) * CLUB.push });
  }
  ctx.api.effect({
    kind: "sprite",
    asset: "leg",
    attach: { id: me.id },
    angle: Math.atan2(aim.y, aim.x),
    scale: 1.3,
    duration: 0.16,
  });
  ctx.api.sound("clack", { volume: any ? 1 : 0.6 });
  ctx.api.shake(any ? 2 : 1, 0.1);
}

defineCharacter({
  update(ctx) {
    const me = alive(ctx);
    if (!me) return;
    const t = ctx.world.time;
    const dashingPounce = t < pounceUntil;
    const dashingSlam = t < slamUntil;
    const aim = ctx.input.aim;
    let vx = 0,
      vy = 0;
    if (dashingSlam) {
      vx = slamAim.x * SLAM.speed;
      vy = slamAim.y * SLAM.speed;
    } else if (dashingPounce) {
      vx = pounceAim.x * POUNCE.speed;
      vy = pounceAim.y * POUNCE.speed;
    } else {
      const move = ctx.input.move;
      if (move.x !== 0 || move.y !== 0) {
        const baseAngle = Math.atan2(move.y, move.x);
        const off = chaosOffset(t, ctx.ownerId * 3.77);
        const speed = melee ? SPEED * MELEE_SPEED_MUL : SPEED;
        vx = Math.cos(baseAngle + off) * speed;
        vy = Math.sin(baseAngle + off) * speed;
      }
    }
    ctx.api.patch(me.id, { vx, vy, angle: Math.atan2(aim.y, aim.x) });

    if (dashingPounce) {
      for (const e of ctx.api.queryCircle({
        x: me.x,
        y: me.y,
        radius: POUNCE.hitRadius,
      })) {
        if (
          e.ownerId === ctx.ownerId ||
          e.hp <= 0 ||
          pounceHits.includes(e.id) ||
          !ctx.api.lineOfSight(me, e)
        )
          continue;
        pounceHits.push(e.id);
        ctx.api.damage(e.id, POUNCE.damage, me.id);
        const dx = e.x - me.x,
          dy = e.y - me.y,
          d = Math.hypot(dx, dy) || 1;
        ctx.api.impulse(e.id, {
          x: -(dx / d) * POUNCE.pull,
          y: -(dy / d) * POUNCE.pull,
        });
        pinUntil = t + POUNCE.pinDuration;
        nextPinTick = t;
        ctx.api.effect({
          kind: "sprite",
          asset: "leg",
          x: e.x,
          y: e.y,
          scale: 1.4,
          duration: 0.2,
        });
        ctx.api.sound("creak", { volume: 0.9 });
        ctx.api.shake(2, 0.12);
      }
    }
    if (dashingSlam) {
      for (const e of ctx.api.queryCircle({
        x: me.x,
        y: me.y,
        radius: SLAM.hitRadius,
      })) {
        if (
          e.ownerId === ctx.ownerId ||
          e.hp <= 0 ||
          slamHits.includes(e.id) ||
          !ctx.api.lineOfSight(me, e)
        )
          continue;
        slamHits.push(e.id);
        ctx.api.damage(e.id, SLAM.damage, me.id);
        const dx = e.x - me.x,
          dy = e.y - me.y,
          d = Math.hypot(dx, dy) || 1;
        ctx.api.impulse(e.id, {
          x: (dx / d) * SLAM.push,
          y: (dy / d) * SLAM.push,
        });
        ctx.api.effect({
          kind: "sprite",
          asset: "leg",
          x: e.x,
          y: e.y,
          scale: 2,
          duration: 0.28,
        });
        ctx.api.sound("creak", { volume: 1 });
        ctx.api.shake(4, 0.2);
      }
    }
    if (t < pinUntil && t >= nextPinTick) {
      nextPinTick = t + POUNCE.pinInterval;
      let any = false;
      for (const e of ctx.api.queryCircle({
        x: me.x,
        y: me.y,
        radius: POUNCE.pinRadius,
      })) {
        if (e.ownerId === ctx.ownerId || e.hp <= 0) continue;
        any = true;
        ctx.api.damage(e.id, POUNCE.pinDamage, me.id);
        const dx = e.x - me.x,
          dy = e.y - me.y,
          d = Math.hypot(dx, dy) || 1;
        ctx.api.impulse(e.id, {
          x: -(dx / d) * POUNCE.pinPull,
          y: -(dy / d) * POUNCE.pinPull,
        });
      }
      ctx.api.effect({
        attach: { id: me.id },
        radius: POUNCE.pinRadius,
        color: "#c9a15a",
        duration: POUNCE.pinInterval,
      });
      if (any) ctx.api.sound("clack", { volume: 0.5 });
    }

    for (let i = 0; i < 4; i++)
      ctx.api.slot(i, {
        label:
          i === 0
            ? melee
              ? "Дубина"
              : "Гвозди"
            : i === 2
              ? melee
                ? "Приделать ногу"
                : "Оторвать ногу"
              : labels[i],
        cooldown: Math.max(0, ready[i] - t),
        active:
          (i === 1 && dashingPounce) ||
          (i === 2 && melee) ||
          (i === 3 && dashingSlam),
      });
  },
  ability(ctx, { slot, phase }) {
    const me = alive(ctx),
      t = ctx.world.time;
    if (!me || phase !== "press" || t < ready[slot]) return;
    if (slot === 0) {
      if (melee) club(ctx, me);
      else fireNail(ctx, me, ctx.input.aim);
      ready[0] = t + (melee ? CLUB.cd : NAIL.cd);
    } else if (slot === 1) {
      pounceAim = { ...ctx.input.aim };
      pounceUntil = t + POUNCE.duration;
      pounceHits = [];
      ready[1] = t + POUNCE.cd;
    } else if (slot === 2) {
      melee = !melee;
      ctx.api.patch(me.id, { sprite: melee ? "body_melee" : "body" });
      ctx.api.sound("creak", { volume: 0.8 });
      ready[2] = t + 1.2;
    } else if (slot === 3) {
      slamAim = { ...ctx.input.aim };
      slamUntil = t + SLAM.duration;
      slamHits = [];
      ready[3] = t + SLAM.cd;
    }
  },
  event(ctx, ev) {
    if (ev.type !== "contact") return;
    const nail = ctx.api.entity(ev.entityId);
    if (!nail || !nail.tags.includes("nail")) return;
    if (ev.kind === "entity" && ev.otherOwnerId === ctx.ownerId) return;
    if (ev.kind === "entity") {
      ctx.api.damage(ev.otherId, NAIL.damage, nail.id);
      ctx.api.impulse(ev.otherId, {
        x: -ev.normal.x * NAIL.push,
        y: -ev.normal.y * NAIL.push,
      });
    }
    ctx.api.effect({
      kind: "sprite",
      asset: "spark",
      x: ev.point.x,
      y: ev.point.y,
      scale: 1.2,
      duration: 0.18,
    });
    ctx.api.destroy(nail.id);
  },
});
