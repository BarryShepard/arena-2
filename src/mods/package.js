export const PACKAGE_LIMIT = 16 * 1024 * 1024;
export function safePath(path) {
  return (
    typeof path === "string" &&
    /^[a-zA-Z0-9_./-]+$/.test(path) &&
    !path.startsWith("/") &&
    !path.split("/").some((p) => p === ".." || p === "." || !p)
  );
}
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// Every shape check precedes the property reads that depend on it, so a
// malformed manifest yields a readable Error rather than a TypeError.
export function validateManifest(m) {
  const positive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (
    !isObject(m) ||
    m.apiVersion !== 1 ||
    typeof m.id !== "string" ||
    !/^[-a-z0-9_]+$/.test(m.id) ||
    typeof m.name !== "string" ||
    m.name.length > 80 ||
    !safePath(m.entry)
  )
    throw Error("Invalid manifest identity/API/entry");
  if (
    !Array.isArray(m.abilities) ||
    m.abilities.length !== 4 ||
    m.abilities.some(
      (a) => !isObject(a) || typeof a.label !== "string" || a.label.length > 40,
    )
  )
    throw Error("Exactly four labelled ability slots required");
  if (
    !isObject(m.body) ||
    !["radius", "maxHp", "moveSpeed"].every((k) => positive(m.body[k])) ||
    m.body.radius > 100
  )
    throw Error("Invalid body dimensions/HP/speed");
  if (
    !isObject(m.appearance) ||
    !positive(m.appearance.width) ||
    !positive(m.appearance.height)
  )
    throw Error("Invalid appearance");
  if (!isObject(m.assets) || Object.keys(m.assets).length > 128)
    throw Error("Invalid assets");
  for (const [key, a] of Object.entries(m.assets)) {
    if (!isObject(a)) throw Error("Invalid asset entry " + key);
    if (!safePath(a.path) || !["sprite", "sound"].includes(a.type))
      throw Error("Invalid asset path/type");
    if (
      a.type === "sprite" &&
      (!a.path.endsWith(".png") ||
        !["frameWidth", "frameHeight", "frames", "fps"].every((k) =>
          positive(a[k]),
        ) ||
        !["frameWidth", "frameHeight", "frames"].every((k) =>
          Number.isInteger(a[k]),
        ))
    )
      throw Error("Invalid PNG sheet");
    if (a.type === "sound" && !a.path.endsWith(".wav"))
      throw Error("Invalid WAV");
  }
  if (
    typeof m.appearance.sprite !== "string" ||
    !Object.hasOwn(m.assets, m.appearance.sprite) ||
    m.assets[m.appearance.sprite].type !== "sprite"
  )
    throw Error("Missing appearance sprite");
  return m;
}
export async function loadPackage(id) {
  const r = await fetch("api/characters/" + encodeURIComponent(id) + ".json", {
    cache: "no-store",
  });
  if (!r.ok) throw Error(await r.text());
  const text = await r.text();
  if (text.length > PACKAGE_LIMIT * 2)
    throw Error("Package response too large");
  const p = JSON.parse(text);
  validateManifest(p.manifest);
  if (
    typeof p.code !== "string" ||
    new TextEncoder().encode(p.code).length > 256 * 1024
  )
    throw Error("Script too large");
  return p;
}
