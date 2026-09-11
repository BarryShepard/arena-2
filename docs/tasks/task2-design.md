# Task 2 design — контракт generic API (обязателен для всех исполнителей)

Дата: 2026-09-11. Основание: `docs/tasks/task2-brief.md`, раздел Task 2 плана, `docs/specs/2026-09-11-arena-mvp.md`.
Этот документ фиксирует точные имена и сигнатуры. Все модули, моды и тесты используют именно их. Ядро не знает имён персонажей и способностей.

## 0. Принципы

- Всё character-specific (projectile damage, отражение, DoT, рост, распад) живёт в модах. Ядро даёт primitives: сущности, движение, контакт, raycast, очереди урона/смерти, таймеры, эффекты.
- Guest читает снимок начала вызова; команды применяются после callback (как в Task 1).
- Никаких функций через JSON. Таймеры/sequence живут в guest.
- Не переписывать поведение Task 1: solid-тела, кирпичи, four-direction input, 180 s, draw, бюджеты остаются.

## 1. Сущности

Поля сущности (snapshot и `api.entity`): `id, ownerId, x, y, vx, vy, angle, radius, hp, maxHp, solid, countsForDefeat, sprite, scale, tags, contact, lifetime, width, height` (+ внутренние `ix, iy`).

Новые поля:
- `contact: boolean` (default `false`) — host генерирует события `contact` для этой сущности.
- `lifetime: number | undefined` — секунды; host уменьшает каждый tick после движения; при `<= 0` ставит в очередь kill с `reason: 'expired'`. `undefined` — бессрочно.
- `width, height: number | undefined` — отображаемый размер в мировых единицах (умножается на `scale`). Host задаёт основному телу `manifest.appearance.width/height`. Если не задано — renderer использует frameWidth/frameHeight ассета.
- `solid` (существующее): только solid-тела расталкиваются между собой, отталкиваются от кирпичей и зажимаются границей. **Non-solid сущности не clamp'ятся**: могут пройти сквозь кирпич и выйти за границу; их поведение (destroy/bounce) описывает мод через `contact` и `lifetime`.

`spawn(spec)` принимает только: `x, y, vx, vy, angle, radius, hp, maxHp, sprite, scale, solid, countsForDefeat, tags, contact, lifetime, width, height`. Неизвестное поле → `Error('Invalid spawn field <k>')`. `hp` задаёт и `maxHp`, если `maxHp` не указан. `sprite` — строка ≤ 40 символов (ключ ассета владельца; отсутствие ассета не ошибка — renderer рисует квадрат). `ownerId` задаётся ядром; `id` — `<owner>:<serial>`.

`patch(id, changes)` (только своя сущность) разрешает: `x, y, vx, vy, angle, radius, sprite, scale, solid, tags, contact, lifetime, width, height`. Запрещены `id, ownerId, hp, maxHp, countsForDefeat` → `Error('Forbidden patch field <k>')`. Числа проверяются на конечность; `radius/scale/width/height > 0`; `lifetime` — конечное число или `null` (снять lifetime).

Устаревший (stale) id в patch/destroy/damage/heal/impulse — no-op (как в Task 1). Чужой id в patch/destroy/heal → ошибка владения.

## 2. Порядок tick (world.step)

1. `time += dt`; для каждого игрока: guest timers/sequences → press/hold/release → `update` (как сейчас).
2. Запомнить `px, py` каждой сущности; интеграция `x += (vx+ix)*dt` и т. д.
3. 16 проходов separation только для `solid && hp>0`, clamp кирпичей/границы только для solid.
4. **Contact sweep** (п. 4) — события `contact` доставляются владельцу каждой сущности с `contact:true`.
5. `lifetime -= dt`; при `<= 0` → `queue.push({type:'kill', id, reason:'expired'})`.
6. `drain()` (FIFO hit/death, как в Task 1) — death callback может spawn/damage/effect; всё применяется до вердикта.
7. `effects = pruneEffects(effects, entities, time)`.
8. Вердикт по `countsForDefeat && hp>0`, затем timeout (как в Task 1).

## 3. События (guest `event(ctx, event)`)

