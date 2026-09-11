// Bud: grows 10% per real hit, splits into five seeds on its first death,
// then fights as a steerable group. Everything below is generic API usage.
const BASE_R = 7,
  MAX_R = 20,
  SPEED = 66;
const FORMS = [
  { label: "Volley", body: "body", seed: "seed", color: "#9be564" },
  { label: "Lash", body: "thorn", seed: "seedthorn", color: "#f07ae0" },
];
let ready = [0, 0, 0, 0],
  form = 0,
  wide = false,
  split = false;
const alive = (ctx) =>
  ctx.world.entities.filter((e) => e.ownerId === ctx.ownerId && e.hp > 0);
const bodies = (ctx) => alive(ctx).filter((e) => e.tags.includes("body"));
const foes = (ctx) =>
  ctx.world.entities.filter((e) => e.ownerId !== ctx.ownerId && e.hp > 0);
function center(list) {
  let x = 0,
    y = 0;
  for (const e of list) {
    x += e.x;
    y += e.y;
  }
  return { x: x / list.length, y: y / list.length };
}
function volley(ctx) {
  const aim = ctx.input.aim,
    angle = Math.atan2(aim.y, aim.x);
  for (const b of bodies(ctx))
    ctx.api.spawn({
      x: b.x + aim.x * (b.radius + 3),
      y: b.y + aim.y * (b.radius + 3),
      vx: aim.x * 220,
      vy: aim.y * 220,
      angle,
      radius: 2,
      hp: 1,
      sprite: "shot",
      contact: true,
      lifetime: 1.2,
      tags: ["shot"],
    });
  ctx.api.sound("pop", { volume: 0.5 });
}
function lash(ctx) {
  const aim = ctx.input.aim,
    ignore = alive(ctx).map((e) => e.id);
  for (const b of bodies(ctx)) {
    const to = { x: b.x + aim.x * 64, y: b.y + aim.y * 64 };
    const hit = ctx.api.raycast({ from: { x: b.x, y: b.y }, to, ignore })[0];
    if (hit && hit.kind === "entity") {
      ctx.api.damage(hit.id, 14, b.id);
      ctx.api.impulse(hit.id, { x: aim.x * 90, y: aim.y * 90 });
      ctx.api.effect({
        x: hit.point.x,
        y: hit.point.y,
        radius: 6,
        color: FORMS[1].color,
        duration: 0.2,
      });
    }
    ctx.api.effect({
      kind: "beam",
      attach: { id: b.id },
      to: hit ? hit.point : to,
      width: 2,
      color: FORMS[1].color,
      duration: 0.14,
      fadeOut: 0.08,
    });
  }
  ctx.api.sound("pop", { volume: 0.8 });
  ctx.api.shake(1, 0.1);
}
function seek(ctx, id) {
  const m = ctx.api.entity(id);
  if (!m) return;
  let best = null,
    bestD = Infinity;
  for (const f of foes(ctx)) {
    const d = Math.hypot(f.x - m.x, f.y - m.y) - (f.countsForDefeat ? 1e4 : 0);
    if (d < bestD) ((bestD = d), (best = f));
  }
  if (!best) return ctx.api.patch(id, { vx: 0, vy: 0 });
  const dx = best.x - m.x,
    dy = best.y - m.y,
    d = Math.hypot(dx, dy) || 1;
  ctx.api.patch(id, {
    vx: (dx / d) * 30,
    vy: (dy / d) * 30,
    angle: Math.atan2(dy, dx),
  });
}
function dropMine(ctx) {
  const c = center(bodies(ctx)),
    aim = ctx.input.aim;
  const id = ctx.api.spawn({
    x: c.x + aim.x * 12,
    y: c.y + aim.y * 12,
    radius: 3,
    hp: 10,
    sprite: "mine",
    contact: true,
    lifetime: 8,
    tags: ["mine"],
  });
  ctx.api.every(0.05, (c2) => seek(c2, id), { entityId: id });
  ctx.api.effect({
    attach: { id },
    radius: 7,
    color: "#e0d060",
    duration: 0.4,
  });
  ctx.api.sound("pop", { volume: 0.4 });
}
function explode(ctx, m) {
  for (const f of ctx.api.queryCircle({ x: m.x, y: m.y, radius: 26 })) {
    if (f.ownerId === ctx.ownerId || f.hp <= 0) continue;
    const dx = f.x - m.x,
      dy = f.y - m.y,
      d = Math.hypot(dx, dy) || 1;
    ctx.api.damage(f.id, 30, m.id);
    ctx.api.impulse(f.id, { x: (dx / d) * 160, y: (dy / d) * 160 });
  }
  ctx.api.sequence(
    [
      {
        effect: {
          x: m.x,
          y: m.y,
          radius: 26,
          color: "#ffb347",
          duration: 0.35,
        },
      },
      {
        effect: {
          kind: "sprite",
          asset: "boom",
          x: m.x,
          y: m.y,
          scale: 2,
          duration: 0.3,
        },
      },
      { sound: "boom_sfx" },
      { shake: { amount: 4, seconds: 0.25 } },
      { wait: 0.1 },
      {
        effect: { x: m.x, y: m.y, radius: 12, color: "#fff2a0", duration: 0.2 },
      },
    ],
    { entityId: null },
  );
}
function morph(ctx) {
  form = 1 - form;
  const color = FORMS[form].color;
  for (const b of bodies(ctx))
    ctx.api.effect({
      attach: { id: b.id },
      radius: b.radius + 4,
      color,
      duration: 0.3,
    });
  ctx.api.sequence(
    [
      { sound: "pop", options: { volume: 0.8 } },
      { wait: 0.1 },
      {
        run: (c2) => {
          for (const b of bodies(c2))
            c2.api.patch(b.id, {
              sprite: b.tags.includes("main")
                ? FORMS[form].body
                : FORMS[form].seed,
            });
        },
      },
    ],
    { entityId: null },
  );
}
function burst(ctx, me) {
  split = true;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const id = ctx.api.spawn({
      x: me.x + Math.cos(a) * 10,
      y: me.y + Math.sin(a) * 10,
      angle: a,
      radius: 4,
      hp: 20,
      solid: true,
      countsForDefeat: true,
      sprite: FORMS[form].seed,
      width: 8,
      height: 8,
      tags: ["body", "seed"],
    });
    ctx.api.impulse(id, { x: Math.cos(a) * 80, y: Math.sin(a) * 80 });
  }
  const color = FORMS[form].color;
  ctx.api.sequence(
    [
      {
        effect: {
          x: me.x,
          y: me.y,
          radius: me.radius + 6,
          color,
          duration: 0.3,
        },
      },
      { sound: "pop" },
      { shake: { amount: 3, seconds: 0.2 } },
      { wait: 0.12 },
      { effect: { x: me.x, y: me.y, radius: 24, color, duration: 0.3 } },
      { wait: 0.12 },
      { effect: { x: me.x, y: me.y, radius: 34, color, duration: 0.3 } },
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
    const c = center(list),
      aim = ctx.input.aim,
      angle = Math.atan2(aim.y, aim.x),
      n = list.length,
      ring = wide ? 20 : 0;
    list.forEach((e, i) => {
      let fx = 0,
        fy = 0;
      if (n > 1) {
        const a = (i / n) * Math.PI * 2,
          dx = c.x + Math.cos(a) * ring - e.x,
          dy = c.y + Math.sin(a) * ring - e.y,
          d = Math.hypot(dx, dy),
          s = Math.min(d * 5, 70);
        if (d > 0.5) ((fx = (dx / d) * s), (fy = (dy / d) * s));
      }
      ctx.api.patch(e.id, {
        vx: ctx.input.move.x * SPEED + fx,
        vy: ctx.input.move.y * SPEED + fy,
        angle,
      });
    });
    const labels = [
      FORMS[form].label,
      wide ? "Wide" : "Tight",
      "Mine",
      "Morph",
    ];
    for (let i = 0; i < 4; i++)
      ctx.api.slot(i, {
        label: labels[i],
        cooldown: Math.max(0, ready[i] - ctx.world.time),
        active: i === 1 ? wide : i === 3 ? form === 1 : false,
      });
  },
  ability(ctx, { slot, phase }) {
    if (
      phase !== "press" ||
      ctx.world.time < ready[slot] ||
      !bodies(ctx).length
    )
      return;
    const t = ctx.world.time;
    if (slot === 0) {
      if (form === 0) (volley(ctx), (ready[0] = t + 0.45));
      else (lash(ctx), (ready[0] = t + 0.7));
    }
    if (slot === 1) {
      wide = !wide;
      ctx.api.sound("pop", { volume: 0.3 });
      ready[1] = t + 0.25;
    }
    if (slot === 2) (dropMine(ctx), (ready[2] = t + 3));
    if (slot === 3) (morph(ctx), (ready[3] = t + 1));
  },
  event(ctx, ev) {
    const me = ctx.api.entity(ev.entityId);
    if (!me) return;
    if (ev.type === "damageReceived") {
      if (ev.entityId !== ctx.selfId || ev.amount <= 0 || me.hp <= 0) return;
      const radius = Math.min(MAX_R, me.radius * 1.1);
      ctx.api.patch(me.id, { radius, scale: radius / BASE_R });
      ctx.api.effect({
        attach: { id: me.id },
        radius: radius + 4,
        color: FORMS[form].color,
        duration: 0.3,
      });
      ctx.api.sound("pop", { volume: 0.25 });
    } else if (ev.type === "death") {
      if (ev.entityId === ctx.selfId && !split) burst(ctx, me);
      else if (me.tags.includes("mine") && ev.reason === "damage")
        explode(ctx, me);
      else if (me.tags.includes("mine") && ev.reason === "expired")
        ctx.api.effect({
          x: me.x,
          y: me.y,
          radius: 5,
          color: "#8a8a60",
          duration: 0.25,
        });
    } else if (ev.type === "contact") {
      if (me.tags.includes("shot")) {
        if (ev.kind === "entity" && ev.otherOwnerId === ctx.ownerId) return;
        if (ev.kind === "entity") {
          const v = Math.hypot(me.vx, me.vy) || 1;
          ctx.api.damage(ev.otherId, 10, me.id);
          ctx.api.impulse(ev.otherId, {
            x: (me.vx / v) * 40,
            y: (me.vy / v) * 40,
          });
        }
        ctx.api.effect({
          x: ev.point.x,
          y: ev.point.y,
          radius: ev.kind === "entity" ? 5 : 3,
          color: ev.kind === "entity" ? "#ffffff" : "#8a8a60",
          duration: 0.15,
        });
        ctx.api.destroy(me.id);
      } else if (me.tags.includes("mine")) {
        if (ev.kind === "entity") {
          if (ev.otherOwnerId === ctx.ownerId) return;
          explode(ctx, me);
          ctx.api.destroy(me.id);
        } else {
          const n = ev.normal,
            dot = me.vx * n.x + me.vy * n.y;
          ctx.api.patch(me.id, {
            x: ev.point.x + n.x * 0.5,
            y: ev.point.y + n.y * 0.5,
            vx: me.vx - dot * n.x,
            vy: me.vy - dot * n.y,
          });
        }
      }
    }
  },
});
