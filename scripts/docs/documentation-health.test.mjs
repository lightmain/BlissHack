import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, test } from "node:test";
import {
  generateCurrentStatus,
  generateReleaseIndex,
  validateDocumentationHealth,
} from "./documentation-health.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const temporaryDirectories = [];
const maintenanceTextPattern =
  /\.(?:c|h|html|js|json|jsx|md|mjs|sh|ts|tsx|txt|ya?ml)$/i;
const legacyPlansPath = "doc/BlissHack/" + "plans/";

/**
 * Convert an operating-system path to a repository-relative POSIX path.
 * @param {string} path path relative to a repository root.
 * @returns {string} normalized repository-relative path.
 */
function normalizePath(path) {
  return path.split(sep).join("/");
}

/**
 * Return every parent directory represented by a repository file list.
 * @param {string[]} paths repository-relative file paths.
 * @returns {string[]} file and directory paths without duplicates.
 */
function withParentDirectories(paths) {
  const entries = new Set(paths);
  for (const path of paths) {
    let parent = normalizePath(dirname(path));
    while (parent !== ".") {
      entries.add(parent);
      parent = normalizePath(dirname(parent));
    }
  }
  return [...entries].sort();
}

/**
 * Recursively list files below a fixture repository.
 * @param {string} root fixture repository root.
 * @param {string} [directory] current relative directory.
 * @returns {Promise<string[]>} repository-relative file paths.
 */
async function listFixtureFiles(root, directory = "") {
  const entries = await readdir(join(root, directory), {
    withFileTypes: true,
  });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listFixtureFiles(root, path);
    return [normalizePath(path)];
  }));
  return paths.flat().sort();
}

/**
 * Read optional UTF-8 content without hiding errors other than absence.
 * @param {string} path absolute file path.
 * @returns {Promise<string>} content or an empty string when absent.
 */
async function readOptionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Read optional JSON content without hiding malformed JSON.
 * @param {string} path absolute JSON file path.
 * @returns {Promise<unknown|null>} parsed value or null when absent.
 */
async function readOptionalJson(path) {
  const source = await readOptionalFile(path);
  return source === "" ? null : JSON.parse(source);
}

/**
 * Build the pure validator input from files on disk.
 * @param {string} root repository root.
 * @param {string[]} filePaths repository-relative file paths.
 * @returns {Promise<Record<string, unknown>>} documentation snapshot.
 */
async function createSnapshot(root, filePaths) {
  const textPaths = filePaths.filter((path) =>
    maintenanceTextPattern.test(path)
  );
  const textEntries = await Promise.all(textPaths.map(async (path) => [
    path,
    await readFile(join(root, path), "utf8"),
  ]));
  const [
    versionSource,
    manifest,
    knowledgeMap,
    status,
    releaseIndex,
  ] = await Promise.all([
    readOptionalFile(join(root, "VERSION")),
    readOptionalJson(join(root, "doc/BlissHack/releases/manifest.json")),
    readOptionalJson(join(root, "doc/BlissHack/knowledge-map.json")),
    readOptionalFile(join(root, "doc/BlissHack/current/status.md")),
    readOptionalFile(join(root, "doc/BlissHack/releases/index.md")),
  ]);

  return {
    version: versionSource.trim(),
    manifest,
    knowledgeMap,
    status,
    releaseIndex,
    existingPaths: withParentDirectories(filePaths),
    texts: Object.fromEntries(textEntries),
  };
}

/**
 * Create a complete, healthy miniature documentation repository.
 * @returns {Promise<string>} temporary repository root.
 */
