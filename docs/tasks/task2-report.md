# Task 2 report — 2026-09-11

Основание: `docs/tasks/task2-brief.md` (раздел Task 2 плана), контракт `docs/tasks/task2-design.md`. Фактический API: `docs/mod-api.md`. Журнал: `docs/implementation-status.md`. Workspace не git; изменения — локальные файлы.

Проверки при составлении отчёта (после fix round): `npm test` — 66/66 PASS (65 без `tests/mutation.test.js` из Task 3); `npm run build` — PASS. Актуально после Task 3 (2026-09-11, после fix round 4): `npm test` — **88/88** PASS (input 4, world 9, effects 9, mods 26, mage 11, bud 9, mutation 1, adversarial 19; `--test-concurrency=1`, ≈ 2.5–3 с), `npm run build` — PASS, `npm run test:browser` — PASS (раздел «Browser smoke (Task 2)» ниже). Тесты Task 2 не переписывались (в `world` добавлено два кейса — fix round 3 и 4, в `effects` один — fix round 3); fix round 2 по adversarial findings (stack 128 KiB, валидация ответа `beforeHit`, command budget per-owner, `world:` префикс, обрезка сообщений), fix round 3 по findings финального review (whitelist `slot`, prototype-ключи ассетов, лимит магнитуд `1e6` + инвариант конечности, M-2/M-3/M-4/M-7, M-1/M-6 в docs) и fix round 4 по finding re-review (лимит магнитуд на `radius/scale/width/height`, проверка конечности после separation/clamp) описаны в `docs/implementation-status.md`, раздел «Task 3».

## Чекбоксы плана Task 2

### 1. Regression: death callback → пять countsForDefeat тел; турель не удерживает; взрыв до verdict

Сделано. `world.drain()` исполняет death callbacks до вычисления вердикта; вердикт — по `countsForDefeat && hp>0` после drain. Доказательства:

- `tests/mods.test.js` «death callback spawns five countsForDefeat bodies; a turret without the flag does not hold» — generic-мод без Bud.
- `tests/mods.test.js` «damage dealt from a death callback resolves before the verdict (draw)».
- `tests/bud.test.js` «burst: first death spawns five countsForDefeat seeds in the same tick; verdict waits for the last seed; seeds do not split».
- `tests/mage.test.js` «slot 3 Turret does not hold the match: mage death is a loss with a live turret».

### 2. Raycast/segment, sensors, contact events без урона по умолчанию; валидация NaN/владения/stale/ownerId/JSON

Сделано. `src/engine/spatial.js` (`createSpatial` — host и guest исполняют один исходник), `world.contacts()` (sweep от позиции до интеграции, доставка по `t`, отбрасывание оставшихся hits после destroy/patch), `api.raycast`. Host не наносит урон и не двигает сущность: Mage/Bud делают это в `contact` callback. Валидация: whitelists spawn/patch, `Forbidden patch field`, `Invalid tags` (массив строк ≤ 16 × ≤ 64), guest-side + host-side проверка конечности, `Invalid raycast`, stale id → no-op (целевой id; устаревший `sourceId` — урон без источника), JSON budget до применения (`runtime.call`). Доказательства:

- `tests/world.test.js` «spatial sweep: numeric point/normal for bricks, entities and bounds; sorted; ignore» (включая brick раньше entity при равном `t`), «spawn whitelist, hp→maxHp default, sizes, lifetime expiry and patch guards» (включая `Invalid tags` и `maxHp` → `hp`), «non-solid entity is never clamped: passes through brick and leaves the arena».
- `tests/mods.test.js` «contact: brick before enemy fires first; destroy on the brick shields the enemy; point/normal numeric», «contact: patching x/y/vx/vy in a callback drops the remaining hits of that tick», «non-solid contact entity crosses the boundary with a bounds event and is not clamped», «death reasons: expired, destroyed and damage», «guest validation: forbidden patch fields, unknown spawn field, NaN/Infinity, sound options», «raycast sorts hits by t and honours ignore», «contact: an entity destroyed during update receives no contact that tick», «damage with a stale sourceId is accepted as unattributed; a live foreign source is rejected» (два последних — fix round).
- `tests/mage.test.js` «slot 0 Bolt: a brick in front of the enemy stops the bolt and shields the enemy», «slot 0 Bolt: leaving the arena destroys the bolt without error», «slot 3 Turret: fires at a visible enemy, not through a brick, then expires».
- `tests/bud.test.js` «Volley: shots hurt the enemy, never own bodies, and die on a brick shielding the enemy», «Mine: creeps toward the enemy, explodes on contact, expires by lifetime otherwise».

