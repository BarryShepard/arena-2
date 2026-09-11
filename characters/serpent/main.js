// Serpent: тело не умеет стоять на месте — vx/vy каждый tick пересчитываются из
// текущего угла головы (headAngle). Угол мгновенно переключается на последнее
// нажатое направление (как angle = atan2(aim) у всех остальных персонажей), без
// собственного "стояния": нет направления — держит предыдущий курс. Два
// хвостовых сегмента — visual-only сущности (solid:false), которые каждый tick
// ставятся на фиксированную дистанцию позади головы вдоль истории её позиций
// (history + trailPoint); резкий разворот проводит голову рядом с этим же
// хвостом на записанном пути — так голова физически кусает свой tailtip.
// Урон о стену/кирпич считается напрямую в update() по позиции и курсу: solid
// тело каждый tick заново прижимается host'ом clamp() ровно к границе (никогда
// не заходит за неё), поэтому prev→pos отрезок sweep не пересекает границу и
// событие contact 'brick'/'bounds' для собственного solid-тела почти никогда
// не приходит — оно рассчитано на снаряды, которые реально пролетают сквозь
// границу. Самоукус, наоборот, детектится честным contact: голова (contact:
// true) реально проходит сквозь non-solid tailtip, а не прижимается к нему.
// Яд не наносит урона и не может напрямую занулить чужую vx/vy (нет такого API) —
// паралич сделан как в Puffer: гасящий встречный impulse каждый tick, только
// полный, а не частичный. Невидимость — generic-поле сущности `visible`.
const SPEED = 70;
const TAIL_RADIUS = 6;
const SEGMENT_GAP = 16;
const HISTORY_MAX = 600;
const BITE = {
  radius: 26,
  arc: Math.acos(0.3),
  damage: 13,
  cd: 0.38,
  push: 55,
};
const SPIT = { speed: 150, radius: 3, life: 1.0, cd: 3.2, paralyze: 0.8 };
const SKIN = { radius: 12, hp: 34, life: 8, cd: 6 };
const VEIL = { duration: 3.5, cd: 8 };
const WALL = { amount: 8, cd: 0.5, push: 42 };
const SELF_BITE = { amount: 10, cd: 0.5 };
const labels = ["Укус", "Ядовитый плевок", "Сброс кожи", "Невидимость"];
let ready = [0, 0, 0, 0],
  headAngle = 0,
  history = [],
  seg1Id = null,
  seg2Id = null,
  poisoned = [],
  invisibleUntil = 0,
  wallReadyAt = 0,
  selfBiteReadyAt = 0;
