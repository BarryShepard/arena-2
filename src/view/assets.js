// Asset tables are keyed by mod-chosen strings, so they are prototype-less and
// read through own-property checks: 'constructor'/'__proto__' never resolve.
const table = () => Object.create(null);
const own = (t, key) =>
  t && typeof key === "string" && Object.hasOwn(t, key) ? t[key] : undefined;
export class Assets {
  constructor() {
    this.images = table();
    this.buffers = table();
    this.audio = null;
    this.sources = new Set();
  }
  async unlock() {
    this.audio = new AudioContext();
    await this.audio.resume();
  }
  async load(packages) {
    for (let i = 0; i < packages.length; i++) {
      const p = packages[i],
        owner = i + 1;
      this.images[owner] = table();
      this.buffers[owner] = table();
      for (const [key, spec] of Object.entries(p.manifest.assets)) {
        const url = own(p.assets, key);
        if (typeof url !== "string") throw Error("Missing asset " + key);
        if (spec.type === "sprite") {
          const img = new Image();
          img.src = url;
          await img.decode();
          if (
            img.width < spec.frameWidth * spec.frames ||
            img.height < spec.frameHeight
          )
            throw Error("PNG sheet dimensions mismatch: " + key);
          this.images[owner][key] = { img, spec };
        } else {
          const data = await (await fetch(url)).arrayBuffer();
          this.buffers[owner][key] = await this.audio.decodeAudioData(data);
        }
      }
    }
  }
  play(events) {
    if (!this.audio) return;
    for (const e of events) {
      const buffer = own(own(this.buffers, String(e.ownerId)), e.asset);
      if (!buffer) continue;
      const source = this.audio.createBufferSource(),
        gain = this.audio.createGain();
      gain.gain.value = 0.16 * (e.volume ?? 1);
      source.buffer = buffer;
      source.connect(gain).connect(this.audio.destination);
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      source.start();
    }
  }
  dispose() {
    for (const s of this.sources) s.stop();
    this.sources.clear();
    this.audio?.close();
    this.audio = null;
    this.images = table();
    this.buffers = table();
  }
}
