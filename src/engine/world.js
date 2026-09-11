import { emptyInput } from "./input.js";
import { DEFAULT_LIMITS } from "../mods/runtime.js";
import { validateEffect, pruneEffects } from "./effects.js";
import { spatial } from "./spatial.js";
const finite = (v, name) => {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw Error("Invalid finite " + name);
  return v;
};
const jsonCheck = (value) => {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) jsonCheck(v);
  } else if (typeof value === "number") finite(value, "number");
};
const SPAWN_FIELDS = [
  "ownerId",
  "x",
  "y",
  "vx",
  "vy",
  "angle",
  "radius",
  "hp",
  "maxHp",
  "sprite",
  "scale",
  "solid",
  "countsForDefeat",
  "tags",
  "contact",
  "visible",
  "lifetime",
  "width",
  "height",
];
const PATCH_FIELDS = [
  "x",
  "y",
  "vx",
  "vy",
  "angle",
  "radius",
  "sprite",
  "scale",
  "solid",
  "tags",
  "contact",
  "visible",
  "lifetime",
  "width",
  "height",
];
const NUMERIC = [
  "x",
  "y",
  "vx",
  "vy",
  "angle",
  "radius",
  "scale",
  "width",
  "height",
];
const SIZE = ["radius", "scale", "width", "height"];
// tags reach both players' snapshots every call, so their size is capped like sprite/label.
const TAGS_MAX = 16,
  TAG_LENGTH_MAX = 64;