const alive = (ctx) => {
  const m = ctx.api.entity(ctx.selfId);
  return m && m.hp > 0 ? m : null;
};
// Outward unit normal of whatever the head currently rests against (arena
// bounds, then bricks), or null if it isn't touching anything solid.
function restingNormal(me, world) {
  const eps = 0.75;
  if (me.x <= me.radius + eps) return { x: 1, y: 0 };
  if (me.x >= world.width - me.radius - eps) return { x: -1, y: 0 };
  if (me.y <= me.radius + eps) return { x: 0, y: 1 };
  if (me.y >= world.height - me.radius - eps) return { x: 0, y: -1 };
  for (const r of world.obstacles) {
    const px = Math.max(r.x, Math.min(r.x + r.w, me.x)),
      py = Math.max(r.y, Math.min(r.y + r.h, me.y)),
      dx = me.x - px,
      dy = me.y - py,
      d = Math.hypot(dx, dy);
    if (d <= me.radius + eps)
      return d > 0 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
  }
  return null;
}
// Walks the recorded path backwards from the current head position (last entry)
// looking for the point `dist` units of arc-length behind it.
function trailPoint(dist) {
  if (history.length < 2) return history[0] ?? { x: 0, y: 0 };
  let remaining = dist;
  for (let i = history.length - 1; i > 0; i--) {
    const a = history[i],
      b = history[i - 1],
      segLen = Math.hypot(a.x - b.x, a.y - b.y);
    if (segLen >= remaining) {
      const t = segLen === 0 ? 0 : remaining / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segLen;
  }
  return history[0];
}
function bite(ctx, me) {
  const aim = { x: Math.cos(headAngle), y: Math.sin(headAngle) };
  let any = false;
  for (const e of ctx.api.queryCircle({
    x: me.x,
    y: me.y,
    radius: BITE.radius,
  })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0 || !ctx.api.lineOfSight(me, e))
      continue;
    const dx = e.x - me.x,
      dy = e.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    if ((dx * aim.x + dy * aim.y) / d < 0.3) continue;
    any = true;
    ctx.api.damage(e.id, BITE.damage, me.id);
    ctx.api.impulse(e.id, { x: (dx / d) * BITE.push, y: (dy / d) * BITE.push });
  }
  ctx.api.effect({
    x: me.x,
    y: me.y,
    radius: BITE.radius,
    angle: headAngle,
    arc: BITE.arc,
    color: "#ffe27a",
    duration: 0.18,
  });
  ctx.api.sound("hiss", { volume: any ? 1 : 0.5 });
  ctx.api.shake(any ? 2 : 1, 0.12);
}
function spit(ctx, me) {
  const aim = { x: Math.cos(headAngle), y: Math.sin(headAngle) },
    r = me.radius + 4,
    veiled = ctx.world.time < invisibleUntil;
  ctx.api.spawn({
    x: me.x + aim.x * r,
    y: me.y + aim.y * r,
    vx: aim.x * SPIT.speed,
    vy: aim.y * SPIT.speed,
    angle: headAngle,
    radius: SPIT.radius,
    hp: 1,
    solid: false,
    contact: true,
    lifetime: SPIT.life,
    sprite: "spit",
    tags: ["spit"],
    visible: !veiled,
  });
  ctx.api.sound("spit_sfx", { volume: 0.5 });
}
function shed(ctx, me) {
  ctx.api.spawn({
    x: me.x,
    y: me.y,
    radius: SKIN.radius,
    hp: SKIN.hp,
    solid: true,
    countsForDefeat: false,
    sprite: "skin",
    lifetime: SKIN.life,
    tags: ["barrier"],
  });
  ctx.api.effect({
    attach: { id: me.id },
    radius: SKIN.radius,
    color: "#8fe37a",
    duration: 0.3,
  });
  ctx.api.sound("shed", { volume: 0.6 });
}
function veil(ctx) {
  const t = ctx.world.time;
  invisibleUntil = t + VEIL.duration;
  for (const id of [ctx.selfId, seg1Id, seg2Id])
    if (id) ctx.api.patch(id, { visible: false });
  ctx.api.effect({
    attach: { id: ctx.selfId },
    radius: 16,
    color: "#5c6b7a",
    duration: 0.3,
  });
  ctx.api.sound("shed", { volume: 0.35 });
  ctx.api.after(
    VEIL.duration,
    (c) => {
      for (const id of [c.selfId, seg1Id, seg2Id]) {
        if (!id) continue;
        const e = c.api.entity(id);
        if (e && e.hp > 0) c.api.patch(id, { visible: true });
      }
    },
    { entityId: null },
  );
}
defineCharacter({
  spawn(ctx) {
    const me = ctx.api.entity(ctx.selfId);
    ctx.api.patch(ctx.selfId, { contact: true });
    headAngle = me.angle;
    const dir = { x: Math.cos(headAngle), y: Math.sin(headAngle) };
    seg1Id = ctx.api.spawn({
      x: me.x - dir.x * SEGMENT_GAP,
      y: me.y - dir.y * SEGMENT_GAP,
      radius: TAIL_RADIUS,
      hp: 999,
      solid: false,
      countsForDefeat: false,
      sprite: "body",
      width: 13,
      height: 13,
      angle: headAngle,
      tags: ["tail"],
    });
    seg2Id = ctx.api.spawn({
      x: me.x - dir.x * SEGMENT_GAP * 2,
      y: me.y - dir.y * SEGMENT_GAP * 2,
      radius: TAIL_RADIUS,
      hp: 999,
      solid: false,
      countsForDefeat: false,
      sprite: "body",
      width: 11,
      height: 11,
      angle: headAngle,
      tags: ["tail", "tailtip"],
    });
    history = [];
    const maxD = SEGMENT_GAP * 2 + 20;
    for (let d = maxD; d >= 0; d -= 2)
      history.push({ x: me.x - dir.x * d, y: me.y - dir.y * d });
  },
  update(ctx) {
    const me = alive(ctx);
    if (!me) return;
    const t = ctx.world.time,
      { move } = ctx.input;
    if (move.x || move.y) headAngle = Math.atan2(move.y, move.x);
    ctx.api.patch(me.id, {
      vx: Math.cos(headAngle) * SPEED,
      vy: Math.sin(headAngle) * SPEED,
      angle: headAngle,
    });
    history.push({ x: me.x, y: me.y });
    if (history.length > HISTORY_MAX) history.shift();
    const p1 = trailPoint(SEGMENT_GAP),
      p2 = trailPoint(SEGMENT_GAP * 2);
    ctx.api.patch(seg1Id, { x: p1.x, y: p1.y, angle: headAngle });
    ctx.api.patch(seg2Id, { x: p2.x, y: p2.y, angle: headAngle });
    const wall = restingNormal(me, ctx.world);
    if (
      wall &&
      Math.cos(headAngle) * wall.x + Math.sin(headAngle) * wall.y < -0.2 &&
      t >= wallReadyAt
    ) {
      wallReadyAt = t + WALL.cd;
      ctx.api.damage(me.id, WALL.amount, me.id);
      ctx.api.impulse(me.id, { x: wall.x * WALL.push, y: wall.y * WALL.push });
      ctx.api.effect({
        attach: { id: me.id },
        radius: 14,
        color: "#ff8a5c",
        duration: 0.2,
      });
      ctx.api.sound("hiss", { volume: 0.8 });
      ctx.api.shake(2, 0.15);
    }
    poisoned = poisoned.filter((p) => p.until > t);
    for (const p of poisoned) {
      const e = ctx.api.entity(p.id);
      if (!e || e.hp <= 0) continue;
      const vx = e.vx + (e.ix || 0),
        vy = e.vy + (e.iy || 0);
      if (vx || vy) ctx.api.impulse(e.id, { x: -vx, y: -vy });
    }
    for (let i = 0; i < 4; i++)
      ctx.api.slot(i, {
        label: labels[i],
        cooldown: Math.max(0, ready[i] - t),
        active: i === 3 && t < invisibleUntil,
      });
  },
  ability(ctx, { slot, phase }) {
    const me = alive(ctx),
      t = ctx.world.time;
    if (!me || phase !== "press") return;
    if (slot === 0) {
      if (t < ready[0]) return;
      ready[0] = t + BITE.cd;
      bite(ctx, me);
    } else if (slot === 1) {
      if (t < ready[1]) return;
      ready[1] = t + SPIT.cd;
      spit(ctx, me);
    } else if (slot === 2) {
      if (t < ready[2]) return;
      ready[2] = t + SKIN.cd;
      shed(ctx, me);
    } else if (slot === 3) {
      if (t < ready[3]) return;
      ready[3] = t + VEIL.cd;
      veil(ctx);
    }
  },
  event(ctx, ev) {
    if (ev.type !== "contact") return;
    const t = ctx.world.time;
    if (ev.entityId === ctx.selfId) {
      if (ev.kind !== "entity") return;
      const other = ctx.api.entity(ev.otherId);
      if (
        !other ||
        other.ownerId !== ctx.ownerId ||
        !other.tags.includes("tailtip")
      )
        return;
      if (t < selfBiteReadyAt) return;
      selfBiteReadyAt = t + SELF_BITE.cd;
      ctx.api.damage(ctx.selfId, SELF_BITE.amount, ctx.selfId);
      ctx.api.effect({
        attach: { id: ctx.selfId },
        radius: 12,
        color: "#c65cff",
        duration: 0.2,
      });
      ctx.api.sound("hiss", { volume: 0.7 });
      ctx.api.shake(2, 0.15);
      return;
    }
    const shot = ctx.api.entity(ev.entityId);
    if (!shot || !shot.tags.includes("spit")) return;
    // The spit is launched from the head's own position along its own heading,
    // and the head keeps chasing in that exact direction every tick — so on
    // the spawn tick it can start out closer to the head's *new* position than
    // to the spot it was launched from. Ignore that self-contact entirely
    // (don't even destroy the spit) instead of just skipping the poison.
    if (ev.kind === "entity" && ev.otherOwnerId === ctx.ownerId) return;
    if (ev.kind === "entity") {
      poisoned.push({ id: ev.otherId, until: t + SPIT.paralyze });
      ctx.api.effect({
        kind: "sprite",
        asset: "spit",
        x: ev.point.x,
        y: ev.point.y,
        scale: 1.6,
        duration: 0.3,
      });
      ctx.api.sound("spit_sfx", { volume: 0.6 });
    }
    ctx.api.destroy(shot.id);
  },
});
