# ARENA — локальная арена файловых модов

Локальный бой двух файловых персонажей в браузере: три пакета (Fighter, Mage, Bud), четыре скриптовые способности у каждого, кирпичная арена 480×270. Матч идёт 3 минуты игрового времени; на таймауте ничья. Смерти последнего тика имеют приоритет над таймаутом. Ядро не знает имён персонажей: снаряды, телепорт, зона, турель, рост и распад Bud — код модов поверх generic API.

## Запуск

Нужен Node.js 22.12+ (проверено на 26.3.0).

```sh
npm ci
npm run dev
```

Открыть **http://127.0.0.1:5173/**, выбрать персонажей и нажать Start match. Сервер слушает только loopback. После установки зависимостей внешние сервисы не нужны. Через `file://` игра не запускается. `npm run build` проверяет production bundle; для игры используется dev server, поскольку он предоставляет локальный каталог модов (статический `dist` сам по себе не содержит API каталога).

## Управление

Клавиши одинаковы для любого персонажа; подписи слотов рисует HUD (мод меняет их на лету).

| Игрок | Движение | Slot 1   | Slot 2   | Slot 3   | Slot 4   |
| ----- | -------- | -------- | -------- | -------- | -------- |
| P1    | WASD     | F        | G        | H        | J        |
| P2    | Стрелки  | Num1 / I | Num2 / O | Num3 / P | Num0 / [ |

| Персонаж         | Slot 1                                                 | Slot 2                                                           | Slot 3                                         | Slot 4                                                 |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| Fighter (120 HP) | Slash — удар сектором                                  | Rush — рывок с уроном на контакте                                | Charge — держать до 1.5 с, отпустить для удара | Repel — толчок вокруг                                  |
| Mage (100 HP)    | Bolt — снаряд, гаснет на кирпиче/границе               | Anchor → Blink — поставить якорь, вторым нажатием телепорт (3 с) | Zone — зона урона 4 HP/0.25 с на 3 с           | Turret — турель на 5 с, бьёт лучом по прямой видимости |
| Bud (100 HP)     | Volley — залп из каждого тела / Lash — луч после Morph | Tight / Wide — строй группы                                      | Mine — ползущая мина 8 с, взрыв на контакте    | Morph — смена формы и поведения Slot 1                 |

Bud растёт на 10 % за каждый реальный удар (до радиуса 20) и после первой смерти распадается на пять управляемых семян: матч продолжается, пока живо хоть одно. Турель Mage матч не удерживает.

Клавиши физические (`KeyboardEvent.code`), раскладка не влияет. Только четыре направления, движение плавное; последняя нажатая из удерживаемых клавиш задаёт направление. Отпускание возвращает к предыдущей удерживаемой. Взгляд сохраняется после остановки.

Escape/Pause — пауза, Restart — новый матч с тем же выбором, Back — выбор. Потеря фокуса/скрытая вкладка ставят паузу и очищают клавиши; возобновление вручную. Пауза не расходует 3 минуты. Некоторые клавиатуры аппаратно ограничивают одновременные нажатия.

Переназначение: скопировать структуру `defaultBindings` из `src/engine/input.js` и записать JSON в localStorage `arena.bindings`, затем обновить страницу. В каждом игроке `move` — вверх/вниз/влево/вправо, `slots` — четыре массива альтернативных кодов. Пример в консоли браузера:

```js
localStorage.setItem(
  "arena.bindings",
  JSON.stringify([
    {
      move: ["KeyW", "KeyS", "KeyA", "KeyD"],
      slots: [["KeyF"], ["KeyG"], ["KeyH"], ["KeyJ"]],
    },
    {
      move: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
      slots: [["KeyI"], ["KeyO"], ["KeyP"], ["BracketLeft"]],
    },
  ]),
);
location.reload();
```

## Файловые персонажи

Скопировать `characters/fighter` (или `mage`/`bud`) в `characters/my_mod`, изменить `manifest.json` (`id: "my_mod"`, имя) и `main.js`. Back → Reload mods повторно сканирует директории. Start/Restart заново читает содержимое пакетов. Реестра имён в ядре нет. Ассеты — собственные простые PNG/WAV, генерируются детерминированно без внешних зависимостей:

```sh
python3 scripts/generate-assets.py        # fighter: body.png, hit.wav
python3 scripts/generate-mage-assets.py   # mage: body/bolt/spark/turret/zone/rune.png, cast/zap.wav
python3 scripts/generate-bud-assets.py    # bud: body/thorn/seed/seedthorn/shot/mine/boom.png, pop/boom.wav
```

Пошаговая инструкция для модели, включая балансные коридоры и смету: [docs/character-authoring.md](docs/character-authoring.md).

Контракт и ограничения: [docs/mod-api.md](docs/mod-api.md) — сущности с `contact`/`lifetime`, `raycast`, entity-scoped таймеры, `sequence`, эффекты ring/sprite/beam с attach, recipe снаряда/турели/группы. Код персонажа исполняется только внутри QuickJS/WASM. Ошибка мода останавливает матч с диагностикой; Back/Restart позволяют продолжить.

## Проверки

```sh
npm test            # 88 тестов: input 4, world 9, effects 9, mods 26 (sandbox/бюджеты/contact/timers), mage 11, bud 9, mutation 1, adversarial 19
npm run build
node scripts/balance-probe.mjs   # DPS/TTK каждого слота против манекена (балансный замер, не тест)
npx playwright install chromium
npm run test:browser
```

`npm test` запускает файлы последовательно (`--test-concurrency=1`): CPU-бюджет мода 8 мс на tick считается по wall-clock, и параллельные test-процессы давали ложные срабатывания. `tests/mutation.test.js` — mod-only mutation recipe: временная копия Fighter с новым id и переписанным слотом 0 обнаруживается и ведёт себя иначе без правки `src/`; `tests/adversarial.test.js` — 19 враждебных модов (`while(true)`, аллокация, рекурсия, spawn/timer/command/contact flood, NaN damage, cross-owner, path traversal, поддельный PNG, мусор из `beforeHit`, мусорные поля в `slot`, абсурдные магнитуды `1e308`), каждый заканчивается атрибутированной ошибкой, закрытием VM и стартом следующего матча. Это bounded failure, не аудит безопасности.

Browser smoke сам поднимает сервер на 127.0.0.1:5178, управляет обоими игроками физическими клавишами и проходит полный цикл: Fighter/Fighter (бой до результата, пауза/blur, Restart, Reload, восстановление после сломанного мода), Mage vs Bud (все 8 слотов, снаряды, зона, турель, эффекты ring/sprite/beam), распад Bud на пять семян и управление группой до победы Fighter, mirror Mage/Mage. Снимки: `docs/artifacts/task1-browser.png`, `task2-mage-bud.png`, `task2-bud-burst.png`. Все 12 способностей Mage/Bud также прогнаны через тот же QuickJS runtime в `tests/mage.test.js` и `tests/bud.test.js`.

## Состояние

Реализованы Task 1–3: generic API (contact events, raycast, lifetime, entity-scoped timers, sequence, sprite/beam/attached effects, sound volume), три персонажа, mutation recipe и adversarial-набор, полный browser smoke. Engine review round 1 Task 2 закрыт fix round'ом (stale `sourceId` без ошибки, лимит `tags`, `after(0)`, подавление contact после destroy); fix round 2 по adversarial findings — stack 128 KiB с безопасным dispose, валидация ответа `beforeHit`, command budget 1024 на владельца за tick, префикс `world:` для событий движка, обрезка сообщений до 512 символов (см. mod-api.md). Независимое ревью проведено в два прохода. Финальный review (`docs/reviews/task2-3-final-review.md`: Task 2 PASS/PASS, Task 3 FAIL до fix round 3) закрыт fix round 3 — whitelist состояния `slot`, own-property lookup ассетов по ключам-именам, технический лимит магнитуд `1e6` с инвариантом конечности и guards в spatial, раздельный dispose, строгий `validateManifest`, общий `listPackages()`. Scoped re-review (`docs/reviews/task2-3-rereview.md`) подтвердил закрытие всех findings и нашёл один новый Important — `radius` вне лимита магнитуд; fix round 4 распространил лимит `1e6` на `radius/scale/width/height` и добавил проверку конечности после separation/clamp. Все Important закрыты; сама правка fix round 4 отдельного ревью не проходила (подтверждена тестом и repro). Открытые рекомендации ревью — M-5 (`tickMs` override в функциональных тестах) и M-8 (инструментировать флейк `arenaSnapshot()`), не блокируют. Следующий шаг — playtest двух людей на одной клавиатуре. Не реализованы: разрушаемые кирпичи, сеть, геймпады, независимый прицел, host-side projectile helpers. Автотесты не заменяют playtest двух людей и не являются аудитом безопасности sandbox. Подробности и ограничения: [docs/implementation-status.md](docs/implementation-status.md).
