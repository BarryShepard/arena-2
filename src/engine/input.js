export const defaultBindings = [
  {
    move: ["KeyW", "KeyS", "KeyA", "KeyD"],
    slots: [["KeyF"], ["KeyG"], ["KeyH"], ["KeyJ"]],
  },
  {
    move: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    slots: [
      ["Numpad1", "KeyI"],
      ["Numpad2", "KeyO"],
      ["Numpad3", "KeyP"],
      ["Numpad0", "BracketLeft"],
    ],
  },
];
export class Input {
  constructor(bindings = defaultBindings) {
    this.bindings = bindings;
    this.reset();
  }
  reset() {
    this.keys = new Set();
    this.pending = this.bindings.map((b) =>
      b.slots.map(() => ({ pressed: false, released: false })),
    );
    this.aim = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
    ];
  }
  key(code, down) {
    if (this.keys.has(code) === down) return;
    const before = this.bindings.map((b) =>
      b.slots.map((codes) => codes.some((c) => this.keys.has(c))),
    );
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    this.bindings.forEach((b, p) =>
      b.slots.forEach((codes, s) => {
        const held = codes.some((c) => this.keys.has(c));
        if (held && !before[p][s]) this.pending[p][s].pressed = true;
        if (!held && before[p][s]) this.pending[p][s].released = true;
      }),
    );
  }
  clear() {
    // Pausing releases active slots without discarding charge/release edges.
    for (const code of [...this.keys]) this.key(code, false);
  }
  sample() {
    return this.bindings.map((b, p) => {
      const last = [...this.keys].filter((c) => b.move.includes(c)).at(-1);
      let x = last === b.move[3] ? 1 : last === b.move[2] ? -1 : 0,
        y = last === b.move[1] ? 1 : last === b.move[0] ? -1 : 0;
      if (x || y) this.aim[p] = { x, y };
      const slots = b.slots.map((codes, s) => {
        const held = codes.some((c) => this.keys.has(c));
        const edges = this.pending[p][s];
        this.pending[p][s] = { pressed: false, released: false };
        return { held, ...edges };
      });
      return { move: { x, y }, aim: this.aim[p], slots };
    });
  }
}
export const emptyInput = () => ({
  move: { x: 0, y: 0 },
  aim: { x: 1, y: 0 },
  slots: Array.from({ length: 4 }, () => ({
    held: false,
    pressed: false,
    released: false,
  })),
});
