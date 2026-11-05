import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const defaultElectronRoot = dirname(require.resolve("electron"));

export function getElectronLicensePaths(
  electronRoot = defaultElectronRoot,
) {
  const distRoot = join(electronRoot, "dist");
  return [
    join(distRoot, "LICENSE"),
    join(distRoot, "LICENSES.chromium.html"),
  ];
}

export async function prepareElectronRuntime(
  electronRoot = defaultElectronRoot,
) {
  await execFileAsync(process.execPath, [join(electronRoot, "install.js")], {
    cwd: electronRoot,
  });

  const licensePaths = getElectronLicensePaths(electronRoot);
  try {
    await Promise.all(licensePaths.map((path) => access(path)));
  } catch (cause) {
    throw new Error(
      `Electron installer did not create the required licenses in ${
        join(electronRoot, "dist")
      }`,
      { cause },
    );
  }
  return licensePaths;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const licensePaths = await prepareElectronRuntime();
  console.log(`Prepared Electron runtime licenses:\n${licensePaths.join("\n")}`);
}
