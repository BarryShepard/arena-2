# Mod API v1 — реализованный контракт после Task 2

Истина — код: `src/mods/bootstrap.js` (guest API), `src/engine/world.js` (host apply/tick), `src/engine/spatial.js` (sweep/raycast), `src/engine/effects.js` (эффекты), `src/mods/runtime.js` (бюджеты), `src/mods/package.js` (манифест). Три рабочих пакета: `characters/fighter`, `characters/mage`, `characters/bud`. Ядро не знает имён персонажей и способностей: всё character-specific живёт в `main.js` пакета.

## Пакет и манифест

Папка пакета содержит `manifest.json`, JS entry, `sprites/*.png`, `sounds/*.wav`. Папки обнаруживаются сервером автоматически (Back → Reload mods пересканирует). Проверки `validateManifest`:

- `apiVersion` строго 1; `id` — `^[-a-z0-9_]+$`; `name` — строка ≤ 80; `entry` — безопасный относительный путь.
- `abilities` — ровно четыре `{label}`, label ≤ 40 символов. Это только стартовые подписи HUD; мод перезаписывает их через `api.slot`.
- `body`: положительные `radius` (≤ 100), `maxHp`, `moveSpeed`. Host использует `radius` и `maxHp` для стартового тела; `moveSpeed` движок не читает — скорость задаёт сам мод.
- `appearance`: `sprite` (ключ sprite-ассета, обязателен), положительные `width`/`height` — отображаемый размер тела в мировых единицах.
- `assets` (≤ 128 ключей): `{type:'sprite', path:'*.png', frameWidth, frameHeight, frames, fps}` (первые три — положительные целые, fps > 0) или `{type:'sound', path:'*.wav'}`.

Пути только внутри realpath пакета: без абсолютных путей, URL, `..`, symlink наружу. Пакет ≤ 16 MiB файлов, script ≤ 256 KiB UTF-8. Браузер полностью декодирует ассеты до матча; отсутствующий/битый файл — ошибка загрузки.

Три пакета как примеры:

| Пакет   | body                  | appearance | Ассеты                                                                                                                | Слоты                                |
| ------- | --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| fighter | r 7, 120 HP, speed 72 | body 16×16 | `body` 2 кадра @6 fps; `hit.wav`                                                                                      | Slash, Rush, Charge, Repel           |
| mage    | r 7, 100 HP, speed 66 | body 16×16 | `body`, `bolt` 8×8, `spark` 8×8×3, `turret`, `zone` 32×32, `rune`; `cast.wav`, `zap.wav`                              | Bolt, Anchor/Blink, Zone, Turret     |
| bud     | r 7, 100 HP, speed 66 | body 16×16 | `body`, `thorn`, `seed` 8×8, `seedthorn`, `shot` 4×4, `mine`, `boom` 24×24×3; `pop.wav`, `boom.wav` (ключ `boom_sfx`) | Volley/Lash, Tight/Wide, Mine, Morph |

## Исполнение и ctx

```js
let state = 0; // closure state: отдельный экземпляр на каждого участника
defineCharacter({
  spawn(ctx) {}, // один раз после создания стартового тела
  update(ctx, dt) {}, // каждый tick, после ability
  ability(ctx, { slot, phase }) {}, // slot 0–3, phase 'press' | 'hold' | 'release'
  event(ctx, event) {}, // beforeHit / damageReceived / death / contact
});
```

`ctx = {selfId, ownerId, entityId, input, world, api}`:

- `selfId` — id стартового тела (`host:N`), не меняется даже после его смерти (Bud продолжает управлять семенами по `ctx.world.entities`).
- `ownerId` — 1 или 2.
- `entityId` — контекстная сущность: `selfId` в `spawn`/`update`/`ability`; `event.entityId` в `beforeHit`/`damageReceived`/`contact`; **`null` в `death`**; внутри timer/sequence callback — scope этого таймера (может быть `null`). Именно это значение становится default scope таймеров, созданных из callback.
- `input`: `move`/`aim` `{x,y}`, `slots[4]` `{pressed,held,released}`. На первом тике удержания приходят и press, и hold; повтор ОС не создаёт press; короткий tap даёт pressed и released в одном input; pause/blur отпускают слоты через release; Restart сбрасывает keys/edges/facing.
- `world` — копия снимка начала вызова: `width, height, obstacles[{x,y,w,h}], time, remaining, entities[], effects[], sounds[], slots, result, error, shake`.
- `api` — заморожен; методы ниже.

