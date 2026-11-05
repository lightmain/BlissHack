import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  getElectronLicensePaths,
  prepareElectronRuntime,
} from "./electron/scripts/prepare-electron-runtime.mjs";

const root = import.meta.dirname;
const iconBase = resolve(root, "electron/assets/icon");
const execFileAsync = promisify(execFile);
const [electronLicensePath, chromiumLicensesPath] =
  getElectronLicensePaths();

export default {
  hooks: {
    async prePackage() {
      await prepareElectronRuntime();
    },
    async postMake(_config, makeResults) {
      for (const result of makeResults) {
        if (result.platform !== "darwin") continue;
        for (const artifact of result.artifacts) {
          if (!artifact.endsWith(".zip")) continue;
          await execFileAsync("/usr/bin/zip", [
            "-j",
            artifact,
            electronLicensePath,
            chromiumLicensesPath,
          ]);
        }
      }
      return makeResults;
    },
    async postPackage(_config, { outputPaths, platform }) {
      if (
        platform !== "darwin"
        || process.env.BLISSHACK_MAC_SIGN_IDENTITY
      ) {
        return;
      }
      for (const outputPath of outputPaths) {
        const appPath = outputPath.endsWith(".app")
          ? outputPath
          : join(outputPath, "BlissHack.app");
        await execFileAsync("/usr/bin/codesign", [
          "--force",
          "--deep",
          "--sign",
          "-",
          appPath,
        ]);
      }
    },
  },
  packagerConfig: {
    appBundleId: "org.blisshack.desktop",
    appCategoryType: "public.app-category.games",
    asar: true,
    executableName: "BlissHack",
    extendInfo: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
      },
    },
    extraResource: [
      resolve(root, "../dat/license"),
      resolve(root, "electron/THIRD_PARTY_NOTICES.md"),
    ],
    icon: iconBase,
    osxSign: {
      identity: process.env.BLISSHACK_MAC_SIGN_IDENTITY ?? "-",
    },
    ignore(path) {
      if (path === "") return false;
      if (path === "/package.json") return false;
      if (path === "/dist" || path.startsWith("/dist/")) return false;
      if (path === "/electron") return false;
      if (
        path === "/electron/main.mjs"
        || path === "/electron/preload.cjs"
        || path === "/electron/desktop-contract.mjs"
        || path === "/electron/assets"
        || path === "/electron/assets/icon.png"
      ) {
        return false;
      }
      return true;
    },
    osxUniversal: {
      mergeASARs: true,
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32"],
    },
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        authors: "The BlissHack contributors",
        description: "An unofficial NetHack 5.0 port.",
        name: "BlissHack",
        noMsi: true,
        setupExe: "BlissHack-Setup.exe",
        setupIcon: `${iconBase}.ico`,
      },
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