async function createHealthyFixture() {
  const root = await mkdtemp(join(tmpdir(), "blisshack-doc-health-"));
  temporaryDirectories.push(root);
  const manifest = {
    schemaVersion: 1,
    currentVersion: "alpha-2.4",
    releases: [
      {
        version: "alpha-2.4",
        plan: "doc/BlissHack/releases/alpha-2.4/plan.md",
        acceptance:
          "doc/BlissHack/releases/alpha-2.4/release-acceptance.md",
        artifacts: [
          "doc/BlissHack/releases/alpha-2.4/catalog-report.md",
        ],
      },
    ],
  };
  const knowledgeMap = {
    schemaVersion: 1,
    archiveRoot: "doc/BlissHack/releases",
    active: [
      "doc/BlissHack/index.md",
      "doc/BlissHack/current/architecture.md",
      "doc/BlissHack/current/status.md",
      "doc/BlissHack/session-start.md",
      "doc/BlissHack/decisions/0001-documentation.md",
      "doc/BlissHack/releases/index.md",
    ],
    generated: [
      "doc/BlissHack/current/status.md",
      "doc/BlissHack/releases/index.md",
    ],
    entrypoints: {
      human: "doc/BlissHack/index.md",
      agent: "doc/BlissHack/session-start.md",
      currentStatus: "doc/BlissHack/current/status.md",
      currentArchitecture: "doc/BlissHack/current/architecture.md",
      decisions: "doc/BlissHack/decisions",
      history: "doc/BlissHack/releases",
    },
  };
  const files = {
    VERSION: "alpha-2.4\n",
    "README.md": [
      "# Fixture",
      "",
      "[Documentation](doc/BlissHack/index.md)",
      "",
    ].join("\n"),
    "doc/BlissHack/releases/manifest.json":
      `${JSON.stringify(manifest, null, 2)}\n`,
    "doc/BlissHack/knowledge-map.json":
      `${JSON.stringify(knowledgeMap, null, 2)}\n`,
    "doc/BlissHack/current/status.md": generateCurrentStatus({
      version: "alpha-2.4",
      manifest,
    }),
    "doc/BlissHack/releases/index.md": generateReleaseIndex(manifest),
    "doc/BlissHack/index.md": [
      "# Documentation",
      "",
      "[Architecture](current/architecture.md)",
      "",
    ].join("\n"),
    "doc/BlissHack/current/architecture.md": "# Architecture\n",
    "doc/BlissHack/session-start.md": "# Session Start\n",
    "doc/BlissHack/decisions/0001-documentation.md": "# Decision\n",
    "doc/BlissHack/releases/alpha-2.4/plan.md": "# Plan\n",
    "doc/BlissHack/releases/alpha-2.4/release-acceptance.md":
      "# Acceptance\n",
    "doc/BlissHack/releases/alpha-2.4/catalog-report.md": "# Report\n",
  };

  await Promise.all(Object.entries(files).map(async ([path, contents]) => {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }));
  return root;
}

/**
 * Validate one fixture repository through the pure production validator.
 * @param {string} root fixture repository root.
 * @returns {Promise<Array<{code: string, path?: string}>>} diagnostics.
 */
async function validateFixture(root) {
  const files = await listFixtureFiles(root);
  return validateDocumentationHealth(await createSnapshot(root, files));
}

/**
 * Assert that diagnostics contain one code and optional affected path.
 * @param {Array<{code: string, path?: string}>} diagnostics diagnostics.
 * @param {string} code expected stable diagnostic code.
 * @param {string} [path] expected affected repository path.
 * @returns {void}
 */
function assertDiagnostic(diagnostics, code, path) {
  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.code === code
      && (path === undefined || diagnostic.path === path)
    ),
    `expected ${code}${path ? ` for ${path}` : ""}; got ${
      JSON.stringify(diagnostics, null, 2)
    }`,
  );
}

/**
 * Assert one diagnostic has the stable public structure.
 * @param {Array<object>} diagnostics diagnostics.
 * @param {string} code expected stable diagnostic code.
 * @param {string} path expected affected repository path.
 * @param {string} [source] expected referring source path.
 * @returns {void}
 */