### 3. Guest timers и отменяемая sequence; scope по умолчанию — создавшая сущность; dispose чистит всё

Сделано в `src/mods/bootstrap.js`: `after/every(seconds, cb, {entityId})` (`after` ≥ 0, `every` > 0; `cancel` из callback другого таймера действует в том же tick), default scope = `ctx.entityId` (null в death), entity-scoped таймеры удаляются без сущности; `sequence(steps, options)` ≤ 64 шагов, общее id-пространство с `cancel`; dispose закрывает VM с таймерами, `world.dispose` очищает effects/sounds/entities. Доказательства:

- `tests/mods.test.js` «timers: entity-bound timer dies with its entity, null scope and context default fire», «timers: after(0) fires next tick; a callback cancelling a later same-tick timer suppresses it» (fix round), «sequence: immediate steps run now, waits defer, cancel stops remaining steps, sound carries volume», «dispose then a new match carries no old callbacks, effects or sounds», «guest internals are inaccessible and shadowing names cannot bypass timer cap» (Task 1, по-прежнему проходит с новым бюджетом timers+sequence).
- `tests/mage.test.js` «slot 1 Anchor expires by timer and returns to the placing phase», «slot 2 Zone: periodic damage inside, none to self, stops when the zone expires» (every в scope зоны).

### 4. VFX: sprite animation, attachment, point/endpoint beam, angle/scale, loop, fade-in/out, delay, sound, shake

Сделано в `src/engine/effects.js` (pure) + `src/view/renderer.js`/`assets.js`. Проверяются вычисляемые значения, не пиксели. Доказательства:

- `tests/effects.test.js` «validateEffect keeps Task 1 ring specs and fills defaults», «validateEffect rejects every malformed branch with an 'effect' message», «attached effects follow the entity and vanish when it is gone», «alpha at boundaries: fadeIn, plateau, fadeOut, and Task 1 linear ring», «delay hides the effect until start and extends its life», «pruneEffects drops expired effects and those whose attach target is gone», «spriteFrame clamps without loop and wraps with loop», «render smoke: rings, sprites, beams and bodies without assets draw on a fake ctx».
- Sound volume: `tests/mods.test.js` «guest validation…» (volume 0.25 в `world.sounds`, `pan` отвергнут), «sequence…» (volume 0.5 из шага); shake: `tests/bud.test.js` «Mine…» (`w.shake.amount === 4`).
- `tests/mods.test.js` «malformed effects fail in world before render with owner attribution» (Task 1) продолжает проходить с новой схемой; «world.effects is pruned in step once an effect expires or its attach dies» (fix round) проверяет prune внутри `world.step`.

### 5. Mage и Bud без `if characterId` в ядре; ассеты локальным скриптом

Сделано: `characters/mage/{manifest.json,main.js}` (Bolt, Anchor→Blink, Zone, Turret), `characters/bud/{manifest.json,main.js}` (рост 10 %, распад на пять семян, группа, Volley/Lash, Tight/Wide, Mine, Morph). В `src/` нет ссылок на имена персонажей или способностей. Ассеты: `scripts/generate-mage-assets.py`, `scripts/generate-bud-assets.py` (stdlib-only, детерминированные PNG/WAV). Доказательства: «Mage manifest is valid with four slots», «Bud manifest is valid with exactly four slots», «growth: real damage scales radius/scale by exactly 10%, zero damage does not, cap holds», «Morph: slot 0 label flips and Lash fires a raycast beam instead of projectiles», «group: move input drives every live body; Formation toggles wide/tight spacing and label».

### 6. Все 12 способностей через тот же runtime; два экземпляра; state; группа Bud; смена поведения слота; test/build/browser smoke

Сделано для unit-части: все тесты Mage/Bud используют `createRuntime` + `createWorld` — тот же путь, что игра. Доказательства:

