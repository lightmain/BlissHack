import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { arch } from "node:process";
import { promisify } from "node:util";
import { extractFile, listPackage } from "@electron/asar";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { afterEach, describe, expect, it } from "vitest";
import forgeConfig from "../forge.config.mjs";

const frontendRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(frontendRoot, "..");
const packageJsonPath = join(frontendRoot, "package.json");
const noticesPath = join(
  frontendRoot,
  "electron",
  "THIRD_PARTY_NOTICES.md",
);
const licensePath = join(repositoryRoot, "dat", "license");
const execFileAsync = promisify(execFile);
const temporaryDirectories = [];
const strictPackageVerification =
  process.env.npm_lifecycle_event === "desktop:verify-package";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("desktop packaging contract", () => {
  it("keeps the Electron entry point, version and Forge hardening stable", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    expect(packageJson).toMatchObject({
      main: "electron/main.mjs",
      version: "0.2.5-alpha.0",
    });
    expect(forgeConfig.packagerConfig).toMatchObject({
      appBundleId: "org.blisshack.desktop",
      asar: true,
      osxSign: { identity: "-" },
    });
    expect(forgeConfig.hooks?.postPackage).toBeTypeOf("function");

    const fusePlugin = forgeConfig.plugins.find(
      (plugin) => plugin.name === "fuses",
    );
    expect(fusePlugin?.fusesConfig).toMatchObject({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });

    const zipMaker = forgeConfig.makers.find(
      ({ name }) => name === "@electron-forge/maker-zip",
    );
    const squirrelMaker = forgeConfig.makers.find(
      ({ name }) => name === "@electron-forge/maker-squirrel",
    );
    expect(zipMaker?.platforms).toEqual(["darwin", "win32"]);
    expect(squirrelMaker).toMatchObject({
      platforms: ["win32"],
      config: { noMsi: true },
    });
  });

  it("ships valid source icons for macOS, Windows and BrowserWindow", async () => {
    const assetRoot = join(frontendRoot, "electron", "assets");
    const [png, ico, icns] = await Promise.all([
      readFile(join(assetRoot, "icon.png")),
      readFile(join(assetRoot, "icon.ico")),
      readFile(join(assetRoot, "icon.icns")),
    ]);

    expect(png.byteLength).toBeGreaterThan(16 * 1024);
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(512);
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(512);

    expect(ico.byteLength).toBeGreaterThan(4 * 1024);
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(ico.readUInt16LE(4)).toBeGreaterThan(0);
    expect(ico.byteLength).toBeGreaterThanOrEqual(
      6 + ico.readUInt16LE(4) * 16,
    );

    expect(icns.byteLength).toBeGreaterThan(16 * 1024);
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.byteLength);
  });

  it("keeps source and license notices external to ASAR", async () => {
    const [packageJson, notices, license] = await Promise.all([
      readFile(packageJsonPath, "utf8").then(JSON.parse),
      readFile(noticesPath, "utf8"),
      readFile(licensePath, "utf8"),
    ]);
    const sourceUrl = new URL(packageJson.homepage);
    const resources = forgeConfig.packagerConfig.extraResource.map(
      (path) => resolve(path),
    );

    expect(sourceUrl.protocol).toBe("https:");
    expect(sourceUrl.hostname).toBe("github.com");
    expect(sourceUrl.pathname.replace(/\/$/, "")).toBe(
      "/lightmain/BlissHack",
    );
    expect(notices).toContain(packageJson.homepage);
    expect(notices).toMatch(/bundled beside this file as `license`/);
    expect(license).toMatch(/NETHACK GENERAL PUBLIC LICENSE/i);
    expect(resources).toContain(resolve(licensePath));
    expect(resources).toContain(resolve(noticesPath));
  });

  it("declares licenses for every bundled renderer dependency", async () => {
    const notices = await readFile(noticesPath, "utf8");

    expect.soft(notices).toMatch(
      /React(?:\.js)?[^\n]*\bMIT(?: License)?\b/i,
    );
    expect.soft(notices).toMatch(
      /React[\s-]?DOM[^\n]*\bMIT(?: License)?\b/i,
    );
    expect.soft(notices).toMatch(
      /Scheduler[^\n]*\bMIT(?: License)?\b/i,
    );
    expect.soft(notices).toMatch(/Lucide[^\n]*\bISC(?: License)?\b/i);
    expect.soft(notices).toMatch(/Feather[^\n]*\bMIT(?: License)?\b/i);
  });

  it("builds DMGs with macOS tools instead of a third-party maker", async () => {
    const script = await readFile(
      join(frontendRoot, "electron", "scripts", "create-dmg.mjs"),
      "utf8",
    );
    const imports = [...script.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => match[1]);

    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((specifier) => specifier.startsWith("node:"))).toBe(
      true,
    );
    expect(script).toContain('execFileAsync("hdiutil"');
    expect(script).not.toMatch(
      /@electron-forge\/maker-dmg|electron-installer-dmg|appdmg/,
    );
  });

  it("provides a separately runnable strict package verification entry", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    expect(packageJson.scripts?.["desktop:verify-package"]).toBe(
      "vitest run electron/packaging-contract.test.mjs",
    );
  });

  it("pins the Vite base to root for every desktop build command", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    const scripts = packageJson.scripts ?? {};
    const desktopBuildCommands = [
      ...(scripts["desktop:build"] ? ["desktop:build"] : []),
      "desktop:start",
      "desktop:package",
      "desktop:package:mac",
      "desktop:package:win",
      "desktop:make",
      "desktop:make:mac",
      "desktop:make:win",
      "test:desktop",
    ];
    const unpinnedCommands = desktopBuildCommands.filter(
      (command) => !resolvesToRootBaseBuild(command, scripts),
    );

    expect(
      unpinnedCommands,
      "desktop commands must build with a Vite CLI base of /",
    ).toEqual([]);
  });

  it("fails strict package discovery when Forge output is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "blisshack-no-package-"));
    temporaryDirectories.push(root);

    await expect(findPackagedResources(join(root, "out"))).rejects.toThrow(
      /no packaged BlissHack application/i,
    );
  });

  it.runIf(strictPackageVerification)(
    "keeps packaged application code minimal and notices external",
    async () => {
      const packagedResources = await findPackagedResources();

      for (const resources of packagedResources) {
        const asarPath = join(resources, "app.asar");
        const entries = listPackage(asarPath);
        const allowedElectronEntries = new Set([
          "/electron",
          "/electron/assets",
          "/electron/assets/icon.png",
          "/electron/desktop-contract.mjs",
          "/electron/main.mjs",
          "/electron/preload.cjs",
        ]);

        expect(entries).toContain("/dist/index.html");
        expect(entries).toContain("/electron/main.mjs");
        expect(entries).toContain("/package.json");
        expect(
          entries.every((entry) =>
            entry === "/package.json"
            || entry === "/dist"
            || entry.startsWith("/dist/")
            || allowedElectronEntries.has(entry)
          ),
          `Unexpected app.asar content in ${asarPath}`,
        ).toBe(true);
        expect(entries.some((entry) => entry.startsWith("/node_modules"))).toBe(
          false,
        );
        expect(entries.some((entry) => entry.startsWith("/src"))).toBe(false);

        const packagedJson = JSON.parse(
          extractFile(asarPath, "package.json").toString("utf8"),
        );
        expect(packagedJson).toMatchObject({
          main: "electron/main.mjs",
          version: "0.2.5-alpha.0",
        });
        await expect(
          access(join(resources, "license")),
        ).resolves.toBeUndefined();
        await expect(
          access(join(resources, "THIRD_PARTY_NOTICES.md")),
        ).resolves.toBeUndefined();
      }
    },
  );

  it.runIf(strictPackageVerification && process.platform === "darwin")(
    "ships Electron licenses in the final macOS ZIP and DMG",
    async () => {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      const makeRoot = join(frontendRoot, "out", "make");
      const zipPath = join(
        makeRoot,
        "zip",
        "darwin",
        arch,
        `BlissHack-darwin-${arch}-${packageJson.version}.zip`,
      );
      const dmgPath = join(
        makeRoot,
        `BlissHack-alpha-2.5-darwin-${arch}.dmg`,
      );
      const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath]);
      const zipEntries = stdout.split("\n").filter(Boolean);
      const mountPoint = await mkdtemp(join(
        tmpdir(),
        "blisshack-dmg-license-",
      ));
      temporaryDirectories.push(mountPoint);

      expect.soft(zipEntries).toContain("LICENSE");
      expect.soft(zipEntries).toContain("LICENSES.chromium.html");

      await execFileAsync("/usr/bin/hdiutil", [
        "attach",
        "-readonly",
        "-nobrowse",
        "-mountpoint",
        mountPoint,
        dmgPath,
      ]);
      try {
        const dmgEntries = await readdir(mountPoint);
        expect.soft(dmgEntries).toContain("LICENSE");
        expect.soft(dmgEntries).toContain("LICENSES.chromium.html");
      } finally {
        await execFileAsync("/usr/bin/hdiutil", ["detach", mountPoint]);
      }
    },
  );
});

