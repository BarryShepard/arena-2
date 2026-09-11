# Task 1 scoped re-review — fix round 1

**Spec verdict: PASS for Task 1. Quality verdict: PASS for Task 1.** Все 5 Important и 2 Minor исходного review — **ADDRESSED**. Новых Important/Critical regressions в области исправлений не найдено. Task 1 gate можно закрыть и перейти к Task 2.

| Finding | Verdict | Проверенное исправление |
| --- | --- | --- |
| Important 1: накопление CPU/event budget | ADDRESSED | `src/mods/runtime.js:51` сохраняет remaining budget между вызовами; nested withBudget не продлевает deadline. `src/engine/world.js:115` включает snapshot, JSON и apply в бюджет вызывающего участника; `src/engine/world.js:359` сбрасывает его один раз за step. Event callbacks учитывают override, drain ограничен. Regression воспроизводит исходные 60 damage / 2 ms event и требует bounded error. |
| Important 2: mutable bridge/timers | ADDRESSED | `src/mods/bootstrap.js:3` изолирует lexical state в IIFE. Mod source компилируется отдельно, dispatch хранится private host handle, defineCharacter удаляется после регистрации. Timer methods/size captured до mod load, limits/api frozen. Regression проверяет отсутствие имён internals, shadow globals и подмену Map.prototype.set, затем timer cap и fresh match. |
| Important 3: malformed effect / RAF recovery | ADDRESSED | `src/engine/world.js:224` проверяет effect schema до применения, в том числе radius и конечные числа. `src/main.js:132` ловит render exception и закрывает runtimes через world.fail; `src/main.js:186` назначает следующий RAF в finally. Browser cases проверяют malformed package и отдельную Canvas exception, после каждого Restart возобновляет time. |
| Important 4: input edges/reset | ADDRESSED | `src/engine/input.js:33` записывает press/release между samples, включая короткий tap; reset очищает keys/pending и initial aim. `src/main.js:48` вызывает полный reset для lifecycle, pause/blur использует release-preserving clear. Tests покрывают tap, aliases/repeat, pause release и restart после charge. |
| Important 5: brick melee occlusion | ADDRESSED | `src/mods/bootstrap.js:18` добавляет obstacle-aware lineOfSight; Fighter применяет его к attack и rush. Regression использует точные позиции исходного corner finding: blocked HP=120, unobstructed HP=105. Этого достаточно для Task 1, полный raycast остаётся Task 2. |
| Minor: owner/package attribution | ADDRESSED | `src/engine/world.js:136` оборачивает apply failures в manifest id + owner; cumulative runtime failure также сохраняет участника. Foreign-patch и malformed-effect assertions требуют attribution. |
| Minor: blur/disposal evidence | ADDRESSED | Browser smoke удерживает KeyD до проверки неподвижности после blur/resume. Foreign-patch test теперь вызывает ошибку из guest через step, проверяет world.error и закрытие обоих runtime до ручного cleanup, затем fresh match. |

## Evidence и границы

Прочитаны fix report, исходные findings, затронутые runtime/bootstrap/world/input/main/Fighter и соответствующие input/mod/browser tests. Git diff не требовался: mapping файлов взят из fix report. Изменения implementation в рамках review не выполнялись.

По отчёту исполнителя: **19/19 tests PASS, build PASS, Chromium smoke PASS**, включая два recovery cases и усиленный blur. Suite и browser повторно не запускались; вывод основан на независимой проверке кода и содержимого regression assertions, а не на выдаче чужих прогонов за собственные. Исходный timeout/death порядок не изменён исправлениями. Новые возможности Task 2/3 и полный adversarial/security audit вне этого re-review. Ручной бой двух людей по-прежнему остаётся отдельной проверкой.
