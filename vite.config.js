import { defineConfig } from "vite";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  validateManifest,
  safePath,
  PACKAGE_LIMIT,
} from "./src/mods/package.js";
const root = path.resolve("characters");
async function file(base, relative) {
  if (!safePath(relative)) throw Error("Invalid package path");
  const resolved = await realpath(path.join(base, relative));
  if (!resolved.startsWith(base + path.sep))
    throw Error("Symlink escapes package");
  const info = await stat(resolved);
  if (!info.isFile() || info.size > PACKAGE_LIMIT)
    throw Error("Invalid/oversized file");
  return readFile(resolved);
}
// Roster discovery: every directory under characters/ whose name is a valid
// package id. Shared by the /api/characters middleware and the tests.
export async function listPackages() {
  return (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && /^[-a-z0-9_]+$/.test(e.name))
    .map((e) => e.name)
    .sort();
}
export async function readPackage(id) {
  if (!/^[-a-z0-9_]+$/.test(id)) throw Error("Invalid package ID");
  const base = await realpath(path.join(root, id));
  if (!base.startsWith(root + path.sep)) throw Error("Package escape");
  const manifestBytes = await file(base, "manifest.json");
  const manifest = validateManifest(JSON.parse(manifestBytes));
  if (manifest.id !== id) throw Error("ID does not match folder");
  const code = await file(base, manifest.entry);
  if (code.length > 256 * 1024) throw Error("Script exceeds 256 KiB");
  let total = manifestBytes.length + code.length;
  const assets = {};
  for (const [key, a] of Object.entries(manifest.assets)) {
    const bytes = await file(base, a.path);
    total += bytes.length;
    if (total > PACKAGE_LIMIT) throw Error("Package exceeds 16 MiB");
    if (
      a.type === "sprite" &&
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw Error("Invalid PNG");
    if (
      a.type === "sound" &&
      (bytes.toString("ascii", 0, 4) !== "RIFF" ||
        bytes.toString("ascii", 8, 12) !== "WAVE")
    )
      throw Error("Invalid WAV");
    assets[key] =
      "data:" +
      (a.type === "sprite" ? "image/png" : "audio/wav") +
      ";base64," +
      bytes.toString("base64");
  }
  return { manifest, code: code.toString("utf8"), assets };
}
export default defineConfig({
  server: { host: "127.0.0.1", fs: { strict: true } },
  plugins: [
    {
      name: "local-character-packages",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, "http://localhost");
          if (!url.pathname.startsWith("/api/characters")) return next();
          res.setHeader("Cache-Control", "no-store");
          try {
            let result;
            if (url.pathname === "/api/characters")
              result = await listPackages();
            else
              result = await readPackage(
                decodeURIComponent(
                  url.pathname.slice("/api/characters/".length),
                ),
              );
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 400;
            res.end(e.message);
          }
        });
      },
    },
  ],
});
