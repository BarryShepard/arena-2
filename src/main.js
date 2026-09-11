import "./style.css";
import { Input, defaultBindings } from "./engine/input.js";
import { createWorld } from "./engine/world.js";
import { arenaMap } from "./engine/map.js";
import { loadPackage } from "./mods/package.js";
import { createRuntime } from "./mods/runtime.js";
import { Assets } from "./view/assets.js";
import { render } from "./view/renderer.js";
const $ = (s) => document.querySelector(s),
  canvas = $("canvas"),
  ctx = canvas.getContext("2d");
let bindings = defaultBindings;
try {
  const custom = JSON.parse(localStorage.getItem("arena.bindings"));
  if (custom) {
    if (
      custom.length !== 2 ||
      custom.some(
        (b) =>
          b.move.length !== 4 ||
          b.slots.length !== 4 ||
          b.slots.some((s) => !Array.isArray(s) || !s.length),
      )
    )
      throw Error("Expected 2 players with 4 move and 4 slot bindings");
    bindings = custom;
  }
} catch (e) {
  showError("Bindings: " + e.message);
}
const input = new Input(bindings);
let world = null,
  assets = null,
  paused = false,
  busy = false,
  acc = 0,
  last = 0,
  selected = [],
  manifests = [null, null];
function showError(message) {
  $("#error").hidden = !message;
  $("#error").textContent = message ?? "";
}
function dispose() {
  world?.dispose();
  assets?.dispose();
  world = null;
  assets = null;
  manifests = [null, null];
  input.reset();
  acc = 0;
}
async function reload() {
  try {
    showError("");
    const r = await fetch("api/characters/index.json", { cache: "no-store" });
    if (!r.ok) throw Error(await r.text());
    const ids = await r.json();
    for (const sel of [$("#p1"), $("#p2")]) {
      const old = sel.value;
      sel.replaceChildren(
        ...ids.map((id) => {
          const o = document.createElement("option");
          o.value = id;
          o.textContent = id;
          return o;
        }),
      );
      if (ids.includes(old)) sel.value = old;
    }
    $("#start").disabled = !ids.length;
  } catch (e) {
    showError(e.message);
  }
}
async function start(restart = false) {
  if (busy) return;
  busy = true;
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  dispose();
  showError("");
  try {
    assets = new Assets();
    await assets.unlock();
    selected = restart ? selected : [$("#p1").value, $("#p2").value];
    const packages = await Promise.all(selected.map(loadPackage));
    manifests = packages.map((p) => p.manifest);
    await assets.load(packages);
    world = createWorld({
      width: 480,
      height: 270,
      duration: 180,
      obstacles: arenaMap,
    });
    for (let i = 0; i < 2; i++) {
      const runtime = await createRuntime(packages[i], i + 1);
      try {
        world.addPlayer(runtime, {
          x: i ? 400 : 80,
          y: 135,
          angle: i ? Math.PI : 0,
        });
      } catch (e) {
        runtime.dispose();
        throw e;
      }
    }
    paused = false;
    $("#pause").textContent = "Pause";
    $("#selection").hidden = true;
    $("#game").hidden = false;
    last = performance.now();
    updateUI();
  } catch (e) {
    dispose();
    $("#selection").hidden = false;
    $("#game").hidden = true;
    showError(e.message);
  } finally {
    busy = false;
    for (const b of document.querySelectorAll("button")) b.disabled = false;
  }
}
function pause(value = !paused) {
  if (!world) return;
  paused = value;
  input.clear();
  acc = 0;
  $("#pause").textContent = paused ? "Resume" : "Pause";
  updateUI();
}
function updateUI() {
  if (!world) return;
  const s = world.snapshot();
  try {
    render(ctx, s, assets);
  } catch (e) {
    world.fail(Error("Render: " + e.message));
    s.error = world.error;
    showError(s.error);
  }
  const seconds = Math.ceil(s.remaining);
  $("#clock").textContent =
    Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  $("#overlay").hidden = !paused && !s.result && !s.error;
  $("#overlay").textContent = s.error
    ? "MOD ERROR"
    : s.result
      ? (s.result === "draw" ? "DRAW" : s.result + " WINS") +
        "\nRestart to fight again"
      : paused
        ? "PAUSED"
        : "";
  if (s.error) showError(s.error);
  $("#hud").replaceChildren(
    ...[1, 2].map((owner) => {
      const group = document.createElement("div");
      group.className = "slots p" + owner;
      (s.slots[owner] ?? []).forEach((slot, i) => {
        const el = document.createElement("div");
        el.className = "slot" + (slot.active ? " active" : "");
        el.dataset.owner = owner;
        el.dataset.slot = i;
        const description = manifests[owner - 1]?.abilities?.[i]?.description;
        if (description) el.dataset.tip = description;
        const label = document.createElement("span");
        label.textContent = slot.label;
        const status = document.createElement("small");
        status.textContent =
          slot.cooldown > 0 ? slot.cooldown.toFixed(1) + "s" : "READY";
        el.append(label, status);
        group.append(el);
      });
      return group;
    }),
  );
}
function frame(now) {
  try {
    if (world && !paused && !busy && !world.result && !world.error) {
      acc += Math.min((now - last) / 1000, 5 / 60);
      let steps = 0;
      while (acc >= 1 / 60 && steps++ < 5) {
        world.step(1 / 60, input.sample());
        assets.play(world.sounds);
        acc -= 1 / 60;
      }
      updateUI();
    }
  } catch (e) {
    world?.fail(Error("Frame: " + e.message));
    showError(world?.error ?? e.message);
  } finally {
    last = now;
    requestAnimationFrame(frame);
  }
}
$("#start").onclick = () => start();
$("#restart").onclick = () => start(true);
$("#reload").onclick = reload;
$("#pause").onclick = () => pause();
$("#back").onclick = () => {
  dispose();
  $("#game").hidden = true;
  $("#selection").hidden = false;
  showError("");
};
const codes = new Set(bindings.flatMap((b) => [...b.move, ...b.slots.flat()]));
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && !e.repeat) pause();
  if (codes.has(e.code) && world) {
    e.preventDefault();
    if (!paused && !e.repeat) input.key(e.code, true);
  }
});
window.addEventListener("keyup", (e) => input.key(e.code, false));
let mouseSlotCode = null;
$("#hud").addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".slot");
  if (!el || !world || paused) return;
  const code = bindings[el.dataset.owner - 1]?.slots[el.dataset.slot]?.[0];
  if (!code) return;
  e.preventDefault();
  mouseSlotCode = code;
  input.key(code, true);
});
function releaseMouseSlot() {
  if (!mouseSlotCode) return;
  input.key(mouseSlotCode, false);
  mouseSlotCode = null;
}
window.addEventListener("pointerup", releaseMouseSlot);
window.addEventListener("pointercancel", releaseMouseSlot);
window.addEventListener("blur", () => pause(true));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause(true);
});
// Read-only test/diagnostic snapshot; no host capability is passed into a mod.
window.arenaSnapshot = () => world?.snapshot() ?? null;
await reload();
requestAnimationFrame(frame);
