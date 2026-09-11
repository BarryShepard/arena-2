// Pure effect helpers (docs/tasks/task2-design.md §7). World stores
// {...validateEffect(spec), ownerId, at}; renderer draws via resolveEffect.
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const FIELDS = {
  ring: ["radius", "angle", "arc", "color"],
  sprite: ["asset", "scale", "angle", "loop"],
  beam: ["to", "attachTo", "width", "color"],
};
const COMMON = [
  "kind",
  "x",
  "y",
  "attach",
  "duration",
  "delay",
  "fadeIn",
  "fadeOut",
];
const num = (spec, key, min, strict) => {
  const v = spec[key];
  if (v === undefined) return undefined;
  if (!finite(v) || (strict ? v <= min : v < min))
    throw Error("Invalid effect " + key);
  return v;
};
const point = (spec, key) => {
  const p = spec[key];
  if (p === undefined) return undefined;
  if (!p || typeof p !== "object" || !finite(p.x) || !finite(p.y))
    throw Error("Invalid effect " + key);
  for (const k of Object.keys(p))
    if (k !== "x" && k !== "y")
      throw Error("Invalid effect " + key + " field " + k);
  return { x: p.x, y: p.y };
};
const anchor = (spec, key) => {
  const a = spec[key];
  if (a === undefined) return undefined;
  if (!a || typeof a !== "object" || typeof a.id !== "string" || !a.id)
    throw Error("Invalid effect " + key);
  for (const k of Object.keys(a))
    if (!["id", "dx", "dy"].includes(k))
      throw Error("Invalid effect " + key + " field " + k);
  const dx = a.dx ?? 0,
    dy = a.dy ?? 0;
  if (!finite(dx) || !finite(dy))
    throw Error("Invalid effect " + key + " offset");
  return { id: a.id, dx, dy };
};
export function validateEffect(spec, manifest) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    throw Error("Invalid effect object");
  const kind = spec.kind ?? "ring";
  if (!FIELDS[kind]) throw Error("Invalid effect kind " + kind);
  for (const key of Object.keys(spec))
    if (!COMMON.includes(key) && !FIELDS[kind].includes(key))
      throw Error("Invalid effect field " + key);
  const out = { kind };
  const attach = anchor(spec, "attach");
  const hasXY = spec.x !== undefined || spec.y !== undefined;
  if (attach && hasXY)
    throw Error("Invalid effect anchor: both x,y and attach");
  if (attach) out.attach = attach;
  else {
    if (!finite(spec.x) || !finite(spec.y))
      throw Error("Invalid effect anchor");
    out.x = spec.x;
    out.y = spec.y;
  }
  if (!finite(spec.duration) || spec.duration <= 0)
    throw Error("Invalid effect duration");
  out.duration = spec.duration;
  out.delay = num(spec, "delay", 0) ?? 0;
  out.fadeIn = num(spec, "fadeIn", 0) ?? 0;
  out.fadeOut =
    num(spec, "fadeOut", 0) ?? (kind === "ring" ? spec.duration : 0);
  const color = spec.color;
  if (
    color !== undefined &&
    (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))
  )
    throw Error("Invalid effect color");
  if (color !== undefined) out.color = color;
  if (kind === "ring") {
    if (!finite(spec.radius) || spec.radius < 0)
      throw Error("Invalid effect radius");
    out.radius = spec.radius;
    const angle = num(spec, "angle", -Infinity),
      arc = num(spec, "arc", 0);
    if (arc !== undefined && arc > Math.PI) throw Error("Invalid effect arc");
    if (angle !== undefined) out.angle = angle;
    if (arc !== undefined) out.arc = arc;
  } else if (kind === "sprite") {
    if (
      typeof spec.asset !== "string" ||
      manifest?.assets?.[spec.asset]?.type !== "sprite"
    )
      throw Error("Invalid effect asset");
    out.asset = spec.asset;
    out.scale = num(spec, "scale", 0, true) ?? 1;
    const angle = num(spec, "angle", -Infinity);
    if (angle !== undefined) out.angle = angle;
    if (spec.loop !== undefined && typeof spec.loop !== "boolean")
      throw Error("Invalid effect loop");
    out.loop = spec.loop ?? false;
  } else {
    const to = point(spec, "to"),
      attachTo = anchor(spec, "attachTo");
    if (!!to === !!attachTo) throw Error("Invalid effect beam end");
    if (to) out.to = to;
    else out.attachTo = attachTo;
    out.width = num(spec, "width", 0, true) ?? 2;
  }
  return out;
}
const at = (entities, a) => {
  const e = entities.get(a.id);
  return e && e.hp > 0 ? { x: e.x + a.dx, y: e.y + a.dy } : null;
};
export function resolveEffect(effect, entities, time) {
  const duration = effect.duration,
    t = time - effect.at - (effect.delay ?? 0);
  if (t < 0 || t >= duration) return null;
  const p = effect.attach ? at(entities, effect.attach) : effect;
  if (!p) return null;
  const r = { x: p.x, y: p.y };
  if (effect.kind === "beam") {
    const q = effect.attachTo ? at(entities, effect.attachTo) : effect.to;
    if (!q) return null;
    r.x2 = q.x;
    r.y2 = q.y;
  }
  const fadeIn = effect.fadeIn ?? 0,
    fadeOut =
      effect.fadeOut ??
      (effect.kind === "beam" || effect.kind === "sprite" ? 0 : duration);
  r.alpha = clamp01(
    Math.min(fadeIn ? t / fadeIn : 1, fadeOut ? (duration - t) / fadeOut : 1),
  );
  r.t = t;
  return r;
}
export function spriteFrame(t, spec, loop) {
  const f = Math.floor(t * spec.fps);
  return loop ? f % spec.frames : Math.min(spec.frames - 1, f);
}
const alive = (entities, a) => {
  const e = entities.get(a.id);
  return !!e && e.hp > 0;
};
export function pruneEffects(effects, entities, time) {
  return effects.filter(
    (e) =>
      time < e.at + (e.delay ?? 0) + e.duration &&
      (!e.attach || alive(entities, e.attach)) &&
      (!e.attachTo || alive(entities, e.attachTo)),
  );
}