Один QuickJS runtime на игрока; нет DOM, fetch, process, require, host import, host eval. Вызовы api собирают JSON-буфер команд, host применяет его **после** возврата callback. `api.entity/queryCircle/raycast` читают снимок начала вызова: только что созданная/изменённая сущность видна в следующем callback (внутри одного tick — уже в contact/death callbacks). Функции через JSON не передаются: таймеры и sequence живут в guest. Bridge internals недоступны моду: `defineCharacter` удаляется после регистрации, глобального dispatch нет, timer Map и лимиты захвачены до загрузки скрипта.

## Сущность

Поля снимка и `api.entity`: `id, ownerId, x, y, vx, vy, angle, radius, hp, maxHp, solid, countsForDefeat, sprite, scale, tags, contact, visible` + необязательные `lifetime, width, height`; внутренние `ix, iy` — затухающий импульс. Дефолты `spawn`: `x,y 0`, `vx,vy 0`, `angle 0`, `radius 7`, `hp = maxHp ?? 100`, `maxHp = hp ?? 100` (задано одно из двух — второе копирует его; ни одного — 100/100), `solid false`, `countsForDefeat false`, `sprite 'body'`, `scale 1`, `tags []`, `contact false`, `visible true`, `lifetime/width/height` отсутствуют.

- `solid`: только solid && hp>0 тела расталкиваются друг с другом (16 проходов), выталкиваются из кирпичей и зажимаются границей. **Non-solid не clamp'ится вообще**: проходит сквозь кирпич и уходит за границу; что делать при контакте (destroy/bounce), решает мод через `contact` + `lifetime`. Стартовое тело — `solid:true, countsForDefeat:true`.
- `contact: boolean` — host генерирует события `contact` для этой сущности (см. sweep). Приводится к boolean.
- `visible: boolean` — чисто рендер: `false` прячет спрайт, рамку-обводку, индикатор направления и полоску HP этой сущности на общем canvas (оба игрока смотрят в один экран, поэтому это не приватность per-player, а честная невидимость для обоих). Приводится к boolean. Не влияет на физику/коллизии/`queryCircle`/`raycast` — сущность остаётся полностью реальной, просто не рисуется.
- `lifetime: number | null` — секунды; host вычитает `dt` каждый tick после движения; при `<= 0` — kill с `reason:'expired'`. `null`/отсутствие — бессрочно.
- `width, height` — отображаемый размер (× `scale`); без них renderer берёт `frameWidth/frameHeight` ассета, а без ассета рисует квадрат `8 × scale`. На коллизии не влияют — коллизия только по `radius`.
- `sprite` — строка ≤ 40 символов, ключ sprite-ассета владельца; отсутствующий ключ не ошибка (квадрат). Таблицы ассетов читаются только по собственным свойствам: имена вида `constructor`/`__proto__`/`hasOwnProperty` — просто отсутствующие ключи (квадрат), а не объекты из `Object.prototype`.
- `tags` — массив строк: ≤ 16 элементов, каждый ≤ 64 символов, иначе `Invalid tags` (host проверяет при `spawn` и `patch`; `tags` попадают в снимки обоих игроков каждый вызов, поэтому ограничены как `sprite`/`label`). Все три мода читают `tags` чужих сущностей через `includes/some` — форма массива строк гарантирована host.
- `countsForDefeat` задаётся только при spawn; `hp/maxHp` меняются только через damage/heal.

`spawn(spec)` принимает ровно: `x, y, vx, vy, angle, radius, hp, maxHp, sprite, scale, solid, countsForDefeat, tags, contact, lifetime, width, height`. Иное поле → `Invalid spawn field <k>`; `ownerId` в spec → `Invalid entity ownership`. Все числа конечные (`Invalid finite <k>`), `|x|, |y|, |vx|, |vy|, radius, scale, width, height ≤ 1e6` (`Invalid magnitude <k>` — технический предел, см. «Технические бюджеты»), `radius/scale/width/height > 0` (`Invalid size`), `hp/maxHp > 0`, `tags` — массив строк ≤ 16 × ≤ 64 (`Invalid tags`).

