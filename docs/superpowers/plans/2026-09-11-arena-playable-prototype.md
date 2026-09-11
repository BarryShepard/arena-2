# 2D Arena Playable Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Available local alias: `subagent-driven-development`. User explicitly requested skipping brainstorming. The workspace is empty and is not a Git repository; do not require a worktree or invent a merge/push step.

**Goal:** Создать локальный бой двух файловых персонажей с четырьмя скриптовыми слотами и доказать выразительность API необычным модом.

**Architecture:** Canvas 2D отображает авторитетный мир с фиксированным шагом. Каждый участник исполняет JS-мод в отдельном QuickJS runtime и взаимодействует с миром только через ограниченный JSON bridge. Локальный Node-сервер обнаруживает пакеты персонажей без редактирования registry.

**Tech Stack:** JavaScript ES modules, Node.js (имеется v26.3.0), Vite, Canvas 2D, quickjs-emscripten, node:test; Playwright для browser smoke, если доступен. Зафиксировать реально установленные версии lockfile.

## Global Constraints

- «Игра — это среда выполнения пользовательских персонажей.»
- «У каждого персонажа есть ровно четыре пользовательских слота способностей.»
- «Сетевая игра не является целью первого прототипа.»
- «Не превращай эти safety limits в игровую систему балансировки.»
- «Сначала сделай минимальный playable vertical slice.»
- Не использовать brainstorming: пользователь прямо попросил пропустить его.
- Обязательные уточнения: `docs/specs/2026-09-11-arena-mvp.md`.
- Не исполнять код персонажей в host JS; ядро не знает имён персонажей или названий способностей.
- Не публиковать, не отправлять сообщения, не коммитить без необходимости. Сохранять отчёт выполнения в `docs/implementation-status.md`.

---

## Карта файлов

```text
package.json / package-lock.json   scripts и воспроизводимые зависимости
index.html / src/main.js           запуск, выбор двух персонажей, ошибки, restart
src/style.css                     минимальный terminal UI, pixelated canvas
vite.config.js                    локальный каталог пакетов и ограниченная раздача файлов
src/mods/package.js               manifest/asset validation, fetch, reload
src/mods/runtime.js               QuickJS lifetime, bridge, budgets
src/mods/bootstrap.js             guest helpers, handlers, state, sequences
src/engine/world.js               entities, fixed tick, очереди, defeat
src/engine/spatial.js             circle overlap, segment hit, solid resolution
src/engine/commands.js            проверка и применение команд
src/engine/input.js               physical key mapping и press/hold/release
src/view/renderer.js              low-res Canvas, sprites, HUD, feedback
src/view/assets.js                PNG sheets и WAV preload/dispose
src/view/effects.js               attachment, beam, fade, timeline rendering
characters/{fighter,mage,bud}/    manifest.json, main.js, PNG/WAV assets
tests/{world,mods,input,effects}.test.js
tests/browser-smoke.mjs
README.md / docs/mod-api.md        запуск, управление, контракт и recipe нового мода
docs/implementation-status.md     выполненные этапы, проверки, ограничения
```

Не создавать пустые модули заранее. Допустимо объединить маленькие соседние файлы, если сохраняются границы runtime/world/render. Не вводить ECS framework, dependency injection framework или UI framework.

## Общий контракт

```js
// JSON snapshot: values copied into guest; never pass host objects/functions.
// Entity: {id, ownerId, x,y,vx,vy,angle,radius,hp,maxHp,
//          solid, countsForDefeat, sprite, scale, tags:[]}
// Input: {move:{x,y}, aim:{x,y}, slots:[{pressed,held,released}, ...]}
// Mod has persistent closure state; each player receives a separate instance.
defineCharacter({
  spawn(ctx) {},
  update(ctx, dt) {},
  ability(ctx, {slot, phase}) {},
  event(ctx, event) {}
});
// ctx = {selfId, ownerId, input, world, api}
// api.entity(id) -> copied entity or null
// api.queryCircle({x,y,radius}) -> copied entities
// api.raycast({from:{x,y},to:{x,y},radius}) -> sorted hits
// api.spawn(spec) -> reserved entity ID; optional behavior string dispatched via event
// api.patch(id, changes), destroy(id), damage(id, amount, sourceId)
// api.impulse(id,{x,y}), heal(id,amount)
// api.after(seconds, callback), every(seconds,callback), cancel(timerId)
// api.effect(spec), sound(asset,options), shake(amount,seconds)
// api.slot(index,{label,cooldown,active}) for HUD only
// api.sequence([{wait:0.1},{effect:{...}},{run:()=>{...}}]) -> cancellable ID
```

