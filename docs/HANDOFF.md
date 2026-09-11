# Arena-2 handoff

Дата состояния: 2026-09-11.

## Что уже готово

Task 1, Task 2 и Task 3 реализованы. Работает локальный браузерный прототип: три файловых персонажа (Fighter, Mage, Bud), Canvas 2D в духе Tank 1990 NES, симметричная арена 480×270 с кирпичными AABB, плавное движение строго по четырём направлениям, прицеливание по последнему направлению, четыре способности на игрока, HP, столкновения, таймер 3:00, пауза, restart, reload, timeout draw.

Ядро не знает имён персонажей. Generic API Task 2: сущности с `contact`/`lifetime`/`tags`/`countsForDefeat`, `raycast`, entity-scoped таймеры `after/every`, отменяемая `sequence`, эффекты ring/sprite/beam с attach/delay/fade/loop, `sound` с volume, события `beforeHit/damageReceived/death` с FIFO drain и вердиктом после death callbacks. Mage (Bolt, Anchor→Blink, Zone, Turret) и Bud (рост 10 % от урона, распад на пять управляемых семян, Volley/Lash, Tight/Wide, Mine, Morph) — код модов поверх этого API.

Код персонажа исполняется в отдельном QuickJS runtime на игрока; bridge не отдаёт DOM, сеть, файловую систему, host eval. Бюджеты: heap 16 MiB, stack 128 KiB, 8 ms CPU на владельца за tick (wall-clock), 256 entities/timers/effects, 1024 commands на владельца за tick, 1024 event callbacks, JSON 1 MiB. Task 3: mod-only mutation recipe (`tests/mutation.test.js`), adversarial-набор bounded failure (`tests/adversarial.test.js`, 19 кейсов), полный browser smoke, README/`docs/mod-api.md`. По findings adversarial-набора выполнен fix round 2: stack 512→128 KiB с безопасным dispose (нативный стек переполнялся раньше лимита QuickJS и abort'ил модуль), валидация ответа `beforeHit` в бюджете владельца, command budget per-owner, префикс `world:` для элементов drain от движка, `Unknown guest error`/обрезка сообщений до 512 символов.

По findings финального независимого review (`docs/reviews/task2-3-final-review.md`) выполнен fix round 3: I-1 — `slot` принимает ровно `{label, cooldown, active}` (`SLOT_FIELDS` в `src/engine/world.js`, лишний ключ → `Invalid slot field`, `active` по умолчанию `false`); I-2 — ключи sprite/asset/sound ищутся только как own-property (`own()` в `src/view/renderer.js`, null-prototype таблицы в `src/view/assets.js`, `Object.hasOwn` в world), `'constructor'`/`'__proto__'` не резолвятся; I-3 — технический лимит `|x|, |y|, |vx|, |vy|, impulse| ≤ 1e6` (`Invalid magnitude`, атрибуция инициатору), host-инвариант конечности после интеграции (`world: Non-finite …`), guards в `src/engine/spatial.js` против hit'ов с `NaN`; M-2 — раздельные `try` в `runtime.dispose()`; M-3 — `typeof`/`isObject` в `validateManifest`; M-4 — `listPackages()` экспортирован из `vite.config.js` и общий для middleware и mutation-теста (`/api/characters` отсортирован); M-7 — обезличенные комментарии; M-1/M-6 — записаны в `docs/mod-api.md`, «Подводные камни». Evidence: adversarial 13–14, `tests/world.test.js` sweep ±1e308, `tests/effects.test.js` proto-keys. Подробно — `docs/implementation-status.md`, «Fix round 3 (final review findings)».

По finding scoped re-review (`docs/reviews/task2-3-rereview.md`, I-4) выполнен fix round 4: `radius` не входил в лимит магнитуд — два solid-тела с `radius ≥ ~9e307` давали `0 * Infinity = NaN` в separation, NaN попадал в снимки обоих игроков, и ошибку получала жертва (`fighter P2: Invalid raycast`) либо `world: Non-finite …` без виновника. Фикс в `src/engine/world.js`: `BOUNDED = x, y, vx, vy, radius, scale, width, height` (`Invalid magnitude <k>` у инициатора, ровно `1e6` принимается), `assertFinitePose(e, phase)` после интеграции **и** после separation/clamp (`world: Non-finite <k> … after integration|collision`). Тест `tests/world.test.js` «radius/scale/width/height share the 1e6 magnitude cap; huge solid radii cannot poison poses»; `docs/mod-api.md` обновлён. Третьего независимого прохода по этой правке не было — закрытие подтверждено тестом и repro-сценарием re-review. Подробно — `docs/implementation-status.md`, «Fix round 4 (re-review I-4)».

## Доказательства

- `npm test`: 88/88 PASS (input 4, world 9, effects 9, mods 26, mage 11, bud 9, mutation 1, adversarial 19), 0 todo; файлы исполняются последовательно (`--test-concurrency=1`), ≈ 2.5–3 с. Прогнано после fix round 4.
- `npm run build`: PASS.
- `npm run test:browser`: PASS в Chromium (Playwright), полный цикл select → load → fight → death → restart → reload: Fighter/Fighter (обе раскладки, 8 слотов, победа, pause/blur, Restart/Reload, malformed effect и Canvas exception recovery), Mage vs Bud (8 слотов, снаряды/зона/турель, VFX ring/sprite/beam), распад Bud на 5 семян + управляемая группа + добивание до `P2`, mirror Mage/Mage независимость anchor/HUD; console/pageerror отсутствуют. Единичный невоспроизведённый флейк (`arenaSnapshot()` null через 1,6 с после Start после Back → Reload, 1 из ≥ 7 прогонов) зафиксирован в `docs/implementation-status.md`.
- Скриншоты: `docs/artifacts/task1-browser.png`, `docs/artifacts/task2-mage-bud.png`, `docs/artifacts/task2-bud-burst.png` (просмотрены оркестратором).
- Review: Task 1 — `docs/reviews/task1-rereview.md` (PASS). Task 2 engine review round 1 (3 Important + 6 Minor) закрыт fix round'ом (`docs/implementation-status.md`, «Fix round (review Task 2 engine)»). Финальный независимый review Task 2/Task 3 — `docs/reviews/task2-3-final-review.md` (на 83/83): Task 2 Spec PASS / Quality PASS; Task 3 FAIL до fix round 3 (I-1, I-2, I-3, Minor M-1…M-8); fix round 3 выполнен. Scoped re-review — `docs/reviews/task2-3-rereview.md` (на 87/87): I-1…I-3 и M-1/2/3/4/6/7 ADDRESSED с репро, регрессий нет, M-5/M-8 не заявлялись; новый I-4 → Task 3 Spec FAIL (только I-4) / Quality PASS; fix round 4 закрыл I-4 (88/88, build, browser smoke PASS). **Итог: Task 1–3 реализованы; все Important закрыты; Task 3 gate закрыт по итогам re-review + fix round 4 с оговоркой, что третьего независимого прохода по fix round 4 не было.** Открытые рекомендации: M-5 (`tickMs` override в функциональных тестах), M-8 (инструментировать `dispose()` для флейка `arenaSnapshot()` null). Итоговые разделы: «Independent review (final)» в `docs/implementation-status.md`, «Independent review (Task 2)» в `docs/tasks/task2-report.md`.
- Журналы: `docs/implementation-status.md` (полный, по задачам), `docs/tasks/progress.md` (кратко), `docs/tasks/task2-report.md` (чекбоксы Task 2, отклонения от дизайна).

## Пользовательские решения

- Референс поля/графики/передвижения: Tank 1990 NES.
- Обычное движение: четыре направления, без диагоналей, плавное; last pressed held direction wins, после отпускания возвращается предыдущее удерживаемое направление.
- Продолжительность матча: 180 секунд игрового времени, HUD `3:00` → `0:00`.
- Если на таймауте оба участника живы: ничья. На последнем тике сначала разрешаются damage/death callbacks, затем timeout.
- Сетевой режим, matchmaking, AI и балансировка не входят в MVP.

## Точка продолжения

1. **Ручной playtest двух людей** на одной клавиатуре (`npm run dev`, http://127.0.0.1:5173/) — единственный непройденный gate плана `docs/superpowers/plans/2026-09-11-arena-playable-prototype.md`; автотесты и ревью его не заменяют. Что оценивать: читаемость попаданий (видно ли, кто кого ударил — кольца Slash/Repel, снаряд Bolt, зона, луч турели/Lash, взрыв мины, семена Bud на реальном экране); сближение и уклонение (успевает ли игрок уйти от Rush/Bolt/мины при движении строго по четырём направлениям, не слишком ли тесны проходы между кирпичами); удобство одновременного управления двоих на одной клавиатуре (WASD+FGHJ против стрелок+Num/IOP[, keyboard ghosting при 4–6 одновременных клавишах, нужны ли альтернативные коды); ощущение Mage (стоит ли Anchor→Blink двух нажатий, читается ли зона, полезна ли турель за 5 с) и Bud (заметен ли рост, управляема ли группа семян одной клавишей, понятен ли Morph по подписи слота). Результаты и найденные дефекты записать в `docs/implementation-status.md`.
2. **По желанию — третий независимый проход по fix round 4** (radius bound): небольшой, read-only. Зона: `src/engine/world.js` (`BOUNDED`, `magnitude`, `assertFinitePose` и две точки вызова — после интеграции и после separation/clamp), `tests/world.test.js` «radius/scale/width/height share the 1e6 magnitude cap…», `docs/mod-api.md` («Технические бюджеты»). Вопросы: остался ли вход, через который конечные значения ≤ `1e6` дают NaN/Infinity в separation или sweep (например, `scale`/`width`/`height` в renderer, `radius` в `queryCircle`/`raycast`), и всегда ли ошибка приписывается инициатору, а не жертве.
3. **По итогам playtest — кандидаты, не обязательства**: рекомендации ревью M-5 (`tickMs` override в функциональных тестах вместо wall-clock assert'ов) и M-8 (инструментировать `dispose()` для флейка `arenaSnapshot()` null); независимый twin-stick прицел и/или геймпады (плановый компромисс — прицел по направлению движения; mod API при этом сохранить); балансировка чисел в `characters/*/main.js` (без правки ядра); разрушаемые кирпичи (нужен новый generic-механизм в `world.js`/`spatial.js` и событие для модов); host-side projectile helpers — только если моды начнут дублировать код.

## Важные ограничения передачи

- Workspace не является Git repository; не ожидать commit SHA, worktree или merge. Изменения — локальные файлы.
- Не откатывать существующие файлы и не переписывать Task 1–2 без конкретного regression; тесты Task 1–2 в наборе — регрессионная сетка.
- Не заявлять security audit: adversarial-набор доказывает bounded failure для перечисленных кейсов и отсутствие известных host capabilities в проверенных путях, не отсутствие обходов sandbox.
- Documented footguns API остаются по дизайну и описаны в `docs/mod-api.md`, «Подводные камни»: contact `t=0` каждый tick при касании, снаряд на позиции владельца контактирует с ним на первом tick, таймеры без явного scope после смерти `selfId` молча удаляются, `destroy` — отложенный kill, квадратный угол кирпича в sweep, `attach` не ограничен своими сущностями.
- Stack 128 KiB — осознанный компромисс (≈ 740 кадров / ≈ 150 вложенных `sequence`); обоснование в комментарии к `DEFAULT_LIMITS` в `src/mods/runtime.js`. Не поднимать без повторной проверки нативного стека в Node и браузерах (Safari/workers не измерялись).
- CPU-бюджет 8 ms — wall-clock; `npm test` поэтому сериализован (`--test-concurrency=1`). Параллельный раннер даёт ложные `CPU tick budget exceeded`, это не регрессия логики. Открытая рекомендация review M-5: `tickMs` override в функциональных тестах вместо wall-clock assert'ов.
- Лимит магнитуд `1e6` (`Invalid magnitude <k>`) распространяется на `|x|, |y|, |vx|, |vy|`, компоненты `impulse` (fix round 3) **и на размеры `radius`, `scale`, `width`, `height`** (fix round 4) в `spawn`/`patch`; после интеграции и после separation/clamp host проверяет конечность позы (`world: Non-finite … after integration|collision` — инвариант, при соблюдении лимитов недостижим). Правило «`slot` принимает ровно три ключа `{label, cooldown, active}`» (`Invalid slot field`) — из fix round 3. Всё это технические ограничения против переполнения интеграции/sweep/separation и раздувания снимков, не балансовые; Fighter/Mage/Bud до них не доходят (радиусы — единицы и десятки, Bud растёт до 20). При балансировке модов не считать их частью дизайна арены; описаны в `docs/mod-api.md`.
- `docs/tasks/task2-design.md` — исторический контракт Task 2; фактические отклонения перечислены в `docs/tasks/task2-report.md` («Отклонения от дизайн-документа»), действующий API — `docs/mod-api.md`.
- `docs/implementation-status.md` и `docs/tasks/progress.md` — журналы состояния; обновлять после каждого этапа. Разделы Task 1/Task 2 в status — исторические, числа тестов в них — на момент записи.
- Статический `dist` не содержит каталога модов; играть через `npm run dev`.

## Запуск

```bash
npm ci
npm test
npm run build
npm run dev
```

Открыть `http://127.0.0.1:5173/`. Для browser smoke: `npx playwright install chromium`, затем `npm run test:browser`; при ограничении loopback запуск может потребовать разрешённого sandbox escalation. Ассеты пакетов регенерируются `python3 scripts/generate-*.py` без внешних зависимостей.
