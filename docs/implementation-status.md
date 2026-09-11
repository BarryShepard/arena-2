# Implementation status — 2026-09-11

## Scope

Task 1, Task 2 и Task 3 реализованы (2026-09-11). Разделы «Task 1» и «Task 2» ниже — исторический журнал (числа тестов в них — на момент записи); актуальное состояние, команды и evidence — в разделе «Task 3». Независимое ревью проведено в два прохода: финальный review (`docs/reviews/task2-3-final-review.md`: Task 2 — Spec PASS / Quality PASS; Task 3 — FAIL до fix round 3) и scoped re-review после fix round 3 (`docs/reviews/task2-3-rereview.md`: I-1…I-3 и M-1/2/3/4/6/7 ADDRESSED, один новый Important I-4 — `radius` вне лимита магнитуд); fix round 4 закрыл I-4 (подразделы «Fix round 3/4» и «Independent review (final)» в «Task 3»). Третьего независимого прохода по fix round 4 не проводилось — закрытие подтверждено тестом и repro-сценарием из re-review. Task 3 gate закрыт с этой оговоркой; единственный непройденный gate — ручной playtest двух людей. Пользовательские уточнения применены: визуальный ориентир Tank 1990 NES, собственная простая графика, симметричные кирпичные AABB с проходами, плавное движение строго в четырёх направлениях, last-pressed held direction wins, 180 секунд simulation time, timeout draw после разрешения смертей.

Работают Fighter/Fighter в отдельных QuickJS runtime, четыре способности в файле мода, cooldown/charge state, круговые тела и кирпичная карта, HP/facing/owner markers, PNG animation и WAV, выбор/Start/Pause/Restart/Back/Reload, blur/tab pause, фиксированный tick и bounded catch-up. Код персонажей не исполняется в host realm. Пакеты обнаруживаются сервером автоматически; API boundary и лимиты описаны в mod-api.md.

## Commands and evidence

- Первоначальный `npm test` до реализации: ожидаемый FAIL, два ERR_MODULE_NOT_FOUND (world/input отсутствовали). Контракты были записаны до engine/input.
- `npm install vite quickjs-emscripten`; `npm install -D @playwright/test prettier`: PASS, lockfile сохранён, audit 0 vulnerabilities. Необязательный native install script fsevents был заблокирован окружением; Vite успешно работает без него.
- `npm test`: PASS, 11/11 (four-direction input, Fighter slots/charge/isolation, no host capabilities, infinite loop interrupt, timer/entity budgets, manifest/path rejection, foreign patch, simultaneous draw, circle separation/bounds, timeout priority, brick collision).
- `npm run build`: PASS, Vite 8.3.0, WASM включён в bundle.
- `npx playwright install chromium`: PASS, Chromium 153.0.8010.12 / playwright chromium v1243.
- Первый `npm run test:browser` в sandbox: FAIL до запуска браузера, child Vite listen EPERM на 127.0.0.1:5178. Повтор с разрешённым sandbox escalation: PASS.
- Фактический browser smoke: выбраны Fighter/Fighter, оба игрока двигались, все 8 способностей/альтернативных key bindings использованы, бой доведён физическими keyboard events до результата, Restart вернул два тела с полными HP и 3:00, Pause остановил simulation time, blur очистил movement и поставил паузу, Back→Reload вернул пакет. Console/pageerror отсутствовали.
- Скриншот `docs/artifacts/task1-browser.png` сохранён и визуально просмотрен: arena/кирпичи, оба owner outlines/facing/HP, таймер, 8 slot labels, кнопки и управление читаемы.

## Honest limitations

- Независимый review выявил 5 Important и 2 Minor. Все исправлены исполнителем в fix round 1; независимый re-review подтвердил исправления и закрыл Task 1 gate. Подробности: `docs/reviews/task1-review.md`, `docs/reviews/task1-fix-report.md`, `docs/reviews/task1-rereview.md`.
- Два человека ещё не играли вместе: удовольствие от боя, баланс и keyboard ghosting не проверены.
- Статический dist не является полным сервером игры; запуск через `npm run dev`, поскольку каталог модов обслуживает Vite plugin.
- Browser smoke проверяет победу в бою, а не ждёт 180 секунд; граничный timeout/death priority проверяется unit test.
- Task 2: Mage/Bud, raycast/projectiles/sensors, lifetime/status, entity-scoped timers, sequence и расширенные attached/beam VFX ещё отсутствуют. Текущие таймеры привязаны к runtime; у первого Fighter они не нужны. *(Исторический пункт Task 1; закрыт в Task 2 — см. раздел ниже.)*
- Task 3: mod-only mutation recipe test, полный adversarial набор и независимый финальный review ещё впереди. Имеющиеся bounded failure тесты не являются security audit. *(Исторический пункт Task 1; mutation recipe и adversarial-набор закрыты в Task 3 — см. раздел ниже; финальный review и scoped re-review проведены, fix round 3 и 4 выполнены — см. «Independent review (final)» в разделе Task 3.)*
- CPU budget теперь суммарный на владельца за весь tick, включая callbacks/bridge/apply. Event overrides действуют. 1024 commands — общий world tick *(с fix round 2 в Task 3 — 1024 на владельца за tick)*; JSON — UTF-16 code units. Spatial lineOfSight учитывает кирпичи, полный raycast остаётся в Task 2 *(реализован; см. раздел Task 2)*.


## Task 1 fix round 1