Перед первой реализацией агент может конкретизировать внутренние сигнатуры; затем записывает их в `docs/mod-api.md` и согласованно использует во всех модах и тестах. Guest API может собирать command buffer; временные IDs резервировать без доступа guest к host, гарантируя уникальность между владельцами. Не передавать callback-функции через JSON: таймеры/sequence callbacks остаются в guest, host передаёт игровое время/события. Все bridge-результаты имеют проверенный размер.

```json
{
  "apiVersion": 1,
  "id": "fighter",
  "name": "Fighter",
  "entry": "main.js",
  "body": {"radius": 7, "maxHp": 120, "moveSpeed": 80},
  "appearance": {"sprite": "body", "width": 16, "height": 16},
  "abilities": [{"label":"Slash"},{"label":"Rush"},{"label":"Charge"},{"label":"Repel"}],
  "assets": {
    "body": {"type":"sprite", "path":"sprites/body.png", "frameWidth":16,"frameHeight":16,"frames":1,"fps":1},
    "hit": {"type":"sound", "path":"sounds/hit.wav"}
  }
}
```

## Task 1: Один законченный playable vertical slice

**Дополнение пользователя:** ориентир графики/поля/движения — Tank 1990 NES; матч 180 игровых секунд. См. раздел уточнений в spec. Пользователь подтвердил ничью по таймауту, если оба участника живы, и плавное движение строго в четырёх направлениях без диагоналей. При нескольких удерживаемых направлениях выбирается последнее нажатое; после отпускания — предыдущее удерживаемое. Ограничение направлений относится к обычному input, не к импульсам и скриптовым способностям. Реализовать паузу таймера, HUD `M:SS`, reset и приоритет death resolution перед timeout. Добавить проверки окончания на 180 секундах, сохранения времени при паузе и сброса при restart. Простая тайловая арена с несколькими непроходимыми кирпичными блоками должна сохранять проходимые маршруты и симметричные стартовые позиции; solid препятствия участвуют в collision/spatial queries. Разрушаемость стен не входит в этот этап.

**Files:** package/config, main/style/input, engine, runtime/bootstrap/package, renderer/assets; `characters/fighter/*`; `tests/world.test.js`, `tests/mods.test.js`, `tests/input.test.js`; README.

**Interfaces:** `loadPackage(id) -> Promise<Package>`; `createRuntime(package, ownerId) -> Promise<ModRuntime>`; `createWorld({width,height}) -> World`; `World.step(dt, inputs)`; `World.snapshot()`; `World.dispose()`; `render(ctx, snapshot, assets)`.

