import test from "node:test";
import assert from "node:assert/strict";
import { Input } from "../src/engine/input.js";
test("four directions use last held key; repeat produces one press; release", () => {
  const i = new Input();
  i.key("KeyW", true);
  i.key("KeyD", true);
  i.key("KeyF", true);
  let p = i.sample()[0];
  assert.deepEqual(p.move, { x: 1, y: 0 });
  i.key("KeyD", false);
  assert.deepEqual(i.sample()[0].move, { x: 0, y: -1 });
  assert.equal(p.slots[0].pressed, true);
  i.key("KeyF", true);
  assert.equal(i.sample()[0].slots[0].pressed, false);
  i.key("KeyF", false);
  assert.equal(i.sample()[0].slots[0].released, true);
  i.clear();
  assert.equal(i.sample()[0].move.x, 0);
});

test("short tap preserves both slot edges between ticks", () => {
  const input = new Input();
  input.key("KeyF", true);
  input.key("KeyF", false);
  assert.deepEqual(input.sample()[0].slots[0], {
    held: false,
    pressed: true,
    released: true,
  });
  assert.deepEqual(input.sample()[0].slots[0], {
    held: false,
    pressed: false,
    released: false,
  });
});
test("alias overlap and OS repeat do not create extra press/release", () => {
  const input = new Input();
  input.key("Numpad1", true);
  assert.equal(input.sample()[1].slots[0].pressed, true);
  input.key("Numpad1", true);
  input.key("KeyI", true);
  input.key("Numpad1", false);
  assert.deepEqual(input.sample()[1].slots[0], {
    held: true,
    pressed: false,
    released: false,
  });
  input.key("KeyI", false);
  assert.equal(input.sample()[1].slots[0].released, true);
});
test("pause delivers charge release; match reset clears edges and restores facing", () => {
  const input = new Input();
  input.key("KeyA", true);
  input.key("KeyH", true);
  input.sample();
  input.clear();
  const paused = input.sample()[0];
  assert.equal(paused.slots[2].released, true);
  assert.deepEqual(paused.aim, { x: -1, y: 0 });
  input.key("KeyH", true);
  input.sample();
  input.reset();
  input.key("KeyH", true);
  const fresh = input.sample();
  assert.equal(fresh[0].slots[2].pressed, true);
  assert.deepEqual(fresh[0].aim, { x: 1, y: 0 });
  assert.deepEqual(fresh[1].aim, { x: -1, y: 0 });
});
