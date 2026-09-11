# Scoped re-review — fix round 3 (2026-09-11)

Режим: read-only, `npm test` 87/87 на момент проверки, `npm run build` PASS, репро через одноразовые `node -e`.

| Finding | Verdict | Evidence |
|---|---|---|
| I-1 slot.state whitelist | ADDRESSED | `src/engine/world.js` `SLOT_FIELDS`, case `slot` сохраняет ровно `{label, cooldown, active}`; adversarial тест 13; репро: 300 KB junk в 4 слота → `fighter P1: Invalid slot field junk`, P2 не упомянут. |
| I-2 prototype-keys | ADDRESSED | `renderer.js` `own()`/`Object.hasOwn`, `assets.js` null-prototype таблицы, `world.js` sound hasOwn, `package.js` appearance.sprite hasOwn; effects-тесты; репро: `sprite:'constructor'`/`'__proto__'` → квадраты, без исключений. Замечание: `effects.js` читает `manifest.assets[asset]?.type` по цепочке прототипов — безопасно (нет члена с `type === 'sprite'`), закреплено тестом. |
| I-3 магнитуды | ADDRESSED в заявленном объёме | `MAGNITUDE_MAX = 1e6` для x/y/vx/vy и impulse (проверка до мутации), post-integration finiteness, guards в `spatial.js`; adversarial 14, world sweep ±1e308. Но тот же класс через `radius` — I-4. |
| M-1, M-2, M-3, M-4, M-6, M-7 | ADDRESSED | mod-api «Подводные камни»; раздельные try в dispose; isObject/typeof в validateManifest (три реальных манифеста проходят); `listPackages()` в middleware и mutation-тесте; комментарии обезличены. |
| M-5, M-8 | NOT ADDRESSED (не заявлены) | Открытые рекомендации. |

Регрессий в зоне правок нет: `createSpatial` self-contained, Fighter/Mage/Bud проходят, ровно `1e6` принимается, docs соответствуют коду.

## Новый finding

**I-4 (Important):** `radius` не входил в лимит магнитуд. Два solid-тела с `radius ≥ ~9e307` дают `r = Infinity`, `0 * Infinity = NaN` в separation; проверка конечности стояла до separation, NaN попадал в снимки обоих игроков, и жертва (raycast/effect/spawn по координатам врага) получала свою ошибку (`fighter P2: Invalid raycast` и т. п.), а при бездействии — `world: Non-finite …` как «баг движка». Фикс: включить размеры в BOUNDED и/или повторить проверку после separation/clamp.

Вердикт на момент re-review: Task 3 Spec FAIL (только I-4), Quality PASS.

## Закрытие I-4 (оркестратор, после re-review)

`src/engine/world.js`: `BOUNDED` = x, y, vx, vy, radius, scale, width, height (`Invalid magnitude <k>`); `assertFinitePose(e, phase)` вызывается после интеграции и после separation/clamp (`… after integration|collision`). `docs/mod-api.md` обновлён. Тест `tests/world.test.js` «radius/scale/width/height share the 1e6 magnitude cap…»: отказ на 1e308/1e7/2e6/Infinity, два solid-тела radius 1e6 дают конечные позиции без ошибки, ручное отравление NaN после clamp даёт `world: Non-finite y (NaN) … after collision`. Прогоны: `npm test` 88/88, `npm run build` PASS, `npm run test:browser` 5/5 PASS. Отдельный третий проход независимого ревью по этой правке не проводился; закрытие подтверждено тестами и repro-сценарием из re-review.
