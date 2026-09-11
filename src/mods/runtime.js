import { getQuickJS } from "quickjs-emscripten";
import { bootstrap } from "./bootstrap.js";
// Guest error text is bounded so a hostile mod cannot fill world.error with megabytes.
const MESSAGE_MAX = 512;
export const DEFAULT_LIMITS = Object.freeze({
  memory: 16 * 1024 * 1024,
  // QuickJS checks its C stack (wasm linear memory) against this limit, but every
  // wasm call also consumes the *native* stack of the embedding JS engine. If the
  // native stack (Node/Chrome main thread ~1 MB, Safari main thread and workers
  // less) overflows first, V8 throws RangeError from inside wasm, the runtime is
  // left inconsistent and JS_FreeRuntime aborts the whole module. 512 KiB
  // reproducibly overflowed native first; 256 KiB is clean in Node, and 128 KiB
  // keeps a 2x margin for browsers with smaller main-thread stacks. Ordinary
  // character scripts never recurse deeply enough to notice.
  stack: 128 * 1024,
  tickMs: 8,
  loadMs: 50,
  entities: 256,
  timers: 256,
  effects: 256,
  commands: 1024,
  events: 1024,
  json: 1024 * 1024,
});
const clip = (text) =>
  text.length > MESSAGE_MAX ? text.slice(0, MESSAGE_MAX) + "…" : text;
// Thrown value → bounded, never-empty message: `throw undefined`/`throw Symbol()`
// dump as undefined and used to yield "<manifest.id> P1: " with no reason.
function guestMessage(error) {
  let text = error?.message;
  if (text === undefined || text === null || text === "") {
    try {
      text = JSON.stringify(error);
    } catch {
      text = undefined;
    }
  }
  text = text === undefined || text === null ? "" : String(text);
  return text ? clip(text) : "Unknown guest error";
}
export async function createRuntime(pkg, ownerId, overrides = {}) {
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...overrides });
  for (const [key, value] of Object.entries(limits))
    if (!Number.isFinite(value) || value <= 0)
      throw Error("Invalid limit " + key);
  const QuickJS = await getQuickJS(),
    runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memory);
  runtime.setMaxStackSize(limits.stack);
  let deadline = 0,
    disposed = false,
    dispatch,
    remaining = limits.tickMs,
    inBudget = false;
  runtime.setInterruptHandler(() => performance.now() > deadline);
  const vm = runtime.newContext();
  // Disposal after an aborted evaluation may itself throw (Emscripten abort in
  // JS_FreeRuntime). That must never replace the attributed guest error, so
  // dispose() swallows it and returns the text for the caller to append. Each
  // step is attempted separately: a throwing vm.dispose() must not leak the
  // runtime behind it.
  const dispose = () => {
    if (disposed) return undefined;
    disposed = true;
    let failure;
    for (const step of [
      () => dispatch?.dispose(),
      () => vm.dispose(),
      () => runtime.dispose(),
    ])
      try {
        step();
      } catch (e) {
        failure ??= clip(String(e?.message ?? e));
      }
    return failure;
  };
  const failure = (e) => {
    const disposeError = dispose();
    const message = e?.message ?? String(e);
    return Error(
      `${pkg.manifest.id} P${ownerId}: ${message}` +
        (disposeError ? ` (runtime dispose failed: ${disposeError})` : ""),
    );
  };
  const unwrap = (r) => {
    if (r.error) {
      let error;
      try {
        error = vm.dump(r.error);
      } finally {
        r.error.dispose();
      }
      throw Error(guestMessage(error));
    }
    return r.value;
  };
  function withBudget(fn) {
    if (disposed) throw Error("Runtime is closed");
    if (inBudget) return fn();
    const start = performance.now();
    deadline = start + remaining;
    inBudget = true;
    try {
      if (remaining <= 0) throw Error("CPU tick budget exceeded");
      const result = fn();
      if (performance.now() > deadline) throw Error("CPU tick budget exceeded");
      return result;
    } catch (e) {
      throw failure(e);
    } finally {
      remaining -= performance.now() - start;
      inBudget = false;
    }
  }
  try {
    if (new TextEncoder().encode(pkg.code).length > 256 * 1024)
      throw Error("Script exceeds 256 KiB");
    deadline = performance.now() + limits.loadMs;
    // Bootstrap returns a private function handle. Mod source executes separately,
    // so neither lexical bridge state nor its dispatch handle is addressable.
    dispatch = unwrap(
      vm.evalCode("(" + bootstrap + ")(" + JSON.stringify(limits) + ")"),
    );
    unwrap(vm.evalCode(pkg.code)).dispose();
    const seal = vm.newString(JSON.stringify({ kind: "seal" }));
    try {
      unwrap(vm.callFunction(dispatch, vm.undefined, seal)).dispose();
    } finally {
      seal.dispose();
    }
    if (performance.now() > deadline) throw Error("CPU load budget exceeded");
  } catch (e) {
    throw failure(e);
  }
  return {
    ownerId,
    manifest: pkg.manifest,
    limits,
    dispose,
    beginTick() {
      remaining = limits.tickMs;
    },
    withBudget,
    call(payload) {
      return withBudget(() => {
        const json = JSON.stringify({ ...payload, ownerId });
        if (json.length > limits.json)
          throw Error("Input JSON budget exceeded");
        const arg = vm.newString(json);
        let handle;
        try {
          handle = unwrap(vm.callFunction(dispatch, vm.undefined, arg));
        } finally {
          arg.dispose();
        }
        let raw;
        try {
          raw = vm.getString(handle);
        } finally {
          handle.dispose();
        }
        if (raw.length > limits.json)
          throw Error("Output JSON budget exceeded");
        const result = JSON.parse(raw);
        if (
          !Array.isArray(result.commands) ||
          result.commands.length > limits.commands
        )
          throw Error("Command budget exceeded");
        return result;
      });
    },
  };
}