- `beforeHit {type, entityId, sourceId, amount}` → return `{cancel:true}` | `{amount:number}` | null.
- `damageReceived {type, entityId, sourceId, amount}` — фактически снятые HP.
- `death {type, entityId, sourceId, reason}` — один раз, до удаления; `reason: 'damage' | 'destroyed' | 'expired'`.
- `contact {type, entityId, kind, otherId, otherOwnerId, t, point:{x,y}, normal:{x,y}}` — `kind: 'entity' | 'brick' | 'bounds'`; `otherId/otherOwnerId` только для `entity`; `t ∈ [0,1]` — доля отрезка движения; `point` — центр самой сущности в момент контакта; `normal` — единичный вектор от препятствия к сущности (для brick — axis-aligned, для bounds — внутрь арены, для entity — от другой сущности к этой).

Все события считаются в `events` budget владельца.

## 4. Contact sweep (host, `src/engine/world.js` + `src/engine/spatial.js`)

Для каждой сущности `e` с `contact && hp>0`: отрезок от `(px,py)` (до интеграции) к `(x,y)` (после collision/clamp), радиус `e.radius`.
- Кирпичи: segment vs AABB, расширенный на `radius` (Minkowski, углы квадратные — допустимое приближение).
- Границы: пересечение с прямоугольником `[radius, width-radius]×[radius, height-radius]` изнутри наружу.
- Сущности: все `other !== e`, `other.hp > 0`, любого владельца (включая своего), в текущей позиции `other`; segment vs circle радиуса `e.radius + other.radius`. Перекрытие в t=0 даёт `t=0`.
- Один hit на пару/препятствие за tick. Hits сортируются по `t`, доставляются по одному. **После каждого callback оставшиеся hits этой сущности в этом tick отбрасываются, если сущность была destroy'нута (в очереди kill) или её `x/y/vx/vy` изменены patch'ем.** Так стена перед противником срабатывает первой, и projectile, уничтоженный на стене, не бьёт противника за ней.
- Host не двигает сущность к точке контакта и не наносит урон: это делает мод.

## 5. Raycast (guest, snapshot)

`api.raycast({from:{x,y}, to:{x,y}, radius = 0, ignore = []})` → массив hits, отсортированный по `t`: `{kind:'entity'|'brick'|'bounds', id?, ownerId?, t, point:{x,y}, normal:{x,y}}`. Учитываются сущности с `hp > 0`, кирпичи и границы; `ignore` — массив id, которые пропускаются. Не конечные числа → `Error('Invalid raycast')`. `lineOfSight(from,to)` остаётся как есть.

Реализация: `src/engine/spatial.js` экспортирует `createSpatial()` — **самодостаточную** функцию без внешних ссылок, возвращающую `{segmentCircle, segmentRect, sweep}`. Host: `export const spatial = createSpatial()`. Bootstrap встраивает её текстом: `const spatial=(${String(createSpatial)})();` — так host и guest используют один и тот же код без дублирования и без host eval пользовательского кода. Внутренние функции только вложенные (переживают минификацию). `sweep(from, to, radius, {entities, obstacles, width, height}, ignoreIds)` → отсортированные hits в формате п. 3/5.

## 6. Таймеры и sequence (guest, `src/mods/bootstrap.js`)

- `api.after(seconds, cb, options = {})`, `api.every(seconds, cb, options = {})` → числовой id; `api.cancel(id)`.
- `options.entityId`: `string | null`. Default — **контекстная сущность** `ctx.entityId`: `selfId` в `spawn/tick`, `event.entityId` в event callbacks, **кроме `death`, где default `null`** (сущность вот-вот удалится). `null` явно = owner/match scope.
- Таймер, привязанный к сущности, **молча отбрасывается** в начале tick, если её нет в снимке. Death callback, создавший новые сущности, может привязать таймеры к их зарезервированным id.
- `api.sequence(steps, options = {})` → id (то же пространство id, `cancel(id)` отменяет). Шаги: `{wait:seconds}`, `{effect:spec}`, `{sound:asset, options?}`, `{shake:{amount,seconds}}`, `{run:fn(ctx)}`. Шаги до первого `wait` исполняются сразу в текущем callback; остальные — в tick после ожидания с свежим `ctx`. Sequence занимает один слот `timers` budget. Максимум 64 шага → иначе `Error('Invalid sequence')`.
- `ctx` получает поле `entityId` (контекстная сущность) в дополнение к `selfId, ownerId, input, world, api`.
- Dispose runtime уничтожает VM и все guest timers; host effects/sounds уничтожаются вместе с world (уже так).

