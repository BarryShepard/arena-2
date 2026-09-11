// Self-contained: bootstrap embeds String(createSpatial) into the guest, so this
// function must not reference module scope. Every helper is nested.
export function createSpatial() {
  // Overflow guard: absurd (finite but ~1e308) coordinates turn intermediate
  // products into Infinity/NaN. Such segments miss instead of yielding NaN hits.
  const fin = Number.isFinite;
  // t=0 is exact even when to-from overflowed to Infinity (Infinity*0 is NaN).
  const at = (from, to, t) =>
    t === 0
      ? { x: from.x, y: from.y }
      : {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        };
  // Segment vs circle (center, r). Overlap at start → t=0. Returns {t, point, normal} | null.
  function segmentCircle(from, to, center, r) {
    const dx = to.x - from.x,
      dy = to.y - from.y,
      fx = from.x - center.x,
      fy = from.y - center.y,
      c = fx * fx + fy * fy - r * r;
    if (!fin(c)) return null;
    let t = 0;
    if (c > 0) {
      const a = dx * dx + dy * dy,
        b = 2 * (fx * dx + fy * dy),
        disc = b * b - 4 * a * c;
      if (!fin(a) || !fin(disc) || a === 0 || disc < 0) return null;
      t = (-b - Math.sqrt(disc)) / (2 * a);
      if (!fin(t) || t < 0 || t > 1) return null;
    }
    const point = at(from, to, t),
      nx = point.x - center.x,
      ny = point.y - center.y,
      d = Math.hypot(nx, ny);
    if (!fin(point.x) || !fin(point.y) || !fin(d)) return null;
    return { t, point, normal: d ? { x: nx / d, y: ny / d } : { x: 1, y: 0 } };
  }
  // Segment vs AABB {x,y,w,h} expanded by radius (square corners). Overlap at start → t=0.
  function segmentRect(from, to, rect, radius) {
    const x0 = rect.x - radius,
      y0 = rect.y - radius,
      x1 = rect.x + rect.w + radius,
      y1 = rect.y + rect.h + radius;
    if (from.x >= x0 && from.x <= x1 && from.y >= y0 && from.y <= y1) {
      let best = null;
      for (const s of [
        [from.x - x0, -1, 0],
        [x1 - from.x, 1, 0],
        [from.y - y0, 0, -1],
        [y1 - from.y, 0, 1],
      ])
        if (!best || s[0] < best[0]) best = s;
      return {
        t: 0,
        point: { x: from.x, y: from.y },
        normal: { x: best[1], y: best[2] },
      };
    }
    let lo = 0,
      hi = 1,
      normal = { x: 0, y: 0 };
    for (const [a, d, min, max, sx, sy] of [
      [from.x, to.x - from.x, x0, x1, 1, 0],
      [from.y, to.y - from.y, y0, y1, 0, 1],
    ]) {
      if (d === 0) {
        if (a < min || a > max) return null;
        continue;
      }
      if (!fin(d)) return null;
      let t1 = (min - a) / d,
        t2 = (max - a) / d;
      if (!fin(t1) || !fin(t2)) return null;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > lo) {
        lo = t1;
        normal = { x: 0 - sx * Math.sign(d), y: 0 - sy * Math.sign(d) };
      }
      if (t2 < hi) hi = t2;
      if (lo > hi) return null;
    }
    const point = at(from, to, lo);
    if (!fin(lo) || !fin(point.x) || !fin(point.y)) return null;
    return { t: lo, point, normal };
  }
  // Segment leaving [radius,width-radius]×[radius,height-radius]; normal points inward.
  function bounds(from, to, radius, width, height) {
    let best = null;
    for (const [a, d, min, max, sx, sy] of [
      [from.x, to.x - from.x, radius, width - radius, 1, 0],
      [from.y, to.y - from.y, radius, height - radius, 0, 1],
    ]) {
      let t, n;
      if (a < min) ((t = 0), (n = 1));
      else if (a > max) ((t = 0), (n = -1));
      else if (d > 0 && a + d > max) ((t = (max - a) / d), (n = -1));
      else if (d < 0 && a + d < min) ((t = (min - a) / d), (n = 1));
      else continue;
      if (!fin(t)) continue;
      if (!best || t < best.t)
        best = { t, normal: { x: sx * n + 0, y: sy * n + 0 } };
    }
    if (!best) return null;
    const point = at(from, to, best.t);
    if (!fin(point.x) || !fin(point.y)) return null;
    return { kind: "bounds", t: best.t, point, normal: best.normal };
  }
  function sweep(from, to, radius, world, ignoreIds) {
    const hits = [],
      ignore = ignoreIds || [];
    for (const e of world.entities || []) {
      if (!(e.hp > 0) || ignore.indexOf(e.id) !== -1) continue;
      const h = segmentCircle(from, to, e, radius + e.radius);
      if (h)
        hits.push({
          kind: "entity",
          id: e.id,
          ownerId: e.ownerId,
          t: h.t,
          point: h.point,
          normal: h.normal,
        });
    }
    for (const r of world.obstacles || []) {
      const h = segmentRect(from, to, r, radius);
      if (h)
        hits.push({ kind: "brick", t: h.t, point: h.point, normal: h.normal });
    }
    const b = bounds(from, to, radius, world.width, world.height);
    if (b) hits.push(b);
    // Equal t: obstacles (brick/bounds) precede entities, so a wall shields whoever is behind it.
    return hits.sort(
      (a, b) => a.t - b.t || (a.kind === "entity") - (b.kind === "entity"),
    );
  }
  return { segmentCircle, segmentRect, sweep };
}
export const spatial = createSpatial();