- Mage, каждый слот: «slot 0 Bolt: projectile entity flies, hits the enemy and vanishes», «slot 1 Anchor/Blink: first press places the anchor, second teleports back to it», «slot 2 Zone…», «slot 3 Turret…», плюс «all four slots in one match run without errors».
- Bud, каждый слот: «Volley…», «group… Formation toggles…», «Mine…», «Morph…», плюс «all four slots before and after the burst against a live Fighter without world error».
- Изоляция экземпляров: «mirror match Mage/Mage: anchor and cooldown state are isolated per instance», «mirror match: P1 morph does not leak into P2; both instances act independently», плюс Fighter «Fighter four abilities execute in QuickJS; charge and cooldown are isolated».
- `npm test` 66/66 на момент отчёта (65 без Task 3 `mutation.test.js`); после Task 3 и fix round 4 — 88/88. `npm run build` PASS. Browser smoke Mage/Bud — PASS (ниже).

## Gate

«Три пакета содержат все character-specific механики; рост от урона и бой после распада работают без знания о Bud в движке» — выполнено по коду: движок оперирует только `contact/lifetime/countsForDefeat/tags/effects/timers`; рост — `patch(radius, scale)` в `damageReceived`, распад — `spawn` в `death`, управление группой — `patch` всех тел с тегом в `update`. Оценка исполнителя: PASS при условии прохождения browser smoke и независимого review. Browser smoke пройден (ниже); независимое ревью проведено — Task 2 Spec PASS / Quality PASS (`docs/reviews/task2-3-final-review.md`), re-review регрессий в зоне Task 2 не нашёл (`docs/reviews/task2-3-rereview.md`). Gate закрыт.

## Отклонения от дизайн-документа (`task2-design.md`)

1. **Guest-side проверка конечности в `emit`** (bootstrap `check`): любое NaN/Infinity в любой команде отвергается ещё в guest с сообщением `Invalid finite <ключ>` до отправки на host; host проверяет повторно. В дизайне проверка была описана только на host. Следствие: сообщения об ошибке одинаковы, но ловятся раньше, в том числе во вложенных полях (`slot.state`, элементы `tags`), которые host проверяет следом.
2. **`ctx.entityId` внутри timer/sequence callback = scope этого таймера**, включая `null` для owner-scope. Дизайн определял `entityId` только для spawn/tick/event; следствие — вложенный `after()` без options из owner-scope таймера тоже получает owner scope, а из entity-scope таймера — ту же сущность.
3. **Тест «circle body cannot enter brick rectangle» переведён на `solid:true`**: раньше `world.spawn` по умолчанию давал solid-поведение всем телам; после введения «non-solid не clamp'ится» тест явно помечает тела solid. Поведение стартовых тел игроков не изменилось (`addPlayer` задаёт `solid:true`).
4. `damage` с устаревшим `sourceId` — после fix round соответствует дизайну (§1: stale id → no-op): урон ставится в очередь без источника, события приходят без `sourceId`; `Foreign damage source` — только для живой чужой сущности. До fix round это была ошибка; отклонение закрыто.
5. `raycast` дополнительно требует `radius ≥ 0` и массив `ignore` (дизайн упоминал только конечность чисел).
6. `sequence`: `wait ≥ 0`; `after` допускает 0 (срабатывает на следующем tick, как `{wait:0}`); `every` требует `seconds > 0` (дизайн не уточнял; до fix round `after(0)` отвергался).
7. `death` не несёт `sourceId` для `destroyed/expired` (поле отсутствует) — дизайн перечислял `sourceId` в форме события без оговорки. То же для урона с устаревшим `sourceId` (п. 4).
8. `tags` ограничены host: массив строк, ≤ 16 элементов по ≤ 64 символов (`Invalid tags` при spawn и patch); дизайн формы `tags` не задавал. Введено в fix round, поскольку `tags` попадают в снимки обоих игроков каждый вызов.
9. Sweep/raycast при равном `t` ставят brick/bounds раньше entity (дизайн задавал только сортировку по `t`); введено в fix round, чтобы стена у самой грани цели прикрывала её.

## Спорные места / замечания для review

Engine review round 1 (3 Important + 6 Minor) закрыт fix round'ом — перечень изменений и тесты в `docs/implementation-status.md`, подраздел «Fix round (review Task 2 engine)». Из исходных замечаний этого раздела:

