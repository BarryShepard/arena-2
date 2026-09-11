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


## Integration notes

Task 1 уже существует; актуальные сигнатуры в docs/mod-api.md, отчёт в docs/implementation-status.md. Не переписывать работающий Task 1. Пользователь подтвердил движение без диагоналей и ничью через 180 секунд. Разрешены произвольные векторы способности/импульса; four-direction только обычный input. Карта содержит AABB bricks; projectiles и raycasts должны учитывать стены. Исправления review Task 1 будут закончены до начала этого этапа. Сохранять src/main.js как общий UI, никаких проверок имён модов. Демонстрационные скрипты — QuickJS ES script, defineCharacter, не host modules. После завершения обновить mod-api, README, status и task2-report.

### Проверки интеграции для Task 2

- Отображаемый размер тела учитывать отдельно от исходного PNG frame size и collision radius; manifest appearance.width/height должны реально влиять на rendering. Рост Bud меняет sprite scale и radius самим модом.
- Контакт projectile со стеной должен происходить до противника за стеной даже при пересечении нескольких объектов за tick. У contact event должна быть достаточная информация о препятствии/нормали/точке.
- Обычные sensor/projectile сущности не должны расталкивать тела или застревать на границе навечно: lifetime и collision behavior принадлежат моду.
- Удаление всех countsForDefeat тел завершает матч даже при живых турелях; новые тела из death callback учитываются до вердикта.
- Все 12 слотов демонстрируют фактические изменения мира/state, не только emitted command или смену HUD.
- Неподвижное поле и UI, user-approved 180s/cardinal input, остаются неизменными по поведению.