- Bridge closure изолирован от отдельного guest source: скрыты LIMITS/timers/commands/dispatch, timer Map methods захвачены до загрузки мода. Прямое затенение имён и изменение Map.prototype.set не обходят timer cap.
- Общий CPU budget на участника/tick; события и queue drain ограничены с учётом overrides. Event storm, ранее занимавший 242ms в review, теперь прерывается: focused test целиком около 10ms, assertion step <100ms.
- Effect schema проверяется до render; неожиданный Canvas exception не убивает RAF. Ошибки host apply содержат пакет/владельца.
- Input хранит короткие edges, отличает pause release от нового match reset; aliases/OS repeat имеют отдельную проверку.
- Минимальный lineOfSight с кирпичными AABB используется в Fighter; corner regression проверяет HP 120 при стене и 105 без неё.
- `npm test`: PASS, 19/19 после исправлений. `npm run build`: PASS.
- `npm run test:browser` с разрешённым loopback/Chromium escalation: PASS. Удерживаемый KeyD оставлен физически нажатым через blur/resume до assertion неподвижности; malformed negative-radius effect дал fighter P1 error и успешный Restart; принудительный Canvas exception был пойман, RAF выжил и Restart снова продвинул simulation time. Console/pageerror отсутствовали; screenshot обновлён.

## Task 2 — 2026-09-11

### Scope

Generic API без знания о персонажах: контактные события, raycast, lifetime, entity-scoped таймеры, отменяемая sequence, эффекты ring/sprite/beam с attach/delay/fade, `sound` с volume; два новых пакета Mage и Bud. Контракт: `docs/tasks/task2-design.md`, фактический — `docs/mod-api.md`. Task 1 (solid-тела, кирпичи, four-direction input, 180 s, draw, бюджеты) не переписывался.

### Реализовано по модулям

- `src/engine/spatial.js`: `createSpatial()` — самодостаточные `segmentCircle`, `segmentRect` (AABB + radius, квадратные углы), bounds, `sweep(from,to,radius,world,ignore)` → hits `{kind,id?,ownerId?,t,point,normal}` по `t` (при равном `t` brick/bounds раньше entity). Один и тот же исходник исполняется на host (`spatial`) и встраивается текстом в guest bootstrap.
- `src/engine/world.js`: whitelists `SPAWN_FIELDS/PATCH_FIELDS` с `contact/lifetime/width/height`; `hp = hp ?? maxHp ?? 100`, `maxHp = maxHp ?? hp ?? 100`; `tags` — массив строк ≤ 16 × ≤ 64 (`Invalid tags`, spawn и patch); `Forbidden patch field` для `id/ownerId/hp/maxHp/countsForDefeat`; clamp/separation только для solid; `contacts(prev)` — sweep каждой contact-сущности без kill в очереди от позиции до интеграции, доставка по одному hit, отбрасывание оставшихся после destroy/patch x,y,vx,vy; `damage` с устаревшим `sourceId` — урон без источника, `Foreign damage source` только для живой чужой сущности; `lifetime -= dt` → kill `expired`; `death.reason` `damage|destroyed|expired`; `sound.options.volume ∈ [0,1]`; порядок tick: timers/abilities/update → интеграция → 16 проходов solid → contacts → lifetime → drain → pruneEffects → вердикт.
- `src/mods/bootstrap.js`: `ctx.entityId`; `raycast` (проверка конечности, `radius ≥ 0`, `ignore` массив); `after/every(seconds, cb, {entityId})` (`after` ≥ 0 — `after(0)` срабатывает на следующем tick; `every` > 0) с default = контекстная сущность (`null` в death), entity-scoped таймеры удаляются в начале tick без сущности, `cancel` из callback другого таймера в том же tick предотвращает его срабатывание; `sequence(steps, options)` — ≤ 64 шагов `wait/effect/sound/shake/run`, немедленные шаги до первого `wait`, общее пространство id с `cancel`; guest-side рекурсивная проверка конечности всех чисел в каждой команде (`emit`).
- `src/engine/effects.js`: `validateEffect(spec, manifest)` по kind с дефолтами (`fadeOut`: ring → duration, sprite/beam → 0; `delay/fadeIn` 0; `scale` 1; `width` 2; `loop` false), `resolveEffect` (attach/attachTo → позиция, alpha), `spriteFrame`, `pruneEffects`.
- `src/view/renderer.js`, `src/view/assets.js`: тела рисуются `(width ?? frameWidth) × scale`, без ассета — квадрат; sprite-эффекты по кадру/angle/scale; beam — линия; gain `0.16 × volume`.
- `characters/mage`: Bolt (non-solid contact projectile, урон/impulse/destroy в contact callback), Anchor/Blink (таймер в scope тела, `patch` позиции, sequence вспышек), Zone (non-solid сущность с lifetime + `every` в её scope + `queryCircle`), Turret (solid, `countsForDefeat:false`, lifetime 5, `raycast` линии огня, beam effect). Ассеты: `scripts/generate-mage-assets.py`.
- `characters/bud`: рост 10 % на `damageReceived` (radius + scale, cap 20), распад на пять `countsForDefeat` семян в death callback, групповое управление и строй Tight/Wide, Volley (снаряд из каждого тела) / Lash (raycast + beam) после Morph, Mine (contact, `every(0.05)` в её scope, отскок от кирпича/границы через `patch` по normal, взрыв из death/contact). Ассеты: `scripts/generate-bud-assets.py`.
- Тесты: `tests/world.test.js` (+3: non-solid без clamp, whitelist/lifetime/patch guards, sweep numeric), `tests/effects.test.js` (8, новый файл), `tests/mods.test.js` (+11 в Task 2: verdict после death callback, contact/brick shielding, patch drops hits, bounds, death reasons, guest validation, raycast, timers, sequence, dispose; +4 в fix round, см. подраздел ниже), `tests/mage.test.js` (11), `tests/bud.test.js` (9).

### Commands and evidence

