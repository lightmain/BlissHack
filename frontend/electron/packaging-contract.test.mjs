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
import { basename, dirname, join, resolve } from "node:path";
import { arch } from "node:process";
import { promisify } from "node:util";
import { extractFile, listPackage } from "@electron/asar";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { PNG } from "pngjs";
import { SaxesParser } from "saxes";
import { afterEach, describe, expect, it } from "vitest";
import forgeConfig from "../forge.config.mjs";

const frontendRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(frontendRoot, "..");
const packageJsonPath = join(frontendRoot, "package.json");
const faviconPath = join(frontendRoot, "public", "favicon.svg");
const iconAssetRoot = join(frontendRoot, "electron", "assets");
const iconGeneratorPath = join(
  frontendRoot,
  "electron",
  "scripts",
  "generate-icons.mjs",
);
const noticesPath = join(
  frontendRoot,
  "electron",
  "THIRD_PARTY_NOTICES.md",
);
const licensePath = join(repositoryRoot, "dat", "license");
const execFileAsync = promisify(execFile);
const temporaryDirectories = [];
const dmgMountPoints = new Set();
const strictPackageVerification =
  process.env.npm_lifecycle_event === "desktop:verify-package";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(cleanupTemporaryDirectory),
  );
}, 45_000);

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

  it("uses one accessible high-contrast dungeon @ SVG as the icon authority", async () => {
    const [indexHtml, svg, desktopAssetNames] = await Promise.all([
      readFile(join(frontendRoot, "index.html"), "utf8"),
      readFile(faviconPath, "utf8"),
      readdir(iconAssetRoot),
    ]);
    const document = parseSvg(svg);
    const root = document.elements[0];
    const title = document.elements.find((element) =>
      element.name === "title"
    );
    const glyphs = document.elements.filter(
      (element) => element.attributes["data-glyph"] === "@",
    );
    const forbiddenEffects = document.elements.filter((element) =>
      [
        "filter",
        "image",
        "linearGradient",
        "mask",
        "radialGradient",
        "script",
      ].includes(element.name)
    );
    const drawableElements = document.elements.filter((element) =>
      ["circle", "ellipse", "path", "polygon", "rect", "text"].includes(
        element.name,
      )
    );
    const viewBox = parseViewBox(root?.attributes.viewBox);
    const background = viewBox
      ? drawableElements.find((element) =>
        element.name === "rect"
        && numberAttribute(element, "x", 0) === viewBox.x
        && numberAttribute(element, "y", 0) === viewBox.y
        && numberAttribute(element, "width") === viewBox.width
        && numberAttribute(element, "height") === viewBox.height
      )
      : undefined;

    expect(indexHtml).toMatch(
      /<link\s+rel=["']icon["'][^>]*href=["']\/favicon\.svg["'][^>]*>/,
    );
    expect(
      desktopAssetNames.filter((name) => name.endsWith(".svg")),
      "public/favicon.svg is the sole SVG authority; desktop assets are generated",
    ).toEqual([]);
    expect(root?.name).toBe("svg");
    expect.soft(viewBox?.width).toBeGreaterThan(0);
    expect.soft(viewBox?.width).toBe(viewBox?.height);
    expect.soft(root?.attributes.role).toBe("img");
    expect.soft(title, "the icon needs an accessible SVG title").toBeDefined();
    expect.soft(title?.attributes.id).toBeTruthy();
    expect.soft(
      root?.attributes["aria-labelledby"]?.split(/\s+/) ?? [],
    ).toContain(title?.attributes.id ?? "__missing-title-id__");
    expect.soft(title?.text ?? "").toMatch(/blisshack/i);
    expect.soft(title?.text ?? "").toContain("@");
    expect.soft(glyphs, "the visible player glyph needs data-glyph=\"@\"")
      .toHaveLength(1);
    expect.soft(background, "the SVG needs one full-viewBox square background")
      .toBeDefined();
    expect.soft(
      forbiddenEffects.length,
      "the small icon must not use Vite-style effects",
    ).toBe(0);
    expect.soft(drawableElements.length).toBeLessThanOrEqual(6);

    if (!background || glyphs.length !== 1) return;
    const backgroundColor = parseHexColor(background.attributes.fill);
    const foregroundColor = parseHexColor(glyphs[0].attributes.fill);
    expect(backgroundColor, "background fill must be a solid hex color")
      .not.toBeNull();
    expect(foregroundColor, "@ fill must be a solid hex color").not.toBeNull();
    if (!backgroundColor || !foregroundColor) return;

    expect(contrastRatio(backgroundColor, foregroundColor))
      .toBeGreaterThanOrEqual(7);
  });

  it("checks generated icons against the authoritative SVG before builds", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    const scripts = packageJson.scripts ?? {};
    let generatorExists = true;
    try {
      await access(iconGeneratorPath);
    } catch {
      generatorExists = false;
    }

    expect.soft(scripts["generate:icons"]).toBe(
      "node electron/scripts/generate-icons.mjs",
    );
    expect.soft(scripts["verify:icons"]).toBe(
      "node electron/scripts/generate-icons.mjs --check",
    );
    expect.soft(scripts.prebuild?.split(" && ")).toContain(
      "npm run verify:icons",
    );
    expect(
      generatorExists,
      "electron/scripts/generate-icons.mjs is the required generation chain",
    ).toBe(true);
    if (!generatorExists) return;

    await expect(
      execFileAsync(process.execPath, [iconGeneratorPath, "--check"], {
        cwd: frontendRoot,
      }),
    ).resolves.toBeDefined();
  });

  it("ships structurally valid PNG, ICO and ICNS icon containers", async () => {
    const [png, ico, icns] = await Promise.all([
      readFile(join(iconAssetRoot, "icon.png")),
      readFile(join(iconAssetRoot, "icon.ico")),
      readFile(join(iconAssetRoot, "icon.icns")),
    ]);
    const decodedPng = decodePng(png, "icon.png");
    const icoEntries = parseIco(ico);
    const icnsEntries = parseIcns(icns);

    expect(decodedPng.width).toBe(decodedPng.height);
    expect(decodedPng.width).toBeGreaterThanOrEqual(1024);
    expect.soft(
      [...new Set(icoEntries.map((entry) => entry.width))],
      "Windows output needs explicit small and large icon frames",
    ).toEqual(expect.arrayContaining([16, 32, 256]));
    expect.soft(
      [...new Set(icnsEntries.map((entry) => entry.pixelSize).filter(Boolean))],
      "macOS output needs small, medium and 1024px representations",
    ).toEqual(expect.arrayContaining([16, 32, 128, 256, 512, 1024]));
  });

  it.each([16, 32])(
    "keeps background and @ pixels distinct after PNG scaling to %ipx",
    async (targetSize) => {
      const png = decodePng(
        await readFile(join(iconAssetRoot, "icon.png")),
        "icon.png",
      );
      const pixels = downscalePng(png, targetSize);
      const opaquePixels = pixels.filter((pixel) => pixel[3] >= 192);
      const contrastingPair = findContrastingPalettePair(
        opaquePixels,
        targetSize * targetSize,
      );

      expect.soft(opaquePixels.length, "the square must remain visibly non-empty")
        .toBeGreaterThan(0);
      expect(
        contrastingPair?.ratio ?? 0,
        "scaled pixels must retain prominent background and foreground colors",
      ).toBeGreaterThanOrEqual(7);
    },
  );

  it("keeps the PNG palette aligned with the SVG background and @ colors", async () => {
    const [svg, pngBytes] = await Promise.all([
      readFile(faviconPath, "utf8"),
      readFile(join(iconAssetRoot, "icon.png")),
    ]);
    const document = parseSvg(svg);
    const root = document.elements[0];
    const viewBox = parseViewBox(root?.attributes.viewBox);
    const background = viewBox
      ? document.elements.find((element) =>
        element.name === "rect"
        && numberAttribute(element, "x", 0) === viewBox.x
        && numberAttribute(element, "y", 0) === viewBox.y
        && numberAttribute(element, "width") === viewBox.width
        && numberAttribute(element, "height") === viewBox.height
      )
      : undefined;
    const glyph = document.elements.find(
      (element) => element.attributes["data-glyph"] === "@",
    );
    const expectedPalette = [
      parseHexColor(background?.attributes.fill),
      parseHexColor(glyph?.attributes.fill),
    ];

    expect(
      expectedPalette.every(Boolean),
      "the SVG must expose solid source colors for generated-output checks",
    ).toBe(true);
    if (!expectedPalette.every(Boolean)) return;

    const pixels = downscalePng(decodePng(pngBytes, "icon.png"), 32);
    for (const [index, color] of expectedPalette.entries()) {
      const matchingPixels = pixels.filter((pixel) =>
        pixel[3] >= 192 && colorDistance(pixel, color) <= 48
      );
      const minimumCoverage = index === 0 ? 0.25 : 0.03;
      expect(
        matchingPixels.length,
        index === 0
          ? "generated PNG must retain the SVG background"
          : "generated PNG must retain a visible SVG @ foreground",
      ).toBeGreaterThanOrEqual(Math.ceil(pixels.length * minimumCoverage));
    }
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

  it("builds a fresh macOS package before creating a DMG", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    expect(packageJson.scripts?.["desktop:dmg"]).toBe(
      "npm run desktop:package:mac && node electron/scripts/create-dmg.mjs",
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
      const checkedInIcon = await readFile(
        join(iconAssetRoot, "icon.png"),
      );

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
        const packagedIcon = extractFile(
          asarPath,
          "electron/assets/icon.png",
        );
        expect(
          packagedIcon.equals(checkedInIcon),
          `Packaged icon is stale in ${asarPath}: packaged ${
            packagedIcon.byteLength
          } bytes, checked-in ${checkedInIcon.byteLength} bytes`,
        ).toBe(true);
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
      const { stdout } = await execFileAsync(
        "unzip",
        ["-Z1", zipPath],
        { timeout: 15_000 },
      );
      const zipEntries = stdout.split("\n").filter(Boolean);
      const mountPoint = await mkdtemp(join(
        tmpdir(),
        "blisshack-dmg-license-",
      ));
      temporaryDirectories.push(mountPoint);
      dmgMountPoints.add(mountPoint);

      expect.soft(zipEntries).toContain("LICENSE");
      expect.soft(zipEntries).toContain("LICENSES.chromium.html");

      try {
        await execFileAsync("/usr/bin/hdiutil", [
          "attach",
          "-readonly",
          "-nobrowse",
          "-mountpoint",
          mountPoint,
          dmgPath,
        ], { timeout: 20_000 });
        const dmgEntries = await readdir(mountPoint);
        expect.soft(dmgEntries).toContain("LICENSE");
        expect.soft(dmgEntries).toContain("LICENSES.chromium.html");
      } finally {
        await detachDmgMountPoint(mountPoint);
        dmgMountPoints.delete(mountPoint);
      }
    },
    90_000,
  );
});