/** Locate Forge package resource directories without inspecting make output. */
async function findPackagedResources(
  out = join(frontendRoot, "out"),
) {
  try {
    const packageDirectories = await readdir(out, { withFileTypes: true });
    const resources = [];
    for (const entry of packageDirectories) {
      if (!entry.isDirectory() || !/^BlissHack-(?:darwin|win32)-/.test(
        entry.name,
      )) {
        continue;
      }
      const packageRoot = join(out, entry.name);
      if (entry.name.startsWith("BlissHack-darwin-")) {
        const app = (await readdir(packageRoot, { withFileTypes: true }))
          .find((candidate) =>
            candidate.isDirectory() && candidate.name.endsWith(".app")
          );
        if (app) {
          resources.push(join(packageRoot, app.name, "Contents", "Resources"));
        }
      } else {
        resources.push(join(packageRoot, "resources"));
      }
    }
    for (const directory of resources) {
      const metadata = await stat(join(directory, "app.asar"));
      expect(metadata.isFile(), basename(directory)).toBe(true);
    }
    if (resources.length === 0) {
      throw new Error(`No packaged BlissHack application found in ${out}`);
    }
    return resources;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`No packaged BlissHack application found in ${out}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/** Follow npm build aliases and require an explicit root Vite CLI override. */
function resolvesToRootBaseBuild(command, scripts, visited = new Set()) {
  if (visited.has(command)) return false;
  const script = scripts[command];
  if (typeof script !== "string") return false;

  const buildSegment = script.split("&&", 1)[0].trim();
  if (
    /^npm run build -- (?:--base(?:=|\s+)\/)(?:\s|$)/.test(buildSegment)
  ) {
    return true;
  }

  const alias = /^npm run ([\w:-]+)$/.exec(buildSegment)?.[1];
  return alias
    ? resolvesToRootBaseBuild(alias, scripts, new Set([...visited, command]))
    : false;
}