- `npm test` (до fix round): PASS, 61/61 (input 4, world 7, effects 8, mods 22, mage 11, bud 9), ~0.6 s. Актуальный результат — в подразделе «Fix round» ниже.
- `npm run build`: PASS, Vite, четыре WASM-варианта quickjs в bundle, ~86 ms. Перепроверено.
- `npm run test:browser`: покрывает Fighter/Fighter (Task 1); Mage/Bud browser smoke — см. раздел ниже.

### Fix round (review Task 2 engine)

Engine review round 1: 3 Important + 6 Minor, все исправлены в коде; документация (`mod-api.md`, README, этот файл, `task2-report.md`) приведена к коду после исправлений. Изменения:

1. `damage` с устаревшим (уже удалённым) `sourceId` — не ошибка: урон ставится в очередь с `sourceId: undefined`, события `beforeHit/damageReceived/death` приходят без источника. `Foreign damage source` — только для живой чужой сущности в `sourceId`. Тест: mods «damage with a stale sourceId is accepted as unattributed; a live foreign source is rejected».
2. `tags` валидируются host при `spawn` и `patch`: массив строк, ≤ 16 элементов, каждая ≤ 64 символов, иначе `Invalid tags` (`TAGS_MAX`/`TAG_LENGTH_MAX` в `world.js`; `tags` попадают в снимки обоих игроков каждый вызов). Тесты: world «spawn whitelist, hp→maxHp default, …», mods «guest validation: …».
3. `after(0, cb)` разрешён и срабатывает на следующем tick (как `{wait:0}`); `every` требует `seconds > 0`; `sequence` `wait ≥ 0`. Тест: mods «timers: after(0) fires next tick; a callback cancelling a later same-tick timer suppresses it».
4. `cancel(id)` из callback другого таймера в том же tick предотвращает его срабатывание: обход таймеров проверяет `hasTimer` перед каждым вызовом. Тот же тест.
5. `contacts()` пропускает сущности, для которых kill уже стоит в очереди (`destroy` в `update`/`ability`/таймере/раннем contact callback): такая сущность не получает contact-событий в этом tick. Тест: mods «contact: an entity destroyed during update receives no contact that tick».
6. `spatial.sweep`/`raycast`: при равном `t` brick/bounds сортируются раньше entity — стена у самой грани цели прикрывает её. Тест: world «spatial sweep: …» (equal t).
7. `spawn`: `hp = spec.hp ?? spec.maxHp ?? 100`, `maxHp = spec.maxHp ?? spec.hp ?? 100` — spec только с `maxHp` даёт `hp = maxHp`. Тест: world «spawn whitelist, hp→maxHp default, …».
8. Сообщение об ошибке содержит префикс владельца ровно один раз (`fighter P1: Cannot mutate foreign entity`): `world.invoke` не оборачивает ошибку `runtime.withBudget` вторым префиксом. Тесты: mods «foreign patch from guest …», «damage with a stale sourceId …» (точное совпадение строки).

Дополнительный тест fix round: mods «world.effects is pruned in step once an effect expires or its attach dies».

- `npm test`: PASS, 66/66 (input 4, world 7, effects 8, mods 26, mage 11, bud 9, mutation 1), ~0.7 s. `tests/mutation.test.js` относится к Task 3 и добавлен параллельно; без него — 65/65. Прогнано при написании этого подраздела; актуальный набор после Task 3 и fix round 4 — 88/88, см. раздел «Task 3».
- Нестабильность harness: при параллельном прогоне всех файлов (`node --test tests/*.test.js`) тест bud «growth: real damage scales radius/scale by exactly 10%, …» примерно в 1 из 5 прогонов падает с `bud P1: CPU tick budget exceeded` — 8 ms wall-clock CPU budget на tick под нагрузкой соседних файлов. `node --test tests/bud.test.js` отдельно: 5/5 стабильно. Ограничение бюджета/harness, не регрессия логики. *(Закрыто в Task 3: `npm test` сериализует файлы через `--test-concurrency=1`, см. раздел «Task 3».)*
- `npm run build`: PASS, Vite, ~90 ms.

### Browser smoke (Task 2)

`npm run test:browser` (Chromium/Playwright, `tests/browser-smoke.mjs`, прогон после fix round 2 Task 3): PASS. Сценарии Task 2 идут после полного набора Task 1 (Fighter/Fighter: движение, 8 bindings, бой до результата, pause/blur, restart, reload, malformed-mod и render recovery) в той же сессии браузера:

- Mage vs Bud: все 8 слотов физическими keyboard events. У Mage: сущность `bolt` летит и исчезает, руна якоря (`sprite`, `loop`) и sequence вспышек `spark` при Blink, зона (`tags: zone`, `sprite: zone`), турель (`solid`, `countsForDefeat:false`) с `beam` по видимой цели. У Bud: `shot` (Volley), `mine`, тело `thorn` после Morph и `beam` Lash. Read-only наблюдатель `window.__seen` накапливает виды эффектов между кадрами (лучи живут ~0.12 с): замечены `ring`, `sprite`, `beam` и все ожидаемые спрайты сущностей. Сообщение: `PASS: Mage vs Bud slots, projectiles, zone, turret, VFX kinds.`
- Bud распад: Fighter догоняет и бьёт Bud, рост зафиксирован по снимку, после первой смерти в снимке ≥ 5 семян с тегом `seed` (`solid`, `countsForDefeat`), `result === null`; группа управляется одной клавишей (центроид сдвигается на W), HUD Bud `Volley/Tight/Mine/Morph`; Fighter добивает ближайшие семена до `result === 'P2'`. Сообщение: `PASS: Bud burst into 5 seeds, group steerable, fighter finished the group (P2 wins).`
- Mirror Mage/Mage: Anchor P1 переключает подпись только у P1 (`Blink` / `Anchor` у P2), Blink P2 — только у P2, обратный Blink P1 возвращает `Anchor`; два одновременных `bolt` в полёте (снаряды не поглощают друг друга). Сообщение: `PASS: Mirror Mage/Mage independent anchor state and HUD labels.`
- Restart после Mage/Mage: два тела 100/100 HP, `3:00`, `effects` пусты, HUD `Bolt/Anchor/Zone/Turret` у обоих; Back → `arenaSnapshot()` null; Reload → в списке три пакета `bud/fighter/mage`, `#game` скрыт, `#error` пуст. Console/pageerror за весь прогон отсутствуют. Итоговое сообщение: `PASS: Task 2 — Mage vs Bud, Bud burst group, mirror Mage, restart/reload; no uncaught browser errors.`
- Скриншоты `docs/artifacts/task2-mage-bud.png` (момент с sprite+beam эффектами и телами zone/turret: руна якоря, зона, турель, луч) и `docs/artifacts/task2-bud-burst.png` (пять семян с кольцами распада) сохранены и визуально просмотрены оркестратором.
- Наблюдение (честно): один раз за серию прогонов `arenaSnapshot()` был `null` через 1,6 с после Start в сценарии после Back → Reload; шесть последующих полных прогонов чисты, воспроизвести не удалось. Причина не установлена; зафиксировано как невоспроизведённый флейк harness, не как известный дефект игры.

