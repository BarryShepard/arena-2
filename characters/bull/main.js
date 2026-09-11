// Bull: flying bull's-head melee killer. Horns fires forward and grants a
// flat shield, Lasso yanks the nearest foe in and holds them still (no API
// to freeze a foreign entity's own velocity, so the "stun" cancels their net
// motion every tick the way Puffer's puddles cancel it partially), Rider
// teleports onto a foe's head and chokes them down, and Minotaur is a
// transformation that immediately grabs and eats whoever is closest, then
// leaves the Bull bigger, faster and tougher for a few seconds. Passive: any
// enemy the Bull damages directly starts bleeding, losing a little health
// each second for 5s.
const BASE_RADIUS = 7;
const SPEED = 78;
const HORNS = {
  range: 130,
  spread: 0.5,
  damage: 16,
  push: 70,
  cd: 1.6,
  shieldAmount: 22,
  shieldDuration: 4,
};
const HOOK = { range: 110, spread: 0.5, stun: 0.8, pull: 260, cd: 5 };
const CHOKE = {
  range: 180,
  spread: 0.4,
  duration: 1.5,
  tickInterval: 0.3,
  tickDamage: 7,
  cd: 6.5,
};
const MINO = {
  duration: 5,
  cd: 22,
  radiusMul: 1.5,
  scaleMul: 1.7,
  speedMul: 1.2,
  grabRange: 90,
  biteDuration: 0.9,
  biteTickInterval: 0.15,
  biteTickDamage: 12,
  healPct: 0.5,
};
const BLEED = { duration: 5, tickInterval: 1, tickDamage: 4 };
const labels = ["Рога", "Аркан", "Наездник", "Минотавр"];
let ready = [0, 0, 0, 0],
  shieldHp = 0,
  shieldUntil = 0,
  hookedId = null,
  hookUntil = 0,
  mountedId = null,
  mountUntil = 0,
  nextChokeTick = 0,
  transformed = false,
  minoUntil = 0,
  biteId = null,
  biteUntil = 0,
  nextBiteTick = 0,
  bleeds = [];
