# Task 1 fix round 1 — 2026-09-11

Все Important 1–5 и Minor из task1-review.md исправлены. Task 2 не реализовывался; spec/plan не изменялись. Нужен независимый scoped re-review.

## Findings → changes

1. **Cumulative CPU/events** — `src/mods/runtime.js`, `src/engine/world.js`: beginTick один раз сбрасывает remaining budget владельца. withBudget учитывает всё время snapshot/JSON/QuickJS/host apply, включая event callbacks, и закрывает runtime при исчерпании. Call внутри withBudget не продлевает deadline. Configurable events применяется к event callback count участника; bounded queue drain использует максимум настроенных events (default 1024). Regression event storm с 60 damage и 2ms callbacks прервался; весь тест 9.88ms, step assertion <100ms. Event override=3 действительно вызывает Event budget error.

2. **Private bridge** — `src/mods/bootstrap.js`, `src/mods/runtime.js`: bootstrap IIFE возвращает private QuickJS function handle host-у. Mod source компилируется отдельным evalCode, не имеет lexical доступа к LIMITS/timers/commands. Нет global dispatch; временная defineCharacter удаляется после load. Immutable private limits и captured Map methods/size защищают timer cap от изменения глобальных имён и Map.prototype.set. Regression проверяет отсутствие internals, попытку shadow/override, timer failure и запуск следующего матча.

3. **Effects/render recovery** — `src/engine/world.js`, `src/main.js`: effect schema проверяет x/y/radius/duration, angle/arc, hex color и unknown fields. Negative radius отклоняется до snapshot/render с package/owner attribution. Render exception переводит мир в диагностическую ошибку; frame использует finally для следующего RAF. Browser regression подменяет пакет malformed effect через route, затем успешно Restart. Отдельный одноразовый Canvas exception также ловится, Restart снова двигает time.

4. **Buffered input/reset** — `src/engine/input.js`, `src/main.js`: физические slot transitions записываются между samples. Short tap имеет оба edges. clear() используется для pause/blur release; reset() нового матча очищает keys/edges и восстанавливает initial facing. Regression покрывает short tap, restart после charge, pause release, aliases и repeat.

5. **Melee occlusion** — `src/mods/bootstrap.js`, `characters/fighter/main.js`: lineOfSight(from,to) проверяет segment-vs-static-AABB; все Fighter attack/rush hits проверяют препятствия. Corner test из review: HP остаётся 120 с кирпичом и падает до 105 без него. Полный raycast/projectile pipeline не добавлялся.

Minor **host attribution**: apply errors обёрнуты manifest id/owner, invoke CPU errors сохраняют контекст. Minor **claims**: foreign patch теперь инициируется модом через step, проверяются world.error, closed runtime обоих игроков и свежий матч. Blur browser assertion оставляет KeyD нажатым до проверки отсутствия движения. Alias поведение проверяет отдельный тест.

## Covering files and commands

- `tests/input.test.js`: input edges/aliases/repeat/pause/reset.
- `tests/mods.test.js`: cumulative CPU, events override, closure isolation/timer tampering, effect schema, foreign patch/disposal/recovery, Fighter wall occlusion; прежние tests сохранены.
- `tests/browser-smoke.mjs`: исходный playable flow + усиленный blur и malformed effect/Canvas recovery.
- `npm test`: **PASS 19/19**, 0 failures, ~172ms.
- `npm run build`: **PASS**, Vite 8.3.0, bundle/WASM generated.
- `npm run test:browser` (разрешённое escalation для локального сервера и Chromium): **PASS**. Fighter/Fighter loading, движение обоих, 8 bindings, combat verdict, pause/blur, restart/reload и оба recovery cases; console/pageerror отсутствуют.
- Screenshot обновлён: `docs/artifacts/task1-browser.png`.

Обновлены `docs/mod-api.md` и `docs/implementation-status.md`. Проверки завершены; дополнительных нерелевантных прогонов не делалось. Человеческий playtest и sandbox security audit по-прежнему не заявляются.