### Independent review (Task 2)

Итог (окончательно). Первый проход — финальный review `docs/reviews/task2-3-final-review.md` (единый для Task 2/Task 3, проведён на 83/83): Task 2 — **Spec PASS / Quality PASS**; все три Important и все Minor относились к Task 3. Второй проход — scoped re-review `docs/reviews/task2-3-rereview.md` (на 87/87): регрессий в зоне правок нет, Fighter/Mage/Bud проходят, `createSpatial` self-contained, docs соответствуют коду; новый finding I-4 касается только движка (Task 3) и закрыт fix round 4. Task 2 принят; engine review round 1 Task 2 закрыт fix round'ом выше. Не проверялось ни одним проходом: ощущение боя и баланс Mage/Bud на реальном экране (playtest двух людей).

### Honest limitations

- Contact sweep против кирпичей использует AABB, расширенный на radius с **квадратными углами** (Minkowski-приближение): у угла кирпича контакт круга регистрируется чуть раньше геометрически точного.
- Перекрытие в начале отрезка даёт `t=0`, и такой contact повторяется **каждый tick**, пока сущности касаются; мод обязан сам делать destroy/патч/дедупликацию (Mage и Bud уничтожают снаряд на первом контакте; мина Bud взрывается).
- Contact с другой движущейся сущностью проверяется по её конечной позиции в этом tick, а не по её отрезку.
- Сущность с kill в очереди (`destroy` до sweep) не получает contact-событий, но до drain остаётся в снимке с `hp > 0` и уже сдвинулась за этот tick: `entity(id)`/`queryCircle` её ещё видят.
- После смерти стартового тела таймеры/sequence без явного `options.entityId` из `update`/`ability` привязываются к мёртвому `selfId` и молча удаляются (см. «Подводные камни» в `mod-api.md`).
- CPU budget 8 ms — wall-clock: под нагрузкой соседних процессов возможны ложные `CPU tick budget exceeded`. В `npm test` устранено сериализацией файлов (`--test-concurrency=1`, Task 3); в игре бюджет по-прежнему зависит от загрузки машины.
- `attach/attachTo` эффектов не ограничены своими сущностями.
- Timer scope проверяется только в начале tick: таймер, привязанный к сущности, погибшей в drain, удаляется на следующем tick (сработать между ними он не может).
- Playtest двумя людьми не проводился: баланс, читаемость снарядов/эффектов на реальном экране и ощущение управления группой Bud не проверены.
- Тесты доказывают bounded failure и валидацию входов, но не являются security audit sandbox; adversarial-набор добавлен в Task 3 (`tests/adversarial.test.js`) и тоже не является security audit.
- Browser smoke для Mage/Bud — PASS (раздел выше); финальный review Task 2 — PASS/PASS (`docs/reviews/task2-3-final-review.md`); scoped re-review (`docs/reviews/task2-3-rereview.md`) регрессий в зоне Task 2 не нашёл.

## Task 3 — 2026-09-11

### Scope

Доказательство моддинга и готовность к передаче: mod-only mutation recipe test, adversarial-набор bounded failure, полный browser smoke, README/`mod-api.md`, итоговые команды и независимый финальный review. Код ядра менялся только по findings adversarial-набора (fix round 2 ниже), финального независимого review (fix round 3 ниже) и scoped re-review (fix round 4 ниже); механики Task 1–2 не переписывались. Не security audit; playtest двух людей не проводился.

### Реализовано