const alive = (ctx) => {
  const m = ctx.api.entity(ctx.selfId);
  return m && m.hp > 0 ? m : null;
};
function pickCone(ctx, me, range, spread) {
  const aim = ctx.input.aim;
  let target = null,
    bestD = Infinity;
  for (const e of ctx.api.queryCircle({ x: me.x, y: me.y, radius: range })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(me, e))
      continue;
    const dx = e.x - me.x,
      dy = e.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    if ((dx * aim.x + dy * aim.y) / d < spread) continue;
    if (d < bestD) {
      bestD = d;
      target = e;
    }
  }
  return target;
}
// Solid bodies can't share a center (collision resolution shoves overlapping
// entities apart along an arbitrary axis when the distance is exactly zero),
// so "landing on the enemy's head" means sitting just outside their circle,
// straight above it, rather than at their exact coordinates.
function perch(me, foe) {
  return { x: foe.x, y: foe.y - (me.radius + foe.radius) };
}
function pickNearest(ctx, me, range) {
  let target = null,
    bestD = Infinity;
  for (const e of ctx.api.queryCircle({ x: me.x, y: me.y, radius: range })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(me, e))
      continue;
    const d = Math.hypot(e.x - me.x, e.y - me.y);
    if (d < bestD) {
      bestD = d;
      target = e;
    }
  }
  return target;
}
function applyBleed(id, t) {
  let entry = bleeds.find((b) => b.id === id);
  if (!entry) {
    entry = { id, until: 0, next: t + BLEED.tickInterval };
    bleeds.push(entry);
  }
  entry.until = t + BLEED.duration;
}
function tickBleeds(ctx, me, t) {
  bleeds = bleeds.filter((b) => {
    const foe = ctx.api.entity(b.id);
    if (!foe || foe.hp <= 0 || t >= b.until) return false;
    if (t >= b.next) {
      b.next = t + BLEED.tickInterval;
      ctx.api.damage(foe.id, BLEED.tickDamage, me.id);
      ctx.api.effect({
        attach: { id: foe.id },
        radius: foe.radius + 3,
        color: "#8a1f1f",
        duration: 0.2,
      });
    }
    return true;
  });
}
function horns(ctx, me, t) {
  ready[0] = t + HORNS.cd;
  shieldHp = HORNS.shieldAmount;
  shieldUntil = t + HORNS.shieldDuration;
  const aim = ctx.input.aim;
  const target = pickCone(ctx, me, HORNS.range, HORNS.spread);
  ctx.api.effect({
    x: me.x,
    y: me.y,
    radius: HORNS.range,
    angle: Math.atan2(aim.y, aim.x),
    arc: Math.acos(HORNS.spread),
    color: "#caa46b",
    duration: 0.15,
  });
  ctx.api.effect({
    attach: { id: me.id },
    radius: me.radius + 6,
    color: "#f2c14e",
    duration: 0.3,
  });
  ctx.api.sound("roar", { volume: target ? 0.9 : 0.5 });
  ctx.api.shake(target ? 2 : 1, 0.1);
  if (!target) return;
  ctx.api.damage(target.id, HORNS.damage, me.id);
  const dx = target.x - me.x,
    dy = target.y - me.y,
    d = Math.hypot(dx, dy) || 1;
  ctx.api.impulse(target.id, {
    x: (dx / d) * HORNS.push,
    y: (dy / d) * HORNS.push,
  });
  applyBleed(target.id, t);
  ctx.api.effect({
    kind: "sprite",
    asset: "gore",
    x: target.x,
    y: target.y,
    scale: 1.3,
    duration: 0.25,
  });
}
function hook(ctx, me, t) {
  ready[1] = t + HOOK.cd;
  const target = pickCone(ctx, me, HOOK.range, HOOK.spread);
  ctx.api.effect({
    x: me.x,
    y: me.y,
    radius: HOOK.range,
    angle: Math.atan2(ctx.input.aim.y, ctx.input.aim.x),
    arc: Math.acos(HOOK.spread),
    color: "#7fbfff",
    duration: 0.2,
  });
  ctx.api.sound("crunch", { volume: target ? 0.8 : 0.3 });
  if (!target) return;
  hookedId = target.id;
  hookUntil = t + HOOK.stun;
  ctx.api.effect({
    attach: { id: target.id },
    radius: target.radius + 5,
    color: "#7fbfff",
    duration: HOOK.stun,
  });
}
function tickHook(ctx, me, t) {
  if (hookedId === null) return;
  const foe = ctx.api.entity(hookedId);
  if (!foe || foe.hp <= 0 || t >= hookUntil) {
    hookedId = null;
    return;
  }
  const vx = foe.vx + (foe.ix || 0),
    vy = foe.vy + (foe.iy || 0);
  if (Math.hypot(vx, vy) > 0.5) ctx.api.impulse(foe.id, { x: -vx, y: -vy });
  const dx = me.x - foe.x,
    dy = me.y - foe.y,
    d = Math.hypot(dx, dy) || 1,
    followDist = me.radius + foe.radius + 4;
  if (d > followDist)
    ctx.api.impulse(foe.id, {
      x: (dx / d) * HOOK.pull,
      y: (dy / d) * HOOK.pull,
    });
}
function mount(ctx, me, t) {
  ready[2] = t + CHOKE.cd;
  const target = pickCone(ctx, me, CHOKE.range, CHOKE.spread);
  ctx.api.sound("crunch", { volume: target ? 0.9 : 0.3 });
  if (!target) return;
  ctx.api.patch(me.id, { ...perch(me, target), vx: 0, vy: 0 });
  mountedId = target.id;
  mountUntil = t + CHOKE.duration;
  nextChokeTick = t;
  ctx.api.effect({
    attach: { id: target.id },
    radius: target.radius + 4,
    color: "#8a1f1f",
    duration: CHOKE.duration,
  });
  ctx.api.shake(2, 0.15);
}
function tickMount(ctx, me, t) {
  const foe = ctx.api.entity(mountedId);
  if (!foe || foe.hp <= 0 || t >= mountUntil) {
    mountedId = null;
    return;
  }
  ctx.api.patch(me.id, { ...perch(me, foe), vx: 0, vy: 0 });
  if (t >= nextChokeTick) {
    nextChokeTick = t + CHOKE.tickInterval;
    ctx.api.damage(foe.id, CHOKE.tickDamage, me.id);
    applyBleed(foe.id, t);
    ctx.api.effect({
      attach: { id: foe.id },
      radius: foe.radius + 2,
      color: "#5c1414",
      duration: CHOKE.tickInterval,
    });
    ctx.api.sound("crunch", { volume: 0.6 });
  }
}
function minotaur(ctx, me, t) {
  ready[3] = t + MINO.cd;
  transformed = true;
  minoUntil = t + MINO.duration;
  ctx.api.patch(me.id, {
    sprite: "minotaur",
    radius: BASE_RADIUS * MINO.radiusMul,
    scale: MINO.scaleMul,
  });
  ctx.api.effect({
    attach: { id: me.id },
    radius: BASE_RADIUS * MINO.radiusMul + 10,
    color: "#b23a3a",
    duration: 0.4,
  });
  ctx.api.sound("roar", { volume: 1 });
  ctx.api.shake(4, 0.25);
  const target = pickNearest(ctx, me, MINO.grabRange);
  if (!target) return;
  ctx.api.patch(me.id, perch(me, target));
  biteId = target.id;
  biteUntil = t + MINO.biteDuration;
  nextBiteTick = t;
  ctx.api.effect({
    attach: { id: target.id },
    radius: target.radius + 6,
    color: "#6b0f0f",
    duration: MINO.biteDuration,
  });
}
function tickBite(ctx, me, t) {
  const foe = ctx.api.entity(biteId);
  if (!foe || foe.hp <= 0 || t >= biteUntil) {
    if (foe && foe.hp > 0) {
      const dx = foe.x - me.x,
        dy = foe.y - me.y,
        d = Math.hypot(dx, dy) || 1;
      ctx.api.impulse(foe.id, { x: (dx / d) * 140, y: (dy / d) * 140 });
    }
    biteId = null;
    return;
  }
  ctx.api.patch(me.id, { ...perch(me, foe), vx: 0, vy: 0 });
  if (t >= nextBiteTick) {
    nextBiteTick = t + MINO.biteTickInterval;
    ctx.api.damage(foe.id, MINO.biteTickDamage, me.id);
    ctx.api.heal(me.id, MINO.biteTickDamage * MINO.healPct);
    applyBleed(foe.id, t);
    ctx.api.effect({
      attach: { id: foe.id },
      radius: foe.radius + 3,
      color: "#3d0a0a",
      duration: MINO.biteTickInterval,
    });
    ctx.api.sound("crunch", { volume: 0.9 });
    ctx.api.shake(2, 0.1);
  }
}
defineCharacter({
  update(ctx) {
    const me = alive(ctx);
    if (!me) return;
    const t = ctx.world.time;
    tickBleeds(ctx, me, t);
    tickHook(ctx, me, t);
    const riding = mountedId !== null,
      eating = biteId !== null;
    if (riding) tickMount(ctx, me, t);
    else if (eating) tickBite(ctx, me, t);
    else {
      const aim = ctx.input.aim,
        speed = SPEED * (transformed ? MINO.speedMul : 1);
      ctx.api.patch(me.id, {
        vx: ctx.input.move.x * speed,
        vy: ctx.input.move.y * speed,
        angle: Math.atan2(aim.y, aim.x),
      });
    }
    if (transformed && t >= minoUntil) {
      transformed = false;
      ctx.api.patch(me.id, {
        sprite: "body",
        radius: BASE_RADIUS,
        scale: 1,
      });
      ctx.api.effect({
        attach: { id: me.id },
        radius: BASE_RADIUS + 8,
        color: "#f2c14e",
        duration: 0.3,
      });
    }
    for (let i = 0; i < 4; i++)
      ctx.api.slot(i, {
        label: labels[i],
        cooldown: Math.max(0, ready[i] - t),
        active:
          (i === 0 && t < shieldUntil && shieldHp > 0) ||
          (i === 1 && hookedId !== null && t < hookUntil) ||
          (i === 2 && riding) ||
          (i === 3 && transformed),
      });
  },
  ability(ctx, { slot, phase }) {
    const me = alive(ctx),
      t = ctx.world.time;
    if (!me || phase !== "press" || t < ready[slot]) return;
    if (slot === 0) horns(ctx, me, t);
    else if (slot === 1) hook(ctx, me, t);
    else if (slot === 2) mount(ctx, me, t);
    else minotaur(ctx, me, t);
  },
  event(ctx, ev) {
    if (ev.type !== "beforeHit") return;
    if (shieldHp <= 0 || ctx.world.time >= shieldUntil) return;
    const absorb = Math.min(shieldHp, ev.amount);
    shieldHp -= absorb;
    return { amount: ev.amount - absorb };
  },
});