- Закрыто: host не валидировал форму `tags` — теперь `Invalid tags` для не-массива строк, > 16 элементов или строки > 64 символов.
- Закрыто: `destroy` в `update` не отменял первый contact того же tick — теперь сущность с kill в очереди не получает contact-событий в этом tick.
- Закрыто: `damage` с устаревшим `sourceId` был ошибкой — теперь урон без источника; ошибка только для живой чужой сущности.
- Остаются по дизайну: contact `t=0` каждый tick при касании; sweep-угол кирпича квадратный; движущаяся другая сущность проверяется по конечной позиции; `attach/attachTo` эффектов принимают чужие сущности (используется Mage намеренно); таймеры без явного scope после смерти `selfId` молча удаляются; снаряд, созданный в позиции владельца, контактирует с его телом на первом tick. Все описаны в `docs/mod-api.md`, раздел «Подводные камни».

## Browser smoke (Task 2)

`npm run test:browser` (`tests/browser-smoke.mjs`, Chromium/Playwright), прогон после fix round 4 Task 3: **PASS**. Сценарии Task 2 выполняются в той же сессии после полного набора Task 1 (Fighter/Fighter):

1. **Mage vs Bud** — все 8 слотов физическими keyboard events. Mage: `bolt` летит и исчезает; руна якоря (`sprite`, `loop`) и sequence вспышек `spark` при Blink; зона (`tags: zone`); турель (`solid`, `countsForDefeat:false`) с `beam` по видимой цели. Bud: `shot` (Volley), `mine`, тело `thorn` после Morph, `beam` Lash. Наблюдатель `window.__seen` накапливает виды эффектов между кадрами: `ring`, `sprite`, `beam` и все ожидаемые спрайты замечены. `PASS: Mage vs Bud slots, projectiles, zone, turret, VFX kinds.`
2. **Bud распад** — Fighter бьёт Bud, рост зафиксирован; после первой смерти в снимке ≥ 5 семян `seed` (`solid`, `countsForDefeat`), `result === null`; группа управляется одной клавишей (центроид сдвигается на W), HUD `Volley/Tight/Mine/Morph`; Fighter добивает семена до `result === 'P2'`. `PASS: Bud burst into 5 seeds, group steerable, fighter finished the group (P2 wins).`
3. **Mirror Mage/Mage** — Anchor/Blink P1 переключает подпись только у P1, Blink P2 — только у P2; два одновременных `bolt` в полёте. `PASS: Mirror Mage/Mage independent anchor state and HUD labels.`
4. **Restart/Back/Reload** — после Restart два тела 100/100, `3:00`, effects пусты, HUD `Bolt/Anchor/Zone/Turret` у обоих; Back → `arenaSnapshot()` null; Reload → `bud/fighter/mage`, `#error` пуст. Console/pageerror за прогон отсутствуют. `PASS: Task 2 — Mage vs Bud, Bud burst group, mirror Mage, restart/reload; no uncaught browser errors.`

Скриншоты `docs/artifacts/task2-mage-bud.png` (руна якоря, зона, турель, луч) и `docs/artifacts/task2-bud-burst.png` (пять семян с кольцами распада) — сохранены, визуально просмотрены оркестратором. Наблюдение: единичный невоспроизведённый флейк — `arenaSnapshot()` был `null` через 1,6 с после Start в сценарии после Back → Reload; шесть последующих прогонов чисты. Причина не установлена.

Плановый чекбокс 6 Task 2 («test/build/browser smoke») закрыт.

## Independent review (Task 2)

Окончательно. Первый проход — единый **финальный review Task 2/Task 3** `docs/reviews/task2-3-final-review.md` (read-only, на 83/83): вердикт по Task 2 — **Spec PASS / Quality PASS**; все Important (I-1…I-3) и Minor (M-1…M-8) относились к Task 3 и закрыты fix round 3 (кроме рекомендаций M-5/M-8). Второй проход — **scoped re-review** `docs/reviews/task2-3-rereview.md` (на 87/87): все findings первого прохода ADDRESSED, регрессий в зоне Task 2 нет (Fighter/Mage/Bud проходят, `createSpatial` self-contained, docs соответствуют коду); единственный новый finding I-4 (`radius` вне лимита магнитуд) — движок, закрыт fix round 4 (см. `docs/implementation-status.md`, «Fix round 4 (re-review I-4)»; отдельного третьего прохода по нему не было). Task 2 принят: Spec PASS / Quality PASS. Не покрыто ревью: ощущение боя и баланс Mage/Bud на реальном экране — playtest двух людей.

- engine review round 1: 3 Important + 6 Minor — все исправлены, см. Fix round (`docs/implementation-status.md`, «Fix round (review Task 2 engine)»).