`patch(id, changes)` разрешает: `x, y, vx, vy, angle, radius, sprite, scale, solid, tags, contact, visible, lifetime, width, height`. Запрещены `id, ownerId, hp, maxHp, countsForDefeat` → `Forbidden patch field <k>`. `lifetime:null` снимает срок; `width/height: undefined` снимает размер; `tags` проверяются так же, как при `spawn` (`Invalid tags`); `x, y, vx, vy, radius, scale, width, height` — тот же предел `1e6` (`Invalid magnitude <k>`).

## Методы ctx.api

Чтение (снимок):

- `entity(id)` → копия любой сущности (своей или чужой) или `null`.
- `queryCircle({x,y,radius})` → сущности, чей круг `(e.x, e.y, e.radius)` пересекает или касается заданного: условие `hypot(e.x−x, e.y−y) <= radius + e.radius`, то есть касание окружностей считается пересечением. В результат входят собственные сущности и сущности с `hp = 0` в момент death callback. Фильтровать владельца/HP — задача мода.
- `lineOfSight(from, to)` → boolean: отрезок не пересекает ни один кирпичный AABB (касание считается пересечением). Числа конечные, иначе `Invalid line segment`.
- `raycast({from:{x,y}, to:{x,y}, radius=0, ignore=[]})` → массив hits, отсортированный по `t` (при равном `t` brick/bounds стоят раньше entity — стена у самой грани цели прикрывает её). Учитываются сущности с `hp > 0` **всех** владельцев (включая свои, если не в `ignore`), кирпичи, границы. Формат hit: `{kind:'entity', id, ownerId, t, point, normal}` | `{kind:'brick', t, point, normal}` | `{kind:'bounds', t, point, normal}`. `t ∈ [0,1]` — доля отрезка; `point` — центр луча в момент попадания; `normal` — единичный вектор от препятствия к лучу (brick — axis-aligned; bounds — внутрь арены). Луч из точки внутри сущности/кирпича даёт `t=0`. Не конечные `from/to/radius`, `radius < 0`, не-массив `ignore` → `Invalid raycast`. Конечные, но абсурдные координаты (порядка `1e154` и выше, когда `dx²` или `to−from` переполняются до `Infinity`) не ошибка: такое препятствие считается промахом, hit с `t: NaN`/`null` не возникает никогда. Mage ignore'ит турель, Bud — все свои тела.

Команды (применяются после callback; ошибка останавливает матч с атрибуцией `<manifest.id> P<n>: <сообщение>` — префикс владельца ровно один раз, например `fighter P1: Cannot mutate foreign entity`):

- `spawn(spec)` → зарезервированный id `<owner>:<serial>` сразу; сущность появляется в снимке следующего callback. Сущность, созданная в `ability/update`, движется уже в этом tick.
- `patch(id, changes)` → только своя сущность (`Cannot mutate foreign entity`); устаревший id — no-op.
- `destroy(id)` → очередь kill своей сущности (`reason:'destroyed'`); устаревший id — no-op. До drain сущность ещё видна в снимке.
- `damage(id, amount, sourceId?)` → очередь урона любой сущности (своей тоже). `amount` конечное ≥ 0. `sourceId`, если задан: **своя существующая** сущность (в death callback умирающая сущность ещё существует — Bud взрывает мину от её же id) — урон атрибутируется ей; **устаревший** id (истёкший снаряд, удалённое тело) — урон ставится в очередь без источника, как при отсутствии `sourceId` (в `beforeHit/damageReceived/death` поле `sourceId` отсутствует); **живая чужая** сущность → `Foreign damage source`. Устаревший целевой id — no-op.
- `heal(id, amount)` → своя живая сущность, до `maxHp`; amount ≥ 0.
- `impulse(id, {x,y})` → любой живой сущности (в том числе чужой — knockback) добавляется затухающий компонент `ix/iy` (× `exp(-10·dt)` за tick); базовые `vx/vy` не меняются. Компоненты конечные и `|x|, |y| ≤ 1e6` (`Invalid magnitude impulse x`/`y`) — ошибка приписывается инициатору, чужое тело остаётся нетронутым.
- `after(seconds, cb, options?)`, `every(seconds, cb, options?)` → числовой id; `seconds` конечное, для `after` ≥ 0 (`after(0, cb)` срабатывает на следующем tick, как `{wait:0}`), для `every` > 0; иначе `Invalid timer`. `cancel(id)` → `true`, если таймер/sequence существовал; `cancel` из callback другого таймера в том же tick предотвращает его срабатывание (обход проверяет существование таймера перед каждым вызовом). Таймеры срабатывают в начале tick владельца по simulation time (пауза не расходует), по одному разу за tick, `every` не наверстывает пропуски; callback получает свежий `ctx`, где `ctx.entityId` = scope таймера.
  - `options.entityId`: не задан → scope = `ctx.entityId` текущего callback (в `death` это `null`); `null` явно → owner/match scope; строка → та сущность (можно зарезервированный id из `spawn` в том же callback). Иной тип/иные options → `Invalid timer options`.
  - Таймер с entity scope **молча удаляется** в начале tick, если сущности нет в снимке (умерла, истёк lifetime, destroy). Mage привязывает `every` к зоне/турели — они прекращаются вместе с сущностью; Bud привязывает `every(0.05)` к мине. **После смерти стартового тела** `ctx.entityId` в `update`/`ability` по-прежнему равен `selfId`, поэтому `after/every/sequence` без `options`, созданные оттуда, получают scope мёртвого тела и молча удаляются в начале следующего tick (у sequence исполнятся только шаги до первого `wait`). Bud после распада передаёт `{entityId: null}` или id живой сущности явно.
  - Активных таймеров + sequence ≤ `timers` budget (256), иначе `Timer budget exceeded`. Dispose runtime уничтожает VM и все таймеры.