- `tests/mutation.test.js` — mod-only mutation recipe: временная копия `characters/fighter` → `characters/zz_mutant_<pid>` с новым `id`/`name`, слот 0 (Slash) заменён на radial impulse + self heal + attached sprite effect; обнаружение через тот же путь, что у сервера (`readPackage` и `listPackages()` из `vite.config.js` — та же функция, что обслуживает `/api/characters`; с fix round 3), загрузка через `createRuntime` + `createWorld`; поведение слота 0 в runtime отличается от оригинального Fighter; `src/` не содержит id мутанта; в `finally` удаляется только собственная папка (`bud/fighter/mage` остаются).
- `tests/adversarial.test.js` — 19 кейсов в 15 группах (нумерация в названиях тестов): (1) `while(true)` в update; (2) чрезмерная аллокация — heap 16 MiB или CPU interrupt, host не затронут; (3, 3b) бесконечная рекурсия — атрибутированный `stack overflow` на лимите по умолчанию и ниже, чистый dispose 20 раз подряд, затем валидный Fighter загружается; (4) spawn flood 300 за update и 200 за tick — entity budget; (5, 5b) рекурсия таймеров (экспоненциальный `after`), синхронная рекурсия sequence, рекурсия self-damage событий — bounded; queue budget при поднятом `tickMs` атрибутируется владельцу команды, поставившей переполняющий элемент, даже при отсутствующей цели; (6) sequence flood 300 — timer budget; (7) NaN/Infinity/отрицательный damage отвергаются с атрибуцией до очереди; (8) cross-owner destroy/heal, spawn с `ownerId`, запрещённые patch-поля; (9, 9b) command/effect/JSON flood — бюджеты с атрибуцией; command budget per-owner: 1024 команд P1 не обвиняют P2, 1025 суммарно по callbacks P1 обвиняют P1; (10) contact flood и raycast/queryCircle flood списываются флудеру, не жертве, в пределах 100 ms; (11) уровень пакета: path traversal, абсолютные/URL-пути, отсутствующий или поддельный PNG, symlink наружу — отвергнуты, Fighter после этого загружается; (12, 12b, 12c) исключения в callbacks и сломанные `defineCharacter` атрибутированы, spawn-time ошибки бросают из `addPlayer`; мусор из `beforeHit` (строка, объект, отрицательное, Infinity/NaN `amount`) отвергается с атрибуцией жертвы; `throw undefined`/`Symbol`/пустой объект получают причину, сообщения > 512 символов обрезаются; (13) мусорное поле в `slot` state отвергается с атрибуцией P1 и не раздувает входной JSON P2; (14) конечные, но абсурдные магнитуды (`1e308`) в `impulse`/`patch`/`spawn` отвергаются у инициатора, жертва остаётся конечной и не обвиняется (13, 14 — fix round 3). Контракт каждого кейса: атрибутированный читаемый `world.error` (или атрибутированный throw при load/spawn), обе VM закрыты, следующий Fighter/Fighter матч стартует. Кейсы, уже покрытые `tests/mods.test.js` (infinite loop при spawn, timer budget при spawn, foreign patch, event storm, malformed effects, shadowing, 65 шагов sequence, NaN в spawn/patch), не дублируются.
- `tests/browser-smoke.mjs` — расширен сценариями Task 2 (см. «Browser smoke (Task 2)» выше), две новых точки скриншотов.
- `package.json`: `"test": "node --test --test-concurrency=1 tests/*.test.js"` — файлы исполняются последовательно, чтобы wall-clock CPU-бюджет 8 ms на tick не срабатывал от нагрузки соседних test-процессов (ранее ≈ 1 из 5 прогонов на 11 ядрах давал ложный `bud P1: CPU tick budget exceeded`). Цена — ≈ 2.5–3 с вместо ≈ 0.7 с.
- Документация: README (запуск, управление обоих игроков, добавление папки/Reload, ограничения прицела, проверки), `docs/mod-api.md` (манифест/main, порядок событий, методы, timers/state/sequence, ассеты, бюджеты, «Подводные камни», recipe снаряда/турели/группы); recipe смены способности без правки ядра — README «Файловые персонажи» + исполняемый пример `tests/mutation.test.js`.

### Fix round 2 (adversarial findings)

Findings adversarial-набора, исправленные в коде (все покрыты тестами выше):

1. **HIGH — stack limit 512 KiB → 128 KiB, safe dispose** (`src/mods/runtime.js`). QuickJS проверяет свой C-стек в wasm-памяти, но каждый wasm-вызов расходует и нативный стек движка (Node/Chrome main thread ≈ 1 MB, у Safari и workers меньше). При 512 KiB нативный стек воспроизводимо переполнялся первым: V8 бросал `RangeError` изнутри wasm, runtime оставался в несогласованном состоянии и `JS_FreeRuntime` abort'ил весь модуль. 256 KiB чист в Node; 128 KiB даёт двукратный запас для браузеров. `dispose()` после прерванной evaluation может сам бросить (Emscripten abort) — теперь это проглатывается и добавляется к атрибутированной ошибке гостя текстом `(runtime dispose failed: …)`, а не заменяет её. Побочный эффект: глубина стека мода ≈ 740 обычных кадров / ≈ 150 вложенных `sequence` (в `mod-api.md` округлено до ≈ 700); Fighter/Mage/Bud до этого не доходят. Тесты 3, 3b.
2. **Ответ `beforeHit` валидируется в `withBudget` владельца** (`world.invoke`): `amount`, если задан, должен быть конечным и неотрицательным; Infinity/NaN/строка/объект → guest-ошибка `Invalid finite hit` / `Negative hit` с префиксом мода-жертвы, который её произвёл. Тест 12b.
3. **Command budget per-owner** (`world.applyCommands`, `commandCounts` Map, сброс в начале tick): 1024 команд на владельца за tick суммарно по update/abilities/timers/events; ранее счётчик был общим на мир, и flood одного владельца мог сработать на первой команде другого. Тест 9b; `mod-api.md` «Технические бюджеты» обновлён.
4. **`describeOwner` для отсутствующего владельца → `world`**: элементы drain, поставленные движком (истёкший `lifetime`, прямой `queueDamage`), дают префикс `world: `; переполнение очереди (`Queue event budget exceeded`) атрибутируется владельцу команды, поставившей переполняющий элемент, даже если её цель уже не существует. Тест 5b.
5. **Сообщения гостя**: `throw undefined`/`throw Symbol()`/пустой объект → `Unknown guest error` вместо пустого `fighter P1: `; текст обрезается до 512 символов (`MESSAGE_MAX`) с `…`, то же для текста ошибки dispose. Тест 12c.