function assertStableDiagnostic(diagnostics, code, path, source) {
  const diagnostic = diagnostics.find((entry) =>
    entry.code === code
    && entry.path === path
    && (source === undefined || entry.source === source)
  );
  assert.ok(
    diagnostic,
    `expected ${code} for ${path}; got ${
      JSON.stringify(diagnostics, null, 2)
    }`,
  );
  assert.equal(typeof diagnostic.message, "string");
  assert.ok(diagnostic.message.length > 0);
  assert.deepEqual(
    Object.keys(diagnostic).sort(),
    source === undefined
      ? ["code", "message", "path"]
      : ["code", "message", "path", "source"],
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("documentation health", () => {
  test("accepts a complete miniature documentation repository", async () => {
    const root = await createHealthyFixture();

    assert.deepEqual(await validateFixture(root), []);
  });

  test("rejects a manifest version mismatch and every missing release path", async () => {
    const root = await createHealthyFixture();
    const manifestPath = join(
      root,
      "doc/BlissHack/releases/manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.currentVersion = "alpha-2.3";
    manifest.releases[0].plan = "doc/BlissHack/releases/missing-plan.md";
    manifest.releases[0].acceptance =
      "doc/BlissHack/releases/missing-acceptance.md";
    manifest.releases[0].artifacts = [
      "doc/BlissHack/releases/missing-artifact.md",
    ];
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    let diagnostics;
    await assert.doesNotReject(async () => {
      diagnostics = await validateFixture(root);
    });
    assertDiagnostic(diagnostics, "MANIFEST_VERSION_MISMATCH");
    for (const path of [
      manifest.releases[0].plan,
      manifest.releases[0].acceptance,
      ...manifest.releases[0].artifacts,
    ]) {
      assertStableDiagnostic(diagnostics, "MANIFEST_PATH_MISSING", path);
    }
  });

  test("generates status with a warning, version, plan, and acceptance links", async () => {
    const root = await createHealthyFixture();
    const manifest = JSON.parse(await readFile(
      join(root, "doc/BlissHack/releases/manifest.json"),
      "utf8",
    ));
    const status = generateCurrentStatus({
      version: "alpha-2.4",
      manifest,
    });

    assert.match(status, /(?:do not edit|不要手工修改|不可手改)/i);
    assert.match(status, /alpha-2\.4/);
    assert.match(
      status,
      /\[[^\]]*plan[^\]]*\]\(\.\.\/releases\/alpha-2\.4\/plan\.md\)/i,
    );
    assert.match(
      status,
      /\[[^\]]*(?:acceptance|验收)[^\]]*\]\(\.\.\/releases\/alpha-2\.4\/release-acceptance\.md\)/i,
    );

    await writeFile(
      join(root, "doc/BlissHack/current/status.md"),
      "# Hand-edited status\n",
      "utf8",
    );
    assertDiagnostic(
      await validateFixture(root),
      "STATUS_OUTDATED",
      "doc/BlissHack/current/status.md",
    );
  });

  test("rejects a hand-edited generated release index", async () => {
    const root = await createHealthyFixture();
    await writeFile(
      join(root, "doc/BlissHack/releases/index.md"),
      "# Hand-edited release archive\n",
      "utf8",
    );

    assertStableDiagnostic(
      await validateFixture(root),
      "RELEASE_INDEX_OUTDATED",
      "doc/BlissHack/releases/index.md",
    );
  });

  test("generates release index links from manifest paths", () => {
    const releaseIndex = generateReleaseIndex({
      schemaVersion: 1,
      currentVersion: "alpha-2.4",
      releases: [
        {
          version: "alpha-2.4",
          status: "accepted",
          summary: "Custom paths",
          plan: "doc/BlissHack/releases/custom/roadmap.md",
          acceptance: "doc/BlissHack/releases/records/sign-off.md",
          artifacts: [],
        },
      ],
    });

    assert.match(releaseIndex, /\[计划]\(\.\/custom\/roadmap\.md\)/);
    assert.match(
      releaseIndex,
      /\[验收]\(\.\/records\/sign-off\.md\)/,
    );
    assert.doesNotMatch(releaseIndex, /\.\/alpha-2\.4\/plan\.md/);
    assert.doesNotMatch(
      releaseIndex,
      /\.\/alpha-2\.4\/release-acceptance\.md/,
    );
  });

  test("reports an unsupported manifest schema without throwing", async () => {
    const root = await createHealthyFixture();
    const manifestPath = join(
      root,
      "doc/BlissHack/releases/manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.schemaVersion = 999;
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    let diagnostics;
    await assert.doesNotReject(async () => {
      diagnostics = await validateFixture(root);
    });
    assertStableDiagnostic(
      diagnostics,
      "MANIFEST_SCHEMA_UNSUPPORTED",
      "doc/BlissHack/releases/manifest.json",
    );
  });

  test("reports non-array manifest releases without throwing", async () => {
    const root = await createHealthyFixture();
    const manifestPath = join(
      root,
      "doc/BlissHack/releases/manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.releases = {};
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    let diagnostics;
    await assert.doesNotReject(async () => {
      diagnostics = await validateFixture(root);
    });
    assertStableDiagnostic(
      diagnostics,
      "MANIFEST_RELEASES_INVALID",
      "doc/BlissHack/releases/manifest.json",
    );
  });

  test("reports duplicate release versions without throwing", async () => {
    const root = await createHealthyFixture();
    const manifestPath = join(
      root,
      "doc/BlissHack/releases/manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.releases.push({ ...manifest.releases[0] });
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    let diagnostics;
    await assert.doesNotReject(async () => {
      diagnostics = await validateFixture(root);
    });
    assertStableDiagnostic(
      diagnostics,
      "MANIFEST_VERSION_DUPLICATE",
      "doc/BlissHack/releases/manifest.json",
    );
  });

  test("reports missing and malformed release path declarations without throwing", async () => {
    const root = await createHealthyFixture();
    const manifestPath = join(
      root,
      "doc/BlissHack/releases/manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.releases[0].plan;
    manifest.releases[0].artifacts = "not-an-array";
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    let diagnostics;
    await assert.doesNotReject(async () => {
      diagnostics = await validateFixture(root);
    });
    assertStableDiagnostic(
      diagnostics,
      "MANIFEST_PLAN_REQUIRED",
      "doc/BlissHack/releases/manifest.json",
    );
    assertStableDiagnostic(
      diagnostics,
      "MANIFEST_ARTIFACTS_INVALID",
      "doc/BlissHack/releases/manifest.json",
    );
  });

  test("reports invalid release artifact entries without throwing", async (t) => {
    for (const [name, artifact] of [
      ["non-string artifact", 42],
      ["empty artifact", ""],
    ]) {
      await t.test(name, async () => {
        const root = await createHealthyFixture();
        const manifestPath = join(
          root,
          "doc/BlissHack/releases/manifest.json",
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.releases[0].artifacts = [artifact];
        await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

        let diagnostics;
        await assert.doesNotReject(async () => {
          diagnostics = await validateFixture(root);
        });
        assertStableDiagnostic(
          diagnostics,
          "MANIFEST_ARTIFACT_INVALID",
          "doc/BlissHack/releases/manifest.json",
        );
      });
    }
  });

  test("rejects release paths outside the declared release directory", async () => {
    const root = await createHealthyFixture();
    const manifestPath = join(
      root,
      "doc/BlissHack/releases/manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const release = manifest.releases[0];
    release.plan = "doc/BlissHack/current/architecture.md";
    release.acceptance = "README.md";
    release.artifacts = ["doc/BlissHack/index.md"];
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const diagnostics = await validateFixture(root);
    for (const path of [
      release.plan,
      release.acceptance,
      ...release.artifacts,
    ]) {
      assertStableDiagnostic(
        diagnostics,
        "MANIFEST_PATH_OUTSIDE_ARCHIVE",
        path,
      );
    }
  });

  test("rejects legacy plans references in maintained repository text", async () => {
    const root = await createHealthyFixture();
    await writeFile(
      join(root, "README.md"),
      `Old location: ${legacyPlansPath}alpha-2.4.md\n`,
      "utf8",
    );

    assertDiagnostic(
      await validateFixture(root),
      "LEGACY_PLAN_REFERENCE",
      "README.md",
    );
  });

  test("requires active entry points and decisions to be registered and present", async () => {
    const root = await createHealthyFixture();
    const mapPath = join(root, "doc/BlissHack/knowledge-map.json");
    const knowledgeMap = JSON.parse(await readFile(mapPath, "utf8"));
    knowledgeMap.active = knowledgeMap.active.filter((path) =>
      path !== "doc/BlissHack/index.md"
      && path !== "doc/BlissHack/current/architecture.md"
      && path !== "doc/BlissHack/session-start.md"
      && !path.startsWith("doc/BlissHack/decisions/")
    );
    knowledgeMap.active.push("doc/BlissHack/current/missing.md");
    await writeFile(mapPath, JSON.stringify(knowledgeMap), "utf8");

    const diagnostics = await validateFixture(root);
    for (const path of [
      "doc/BlissHack/index.md",
      "doc/BlissHack/current/architecture.md",
      "doc/BlissHack/session-start.md",
      "doc/BlissHack/decisions/0001-documentation.md",
    ]) {
      assertDiagnostic(diagnostics, "KNOWLEDGE_ENTRY_REQUIRED", path);
    }
    assertDiagnostic(
      diagnostics,
      "KNOWLEDGE_ENTRY_MISSING",
      "doc/BlissHack/current/missing.md",
    );
  });

  test("validates the knowledge map schema version", async () => {
    const root = await createHealthyFixture();
    const mapPath = join(root, "doc/BlissHack/knowledge-map.json");
    const knowledgeMap = JSON.parse(await readFile(mapPath, "utf8"));
    knowledgeMap.schemaVersion = 999;
    await writeFile(mapPath, JSON.stringify(knowledgeMap), "utf8");

    assertStableDiagnostic(
      await validateFixture(root),
      "KNOWLEDGE_SCHEMA_UNSUPPORTED",
      "doc/BlissHack/knowledge-map.json",
    );
  });

  test("requires a non-empty knowledge archive root", async (t) => {
    for (const [name, archiveRoot] of [
      ["missing archive root", undefined],
      ["null archive root", null],
      ["empty archive root", ""],
    ]) {
      await t.test(name, async () => {
        const root = await createHealthyFixture();
        const mapPath = join(root, "doc/BlissHack/knowledge-map.json");
        const knowledgeMap = JSON.parse(await readFile(mapPath, "utf8"));
        if (archiveRoot === undefined) {
          delete knowledgeMap.archiveRoot;
        } else {
          knowledgeMap.archiveRoot = archiveRoot;
        }
        await writeFile(mapPath, JSON.stringify(knowledgeMap), "utf8");

        let diagnostics;
        await assert.doesNotReject(async () => {
          diagnostics = await validateFixture(root);
        });
        assertStableDiagnostic(
          diagnostics,
          "KNOWLEDGE_ARCHIVE_ROOT_REQUIRED",
          "doc/BlissHack/knowledge-map.json",
        );
      });
    }
  });

  test("validates archive root existence", async () => {
    const root = await createHealthyFixture();
    const mapPath = join(root, "doc/BlissHack/knowledge-map.json");
    const knowledgeMap = JSON.parse(await readFile(mapPath, "utf8"));
    knowledgeMap.archiveRoot = "doc/BlissHack/missing-releases";
    await writeFile(mapPath, JSON.stringify(knowledgeMap), "utf8");

    assertStableDiagnostic(
      await validateFixture(root),
      "KNOWLEDGE_ARCHIVE_ROOT_MISSING",
      "doc/BlissHack/missing-releases",
    );
  });

  test("validates archive root consistency", async () => {
    const root = await createHealthyFixture();
    const mapPath = join(root, "doc/BlissHack/knowledge-map.json");
    const knowledgeMap = JSON.parse(await readFile(mapPath, "utf8"));
    knowledgeMap.archiveRoot = "doc/BlissHack/current";
    await writeFile(mapPath, JSON.stringify(knowledgeMap), "utf8");

    assertStableDiagnostic(
      await validateFixture(root),
      "KNOWLEDGE_ARCHIVE_ROOT_MISMATCH",
      "doc/BlissHack/current",
    );
  });

  test("validates generated knowledge entries for presence and consistency", async () => {
    const root = await createHealthyFixture();
    const mapPath = join(root, "doc/BlissHack/knowledge-map.json");
    const knowledgeMap = JSON.parse(await readFile(mapPath, "utf8"));
    knowledgeMap.generated = [
      "doc/BlissHack/current/status.md",
      "doc/BlissHack/current/missing-generated.md",
    ];
    await writeFile(mapPath, JSON.stringify(knowledgeMap), "utf8");

    const diagnostics = await validateFixture(root);
    assertStableDiagnostic(
      diagnostics,
      "KNOWLEDGE_GENERATED_REQUIRED",
      "doc/BlissHack/releases/index.md",
    );
    assertStableDiagnostic(
      diagnostics,
      "KNOWLEDGE_GENERATED_MISSING",
      "doc/BlissHack/current/missing-generated.md",
    );
  });

  test("validates knowledge entrypoints for presence and consistency", async () => {
    const root = await createHealthyFixture();
    const mapPath = join(root, "doc/BlissHack/knowledge-map.json");
    const knowledgeMap = JSON.parse(await readFile(mapPath, "utf8"));
    knowledgeMap.entrypoints.human =
      "doc/BlissHack/current/architecture.md";
    knowledgeMap.entrypoints.agent =
      "doc/BlissHack/current/missing-agent-entrypoint.md";
    await writeFile(mapPath, JSON.stringify(knowledgeMap), "utf8");

    const diagnostics = await validateFixture(root);
    assertStableDiagnostic(
      diagnostics,
      "KNOWLEDGE_ENTRYPOINT_MISMATCH",
      "doc/BlissHack/index.md",
    );
    assertStableDiagnostic(
      diagnostics,
      "KNOWLEDGE_ENTRYPOINT_MISSING",
      "doc/BlissHack/current/missing-agent-entrypoint.md",
    );
  });

  test("rejects duplicate active knowledge entries", async () => {
    const root = await createHealthyFixture();
    const mapPath = join(root, "doc/BlissHack/knowledge-map.json");
    const knowledgeMap = JSON.parse(await readFile(mapPath, "utf8"));
    knowledgeMap.active.push("doc/BlissHack/index.md");
    await writeFile(mapPath, JSON.stringify(knowledgeMap), "utf8");

    assertStableDiagnostic(
      await validateFixture(root),
      "KNOWLEDGE_ACTIVE_DUPLICATE",
      "doc/BlissHack/index.md",
    );
  });

  test("rejects missing local Markdown link targets and ignores remote links", async () => {
    const root = await createHealthyFixture();
    await writeFile(
      join(root, "doc/BlissHack/index.md"),
      [
        "# Documentation",
        "",
        "[Missing](current/missing.md#details)",
        "[Remote](https://example.com/missing.md)",
        "[Section](#documentation)",
        "",
      ].join("\n"),
      "utf8",
    );

    assertDiagnostic(
      await validateFixture(root),
      "MARKDOWN_LINK_MISSING",
      "doc/BlissHack/current/missing.md",
    );
  });

  test("ignores links inside multiline CommonMark code spans", async () => {
    const root = await createHealthyFixture();
    await writeFile(
      join(root, "doc/BlissHack/index.md"),
      [
        "# Documentation",
        "",
        "Before `",
        "[x](missing.md)",
        "` after",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(await validateFixture(root), []);
  });

  test("checks unquoted HTML href and src targets", async () => {
    const root = await createHealthyFixture();
    await writeFile(
      join(root, "doc/BlissHack/index.md"),
      [
        "# Documentation",
        "",
        "<a href=missing.md>Missing page</a>",
        "<img src=missing.png alt=Missing>",
        "",
      ].join("\n"),
      "utf8",
    );

    const diagnostics = await validateFixture(root);
    for (const path of [
      "doc/BlissHack/missing.md",
      "doc/BlissHack/missing.png",
    ]) {
      assertStableDiagnostic(
        diagnostics,
        "MARKDOWN_LINK_MISSING",
        path,
        "doc/BlissHack/index.md",
      );
    }
  });

  test("recognizes Setext heading anchors and rejects missing anchors", async () => {
    const root = await createHealthyFixture();
    await writeFile(
      join(root, "doc/BlissHack/current/architecture.md"),
      [
        "Primary Title",
        "=============",
        "",
        "Secondary Title",
        "---------------",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(root, "doc/BlissHack/index.md"),
      [
        "# Documentation",
        "",
        "[Primary](current/architecture.md#primary-title)",
        "[Secondary](current/architecture.md#secondary-title)",
        "[Missing](current/architecture.md#missing-setext)",
        "",
      ].join("\n"),
      "utf8",
    );

    const diagnostics = await validateFixture(root);
    assertStableDiagnostic(
      diagnostics,
      "MARKDOWN_ANCHOR_MISSING",
      "doc/BlissHack/current/architecture.md#missing-setext",
      "doc/BlissHack/index.md",
    );
    assert.deepEqual(
      diagnostics
        .filter((diagnostic) =>
          diagnostic.code === "MARKDOWN_ANCHOR_MISSING"
        )
        .map((diagnostic) => diagnostic.path),
      ["doc/BlissHack/current/architecture.md#missing-setext"],
    );
  });

  test("checks reference links, HTML links and images, definitions, and anchors", async () => {
    const root = await createHealthyFixture();
    await writeFile(
      join(root, "doc/BlissHack/index.md"),
      [
        "# Documentation",
        "",
        "[Architecture][architecture]",
        "![Missing reference image][missing-image]",
        "[Missing definition][undefined-reference]",
        '<a href="current/missing-html.md">Missing HTML page</a>',
        '<img src="current/missing-html.png" alt="Missing HTML image">',
        "[Missing target anchor](current/architecture.md#details)",
        "[Missing local anchor](#details)",
        "",
        "[architecture]: current/architecture.md#architecture",
        "[missing-image]: current/missing-reference.png",
        "",
      ].join("\n"),
      "utf8",
    );

    const diagnostics = await validateFixture(root);
    for (const path of [
      "doc/BlissHack/current/missing-reference.png",
      "doc/BlissHack/current/missing-html.md",
      "doc/BlissHack/current/missing-html.png",
    ]) {
      assertStableDiagnostic(
        diagnostics,
        "MARKDOWN_LINK_MISSING",
        path,
        "doc/BlissHack/index.md",
      );
    }
    assertStableDiagnostic(
      diagnostics,
      "MARKDOWN_REFERENCE_UNDEFINED",
      "undefined-reference",
      "doc/BlissHack/index.md",
    );
    assertStableDiagnostic(
      diagnostics,
      "MARKDOWN_ANCHOR_MISSING",
      "doc/BlissHack/current/architecture.md#details",
      "doc/BlissHack/index.md",
    );
    assertStableDiagnostic(
      diagnostics,
      "MARKDOWN_ANCHOR_MISSING",
      "doc/BlissHack/index.md#details",
      "doc/BlissHack/index.md",
    );
  });

  test("ignores legacy path text in archived HTML and JavaScript prototypes", async () => {
    const root = await createHealthyFixture();
    const prototypeFiles = {
      "doc/BlissHack/prototypes/history.html":
        `<a href="${legacyPlansPath}alpha-2.4.md">Historical plan</a>\n`,
      "doc/BlissHack/prototypes/history.js":
        `const historicalPlan = "${legacyPlansPath}alpha-2.4.md";\n`,
    };
    await Promise.all(
      Object.entries(prototypeFiles).map(async ([path, contents]) => {
        const absolutePath = join(root, path);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, contents, "utf8");
      }),
    );

    assert.deepEqual(await validateFixture(root), []);
  });

  test("current repository has no documentation health diagnostics", async () => {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: repositoryRoot, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
    );
    const filePaths = stdout
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort();
    const diagnostics = validateDocumentationHealth(
      await createSnapshot(repositoryRoot, filePaths),
    );

    assert.deepEqual(diagnostics, []);
  });
});