- `sequence(steps, options?)` → id из того же пространства (`cancel(id)` останавливает оставшиеся шаги), занимает один слот `timers`. Шаги — объекты ровно с одним ключом: `{wait:seconds≥0}`, `{effect:spec}`, `{sound:asset, options?}` (options только у sound), `{shake:{amount,seconds}}`, `{run:fn(ctx)}`. ≤ 64 шагов, любое нарушение → `Invalid sequence` до исполнения. Шаги до первого `wait` исполняются сразу в текущем callback (`run` получает текущий `ctx`); остальные — в начале tick после ожидания с новым `ctx` (`entityId` = scope sequence). Scope — как у таймеров: без `options` — контекстная сущность; Bud явно передаёт `{entityId:null}` для взрыва мины и вспышек распада, чтобы анимация пережила исчезновение тела. Ошибка в `effect` шаге всплывает при host apply.
- `effect(spec)` → см. таблицу ниже. Живых эффектов на владельца ≤ 256 (`Effect budget exceeded`); ошибка схемы останавливает мод до render.
- `sound(asset, {volume?})` → WAV-ключ текущего пакета (`Unknown sound`); `volume ∈ [0,1]`, default 1, умножает базовый gain 0.16; любой другой ключ options → `Invalid sound option <k>`.
- `shake(amount, seconds)` → визуальный shake, амплитуда `min(|amount|, 8)` px; последний вызов перекрывает предыдущий.
- `slot(index, {label, cooldown, active})` → только HUD: index 0–3; state — объект ровно с ключами `label` (строка ≤ 40), `cooldown` (конечное ≥ 0, секунды, «READY» при 0) и `active` (подсветка, приводится к boolean, отсутствие = `false`). Любой другой ключ → `Invalid slot field <k>`, не-объект/отсутствие label или cooldown → `Invalid slot`. Host сохраняет ровно `{label, cooldown, active}` — слоты попадают в снимки обоих игроков каждый вызов, поэтому лишние данные в них не допускаются. Движок не блокирует способность и не уменьшает cooldown: мод сам сравнивает `ctx.world.time` с моментом готовности.

Все команды проходят guest-side проверку конечности каждого числа (рекурсивно по объекту) в момент вызова — `NaN/Infinity` в любом поле, включая `tags` или state slot'а, даёт `Invalid finite <ключ>` до отправки на host; host повторяет проверку. Команд за tick ≤ 1024 на владельца (сумма по всем его callback за tick: update/abilities/timers/events; чужие команды не учитываются).

### Эффекты

| Поле   | ring (default)                                                                                                                 | sprite                                                                                        | beam                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `kind` | `'ring'` / отсутствует                                                                                                         | `'sprite'`                                                                                    | `'beam'`                                             |
| anchor | `x,y` **или** `attach:{id,dx=0,dy=0}`                                                                                          | то же                                                                                         | то же — начало луча                                  |
| конец  | —                                                                                                                              | —                                                                                             | ровно одно из `to:{x,y}` / `attachTo:{id,dx=0,dy=0}` |
| форма  | `radius ≥ 0` обязателен; `angle?`; `arc? ∈ [0,π]` (половина сектора); `color? #RRGGBB`                                         | `asset` — sprite-ключ владельца, обязателен; `scale? > 0` (1); `angle?`; `loop? bool` (false) | `width? > 0` (2); `color?`                           |
| время  | `duration > 0` обязателен; `delay ≥ 0` (0); `fadeIn ≥ 0` (0); `fadeOut ≥ 0` — default **duration** (линейное затухание Task 1) | как ring, `fadeOut` default **0**                                                             | как sprite, `fadeOut` default **0**                  |