- [ ] Создать package scripts `dev`, `build`, `test` (`node --test tests/*.test.js`), `test:browser`. Установить Vite и QuickJS; lockfile сохранить. Установить dev server на loopback. Если загрузка зависимостей недоступна, записать точную ошибку, не заменять sandbox на eval.
- [ ] Создать тесты смысловых инвариантов до реализации. Пример контракта world fixture:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/engine/world.js';
test('simultaneous elimination is a draw', () => {
  const world = createWorld({width:480,height:270});
  const a = world.spawn({ownerId:1,x:80,y:100,radius:7,hp:10,countsForDefeat:true});
  const b = world.spawn({ownerId:2,x:400,y:100,radius:7,hp:10,countsForDefeat:true});
  world.queueDamage(a,10,b);
  world.queueDamage(b,10,a);
  world.step(1/60, []);
  assert.equal(world.snapshot().result, 'draw');
});
```

- [ ] Запустить `npm test`, убедиться, что отсутствующие контракты дают ожидаемый fail. Реализовать движение по одной оси за раз (last-pressed held direction), boundary clamp, circle collision, FIFO damage/death и проверку победы в конце тика. Проверить смену активного направления при нажатии/отпускании нескольких клавиш и отсутствие диагонального input. Ограничить catch-up до 5 шагов на кадр, при blur/tab hide очищать input и ставить паузу.
- [ ] Загрузчик проверяет apiVersion=1, четыре slots, конечные числа, положительные размеры/HP, существующие ассеты. Пути только внутри пакета, без URL, `..`, абсолютных путей и symlink escape. Сервер автоматически сканирует `characters/`, пересканирует по Reload, не выдаёт другие директории.
- [ ] Реализовать отдельный QuickJS runtime на игрока: 16 MiB guest heap, 512 KiB stack, interrupt deadline 8 ms на tick вызов, 50 ms на initial load; лимиты 256 entities, 256 timers, 256 effects на владельца и 1024 событий/команд за tick, package 16 MiB и script 256 KiB. Лимиты конфигурируемые, переполнение даёт понятную ошибку и закрывает runtime. Никаких host capabilities сверх JSON bridge. Проверять бюджет и во время сериализации/получения команд.
- [ ] Написать Fighter целиком как мод: четыре разных способности, charge хранит состояние между press/release. Автопередвижение персонажа может быть default guest helper, который мод способен заменить для управления роем. Canvas 480×270, nearest-neighbor, видимые facing markers и owner outlines, HP и четыре подписи/индикатора.
- [ ] Реализовать выбор Fighter для двух независимых игроков, Start, Pause, Restart, Back и Reload. Предзагружать PNG/WAV до боя, звук разблокировать пользовательским Start. Отсутствующий/невалидный ассет показывает package error и не начинает полуматч.
- [ ] Проверить `npm test` и `npm run build`. В browser smoke: выбрать Fighter/Fighter, начать, двигать обоих, использовать четыре слота, довести бой до результата и перезапустить. Проверить console/pageerror. В отчёте различать настоящую browser проверку и непройденный manual checklist.

**Gate:** Уже можно реально играть двумя одинаковыми персонажами; сборка, изоляция и restart работают. Не переходить к расширению, если этот gate не пройден.

## Task 2: Выразительность — Mage, Bud и sequences

**Files:** spatial/commands/bootstrap, effects, `characters/mage/*`, `characters/bud/*`, `tests/world.test.js`, `tests/mods.test.js`, `tests/effects.test.js`, `docs/mod-api.md`.

**Interfaces:** Общий контракт выше; события с `type`, `entityId`, `sourceId`, `amount`, `point`, `normal` по применимости. Для `beforeHit` return `{cancel:true}` или `{amount:number}`; event payload копируется. `death` одноразовый; `damageReceived.amount` — фактическое уменьшение HP.

- [ ] Добавить regression test: death callback создаёт пять `countsForDefeat` тел и победитель ещё не определён; смерть последнего тела заканчивает матч. Добавить test: турель без `countsForDefeat` не удерживает матч. Проверить, что callbacks гибели и команды взрыва разрешаются до verdict.
- [ ] Реализовать raycast/segment checks для быстрых projectiles, sensors и контактные события без урона по умолчанию. Damage, отражение/щит и DoT описывает мод. Проверять NaN/Infinity, владение patch/destroy, stale IDs, невозможность менять ownerId, ограничения размеров JSON до применения команд.
- [ ] Реализовать guest timers и отменяемую sequence; таймеры привязаны к матчу/владельцу и по умолчанию к создавшей сущности. Death callbacks могут создавать самостоятельные эффекты и сущности. Dispose отменяет всё, после restart не остаётся старых callback/sound/effect.
- [ ] Реализовать VFX: sprite animation, attachment, point и endpoint beam, angle/scale, loop, fade-in/out, delay, sound и shake. Проверки должны проверять вычисляемую позицию attachment после перемещения, fade на границах времени и cleanup lifetime, а не пиксельные скриншотные совпадения.
- [ ] Создать Mage: projectile с own sprite/effect, anchor→teleport, DoT zone, turret; Bud согласно spec. В ядре не добавлять `if characterId` или switch по именам способностей. Небольшие PNG/WAV создать локальным скриптом как простые программные assets без художественного pipeline; скрипт генерации сохранить при необходимости воспроизводимости.
- [ ] Автоматически прогнать каждую из 12 способностей через тот же runtime, что использует игра. Проверить два независимых экземпляра одного мода, cooldown/charge/anchor state, управляемую группу Bud и смену поведения первого слота. Прогнать `npm test`, build и browser smoke Mage/Bud.

**Gate:** Три пакета содержат все character-specific механики; рост от урона и бой после распада работают без знания о Bud в движке.

## Task 3: Доказательство моддинга и готовность к передаче

**Files:** tests/mods, tests/browser-smoke, README, docs/mod-api, docs/implementation-status; исправления по проверке в конкретных затронутых модулях.

**Interfaces:** Действующий файловый формат, guest API и запуск из предыдущих задач; документировать именно реализованные названия и ограничения.

- [ ] Тест загрузки создаёт временную копию пакета с новым id/name и меняет скрипт первой способности на radial impulse + healing + attached effect. Проверить обнаружение после Reload и изменение поведения в runtime без изменения core файлов и registry. После теста удалить только собственный временный пакет.
- [ ] Добавить adversarial cases: `while(true){}`, excessive allocation, spawn flood, timer/event recursion, NaN damage, forbidden cross-owner patch, path traversal, отсутствующий PNG. Для каждого требовать bounded failure, сохранение UI живым и возможность начать следующий матч. Не заявлять sandbox security audit по результатам этих тестов.
- [ ] Провести browser smoke полным циклом select→load→fight→death/draw→restart→reload. Проверить scaled canvas, читаемость owner markers/HP, оба набора клавиш без numpad, release при blur и отсутствие console errors. Сохранить screenshot, если браузерный инструмент доступен.
- [ ] README на русском: `npm ci`, `npm run dev`, URL, управление обоих игроков, как добавить папку/перезагрузить, ограничения прицеливания. `docs/mod-api.md`: полный working manifest/main example, события и их порядок, методы API/аргументы/возвраты, timers/state/sequence, assets и технические budgets. Отдельный recipe смены способности без core edits.
- [ ] Выполнить итоговые `npm test`, `npm run build`, `npm run test:browser`. Если браузер отсутствует, не помечать browser gate пройденным; записать команду и причину, выполнить доступные проверки. Обновить `docs/implementation-status.md`: команды и результаты, реализованные gates, известные ограничения, ручной playtest двух людей ещё нужен.
- [ ] Провести независимый review соответствия spec и качества: sandbox bridge, события смерти, package loader, cleanup/restart, отсутствие характерных механик в core. Передать исправления агенту-исполнителю и повторно проверить затронутые тесты. Не объявлять весь prototype завершённым при непрошедшем playable gate.

## Self-review плана

- Все обязательные группы требования покрыты: loop/input/4 slots (1), моды/assets/sandbox (1), reactive world/VFX/необычные mechanics (2), изменение без ядра и end-to-end (3).
- Потенциальные примеры вроде laser/reflection/wall остаются возможностями low-level API; отдельные готовые реализации всех примеров не входят в MVP.
- Главный компромисс для проверки человеком: прицел по направлению движения. Если неудобно, добавить независимое управление/геймпады после первой драки, сохранив mod API.
- Workspace пуст; baseline tests отсутствуют. Создание Git-истории, worktree, публикация и merge не являются deliverable.
