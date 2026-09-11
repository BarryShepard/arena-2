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

## Task 3: Доказательство моддинга и готовность к передаче

**Files:** tests/mods, tests/browser-smoke, README, docs/mod-api, docs/implementation-status; исправления по проверке в конкретных затронутых модулях.

**Interfaces:** Действующий файловый формат, guest API и запуск из предыдущих задач; документировать именно реализованные названия и ограничения.

- [ ] Тест загрузки создаёт временную копию пакета с новым id/name и меняет скрипт первой способности на radial impulse + healing + attached effect. Проверить обнаружение после Reload и изменение поведения в runtime без изменения core файлов и registry. После теста удалить только собственный временный пакет.
- [ ] Добавить adversarial cases: `while(true){}`, excessive allocation, spawn flood, timer/event recursion, NaN damage, forbidden cross-owner patch, path traversal, отсутствующий PNG. Для каждого требовать bounded failure, сохранение UI живым и возможность начать следующий матч. Не заявлять sandbox security audit по результатам этих тестов.
- [ ] Провести browser smoke полным циклом select→load→fight→death/draw→restart→reload. Проверить scaled canvas, читаемость owner markers/HP, оба набора клавиш без numpad, release при blur и отсутствие console errors. Сохранить screenshot, если браузерный инструмент доступен.
- [ ] README на русском: `npm ci`, `npm run dev`, URL, управление обоих игроков, как добавить папку/перезагрузить, ограничения прицеливания. `docs/mod-api.md`: полный working manifest/main example, события и их порядок, методы API/аргументы/возвраты, timers/state/sequence, assets и технические budgets. Отдельный recipe смены способности без core edits.
- [ ] Выполнить итоговые `npm test`, `npm run build`, `npm run test:browser`. Если браузер отсутствует, не помечать browser gate пройденным; записать команду и причину, выполнить доступные проверки. Обновить `docs/implementation-status.md`: команды и результаты, реализованные gates, известные ограничения, ручной playtest двух людей ещё нужен.
- [ ] Провести независимый review соответствия spec и качества: sandbox bridge, события смерти, package loader, cleanup/restart, отсутствие характерных механик в core. Передать исправления агенту-исполнителю и повторно проверить затронутые тесты. Не объявлять весь prototype завершённым при непрошедшем playable gate.


## Integration notes

Предыдущие этапы должны пройти review до начала Task3. Использовать фактический контракт docs/mod-api.md; не переписывать реализацию для совпадения с концептуальным примером плана. Изменение поведения в mod-only тесте должно пройти реальную загрузку package и QuickJS, не fake runtime. Browser ошибки злонамеренного мода проверять вместе с восстановлением следующего матча. Никаких постоянных тестовых пакетов в characters/; cleanup только созданных тестом ресурсов. Визуальная проверка как минимум Mage/Bud mid-combat, пять управляемых тел Bud после смерти. Удовольствие от боя остаётся предметом человеческого playtest.

Дополнительный numerical adversarial case: большие, но конечные vx/impulse/position не должны незаметно превращаться в Infinity/NaN после arithmetic, портить snapshot или renderer; принимать bounded diagnostic либо корректный технический clamp, а не балансировочное ограничение мощности.