Неизвестное поле, неверный kind, отсутствие anchor, `x,y` вместе с `attach`, `color` у sprite, не-sprite asset, оба/ни одного конца beam → ошибка с подстрокой `effect`. `attach/attachTo` принимают **любую** живую сущность, включая чужую (Mage вешает spark на противника); эффект скрыт и удаляется, когда сущность исчезает или hp ≤ 0. `alpha = clamp01(min(t/fadeIn, (duration−t)/fadeOut))`; эффект с `delay` живёт до `at+delay+duration`. Кадр sprite: `loop ? floor(t·fps) % frames : min(frames−1, floor(t·fps))`, размер `frameWidth/Height × scale`. Beam — линия `width/color` между anchor и концом. Эффекты лежат в `world.effects` снимка с `ownerId, at`.

## Порядок tick (`world.step`, 1/60 с, catch-up ≤ 5 шагов на кадр)

1. `time += dt`; для каждого игрока по порядку 1, 2: сработавшие timers/sequences (entity-scoped без сущности — удаляются; отменённые callback'ом ранее в этом обходе — пропускаются) → `ability` для каждого слота с press/hold/release → `update`. Команды каждого callback применяются сразу после него.
2. Запоминается `px,py` живых сущностей; интеграция `x += (vx+ix)·dt`, затухание `ix/iy`.
3. 16 проходов: попарное расталкивание `solid && hp>0`, затем clamp кирпичей/границы — только solid.
4. Contact sweep для сущностей с `contact && hp>0`, у которых нет kill в очереди; события `contact` доставляются владельцу.
5. `lifetime -= dt` у живых; `<= 0` → kill `reason:'expired'`.
6. `drain()` — FIFO очередь damage/kill/death; callbacks могут spawn/damage/destroy/effect, всё разрешается здесь же.
7. `pruneEffects` — истёкшие и потерявшие attach эффекты удаляются.
8. Вердикт: живые `countsForDefeat && hp>0` у каждого владельца; затем timeout.

Сущности, созданные в шагах 4–6, движутся со следующего tick. Бюджеты CPU/events сбрасываются один раз в начале tick.

## События (`event(ctx, event)`), всё в `events` budget владельца

- `beforeHit {type, entityId, sourceId?, amount}` — перед снятием HP своей живой сущности; return `{cancel:true}` (отменить), `{amount:number}` (конечное ≥ 0, иначе ошибка) или ничего.
- `damageReceived {type, entityId, sourceId?, amount}` — фактически снятые HP (`min(hp, amount)`); при 0 тоже приходит. Bud растёт только при `amount > 0`.
- `death {type, entityId, sourceId?, reason}` — один раз, до удаления; сущность ещё в снимке с `hp = 0`. `reason: 'damage'` (HP до 0; `sourceId` — как в damage) | `'destroyed'` (`api.destroy`) | `'expired'` (lifetime). Callback может создавать сущности/урон/эффекты/таймеры — всё применяется до вердикта; `ctx.entityId === null`, поэтому таймеры без явного scope получают owner scope. Bud спавнит пять семян; Mage рисует кольцо на месте зоны/турели.
- `contact {type, entityId, kind, otherId?, otherOwnerId?, t, point:{x,y}, normal:{x,y}}` — `kind: 'entity' | 'brick' | 'bounds'`; `otherId/otherOwnerId` только для `entity` (любой владелец, включая свой — Mage/Bud сами пропускают свои тела). `t` — доля отрезка движения этого tick, `point` — центр самой сущности в момент контакта, `normal` — от препятствия к сущности (для entity — от другой сущности к этой). Host ничего не делает сам: урон, отскок (Bud mine: `patch` позиции/скорости по `normal`), уничтожение — в моде.

Contact sweep: отрезок от позиции до интеграции к позиции после collision/clamp, радиус сущности. Кирпич — AABB, расширенный на radius (углы квадратные); граница — выход из `[r, W−r]×[r, H−r]`; сущности — все `other ≠ e` с `hp > 0` в текущих позициях, круг `r+r_other`. Перекрытие на старте отрезка даёт `t=0` — и повторяется каждый tick, пока сущности касаются. Один hit на пару/препятствие за tick, сортировка по `t` (при равном `t` brick/bounds раньше entity), доставка по одному; **после callback оставшиеся hits этой сущности в этом tick отбрасываются, если она поставлена в kill-очередь (destroy) или её `x/y/vx/vy` изменены patch'ем**. Так стена перед противником срабатывает первой, а снаряд, уничтоженный на стене, не бьёт противника за ней. Сущность, для которой kill уже стоит в очереди к моменту sweep (`destroy` в `update`/`ability`/таймере или в contact callback другой сущности этого tick), **не получает contact-событий в этом tick**, хотя до drain она ещё в снимке и уже сдвинулась. Список «сущности» включает **собственное тело владельца**: снаряд, созданный в позиции владельца без отступа ≥ `r + r_owner`, получит на первом же tick contact `kind:'entity'` с `otherOwnerId === ctx.ownerId` при `t=0` (recipe ниже отступает на `me.radius + 4`; Mage/Bud пропускают свои тела в callback).

Порядок в очереди: `damage` → `beforeHit` → снятие → `damageReceived` → при hp ≤ 0 в конец очереди ставится `death`. Урон по сущности с hp ≤ 0 и повторные kill пропускаются.

## Вердикт

После drain: нет живых `countsForDefeat` у обоих — draw; у одного — победа другого; иначе при `time ≥ 180` — draw. Death callbacks исполняются до вердикта: пять семян Bud из death callback удерживают матч, взрыв из death callback может дать draw. Сущности без флага (турель Mage, зона, мина, снаряды) матч не удерживают. Таймер паузы не расходуется. Ошибка мода/бюджета — `world.error`, матч останавливается, обе VM закрываются: техническая ошибка, не поражение.

## Технические бюджеты

`DEFAULT_LIMITS` (`src/mods/runtime.js`; `createRuntime(pkg, ownerId, overrides)`): heap 16 MiB, stack 128 KiB (лимит QuickJS должен срабатывать раньше нативного стека браузера/Node — глубина ≈ 700 обычных вызовов или ≈ 150 вложенных `sequence`), load 50 ms, **8 ms CPU суммарно на участника за tick** (update/abilities/timers/event callbacks, snapshot, JSON bridge, host apply — без нового бюджета на callback), 256 entities/timers/effects на владельца, 1024 commands за tick на владельца, 1024 event callbacks на участника за tick и столько же элементов drain, JSON ≤ 1 048 576 UTF-16 code units на сообщение в каждую сторону, `tags` ≤ 16 строк по ≤ 64 символов на сущность (`sprite`/`label` ≤ 40), state слота — ровно `{label, cooldown, active}`, script 256 KiB, пакет 16 MiB. Нарушение останавливает матч и закрывает VM.

Лимит магнитуд: `|x|, |y|, |vx|, |vy|`, `radius`, `scale`, `width`, `height` в `spawn`/`patch` и компоненты `impulse` не превышают `1e6` (`Invalid magnitude <k>`, атрибуция инициатору). Это технический, а не балансовый предел: арена 480×270, скорости моделей — сотни единиц; конечные, но абсурдные значения (`1e308`) переполняли интеграцию (`ix = Infinity` навсегда, `null` в JSON) и sweep (`t: NaN`). После интеграции и после separation/clamp host проверяет конечность `x, y, ix, iy` каждой живой сущности; нарушение — ошибка `world: Non-finite <k> … on entity <id> … after integration|collision` (инвариант движка: при соблюдении лимитов недостижимо). `hp`, `lifetime`, `angle` лимитом не ограничены — только конечностью (`radius` до 1e6 с `radius ≥ 1e154` ранее давал `NaN` в separation).

Атрибуция ошибок: всё, что мод произвёл (команды, ответ `beforeHit`, исключение из callback), проверяется внутри бюджета этого мода и получает префикс `<manifest.id> P<n>: `. Переполнение очереди drain (`Queue event budget exceeded`) приписывается владельцу команды, поставившей переполняющий элемент (даже если его цель уже не существует); элементы, поставленные самим движком (истёкший `lifetime`), дают префикс `world: `. Текст исключения из гостя обрезается до 512 символов; `throw undefined`/`throw Symbol()` даёт `Unknown guest error`.

## Чего нет

Host-side projectile/behavior helpers и событие `projectileHit` (только generic `contact`); status/DoT helpers (Mage делает зону через `every` + `queryCircle`); ограничение `attach` на свои сущности; позиционный звук; повторяющиеся/вложенные sequence как отдельная сущность (только `run` + новый `sequence`); разрушаемые кирпичи; сеть; геймпад; независимый прицел. Sweep непрерывный (отрезок за tick), поэтому contact-снаряды не туннелируют сквозь кирпичи; но пара «контакт с сущностью, которая сама движется» проверяется по конечной позиции другой сущности, а не по её отрезку. Playtest людьми и security audit не проводились.

## Подводные камни

- Contact при перекрытии на старте отрезка приходит с `t=0` **каждый tick**, пока сущности касаются: дедупликация, destroy или отскок — задача мода (Mage/Bud уничтожают снаряд на первом контакте, мина Bud взрывается).
- Снаряд, созданный в позиции владельца, на первом tick контактирует с телом владельца (`kind:'entity'`, `otherOwnerId === ctx.ownerId`, `t=0`): отступайте на `r + r_owner` или фильтруйте свои id в callback.
- После смерти стартового тела `ctx.entityId` в `update`/`ability` остаётся `selfId`: таймеры и sequence без `options.entityId` привязываются к мёртвому телу и молча удаляются в начале следующего tick. Передавайте `{entityId: null}` или id живой сущности.
- `destroy` ставит kill в очередь, а не удаляет сущность: до drain она в снимке с `hp > 0` и движется, но contact-событий уже не получает.
- `damage` с устаревшим `sourceId` — не ошибка: урон проходит без источника, события приходят без `sourceId`. `Foreign damage source` — только для живой чужой сущности в `sourceId`.
- При равном `t` brick/bounds стоят раньше entity (sweep и raycast); контакт с движущейся сущностью проверяется по её конечной позиции в этом tick; угол кирпича в sweep квадратный (AABB, расширенный на radius).
- Ошибка мода закрывает обе VM и останавливает матч; сообщение — `<manifest.id> P<n>: …`, префикс один раз.
- Порядок в tick-фазе асимметричен: игроки обрабатываются по порядку 1, 2, и команды P1 (timers → ability → update) применяются **до** того, как снимается снимок для P2 в том же tick. P2 видит spawn/patch/slot P1 этого tick уже в своём `update`, а P1 увидит команды P2 только в следующем tick (или в contact/death callbacks этого tick). Симметричный мод не должен полагаться на «одновременность» решений в пределах tick.
- Лимит магнитуд `1e6` для `x, y, vx, vy, radius, scale, width, height` и `impulse` (см. «Технические бюджеты»): `patch(id, {vx: 1e308})` или `impulse(enemy, {x: 1e308, y: 0})` — ошибка инициатора (`Invalid magnitude …`), а не «бесконечный knockback». В `raycast` абсурдные координаты дают промах, а не hit с `NaN`.
- Dev-сервер Vite отдаёт статику всего project root (`index.html`, `src/`, `characters/`, `docs/` и т. д.); `server.fs.strict` запрещает только выход **за** корень проекта. Пакеты читаются через `/api/characters/<id>` с проверками realpath/symlink, но сами файлы `characters/*` доступны и как статика — это свойство локальной установки, а не публичного сервера.

## Recipe: снаряд, турель, группа тел (по коду Mage/Bud)

Снаряд — non-solid контактная сущность с lifetime; ответ на контакт в `event`:

```js
ctx.api.spawn({
  x: me.x + aim.x * (me.radius + 4),
  y: me.y + aim.y * (me.radius + 4),
  vx: aim.x * 220,
  vy: aim.y * 220,
  angle: Math.atan2(aim.y, aim.x),
  radius: 3,
  hp: 1,
  solid: false,
  contact: true,
  lifetime: 1.6,
  sprite: "bolt",
  tags: ["bolt"],
});
// event(ctx, ev): ev.type === 'contact'
const bolt = ctx.api.entity(ev.entityId);
if (ev.kind === "entity" && ev.otherOwnerId !== ctx.ownerId) {
  ctx.api.damage(ev.otherId, 14, bolt.id);
  ctx.api.impulse(ev.otherId, { x: -ev.normal.x * 90, y: -ev.normal.y * 90 });
}
ctx.api.effect({
  kind: "sprite",
  asset: "spark",
  x: ev.point.x,
  y: ev.point.y,
  duration: 0.24,
});
ctx.api.destroy(bolt.id); // остальные hits этого tick отбрасываются
```

Турель — solid тело без `countsForDefeat`, `every` привязан к ней и исчезает вместе с ней; линия огня через `raycast`:

```js
const id = ctx.api.spawn({
  x,
  y,
  radius: 6,
  hp: 40,
  solid: true,
  countsForDefeat: false,
  sprite: "turret",
  lifetime: 5,
  tags: ["turret"],
});
ctx.api.every(
  0.6,
  (c) => {
    const turret = c.api.entity(c.entityId);
    if (!turret) return;
    const hit = c.api
      .raycast({ from: turret, to: target, ignore: [turret.id] })
      .find((h) => h.kind !== "entity" || h.id === target.id);
    if (!hit || hit.id !== target.id) return; // кирпич/граница раньше цели
    c.api.damage(target.id, 8, turret.id);
    c.api.effect({
      kind: "beam",
      attach: { id: turret.id },
      to: hit.point,
      width: 2,
      color: "#d9b3ff",
      duration: 0.12,
      fadeOut: 0.08,
    });
  },
  { entityId: id },
);
```

Группа тел — death callback стартового тела создаёт `countsForDefeat` семена, а `update` ведёт всех живых по тегу:

```js
event(ctx, ev) {
  if (ev.type === "death" && ev.entityId === ctx.selfId && !split) {
    const me = ctx.api.entity(ev.entityId); split = true;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const id = ctx.api.spawn({ x: me.x + Math.cos(a) * 10, y: me.y + Math.sin(a) * 10,
        radius: 4, hp: 20, solid: true, countsForDefeat: true, sprite: "seed", width: 8, height: 8,
        tags: ["body", "seed"] });
      ctx.api.impulse(id, { x: Math.cos(a) * 80, y: Math.sin(a) * 80 });
    }
    ctx.api.sequence([{ effect: {...} }, { sound: "pop" }, { wait: 0.12 }, { effect: {...} }], { entityId: null });
  }
},
update(ctx) {
  for (const e of ctx.world.entities)
    if (e.ownerId === ctx.ownerId && e.hp > 0 && e.tags.includes("body"))
      ctx.api.patch(e.id, { vx: ctx.input.move.x * 66, vy: ctx.input.move.y * 66 });
}
```

Смена поведения слота — только state в замыкании: Bud хранит `form` и в `ability` вызывает `volley` или `lash` (raycast + beam), меняя label через `api.slot`. Проверенные ограничения и команды — `docs/implementation-status.md`.

## Recipe: смена способности без правки ядра (исполняемая версия — `tests/mutation.test.js`)

1. Скопировать папку: `cp -r characters/fighter characters/my_fighter`. В `manifest.json` поставить `"id": "my_fighter"` (должен совпадать с именем папки и матчить `^[-a-z0-9_]+$`), новое `name`, при желании новый `label` первого слота.
2. В `main.js` заменить одну строку в `ability()`: вызов `attack(ctx, 24, 15, 0.25, 45, "#fff1c1");` (слот 0) → `blast(ctx);` и добавить функцию:

```js
function blast(ctx) {
  const me = ctx.api.entity(ctx.selfId);
  if (!me || me.hp <= 0) return;
  for (const e of ctx.api.queryCircle({ x: me.x, y: me.y, radius: 60 })) {
    if (e.ownerId === ctx.ownerId || e.hp <= 0) continue;
    const dx = e.x - me.x,
      dy = e.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    ctx.api.impulse(e.id, { x: (dx / d) * 300, y: (dy / d) * 300 }); // radial knockback
  }
  ctx.api.heal(me.id, 30);
  ctx.api.effect({
    kind: "sprite",
    asset: "body",
    attach: { id: me.id },
    scale: 2,
    duration: 0.5,
  });
}
```

3. В игре: Back → Reload mods — сервер заново сканирует `characters/`; выбрать `my_fighter`, Start. Никаких правок `src/`, `vite.config.js` или списка имён: ядро не знает персонажей. Тест `tests/mutation.test.js` делает то же самое во временной папке и доказывает, что первый слот больше не наносит урон, а отталкивает, лечит и вешает attached-эффект; после теста папка удаляется.
