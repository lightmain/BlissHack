import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import { arch } from "node:process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const frontendRoot = resolve(import.meta.dirname, "../..");
const architecture = process.argv[2] ?? arch;
const packagedApp = join(
  frontendRoot,
  "out",
  `BlissHack-darwin-${architecture}`,
  "BlissHack.app",
);
const staging = join(frontendRoot, "out", `.dmg-staging-${architecture}`);
const outputDirectory = join(frontendRoot, "out", "make");
const output = join(
  outputDirectory,
  `BlissHack-alpha-2.6-darwin-${architecture}.dmg`,
);
const electronLicenseRoot = join(
  frontendRoot,
  "node_modules",
  "electron",
  "dist",
);

await rm(staging, { force: true, recursive: true });
await mkdir(staging, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
await execFileAsync("/usr/bin/ditto", [
  packagedApp,
  join(staging, "BlissHack.app"),
]);
await Promise.all([
  copyFile(
    join(electronLicenseRoot, "LICENSE"),
    join(staging, "LICENSE"),
  ),
  copyFile(
    join(electronLicenseRoot, "LICENSES.chromium.html"),
    join(staging, "LICENSES.chromium.html"),
  ),
]);
await symlink("/Applications", join(staging, "Applications"));
await execFileAsync("hdiutil", [
  "create",
  "-volname",
  "BlissHack alpha-2.6",
  "-srcfolder",
  staging,
  "-ov",
  "-format",
  "UDZO",
  output,
]);
await rm(staging, { force: true, recursive: true });
console.log(output);
