// Mage: projectile bolt, two-phase blink anchor, damage zone, temporary turret.
// Every mechanic lives here; the engine only provides entities, contact, raycast, timers, effects.
const SPEED = 66,
  BOLT = { speed: 220, damage: 14, push: 90, life: 1.6, cooldown: 0.35 },
  ANCHOR_LIFE = 3,
  ZONE = { life: 3, radius: 18, tick: 0.25, damage: 4, cooldown: 4 },
  TURRET = { life: 5, hp: 40, range: 150, tick: 0.6, damage: 8, cooldown: 6 };
const labels = ["Bolt", "Anchor", "Zone", "Turret"];
let ready = [0, 0, 0, 0],
  anchor = null; // {x, y, timer} while an anchor is placed
const alive = (ctx) => {
  const me = ctx.api.entity(ctx.selfId);
  return me && me.hp > 0 ? me : null;
};
// Bolts and zones are never targets (also keeps mirror matches from eating each other's bolts).
const passive = (e) => e.tags.some((t) => t === "bolt" || t === "zone");
const foes = (ctx) =>
  ctx.world.entities.filter(
    (e) => e.ownerId !== ctx.ownerId && e.hp > 0 && !passive(e),
  );
const dirTo = (a, b) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

function castBolt(ctx, me, aim) {
  const r = me.radius + 4;
  ctx.api.spawn({
    x: me.x + aim.x * r,
    y: me.y + aim.y * r,
    vx: aim.x * BOLT.speed,
    vy: aim.y * BOLT.speed,
    angle: Math.atan2(aim.y, aim.x),
    radius: 3,
    hp: 1,
    solid: false,
    contact: true,
    lifetime: BOLT.life,
    sprite: "bolt",
    tags: ["bolt"],
  });
  ctx.api.sound("cast", { volume: 0.7 });
}
function placeAnchor(ctx, me) {
  anchor = {
    x: me.x,
    y: me.y,
    // Default scope = the mage itself: the timer dies with it.
    timer: ctx.api.after(ANCHOR_LIFE, () => {
      anchor = null;
    }),
  };
  ctx.api.effect({
    kind: "sprite",
    asset: "rune",
    x: me.x,
    y: me.y,
    duration: ANCHOR_LIFE,
    loop: true,
    fadeOut: 0.5,
  });
  ctx.api.sound("cast", { volume: 0.4 });
}
function blink(ctx, me) {
  const from = { x: me.x, y: me.y },
    to = anchor;
  ctx.api.cancel(anchor.timer);
  anchor = null;
  ctx.api.patch(me.id, { x: to.x, y: to.y });
  ctx.api.sequence([
    {
      effect: {
        x: from.x,
        y: from.y,
        radius: 12,
        color: "#b98cff",
        duration: 0.25,
      },
    },
    { sound: "cast", options: { volume: 1 } },
    { shake: { amount: 1, seconds: 0.08 } },
    { wait: 0.06 },
    {
      effect: {
        kind: "sprite",
        asset: "spark",
        attach: { id: me.id },
        scale: 2,
        duration: 0.25,
      },
    },
    { wait: 0.06 },
    {
      effect: {
        attach: { id: me.id },
        radius: 10,
        color: "#ffffff",
        duration: 0.2,
      },
    },
  ]);
}
function castZone(ctx, me, aim) {
  const id = ctx.api.spawn({
    x: me.x + aim.x * 30,
    y: me.y + aim.y * 30,
    radius: ZONE.radius,
    hp: 20,
    solid: false,
    sprite: "zone",
    width: 40,
    height: 40,
    lifetime: ZONE.life,
    tags: ["zone"],
  });
  // Bound to the zone: dropped automatically once the zone expires or dies.
  ctx.api.every(ZONE.tick, zoneTick, { entityId: id });
  ctx.api.sound("cast", { volume: 0.6 });
}
function zoneTick(ctx) {
  const zone = ctx.api.entity(ctx.entityId);
  if (!zone || !alive(ctx)) return;
  for (const e of ctx.api.queryCircle(zone)) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || passive(e)) continue;
    ctx.api.damage(e.id, ZONE.damage, zone.id);
    ctx.api.effect({
      kind: "sprite",
      asset: "spark",
      attach: { id: e.id },
      duration: 0.2,
    });
  }
  ctx.api.effect({
    attach: { id: zone.id },
    radius: zone.radius,
    color: "#c86bff",
    duration: ZONE.tick,
    fadeIn: 0.05,
  });
}
function castTurret(ctx, me, aim) {
  const x = me.x + aim.x * 22,
    y = me.y + aim.y * 22;
  const id = ctx.api.spawn({
    x,
    y,
    radius: 6,
    hp: TURRET.hp,
    solid: true,
    countsForDefeat: false,
    sprite: "turret",
    lifetime: TURRET.life,
    tags: ["turret"],
  });
  ctx.api.every(TURRET.tick, turretFire, { entityId: id });
  ctx.api.effect({
    kind: "sprite",
    asset: "rune",
    x,
    y,
    scale: 1.5,
    duration: 0.4,
  });
  ctx.api.sound("cast", { volume: 0.6 });
}
function turretFire(ctx) {
  const turret = ctx.api.entity(ctx.entityId);
  if (!turret || !alive(ctx)) return;
  let target = null,
    best = TURRET.range;
  for (const e of foes(ctx)) {
    const d = Math.hypot(e.x - turret.x, e.y - turret.y);
    if (d < best) {
      best = d;
      target = e;
    }
  }
  if (!target) return;
  // First brick/bounds or the target itself decides line of fire; stray entities are ignored.
  const hit = ctx.api
    .raycast({ from: turret, to: target, ignore: [turret.id] })
    .find((h) => h.kind !== "entity" || h.id === target.id);
  if (!hit || hit.id !== target.id) return;
  const dir = dirTo(turret, target);
  ctx.api.damage(target.id, TURRET.damage, turret.id);
  ctx.api.impulse(target.id, { x: dir.x * 40, y: dir.y * 40 });
  ctx.api.effect({
    kind: "beam",
    attach: { id: turret.id },
    to: hit.point,
    width: 2,
    color: "#d9b3ff",
    duration: 0.12,
    fadeOut: 0.08,
  });
  ctx.api.effect({
    kind: "sprite",
    asset: "spark",
    x: hit.point.x,
    y: hit.point.y,
    duration: 0.25,
  });
  ctx.api.sound("zap", { volume: 0.5 });
}
// Contact response for bolts: the host only reports the hit, the mod applies damage and destroys.
function boltContact(ctx, ev) {
  const bolt = ctx.api.entity(ev.entityId);
  if (!bolt || !bolt.tags.includes("bolt")) return;
  if (ev.kind === "entity") {
    if (ev.otherOwnerId === ctx.ownerId) return; // fly through own bodies
    const other = ctx.api.entity(ev.otherId);
    if (!other || other.hp <= 0 || passive(other)) return;
    ctx.api.damage(other.id, BOLT.damage, bolt.id);
    ctx.api.impulse(other.id, {
      x: -ev.normal.x * BOLT.push,
      y: -ev.normal.y * BOLT.push,
    });
  }
  ctx.api.effect({
    kind: "sprite",
    asset: "spark",
    x: ev.point.x,
    y: ev.point.y,
    duration: 0.24,
  });
  ctx.api.sound("zap", { volume: ev.kind === "entity" ? 0.8 : 0.3 });
  ctx.api.destroy(bolt.id);
}
defineCharacter({
  update(ctx) {
    const me = alive(ctx);
    if (!me) return;
    const { move, aim } = ctx.input;
    ctx.api.patch(me.id, {
      vx: move.x * SPEED,
      vy: move.y * SPEED,
      angle: Math.atan2(aim.y, aim.x),
    });
    for (let i = 0; i < 4; i++)
      ctx.api.slot(i, {
        label: i === 1 && anchor ? "Blink" : labels[i],
        cooldown: Math.max(0, ready[i] - ctx.world.time),
        active: i === 1 && !!anchor,
      });
  },
  ability(ctx, { slot, phase }) {
    const me = alive(ctx),
      t = ctx.world.time;
    if (!me || phase !== "press" || t < ready[slot]) return;
    const aim = ctx.input.aim;
    if (slot === 0) {
      castBolt(ctx, me, aim);
      ready[0] = t + BOLT.cooldown;
    } else if (slot === 1) {
      if (anchor) blink(ctx, me);
      else placeAnchor(ctx, me);
      ready[1] = t + 0.25;
    } else if (slot === 2) {
      castZone(ctx, me, aim);
      ready[2] = t + ZONE.cooldown;
    } else {
      castTurret(ctx, me, aim);
      ready[3] = t + TURRET.cooldown;
    }
  },
  event(ctx, ev) {
    if (ev.type === "contact") return boltContact(ctx, ev);
    if (ev.type !== "death") return;
    if (ev.entityId === ctx.selfId) {
      anchor = null;
      return;
    }
    const e = ctx.api.entity(ev.entityId);
    if (e && alive(ctx) && e.tags.some((t) => t === "zone" || t === "turret"))
      ctx.api.effect({
        x: e.x,
        y: e.y,
        radius: e.radius + 4,
        color: "#8f6bff",
        duration: 0.3,
      });
  },
});