Не менялись: механики Task 1–2, форма API, тесты Task 1–2 (все продолжают проходить).

### Fix round 3 (final review findings)

Основание: финальный независимый review `docs/reviews/task2-3-final-review.md` (2026-09-11, проведён на 83/83): Task 2 — Spec PASS / Quality PASS; Task 3 — Spec FAIL до fix round 3 (Important I-1, I-2, I-3), Quality PASS с оговорками (M-4, M-5); Critical нет. Fix round 3 закрыл все три Important и Minor M-1, M-2, M-3, M-4, M-6, M-7; M-5 и M-8 осознанно оставлены как рекомендации (см. «Honest limitations»).

1. **I-1 — whitelist состояния слота** (`src/engine/world.js`, `SLOT_FIELDS = ["label", "cooldown", "active"]`, case `slot`). `state` принимается ровно с этими ключами; любой другой → `Invalid slot field <k>` с атрибуцией вызывающему моду; host сохраняет ровно `{label, cooldown, active}`, `active` по умолчанию `false`. Раньше лишние ключи попадали в `this.slots` и в снимки обоих игроков: P1 мог положить 4×300 KB мусора, и следующий invoke P2 падал с `fighter P2: Input JSON budget exceeded` (либо P2 оплачивал structuredClone чужого мусора своим CPU-бюджетом). Evidence: `tests/adversarial.test.js` 13 «slot state is whitelisted: a junk field is rejected with P1 attribution and never inflates P2's input JSON». `docs/mod-api.md` (`slot`, «Технические бюджеты») обновлён.
2. **I-2 — prototype-ключи sprite/asset/sound** (`src/view/renderer.js` `own()` через `Object.hasOwn`; `src/view/assets.js` — таблицы с null-prototype и own-property lookup в `play`; `src/engine/world.js` — `Object.hasOwn` при проверке `asset` команды `sound`; `validateEffect` отвергает такие ключи). Раньше `assets.images[owner]?.[e.sprite]` для `sprite: 'constructor' | '__proto__' | 'hasOwnProperty'` резолвился через прототип → TypeError → `Render: …` без атрибуции мода. Evidence: `tests/effects.test.js` «prototype keys never resolve as assets: validateEffect rejects them, Assets tables are prototype-less, play skips them».
3. **I-3 — технический лимит магнитуд и инвариант конечности** (`src/engine/world.js`: `MAGNITUDE_MAX = 1e6` — `|x|, |y|, |vx|, |vy|` в `spawn`/`patch` и компоненты `impulse` → `Invalid magnitude <k>`, ошибка приписывается инициатору, чужое тело остаётся нетронутым; после интеграции host проверяет конечность `x, y, ix, iy` каждой живой сущности — нарушение даёт `world: Non-finite <k> (…) on entity <id> of <owner> after integration`, инвариант движка; `src/engine/spatial.js` — guards `Number.isFinite`: переполняющиеся отрезки дают промах, а не hit `{t: NaN, point: null}`). Раньше `impulse 1e308` дважды давал `ix = Infinity` навсегда (чужое тело прижато к стене, `null` в JSON, без диагностики), а `segmentCircle` — `t = NaN`, нарушая контракт `point/normal`. Это реализация численного adversarial-кейса из task3-brief, который не был покрыт. Лимит `1e6` технический, не балансовый: арена 480×270, скорости — сотни единиц; Fighter/Mage/Bud до него не доходят. Evidence: `tests/adversarial.test.js` 14 «finite but absurd magnitudes (1e308) in impulse/patch/spawn are rejected at the initiator; the victim stays finite and unblamed»; `tests/world.test.js` «spatial: absurd (overflowing) coordinates miss instead of producing NaN hits; host rejects a non-finite pose» (sweep с концами ±1e308 / ±1.7e308 по всем осям). `docs/mod-api.md` («Технические бюджеты», «Подводные камни», `spawn`/`patch`/`impulse`) обновлён.
4. **M-2 — `runtime.dispose()`** (`src/mods/runtime.js`): три шага (`dispatch.dispose()`, `vm.dispose()`, `runtime.dispose()`) выполняются в раздельных `try`; исключение в `vm.dispose()` больше не пропускает `runtime.dispose()` (утечка wasm-runtime). Регрессионно — adversarial 3, 3b (dispose после stack overflow 20 раз подряд).
5. **M-3 — `validateManifest`** (`src/mods/package.js`, `isObject`): манифест, `body`, `appearance`, элементы `abilities` и значения `assets` должны быть объектами, `id` — строкой; не-объект даёт понятную ошибку (`Invalid manifest identity`, `Invalid asset entry <key>` и т. п.) вместо TypeError. Evidence: `tests/mods.test.js` «manifest rejects bad API, slots, numerical fields and paths» (`id: null`, `abilities: [null, …]`, `abilities: ["Slash", …]`).
6. **M-4 — `listPackages()`** экспортирован из `vite.config.js` и используется и middleware `/api/characters`, и `tests/mutation.test.js` (дубликат readdir-фильтра убран; mutation-тест проверяет roster до/после через ту же функцию). Побочный эффект: `/api/characters` отсортирован по id. Evidence: `tests/mutation.test.js`.
7. **M-7** — комментарии в `src/mods/runtime.js` обезличены (без имён персонажей).
8. **M-1, M-6 — документация**: асимметрия порядка tick-фазы (команды P1 применяются до снимка P2 в том же tick) и то, что dev-сервер отдаёт статику всего project root (`server.fs.strict` ограничивает только выход за корень), записаны в `docs/mod-api.md`, «Подводные камни».

