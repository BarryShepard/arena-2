# Финальный независимый review — Task 2 и Task 3 (2026-09-11)

Режим: read-only. Прочитаны spec, план (Task 2/3, Gate'ы), task2-brief/design/report, task1-rereview, весь `src/`, три пакета, все тесты, browser-smoke, mod-api.md, README, implementation-status.md, HANDOFF. Прогнано: `npm test` ×4 (83/83, стабильно), `npm run build` (PASS), одноразовые `node -e` эксперименты. Browser smoke — PASS оркестратора принят как заявленный.

## Вердикт до fix round 3

| | Spec | Quality |
|---|---|---|
| Task 2 | PASS | PASS |
| Task 3 | FAIL до fix round 3 (I-1, I-2, I-3) | PASS с оговорками (M-4, M-5) |

Critical нет: ни одна находка не даёт побега из sandbox, зависания или потери restart; все три Important заканчиваются остановкой матча с неверной/отсутствующей атрибуцией либо молчаливым `Infinity` в мире.

## Important (подтверждены воспроизведением)

- **I-1** `src/engine/world.js` case `slot`: `state` не whitelist'ится, лишние ключи попадают в `this.slots` и в снимки обоих игроков. P1 кладёт 4×300 KB мусора → следующий invoke P2 падает с `fighter P2: Input JSON budget exceeded`; при дефолтах P2 оплачивает structuredClone чужого мусора своим CPU-бюджетом. Fix: принимать ровно `{label, cooldown, active}`.
- **I-2** `src/view/renderer.js`: `assets.images[owner]?.[e.sprite]` для `sprite: 'constructor' | '__proto__' | …` резолвится через прототип → TypeError → `Render: …` без атрибуции мода. Fix: `Object.hasOwn` / null-prototype в renderer, assets.play, проверках asset в world/effects.
- **I-3** Численный adversarial-кейс из task3-brief не реализован: `impulse 1e308` дважды → `ix = Infinity` навсегда (чужое тело прижато к стене, `ix → null` в JSON, диагностики нет); в `spatial.segmentCircle` переполнение даёт `t = NaN` → hit `{t:null, point:null}`, нарушая контракт; жертва, использующая `ev.point`, получает свою ошибку. Fix: технический clamp магнитуд (|v| ≤ 1e6), проверка конечности после интеграции, guard в spatial, adversarial-кейс.

## Minor

- M-1 асимметрия порядка: команды P1 tick-фазы применяются до snapshot P2 в том же tick — задокументировать.
- M-2 `runtime.dispose()`: исключение в `vm.dispose()` пропускает `runtime.dispose()` (утечка wasm-runtime).
- M-3 `validateManifest`: `typeof m.id`, элементы `abilities`/значения `assets` должны быть объектами (понятная ошибка вместо TypeError).
- M-4 mutation test дублирует readdir-фильтр middleware — экспортировать `listPackages()`.
- M-5 wall-clock assert'ы в тестах и 8-мс бюджет: локально стабильно, под CI-нагрузкой возможны ложные падения; рекомендация — `tickMs` override в функциональных тестах.
- M-6 dev-сервер отдаёт статику project root (`fs.strict` ограничивает только выход за root) — зафиксировать в docs.
- M-7 комментарии в `runtime.js` упоминают имена персонажей — обезличить.
- M-8 невоспроизведённый флейк `arenaSnapshot() === null` после Back→Reload — инструментировать `dispose()`.

## Проверено и в порядке

Sandbox bridge (нет host capabilities, internals недоступны, whitelists, бюджеты per-owner на всех путях включая contact/raycast/sequence/beforeHit response, атрибуция с одним префиксом, dispose/restart cleanup); смерть/вердикт (death один раз, spawn из death до вердикта, турель не удерживает, draw, timeout после смертей); package loader (apiVersion, 4 слота, safePath, realpath symlink, PNG/WAV magic, размеры, авто-обнаружение); отсутствие character-specific логики в `src/` (только комментарии); Gate Task 2 выполнен; пользовательские решения не нарушены; 10 выборочных утверждений mod-api совпали с кодом; README/status/HANDOFF честны (нет заявлений security audit, playtest не проведён, флейк smoke записан).