// Technical (not balance) cap on positions, velocities and impulses: finite but
// absurd values (1e308) overflow to Infinity/NaN inside integration and sweep.
export const MAGNITUDE_MAX = 1e6;
const BOUNDED = ["x", "y", "vx", "vy", "radius", "scale", "width", "height"];
const magnitude = (v, name) => {
  if (Math.abs(finite(v, name)) > MAGNITUDE_MAX)
    throw Error("Invalid magnitude " + name);
  return v;
};
const SLOT_FIELDS = ["label", "cooldown", "active"];
// Validates one mutable entity field; returns the value to store (undefined = unset).
const field = (k, v) => {
  if (k === "lifetime") {
    if (v === null || v === undefined) return undefined;
    return finite(v, k);
  }
  if ((k === "width" || k === "height") && v === undefined) return undefined;
  if (NUMERIC.includes(k)) finite(v, k);
  if (BOUNDED.includes(k)) magnitude(v, k);
  if (SIZE.includes(k) && v <= 0) throw Error("Invalid size");
  if (k === "sprite" && (typeof v !== "string" || v.length > 40))
    throw Error("Invalid sprite");
  if (k === "contact" || k === "visible") return !!v;
  if (k === "tags") {
    if (
      !Array.isArray(v) ||
      v.length > TAGS_MAX ||
      v.some((t) => typeof t !== "string" || t.length > TAG_LENGTH_MAX)
    )
      throw Error("Invalid tags");
    return v;
  }
  return v;
};
export function createWorld({
  width = 480,
  height = 270,
  duration = 180,
  obstacles = [],
} = {}) {
  return new World(width, height, duration, obstacles);
}
class World {
  constructor(width, height, duration, obstacles) {
    this.obstacles = obstacles;
    this.width = width;
    this.height = height;
    this.duration = duration;
    this.time = 0;
    this.entities = new Map();
    this.players = new Map();
    this.queue = [];
    this.effects = [];
    this.sounds = [];
    this.slots = {};
    this.result = null;
    this.error = null;
    this.serial = 0;
    this.disposed = false;
  }
  spawn(spec, id = "host:" + ++this.serial) {
    jsonCheck(spec);
    for (const k of Object.keys(spec))
      if (!SPAWN_FIELDS.includes(k)) throw Error("Invalid spawn field " + k);
    const e = {
      id,
      ownerId: spec.ownerId,
      x: spec.x ?? 0,
      y: spec.y ?? 0,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 7,
      hp: spec.hp ?? spec.maxHp ?? 100,
      maxHp: spec.hp ?? 100,
      solid: false,
      countsForDefeat: false,
      sprite: "body",
      scale: 1,
      tags: [],
      contact: false,
      visible: true,
      ...spec,
    };
    e.id = id;
    if (e.tags === undefined) e.tags = [];
    for (const k of ["hp", "maxHp"]) finite(e[k], k);
    for (const k of PATCH_FIELDS) {
      const v = field(k, e[k]);
      if (v === undefined) delete e[k];
      else e[k] = v;
    }
    if (
      ![1, 2].includes(e.ownerId) ||
      this.entities.has(id) ||
      e.hp <= 0 ||
      e.maxHp <= 0
    )
      throw Error("Invalid entity");
    if (
      [...this.entities.values()].filter((x) => x.ownerId === e.ownerId)
        .length >= (this.players.get(e.ownerId)?.runtime.limits.entities ?? 256)
    )
      throw Error("Entity budget exceeded");
    this.entities.set(id, e);
    return id;
  }
  addPlayer(runtime, position) {
    const m = runtime.manifest;
    const id = this.spawn({
      ownerId: runtime.ownerId,
      ...position,
      radius: m.body.radius,
      hp: m.body.maxHp,
      solid: true,
      countsForDefeat: true,
      sprite: m.appearance.sprite,
      width: m.appearance.width,
      height: m.appearance.height,
    });
    this.players.set(runtime.ownerId, {
      runtime,
      selfId: id,
      input: emptyInput(),
    });
    this.slots[runtime.ownerId] = m.abilities.map((a) => ({
      label: a.label,
      cooldown: 0,
      active: false,
    }));
    this.invoke(runtime.ownerId, "spawn");
    return id;
  }
  invoke(owner, kind, event, dt = 0) {
    const p = this.players.get(owner);
    if (!p) return null;
    return p.runtime.withBudget(() => {
      if (kind === "event") {
        const count = (this.eventCounts?.get(owner) ?? 0) + 1;
        this.eventCounts ??= new Map();
        this.eventCounts.set(owner, count);
        if (count > p.runtime.limits.events)
          throw Error("Event budget exceeded");
      }
      const r = p.runtime.call({
        kind,
        selfId: p.selfId,
        input: p.input,
        world: this.snapshot(),
        event,
        dt,
      });
      // Errors here surface through runtime.withBudget, which already prefixes
      // "<manifest.id> P<owner>: " — no second prefix.
      this.applyCommands(owner, r.commands);
      // The response is the owner's output too: validate it inside its budget so
      // garbage from beforeHit is attributed to the mod that produced it.
      if (event?.type === "beforeHit") {
        const amount = r.response?.amount;
        if (amount !== undefined && amount !== null) {
          finite(amount, "hit");
          if (amount < 0) throw Error("Negative hit");
        }
      }
      return r.response;
    });
  }