Не сделаны (осознанно, остаются рекомендациями): **M-5** — `tickMs` override в функциональных тестах вместо wall-clock assert'ов (локально стабильно при `--test-concurrency=1`); **M-8** — инструментирование `dispose()` для невоспроизведённого флейка `arenaSnapshot() === null`. Не менялись: форма API Task 1–2 (кроме технического лимита магнитуд и строгой формы `slot`), тесты Task 1–2 (добавлены только новые кейсы в `world`/`effects`).

### Fix round 4 (re-review I-4)

Основание: scoped re-review `docs/reviews/task2-3-rereview.md` (2026-09-11, проведён на 87/87): I-1…I-3 и M-1/M-2/M-3/M-4/M-6/M-7 — ADDRESSED, регрессий в зоне правок нет; один новый Important **I-4** — `radius` не входил в лимит магнитуд fix round 3. Механизм: два solid-тела с `radius ≥ ~9e307` давали `r = Infinity` и `0 * Infinity = NaN` в separation; проверка конечности стояла только после интеграции (до separation/clamp), NaN попадал в снимки обоих игроков, и жертва (raycast/effect/spawn по координатам врага) получала свою ошибку (`fighter P2: Invalid raycast` и т. п.), а при бездействии — `world: Non-finite …` как «баг движка». Тот же класс, что I-3, через другой вход.

1. **`BOUNDED` расширен на размеры** (`src/engine/world.js`: `BOUNDED = ["x", "y", "vx", "vy", "radius", "scale", "width", "height"]`, `MAGNITUDE_MAX = 1e6`): в `spawn`/`patch` любое из этих полей `> 1e6` → `Invalid magnitude <k>` с атрибуцией инициатору. Ровно `1e6` принимается. Размеры Fighter/Mage/Bud — единицы и десятки, лимит технический.
2. **`assertFinitePose(e, phase)` в двух точках** (`src/engine/world.js`): после интеграции (`… after integration`) и, дополнительно, после separation/clamp для каждой живой сущности (`… after collision`). Сообщение: `world: Non-finite <k> (<value>) on entity <id> of <owner> after integration|collision` — инвариант движка, при соблюдении лимитов недостижим; при нарушении матч останавливается до того, как NaN попадёт в снимок.
3. **Тест** `tests/world.test.js` «radius/scale/width/height share the 1e6 magnitude cap; huge solid radii cannot poison poses»: отказ на `1e308`/`1e7`/`2e6`/`Infinity` для всех четырёх полей; два solid-тела с `radius: 1e6` дают конечные позиции без ошибки; ручное отравление `y = NaN` после clamp даёт `world: Non-finite y (NaN) … after collision`. `docs/mod-api.md` («`spawn`/`patch`», «Технические бюджеты», «Подводные камни») обновлён.

Прогоны после закрытия: `npm test` **88/88** (world 8 → 9), `npm run build` PASS, `npm run test:browser` PASS (5 блоков). Третий независимый проход по этой правке не проводился: закрытие подтверждено тестом выше и repro-сценарием из re-review (два solid-тела с огромным `radius` — теперь `Invalid magnitude radius` у инициатора). Не менялись: форма API (кроме расширения лимита на размеры), механики и тесты Task 1–2.

### Commands and evidence

- `npm test`: PASS, **88/88**, 0 todo/skipped: adversarial 19, bud 9, effects 9, input 4, mage 11, mods 26, mutation 1, world 9 (порядок — как исполняет раннер по алфавиту файлов); ≈ 2.5–3 с при `--test-concurrency=1`. Перепроверено после fix round 4 при обновлении этого раздела (2610 ms; до fix round 3 — 83/83, после fix round 3 — 87/87, fix round 4 добавил один кейс в `world`).
- `npm run build`: PASS, Vite, четыре WASM-варианта quickjs в bundle.
- `npm run test:browser`: PASS в Chromium (Playwright), перепрогнан после fix round 4 (5 блоков PASS). Полный цикл select → load → fight → death/draw → restart → reload: Fighter/Fighter (набор Task 1: движение, обе раскладки включая альтернативные коды без numpad, 8 слотов, победа, pause/blur с физически удерживаемой клавишей, restart, Back → Reload, malformed effect и Canvas exception recovery), Mage vs Bud (8 слотов, projectiles/zone/turret, VFX kinds ring/sprite/beam), Bud распад на 5 семян + управляемая группа + добивание до `P2`, mirror Mage/Mage независимость anchor/HUD, Restart/Back/Reload; console/pageerror — ни одного. Подробности и сообщения PASS — «Browser smoke (Task 2)» выше.
- Скриншоты: `docs/artifacts/task1-browser.png`, `docs/artifacts/task2-mage-bud.png`, `docs/artifacts/task2-bud-burst.png` — просмотрены оркестратором (арена/кирпичи, owner outlines/HP/таймер/слоты; руна якоря, зона, турель, луч; пять семян с кольцами распада). Масштабирование canvas и читаемость маркеров проверены визуально по скриншотам, не автоматической проверкой.
- Флейк: единичный невоспроизведённый `arenaSnapshot() === null` через 1,6 с после Start после Back → Reload (1 из ≥ 7 прогонов); см. «Browser smoke (Task 2)».

### Чекбоксы плана Task 3