## 7. Эффекты (`src/engine/effects.js` — pure; `src/view/renderer.js` рисует)

Spec `api.effect(spec)`:

```
kind:      'ring' (default) | 'sprite' | 'beam'
anchor:    либо x,y, либо attach:{id, dx=0, dy=0}     (ring/sprite: позиция; beam: начало)
end:       beam only: либо to:{x,y}, либо attachTo:{id, dx=0, dy=0}
ring:      radius ≥ 0 (обязателен), angle?, arc? ∈ [0,π], color? #RRGGBB
sprite:    asset (ключ sprite-ассета владельца, обязателен), scale? > 0 (default 1), angle?, loop? (bool, default false)
beam:      width? > 0 (default 2), color?
timing:    duration > 0 (обязателен), delay ≥ 0 (default 0), fadeIn ≥ 0 (default 0),
           fadeOut ≥ 0 (default: ring → duration [совместимость с Task 1], sprite/beam → 0)
```

Неизвестное поле, неверный kind, отсутствие anchor, одновременно `x,y` и `attach`, не-sprite asset → `Error(...)` с подстрокой `effect`. Ошибка проверяется в world до render.

Экспорты `src/engine/effects.js`:
- `validateEffect(spec, manifest)` → нормализованный объект (kind, defaults заполнены) без `ownerId/at`; бросает Error.
- `resolveEffect(effect, entities /* Map id→entity */, time)` → `null`, если `time < at+delay`, `time >= at+delay+duration` или attach/attachTo сущность отсутствует (или hp<=0); иначе `{x, y, x2?, y2?, alpha, t}` где `t` — локальное время с начала показа, `alpha = clamp01(min(fadeIn? t/fadeIn : 1, fadeOut? (duration-t)/fadeOut : 1))`.
- `spriteFrame(t, assetSpec, loop)` → индекс кадра: `loop ? floor(t*fps) % frames : min(frames-1, floor(t*fps))`.
- `pruneEffects(effects, entities, time)` → эффекты, которые ещё могут показаться (не истекли, attach жив). Эффект с `delay` живёт до `at+delay+duration`.

World хранит `{...normalized, ownerId, at: time}`. Renderer: ring → arc как в Task 1; sprite → drawImage кадра, rotate на angle, масштаб; beam → линия width/color между (x,y) и (x2,y2). Тела рисуются размером `(width ?? frameWidth) * scale × (height ?? frameHeight) * scale`.

## 8. Прочие команды

- `api.sound(asset, {volume?})` — `volume ∈ [0,1]`, default 1; умножает базовый gain 0.16. Неизвестное поле options → ошибка.
- `api.shake`, `api.slot`, `api.damage`, `api.heal`, `api.impulse` — без изменений.

## 9. Вердикт и тесты, которые обязаны существовать

- Death callback создаёт пять `countsForDefeat` тел → результат ещё `null`; смерть последнего → результат. Turret без флага не удерживает матч. Взрыв из death callback (damage в death) разрешается до вердикта (может дать draw).
- Contact: стена перед противником срабатывает первой; destroy в callback стены → противник не получает событие/урон. `point/normal` проверяются численно. Non-solid не clamp'ится и проходит границу с событием `bounds`.
- Lifetime expiry даёт `death reason:'expired'`.
- Патч `ownerId/countsForDefeat/hp` → ошибка; NaN/Infinity в spawn/patch/impulse/raycast → ошибка; stale id → no-op.
- Таймер, привязанный к сущности, не срабатывает после её смерти; `null` scope срабатывает; `cancel(sequenceId)` останавливает оставшиеся шаги; после dispose+новый матч старых callbacks/effects/sounds нет.
- Effects: attached позиция после перемещения; alpha на границах (t=0, fadeIn, duration−fadeOut, конец); delay скрывает до старта; prune по истечении и по исчезновению attach; spriteFrame loop/no-loop.