  // Host-originated work (expired lifetimes, direct queueDamage) has no owner.
  describeOwner(owner) {
    if (owner === undefined || owner === null) return "world";
    return `${this.players.get(owner)?.runtime.manifest.id ?? "entity"} P${owner}`;
  }
  fail(error) {
    this.error = error.message ?? String(error);
    for (const p of this.players.values()) p.runtime.dispose();
  }
  applyCommands(owner, commands) {
    const limit = this.players.get(owner)?.runtime.limits ?? DEFAULT_LIMITS;
    // Per owner per tick (summed over update/abilities/timers/events), so one
    // owner's flood can never trip the budget on the other's first command.
    this.commandCounts ??= new Map();
    const count = (this.commandCounts.get(owner) ?? 0) + commands.length;
    this.commandCounts.set(owner, count);
    if (count > limit.commands) throw Error("Command budget exceeded");
    for (const c of commands) {
      jsonCheck(c);
      const e = this.entities.get(c.id);
      const own = () => {
        if (e && e.ownerId !== owner)
          throw Error("Cannot mutate foreign entity");
        return e;
      };
      switch (c.op) {
        case "spawn":
          if (
            typeof c.id !== "string" ||
            !c.id.startsWith(owner + ":") ||
            c.spec.ownerId !== undefined
          )
            throw Error("Invalid entity ownership");
          this.spawn({ ...c.spec, ownerId: owner }, c.id);
          break;
        case "patch":
          if (own()) {
            for (const [k, v] of Object.entries(c.changes)) {
              if (!PATCH_FIELDS.includes(k))
                throw Error("Forbidden patch field " + k);
              const value = field(k, v);
              if (value === undefined) delete e[k];
              else e[k] = value;
            }
          }
          break;
        case "destroy":
          if (own())
            this.queue.push({
              type: "kill",
              id: e.id,
              reason: "destroyed",
              by: owner,
            });
          break;
        case "damage":
          finite(c.amount, "damage");
          if (c.amount < 0) throw Error("Negative damage");
          if (c.sourceId !== undefined && c.sourceId !== null) {
            // Stale source (expired projectile, dead body) → same as no source.
            const source = this.entities.get(c.sourceId);
            if (source && source.ownerId !== owner)
              throw Error("Foreign damage source");
            this.queueDamage(
              c.id,
              c.amount,
              source ? c.sourceId : undefined,
              owner,
            );
          } else this.queueDamage(c.id, c.amount, undefined, owner);
          break;
        case "heal":
          finite(c.amount, "heal");
          if (c.amount < 0) throw Error("Negative heal");
          if (own() && e.hp > 0) e.hp = Math.min(e.maxHp, e.hp + c.amount);
          break;
        case "impulse":
          magnitude(c.vector.x, "impulse x");
          magnitude(c.vector.y, "impulse y");
          if (e && e.hp > 0) {
            e.ix = (e.ix ?? 0) + c.vector.x;
            e.iy = (e.iy ?? 0) + c.vector.y;
          }
          break;
        case "effect":
          if (
            this.effects.filter((e) => e.ownerId === owner).length >=
            limit.effects
          )
            throw Error("Effect budget exceeded");
          this.effects.push({
            ...validateEffect(
              c.spec,
              this.players.get(owner)?.runtime.manifest,
            ),
            ownerId: owner,
            at: this.time,
          });
          break;
        case "sound": {
          // Own-property lookup: 'constructor'/'__proto__' must not resolve
          // through Object.prototype.
          const assets = this.players.get(owner).runtime.manifest.assets;
          if (
            typeof c.asset !== "string" ||
            !Object.hasOwn(assets, c.asset) ||
            assets[c.asset]?.type !== "sound"
          )
            throw Error("Unknown sound");
          const o = c.options ?? {};
          if (!o || typeof o !== "object" || Array.isArray(o))
            throw Error("Invalid sound options");
          for (const k of Object.keys(o))
            if (k !== "volume") throw Error("Invalid sound option " + k);
          const volume = o.volume ?? 1;
          finite(volume, "sound volume");
          if (volume < 0 || volume > 1) throw Error("Invalid sound volume");
          this.sounds.push({ ownerId: owner, asset: c.asset, volume });
          break;
        }
        case "shake":
          finite(c.amount, "shake");
          finite(c.seconds, "shake duration");
          this.shake = {
            amount: Math.min(Math.abs(c.amount), 8),
            until: this.time + c.seconds,
          };
          break;
        case "slot": {
          // Slot state reaches both players' snapshots every call: whitelist the
          // keys so junk fields cannot inflate the other player's input JSON.
          const s = c.state;
          if (
            !Number.isInteger(c.index) ||
            c.index < 0 ||
            c.index > 3 ||
            !s ||
            typeof s !== "object" ||
            Array.isArray(s)
          )
            throw Error("Invalid slot");
          for (const k of Object.keys(s))
            if (!SLOT_FIELDS.includes(k))
              throw Error("Invalid slot field " + k);
          if (
            typeof s.label !== "string" ||
            s.label.length > 40 ||
            !Number.isFinite(s.cooldown) ||
            s.cooldown < 0
          )
            throw Error("Invalid slot");
          this.slots[owner][c.index] = {
            label: s.label,
            cooldown: s.cooldown,
            active: !!s.active,
          };
          break;
        }
        default:
          throw Error("Unknown command " + c.op);
      }
    }
  }
  // `by` — the owner whose command queued the item (undefined for host-originated
  // items); used only to attribute the queue budget when the target is gone.
  queueDamage(id, amount, sourceId, by) {
    finite(amount, "damage");
    this.queue.push({ type: "damage", id, amount, sourceId, by });
  }
  drain() {
    let events = 0;
    while (this.queue.length) {
      const drainLimit = this.players.size
        ? Math.max(
            ...[...this.players.values()].map((p) => p.runtime.limits.events),
          )
        : DEFAULT_LIMITS.events;
      if (++events > drainLimit) {
        const head = this.queue[0];
        const owner =
          head.by ??
          this.entities.get(head.sourceId)?.ownerId ??
          this.entities.get(head.id)?.ownerId;
        throw Error(
          this.describeOwner(owner) + ": Queue event budget exceeded",
        );
      }
      const item = this.queue.shift(),
        e = this.entities.get(item.id);
      if (!e) continue;
      if (item.type === "damage" && e.hp > 0) {
        const response = this.invoke(e.ownerId, "event", {
          type: "beforeHit",
          entityId: e.id,
          sourceId: item.sourceId,
          amount: item.amount,
        });
        if (response?.cancel) continue;
        // Validated inside invoke (owner's budget, owner's attribution).
        const amount = response?.amount ?? item.amount;
        const actual = Math.min(e.hp, amount);
        e.hp -= actual;
        this.invoke(e.ownerId, "event", {
          type: "damageReceived",
          entityId: e.id,
          sourceId: item.sourceId,
          amount: actual,
        });
        if (e.hp <= 0)
          this.queue.push({ type: "death", id: e.id, sourceId: item.sourceId });
      } else if (item.type === "kill" || item.type === "death") {
        if (e.dead) continue;
        e.hp = 0;
        e.dead = true;
        this.invoke(e.ownerId, "event", {
          type: "death",
          entityId: e.id,
          sourceId: item.sourceId,
          reason:
            item.reason ?? (item.type === "death" ? "damage" : "destroyed"),
        });
        this.entities.delete(e.id);
      }
    }
  }
  step(dt, inputs = []) {
    if (this.disposed || this.result || this.error) return;
    this.commandCounts = new Map();
    this.eventCounts = new Map();
    for (const p of this.players.values()) p.runtime.beginTick();
    this.sounds = [];
    try {
      this.time += dt;
      for (const [owner, p] of this.players) {
        p.input = inputs[owner - 1] ?? emptyInput();
        this.invoke(owner, "tick", undefined, dt);
      }
      const prev = new Map();
      for (const e of this.entities.values()) {
        if (e.hp <= 0) continue;
        prev.set(e.id, { x: e.x, y: e.y });
        e.x += (e.vx + (e.ix ?? 0)) * dt;
        e.y += (e.vy + (e.iy ?? 0)) * dt;
        e.ix = (e.ix ?? 0) * Math.exp(-10 * dt);
        e.iy = (e.iy ?? 0) * Math.exp(-10 * dt);
        // Host invariant: MAGNITUDE_MAX keeps every input bounded, so a
        // non-finite pose here is an engine bug, not a mod error.
        this.assertFinitePose(e, "integration");
      }
      for (let pass = 0; pass < 16; pass++) {
        const bodies = [...this.entities.values()].filter(
          (e) => e.solid && e.hp > 0,
        );
        for (let i = 0; i < bodies.length; i++)
          for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i],
              b = bodies[j],
              dx = b.x - a.x,
              dy = b.y - a.y,
              d = Math.hypot(dx, dy),
              r = a.radius + b.radius;
            if (d < r) {
              const nx = d ? dx / d : 1,
                ny = d ? dy / d : 0,
                push = (r - d) / 2;
              a.x -= nx * push;
              a.y -= ny * push;
              b.x += nx * push;
              b.y += ny * push;
            }
          }
        for (const e of bodies) this.clamp(e);
      }
      for (const e of this.entities.values())
        if (e.hp > 0) this.assertFinitePose(e, "collision");
      this.contacts(prev);
      for (const e of this.entities.values())
        if (e.hp > 0 && typeof e.lifetime === "number") {
          e.lifetime -= dt;
          if (e.lifetime <= 0)
            this.queue.push({ type: "kill", id: e.id, reason: "expired" });
        }
      this.drain();
      this.effects = pruneEffects(this.effects, this.entities, this.time);
      const alive = [1, 2].map((o) =>
        [...this.entities.values()].some(
          (e) => e.ownerId === o && e.countsForDefeat && e.hp > 0,
        ),
      );
      if (!alive[0] && !alive[1]) this.result = "draw";
      else if (!alive[0]) this.result = "P2";
      else if (!alive[1]) this.result = "P1";
      else if (this.time >= this.duration - 1e-8) this.result = "draw";
    } catch (e) {
      this.fail(e);
    }
  }
  // §4: sweep each contact entity from its pre-integration position; the mod owns the response.
  contacts(prev) {
    const doomed = (id) =>
      this.queue.some((q) => q.type === "kill" && q.id === id);
    for (const e of [...this.entities.values()]) {
      const from = prev.get(e.id);
      // An entity destroyed during update never receives contacts this tick.
      if (!from || !e.contact || e.hp <= 0 || doomed(e.id)) continue;
      const hits = spatial.sweep(
        from,
        { x: e.x, y: e.y },
        e.radius,
        {
          entities: [...this.entities.values()],
          obstacles: this.obstacles,
          width: this.width,
          height: this.height,
        },
        [e.id],
      );
      for (const h of hits) {
        const pose = [e.x, e.y, e.vx, e.vy];
        this.invoke(e.ownerId, "event", {
          type: "contact",
          entityId: e.id,
          kind: h.kind,
          otherId: h.id,
          otherOwnerId: h.ownerId,
          t: h.t,
          point: h.point,
          normal: h.normal,
        });
        if (
          doomed(e.id) ||
          [e.x, e.y, e.vx, e.vy].some((v, i) => v !== pose[i])
        )
          break;
      }
    }
  }
  assertFinitePose(e, phase) {
    for (const k of ["x", "y", "ix", "iy"])
      if (e[k] !== undefined && !Number.isFinite(e[k]))
        throw Error(
          `world: Non-finite ${k} (${e[k]}) on entity ${e.id} of ${this.describeOwner(e.ownerId)} after ${phase}`,
        );
  }
  clamp(e) {
    for (const r of this.obstacles) {
      const px = Math.max(r.x, Math.min(r.x + r.w, e.x)),
        py = Math.max(r.y, Math.min(r.y + r.h, e.y)),
        dx = e.x - px,
        dy = e.y - py,
        d = Math.hypot(dx, dy);
      if (d > 0 && d < e.radius) {
        e.x += (dx / d) * (e.radius - d);
        e.y += (dy / d) * (e.radius - d);
      } else if (d === 0) {
        const sides = [
          { d: e.x - r.x, x: r.x - e.radius, y: e.y },
          { d: r.x + r.w - e.x, x: r.x + r.w + e.radius, y: e.y },
          { d: e.y - r.y, x: e.x, y: r.y - e.radius },
          { d: r.y + r.h - e.y, x: e.x, y: r.y + r.h + e.radius },
        ].sort((a, b) => a.d - b.d);
        e.x = sides[0].x;
        e.y = sides[0].y;
      }
    }
    e.x = Math.max(e.radius, Math.min(this.width - e.radius, e.x));
    e.y = Math.max(e.radius, Math.min(this.height - e.radius, e.y));
  }
  snapshot() {
    return structuredClone({
      width: this.width,
      height: this.height,
      obstacles: this.obstacles,
      time: this.time,
      remaining: Math.max(0, this.duration - this.time),
      entities: [...this.entities.values()],
      effects: this.effects,
      sounds: this.sounds,
      slots: this.slots,
      result: this.result,
      error: this.error,
      shake: this.shake,
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.players.values()) p.runtime.dispose();
    this.entities.clear();
    this.effects = [];
    this.sounds = [];
    this.queue = [];
  }
}