- [x] Mutation recipe test — `tests/mutation.test.js` «mod-only mutation: copied package is discovered, loaded and changes slot 0 behaviour»: PASS; core файлы и registry не менялись (реестра нет), удаляется только своя папка.
- [x] Adversarial cases — `tests/adversarial.test.js`, 19 кейсов (17 + два из fix round 3): PASS; каждый заканчивается bounded failure с атрибуцией, закрытием обеих VM и стартом следующего матча. Security audit не заявляется.
- [x] Browser smoke полным циклом — PASS, скриншоты сохранены (см. выше).
- [x] README и `docs/mod-api.md` — обновлены под реализованные имена и лимиты (включая fix round 2, fix round 3: лимит магнитуд, строгая форма `slot`, M-1/M-6 в «Подводных камнях», и fix round 4: лимит магнитуд распространён на `radius/scale/width/height`).
- [x] Итоговые `npm test` / `npm run build` / `npm run test:browser` — PASS, результаты выше; этот файл обновлён.
- [x] Независимый финальный review (sandbox bridge, события смерти, package loader, cleanup/restart, отсутствие character-specific механик в core) — два прохода: `docs/reviews/task2-3-final-review.md` (Task 3 FAIL до fix round 3 → fix round 3) и `docs/reviews/task2-3-rereview.md` (все findings первого прохода ADDRESSED, новый I-4 → fix round 4). Gate закрыт с оговоркой: третьего независимого прохода по fix round 4 не было, закрытие I-4 подтверждено тестом и repro-сценарием re-review. См. «Independent review (final)».

### Honest limitations

- Adversarial-набор доказывает bounded failure для перечисленных кейсов, а не отсутствие обходов sandbox; security audit не проводился и не заявляется.
- Ручной playtest двух людей не проводился: удовольствие от боя, баланс трёх персонажей, keyboard ghosting на реальных клавиатурах, читаемость снарядов/эффектов на реальном экране и ощущение управления группой Bud — гипотезы.
- CPU-бюджет 8 ms остаётся wall-clock: под нагрузкой машины возможны ложные `CPU tick budget exceeded` в игре; в тестах — только сериализация файлов, не изменение бюджета.
- Stack 128 KiB — компромисс между нативным стеком браузеров и глубиной рекурсии мода (≈ 740 кадров); обоснование в комментарии к `DEFAULT_LIMITS` в `src/mods/runtime.js`. В Safari/workers запас не измерялся.
- Один невоспроизведённый флейк browser smoke (`arenaSnapshot()` null после Back → Reload) не объяснён. Рекомендация review M-8 (инструментировать `dispose()`) открыта — не выполнена.
- Рекомендация review M-5 открыта — не выполнена: wall-clock assert'ы функциональных тестов и 8-мс бюджет локально стабильны при `--test-concurrency=1`, но под CI-нагрузкой возможны ложные падения; предложенный путь — `tickMs` override в функциональных тестах.
- Лимит магнитуд `1e6` (`x, y, vx, vy`, `impulse` — fix round 3; `radius, scale, width, height` — fix round 4) и правило «`slot` принимает ровно `{label, cooldown, active}`» — технические ограничения, не балансовые; описаны в `docs/mod-api.md`.
- Fix round 4 (расширение лимита на размеры, `assertFinitePose` после collision) не проходил отдельного независимого ревью; его корректность опирается на тест `tests/world.test.js` и воспроизведение repro-сценария re-review, а не на третий read-only проход.
- Browser smoke не ждёт 180 с (timeout draw — unit test) и не проверяет пиксели: масштабирование/читаемость — визуально по скриншотам.
- Mutation recipe проверяет Fighter-копию и слот 0; recipe для Mage/Bud выполняется по тем же правилам, но отдельным тестом не покрыт.
- Documented footguns API (contact `t=0` каждый tick, снаряд на позиции владельца, таймеры после смерти `selfId`, `destroy` как отложенный kill, квадратный угол sweep) остаются по дизайну — `docs/mod-api.md`, «Подводные камни».

### Independent review (final)

Окончательно, два прохода независимого read-only ревью плюс fix round по каждому.

| Проход | Отчёт | Вердикт | Следствие |
|---|---|---|---|
| Первый (финальный review, на 83/83) | `docs/reviews/task2-3-final-review.md` | Task 2 — Spec PASS / Quality PASS. Task 3 — Spec FAIL (I-1 `slot.state` без whitelist, I-2 prototype-ключи sprite/asset/sound, I-3 численный adversarial-кейс не реализован), Quality PASS с оговорками (M-4, M-5); Minor M-1…M-8; Critical нет | fix round 3: I-1…I-3, M-2/M-3/M-4/M-7 в коде, M-1/M-6 в docs; M-5/M-8 — рекомендации |
| Второй (scoped re-review, на 87/87) | `docs/reviews/task2-3-rereview.md` | I-1, I-2, I-3, M-1, M-2, M-3, M-4, M-6, M-7 — ADDRESSED (с репро); M-5, M-8 — NOT ADDRESSED, не заявлялись; регрессий в зоне правок нет. Новый **I-4** (Important): `radius` вне лимита магнитуд → NaN в separation с обвинением жертвы. Task 3 — Spec FAIL (только I-4), Quality PASS | fix round 4: `BOUNDED` += `radius/scale/width/height`, `assertFinitePose` после интеграции и после separation/clamp, тест в `tests/world.test.js`; 88/88, build PASS, browser smoke PASS |
| Третий | — | **Не проводился.** Закрытие I-4 подтверждено тестом и repro-сценарием из re-review, а не независимым проходом | — |

Итог: Task 1–3 реализованы. Task 2 gate закрыт первым проходом (PASS/PASS) и подтверждён отсутствием регрессий во втором. Task 3 gate закрыт по итогам re-review + fix round 4 — с оговоркой, что сама правка fix round 4 независимого ревью не проходила. Открытые рекомендации (не блокируют): **M-5** — `tickMs` override в функциональных тестах вместо wall-clock assert'ов; **M-8** — инструментировать `dispose()` для невоспроизведённого флейка `arenaSnapshot() === null`. Не проверено ни одним проходом: ручной playtest двух людей (единственный непройденный gate плана). Ни один из проходов не является security audit — adversarial-набор и ревью sandbox bridge доказывают bounded failure на проверенных путях, не отсутствие обходов.