/** Detach a mounted image before deleting its temporary mount directory. */
async function cleanupTemporaryDirectory(directory) {
  if (dmgMountPoints.has(directory)) {
    await detachDmgMountPoint(directory);
    dmgMountPoints.delete(directory);
  }
  await rm(directory, { recursive: true, force: true });
}

/** Detach a DMG, retrying forcefully if the normal detach leaves it mounted. */
async function detachDmgMountPoint(mountPoint) {
  if (!await isActiveMountPoint(mountPoint)) return;

  let lastError;
  for (const args of [
    ["detach", mountPoint],
    ["detach", "-force", mountPoint],
  ]) {
    try {
      await execFileAsync("/usr/bin/hdiutil", args, { timeout: 15_000 });
    } catch (error) {
      lastError = error;
    }
    if (!await isActiveMountPoint(mountPoint)) return;
  }
  throw new Error(`Unable to detach DMG mount point ${mountPoint}`, {
    cause: lastError,
  });
}

/** Distinguish an attached image from its ordinary parent filesystem. */
async function isActiveMountPoint(mountPoint) {
  try {
    const [mountMetadata, parentMetadata] = await Promise.all([
      stat(mountPoint),
      stat(dirname(mountPoint)),
    ]);
    return mountMetadata.dev !== parentMetadata.dev;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

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

/** Parse enough SVG structure to enforce the icon's semantic contract. */
function parseSvg(source) {
  const elements = [];
  const stack = [];
  const parser = new SaxesParser();
  parser.on("opentag", (node) => {
    const element = {
      name: node.name.split(":").at(-1),
      attributes: Object.fromEntries(
        Object.entries(node.attributes).map(([name, value]) => [
          name.split(":").at(-1),
          typeof value === "string" ? value : value.value,
        ]),
      ),
      text: "",
    };
    elements.push(element);
    stack.push(element);
  });
  parser.on("text", (text) => {
    if (stack.length > 0) stack.at(-1).text += text;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.write(source).close();
  return { elements };
}

/** Parse a positive square SVG viewBox. */
function parseViewBox(value) {
  if (typeof value !== "string") return null;
  const values = value.trim().split(/[\s,]+/).map(Number);
  if (
    values.length !== 4
    || values.some((entry) => !Number.isFinite(entry))
    || values[2] <= 0
    || values[3] <= 0
  ) {
    return null;
  }
  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
  };
}

/** Read one numeric SVG attribute with an optional default. */
function numberAttribute(element, name, defaultValue) {
  const value = element.attributes[name];
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Parse #RGB or #RRGGBB into an RGB tuple. */
function parseHexColor(value) {
  if (typeof value !== "string") return null;
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value);
  if (short) {
    return short.slice(1).map((component) =>
      Number.parseInt(component.repeat(2), 16)
    );
  }
  const full = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  return full
    ? full.slice(1).map((component) => Number.parseInt(component, 16))
    : null;
}

/** Calculate WCAG contrast for two RGB tuples. */
function contrastRatio(left, right) {
  const luminances = [left, right].map(relativeLuminance);
  return (
    (Math.max(...luminances) + 0.05)
    / (Math.min(...luminances) + 0.05)
  );
}

/** Calculate sRGB relative luminance. */
function relativeLuminance(color) {
  const [red, green, blue] = color.map((component) => {
    const normalized = component / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

/** Decode a PNG and attach the asset name to malformed-image errors. */
function decodePng(bytes, name) {
  try {
    return PNG.sync.read(bytes);
  } catch (error) {
    throw new Error(`${name} is not a valid PNG`, { cause: error });
  }
}

/** Parse ICO directory entries and require bounded PNG-compressed frames. */
function parseIco(bytes) {
  if (
    bytes.byteLength < 6
    || bytes.readUInt16LE(0) !== 0
    || bytes.readUInt16LE(2) !== 1
  ) {
    throw new Error("icon.ico has an invalid ICO header");
  }
  const count = bytes.readUInt16LE(4);
  const directoryEnd = 6 + count * 16;
  if (count === 0 || directoryEnd > bytes.byteLength) {
    throw new Error("icon.ico has an invalid image directory");
  }

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = bytes[entryOffset] || 256;
    const height = bytes[entryOffset + 1] || 256;
    const byteLength = bytes.readUInt32LE(entryOffset + 8);
    const imageOffset = bytes.readUInt32LE(entryOffset + 12);
    const imageEnd = imageOffset + byteLength;
    if (
      width !== height
      || byteLength === 0
      || imageOffset < directoryEnd
      || imageEnd > bytes.byteLength
    ) {
      throw new Error(`icon.ico frame ${index} is out of bounds`);
    }
    const png = decodePng(
      bytes.subarray(imageOffset, imageEnd),
      `icon.ico frame ${width}px`,
    );
    if (png.width !== width || png.height !== height) {
      throw new Error(`icon.ico frame ${width}px has mismatched dimensions`);
    }
    entries.push({ width, height });
  }
  return entries;
}

const ICNS_PIXEL_SIZES = new Map([
  ["ic04", 16],
  ["ic11", 32],
  ["ic05", 32],
  ["ic12", 64],
  ["icp6", 64],
  ["ic07", 128],
  ["ic13", 256],
  ["ic08", 256],
  ["ic14", 512],
  ["ic09", 512],
  ["ic10", 1024],
]);

/** Parse and bounds-check every top-level ICNS chunk. */
function parseIcns(bytes) {
  if (
    bytes.byteLength < 8
    || bytes.subarray(0, 4).toString("ascii") !== "icns"
    || bytes.readUInt32BE(4) !== bytes.byteLength
  ) {
    throw new Error("icon.icns has an invalid ICNS header");
  }

  const entries = [];
  const seenTypes = new Set();
  let offset = 8;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new Error("icon.icns has a truncated chunk header");
    }
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const byteLength = bytes.readUInt32BE(offset + 4);
    if (
      !/^[\x20-\x7e]{4}$/.test(type)
      || byteLength < 8
      || offset + byteLength > bytes.byteLength
      || seenTypes.has(type)
    ) {
      throw new Error(`icon.icns has an invalid ${type} chunk`);
    }
    seenTypes.add(type);
    const pixelSize = ICNS_PIXEL_SIZES.get(type);
    const payload = bytes.subarray(offset + 8, offset + byteLength);
    if (
      pixelSize
      && payload.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    ) {
      const png = decodePng(payload, `icon.icns ${type} chunk`);
      if (png.width !== pixelSize || png.height !== pixelSize) {
        throw new Error(`icon.icns ${type} chunk has mismatched dimensions`);
      }
    }
    entries.push({
      type,
      pixelSize,
    });
    offset += byteLength;
  }
  if (offset !== bytes.byteLength || entries.length === 0) {
    throw new Error("icon.icns chunk lengths do not cover the file");
  }
  return entries;
}

/** Box-filter a PNG to a small RGBA pixel array. */
function downscalePng(png, targetSize) {
  const pixels = [];
  for (let targetY = 0; targetY < targetSize; targetY += 1) {
    const sourceYStart = Math.floor(targetY * png.height / targetSize);
    const sourceYEnd = Math.floor((targetY + 1) * png.height / targetSize);
    for (let targetX = 0; targetX < targetSize; targetX += 1) {
      const sourceXStart = Math.floor(targetX * png.width / targetSize);
      const sourceXEnd = Math.floor(
        (targetX + 1) * png.width / targetSize,
      );
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let sourceY = sourceYStart; sourceY < sourceYEnd; sourceY += 1) {
        for (
          let sourceX = sourceXStart;
          sourceX < sourceXEnd;
          sourceX += 1
        ) {
          const pixelOffset = (sourceY * png.width + sourceX) * 4;
          const pixelAlpha = png.data[pixelOffset + 3];
          alpha += pixelAlpha;
          red += png.data[pixelOffset] * pixelAlpha;
          green += png.data[pixelOffset + 1] * pixelAlpha;
          blue += png.data[pixelOffset + 2] * pixelAlpha;
          count += 1;
        }
      }
      pixels.push([
        alpha === 0 ? 0 : red / alpha,
        alpha === 0 ? 0 : green / alpha,
        alpha === 0 ? 0 : blue / alpha,
        alpha / count,
      ]);
    }
  }
  return pixels;
}

/** Find two prominent quantized colors with the strongest contrast. */
function findContrastingPalettePair(pixels, totalPixelCount) {
  const buckets = new Map();
  for (const pixel of pixels) {
    const color = pixel.slice(0, 3).map((component) =>
      Math.min(255, Math.round(component / 32) * 32)
    );
    const key = color.join(",");
    const bucket = buckets.get(key) ?? { color, count: 0 };
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const minimumCount = Math.ceil(totalPixelCount * 0.02);
  const prominent = [...buckets.values()].filter(
    (bucket) => bucket.count >= minimumCount,
  );
  let best;
  for (let left = 0; left < prominent.length; left += 1) {
    for (let right = left + 1; right < prominent.length; right += 1) {
      const ratio = contrastRatio(
        prominent[left].color,
        prominent[right].color,
      );
      if (!best || ratio > best.ratio) {
        best = { left: prominent[left], right: prominent[right], ratio };
      }
    }
  }
  return best;
}

/** Calculate Euclidean RGB distance, ignoring alpha. */
function colorDistance(left, right) {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}
