import { resolveEffect, spriteFrame } from "../engine/effects.js";
const colors = ["", "#7ee5e0", "#f5ad68"];
// Own-property lookup only: a mod-chosen key like 'constructor', '__proto__' or
// 'hasOwnProperty' must not resolve through Object.prototype into a fake asset.
const own = (table, key) =>
  table && typeof key === "string" && Object.hasOwn(table, key)
    ? table[key]
    : undefined;
export function render(ctx, s, assets) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#151c1b";
  ctx.fillRect(0, 0, s.width, s.height);
  ctx.fillStyle = "#202b27";
  for (let y = 0; y < s.height; y += 16)
    for (let x = 0; x < s.width; x += 16) {
      ctx.fillRect(x, y, 1, 1);
    }
  for (const r of s.obstacles ?? []) {
    ctx.fillStyle = "#885641";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "#b07851";
    for (let y = r.y; y < r.y + r.h; y += 8)
      for (let x = r.x; x < r.x + r.w; x += 16) {
        ctx.fillRect(x + 1, y + 1, 13, 5);
      }
  }
  ctx.save();
  if (s.shake?.until > s.time)
    ctx.translate(
      Math.sin(s.time * 151) * s.shake.amount,
      Math.cos(s.time * 129) * s.shake.amount,
    );
  for (const e of s.entities) {
    const color = colors[e.ownerId];
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(e.x - e.radius - 2),
      Math.round(e.y - e.radius - 2),
      e.radius * 2 + 4,
      e.radius * 2 + 4,
    );
    const asset = own(own(assets.images, String(e.ownerId)), e.sprite);
    if (asset) {
      const { img, spec } = asset,
        frame = Math.floor(s.time * spec.fps) % spec.frames,
        w = (e.width ?? spec.frameWidth) * e.scale,
        h = (e.height ?? spec.frameHeight) * e.scale;
      ctx.drawImage(
        img,
        frame * spec.frameWidth,
        0,
        spec.frameWidth,
        spec.frameHeight,
        Math.round(e.x - w / 2),
        Math.round(e.y - h / 2),
        w,
        h,
      );
    } else {
      const w = (e.width ?? 8) * e.scale,
        h = (e.height ?? 8) * e.scale;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(e.x - w / 2), Math.round(e.y - h / 2), w, h);
    }
    ctx.fillStyle = color;
    ctx.fillRect(
      Math.round(e.x + Math.cos(e.angle) * (e.radius + 5)) - 1,
      Math.round(e.y + Math.sin(e.angle) * (e.radius + 5)) - 1,
      3,
      3,
    );
    ctx.fillStyle = "#080d0b";
    ctx.fillRect(e.x - 10, e.y - e.radius - 7, 20, 3);
    ctx.fillStyle = color;
    ctx.fillRect(e.x - 10, e.y - e.radius - 7, (20 * e.hp) / e.maxHp, 2);
  }
  const entities = new Map(s.entities.map((e) => [e.id, e]));
  for (const e of s.effects ?? []) {
    const r = resolveEffect(e, entities, s.time);
    if (!r) continue;
    ctx.globalAlpha = r.alpha;
    if (e.kind === "sprite") {
      const asset = own(own(assets.images, String(e.ownerId)), e.asset);
      if (!asset) continue;
      const { img, spec } = asset,
        frame = spriteFrame(r.t, spec, e.loop),
        w = spec.frameWidth * (e.scale ?? 1),
        h = spec.frameHeight * (e.scale ?? 1);
      ctx.save();
      ctx.translate(Math.round(r.x), Math.round(r.y));
      ctx.rotate(e.angle ?? 0);
      ctx.drawImage(
        img,
        frame * spec.frameWidth,
        0,
        spec.frameWidth,
        spec.frameHeight,
        -w / 2,
        -h / 2,
        w,
        h,
      );
      ctx.restore();
    } else if (e.kind === "beam") {
      ctx.strokeStyle = e.color ?? "#fff";
      ctx.lineWidth = e.width ?? 2;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x2, r.y2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = e.color ?? "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        r.x,
        r.y,
        e.radius ?? 12,
        (e.angle ?? 0) - (e.arc ?? Math.PI),
        (e.angle ?? 0) + (e.arc ?? Math.PI),
      );
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
