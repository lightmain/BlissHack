import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const fixtureDirectory = join(
  repositoryRoot,
  "frontend/test/integration-tests/fixtures",
);
const temporaryDirectories = [];

/**
 * Return a complete brace-delimited C function body after a source marker.
 * @param {string} source - complete C source.
 * @param {RegExp} marker - function signature immediately before its body.
 * @returns {string} complete function body.
 */
function cBlockAfter(source, marker) {
  const match = marker.exec(source);
  expect(match).not.toBeNull();
  const start = source.indexOf("{", match.index + match[0].length);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error("Unterminated C block");
}

/**
 * Return the source slice containing one monster table entry.
 * @param {string} source - complete monsters.h source.
 * @param {string} name - exact neutral monster name.
 * @returns {string} table entry prefix containing LVL.
 */
function monsterEntry(source, name) {
  const start = source.indexOf(`MON(NAM("${name}")`);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, start + 240);
}

/**
 * Apply the current adj_lev arithmetic to one explicit game context.
 * @param {number} baseLevel - monster table level.
 * @param {number} levelDifficulty - current level_difficulty() result.
 * @param {number} playerLevel - current player experience level.
 * @returns {number} adjusted monster level after its lower and upper caps.
 */
function adjustedMonsterLevel(baseLevel, levelDifficulty, playerLevel) {
  if (baseLevel > 49) return 50;
  let adjustedLevel = baseLevel;
  const difficultyDifference = levelDifficulty - baseLevel;
  if (difficultyDifference < 0) {
    adjustedLevel -= 1;
  } else {
    adjustedLevel += Math.floor(difficultyDifference / 5);
  }
  const playerDifference = playerLevel - baseLevel;
  if (playerDifference > 0) {
    adjustedLevel += Math.floor(playerDifference / 4);
  }
  const levelCap = Math.min(Math.floor((3 * baseLevel) / 2), 49);
  return Math.max(0, Math.min(adjustedLevel, levelCap));
}

/**
 * Return inclusive bounds for a fixed number of identical dice.
 * @param {number} count - number of dice.
 * @param {number} sides - sides per die.
 * @returns {[number, number]} minimum and maximum roll.
 */
function diceBounds(count, sides) {
  return [count, count * sides];
}

/**
 * Apply newmonhp's all-minimum-roll boost to inclusive HP bounds.
 * @param {[number, number]} bounds - bounds before the final boost.
 * @param {number} baseHp - newmonhp basehp used by the boost comparison.
 * @returns {[number, number]} bounds after the boost.
 */
function withMinimumRollBoost(bounds, baseHp) {
  return [bounds[0] === baseHp ? bounds[0] + 1 : bounds[0], bounds[1]];
}

/**
 * Derive ordinary-monster HP after an optional home-elemental multiplier.
 * @param {number} adjustedLevel - adj_lev result used as the dice count.
 * @param {number} multiplier - post-roll home-elemental multiplier.
 * @returns {[number, number]} inclusive initial HP bounds.
 */
function ordinaryHpBounds(adjustedLevel, multiplier = 1) {
  const rolled = diceBounds(adjustedLevel, 8);
  return withMinimumRollBoost(
    [rolled[0] * multiplier, rolled[1] * multiplier],
    adjustedLevel,
  );
}

/**
 * Derive adult-dragon HP for one adjusted level and dungeon context.
 * @param {number} adjustedLevel - adj_lev result.
 * @param {boolean} endgame - whether In_endgame(&u.uz) is true.
 * @returns {[number, number]} inclusive initial HP bounds.
 */
function adultDragonHpBounds(adjustedLevel, endgame) {
  if (endgame) return [8 * adjustedLevel, 8 * adjustedLevel];
  const bonus = diceBounds(adjustedLevel, 4);
  return [
    4 * adjustedLevel + bonus[0],
    4 * adjustedLevel + bonus[1],
  ];
}

/** Collapse source formatting without changing paragraph wording. */
function normalizedText(value) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("alpha-2.4 stage-zero source baselines", () => {
  /** Compile current display.h macros and classify representative glyphs. */
  it("classifies supported glyph families and rejects a zap effect", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blisshack-glyphs-"));
    temporaryDirectories.push(directory);
    const executable = join(directory, "glyph-classification");
    const compile = spawnSync(
      "cc",
      [
        "-std=c11",
        "-ffunction-sections",
        "-fdata-sections",
        `-I${join(repositoryRoot, "include")}`,
        join(fixtureDirectory, "alpha-2.4-glyph-classification.c"),
        join(repositoryRoot, "src/glyphs.c"),
        process.platform === "darwin"
          ? "-Wl,-dead_strip"
          : "-Wl,--gc-sections",
        "-o",
        executable,
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(compile.status, compile.stderr).toBe(0);

    const run = spawnSync(executable, [], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const rows = run.stdout.trim().split("\n").map((line) => {
      const [name, glyph, classified, identity] = line.split("\t");
      return {
        name,
        glyph: Number(glyph),
        classified: Number(classified),
        identity: Number(identity),
      };
    });

    expect(rows.map(({ name }) => name)).toEqual([
      "monster",
      "pet",
      "ridden",
      "detected",
      "object",
      "generic",
      "corpse",
      "statue",
      "piletop",
      "terrain",
      "trap",
      "unsupported",
    ]);
    expect(rows.every(
      ({ glyph, classified, identity }) =>
        Number.isInteger(glyph) && classified === 1 && identity === 1,
    )).toBe(true);
  });

  /** Lock adj_lev/newmonhp formulas and context-specific representative bounds. */
  it("derives representative HP bounds from explicit adjustment contexts", async () => {
    const [makemonSource, monstersSource] = await Promise.all([
      readFile(join(repositoryRoot, "src/makemon.c"), "utf8"),
      readFile(join(repositoryRoot, "include/monsters.h"), "utf8"),
    ]);
    const adjLev = cBlockAfter(
      makemonSource,
      /\nint\s*\nadj_lev\s*\(\s*struct permonst \*ptr\s*\)\s*/,
    );
    const newmonhp = cBlockAfter(
      makemonSource,
      /\nvoid\s*\nnewmonhp\s*\(\s*struct monst \*mon,\s*int mndx\s*\)\s*/,
    );
    const branchMarkers = [
      "if (is_golem(ptr))",
      "} else if (is_rider(ptr))",
      "} else if (ptr->mlevel > 49)",
      "} else if (ptr->mlet == S_DRAGON && mndx >= PM_GRAY_DRAGON)",
      "} else if (!mon->m_lev)",
      "} else {",
      "if (is_home_elemental(ptr))",
      "if (mon->mhpmax == basehp)",
    ];
    const branchPositions = branchMarkers.map((marker) =>
      newmonhp.indexOf(marker)
    );

    expect(branchPositions.every((position) => position >= 0)).toBe(true);
    expect(branchPositions).toEqual([...branchPositions].sort((a, b) => a - b));
    expect(newmonhp).toMatch(/mon->m_lev = adj_lev\(ptr\)/);
    expect(newmonhp).toMatch(/is_golem\(ptr\)[\s\S]*golemhp\(mndx\)/);
    expect(newmonhp).toMatch(/is_rider\(ptr\)[\s\S]*basehp = 10;[\s\S]*d\(basehp, 8\)/);
    expect(newmonhp).toMatch(/ptr->mlevel > 49[\s\S]*2 \* \(ptr->mlevel - 6\)/);
    expect(newmonhp).toMatch(/S_DRAGON[\s\S]*In_endgame\(&u\.uz\)[\s\S]*8 \* basehp[\s\S]*4 \* basehp \+ d\(basehp, 4\)/);
    expect(newmonhp).toMatch(/!mon->m_lev[\s\S]*basehp = 1;[\s\S]*rnd\(4\)/);
    expect(newmonhp).toMatch(/d\(basehp, 8\)[\s\S]*is_home_elemental\(ptr\)[\s\S]*mon->mhp \*= 3/);
    expect(newmonhp).toMatch(/mon->mhpmax == basehp[\s\S]*mon->mhpmax \+= 1/);
    expect(adjLev).toMatch(
      /tmp2 = \(level_difficulty\(\) - tmp\);[\s\S]*tmp2 \/ 5/,
    );
    expect(adjLev).toMatch(
      /tmp2 = \(u\.ulevel - ptr->mlevel\);[\s\S]*tmp2 \/ 4/,
    );
    expect(adjLev).toMatch(
      /tmp2 = \(3 \* \(\(int\) ptr->mlevel\)\) \/ 2;[\s\S]*tmp2 = 49/,
    );

    expect(monsterEntry(monstersSource, "newt")).toMatch(/LVL\(0,/);
    expect(monsterEntry(monstersSource, "gecko")).toMatch(/LVL\(1,/);
    expect(monsterEntry(monstersSource, "straw golem")).toMatch(/LVL\(3,/);
    expect(monsterEntry(monstersSource, "Death")).toMatch(/LVL\(30,/);
    expect(monsterEntry(monstersSource, "gray dragon")).toMatch(/LVL\(15,/);
    expect(monsterEntry(monstersSource, "air elemental")).toMatch(/LVL\(8,/);
    expect(makemonSource).toMatch(
      /case PM_STRAW_GOLEM:\s*return 20;/,
    );
    expect(makemonSource).toMatch(
      /case PM_AIR_ELEMENTAL:[\s\S]*?return TRUE;/,
    );

    const newtLevel = adjustedMonsterLevel(0, 1, 1);
    expect(newtLevel).toBe(0);
    expect(withMinimumRollBoost([1, 4], 1)).toEqual([2, 4]);

    const ordinaryLevelOne = adjustedMonsterLevel(1, 1, 1);
    expect(ordinaryLevelOne).toBe(1);
    expect(ordinaryHpBounds(ordinaryLevelOne)).toEqual([2, 8]);

    const strawGolemHp = Number(
      /case PM_STRAW_GOLEM:\s*return (\d+);/.exec(makemonSource)?.[1],
    );
    expect(strawGolemHp).toBe(20);
    expect(withMinimumRollBoost(diceBounds(10, 8), 10)).toEqual([11, 80]);

    const shallowDragonLevel = adjustedMonsterLevel(15, 1, 1);
    // These are legal max-level endgame contexts whose difficulty hits the cap.
    const cappedEndgameDragonLevel = adjustedMonsterLevel(15, 60, 30);
    expect(shallowDragonLevel).toBe(14);
    expect(cappedEndgameDragonLevel).toBe(22);
    expect([
      adultDragonHpBounds(shallowDragonLevel, false)[0],
      adultDragonHpBounds(cappedEndgameDragonLevel, false)[1],
    ]).toEqual([70, 176]);
    expect(adultDragonHpBounds(cappedEndgameDragonLevel, true))
      .toEqual([176, 176]);

    const cappedPlaneOfAirLevel = adjustedMonsterLevel(8, 60, 30);
    expect(cappedPlaneOfAirLevel).toBe(12);
    expect(ordinaryHpBounds(cappedPlaneOfAirLevel, 3)).toEqual([36, 288]);
  });

  /** Verify the offline Wiki fixture against the reviewed prototype and notice. */
  it("keeps four approved Newt revision 205110 paragraphs and attribution", async () => {
    const [fixtureSource, prototype, notice] = await Promise.all([
      readFile(
        join(fixtureDirectory, "newt-wiki-revision-205110.json"),
        "utf8",
      ),
      readFile(
        join(
          repositoryRoot,
          "doc/BlissHack/prototypes/alpha-2.4-examine-newt.html",
        ),
        "utf8",
      ),
      readFile(
        join(
          repositoryRoot,
          "doc/BlissHack/prototypes/alpha-2.4-examine-newt.NOTICE.md",
        ),
        "utf8",
      ),
    ]);
    const fixture = JSON.parse(fixtureSource);
    const prototypeParagraphs = [
      ...prototype.matchAll(
        /<blockquote\s+class="examine-wiki-excerpt"[\s\S]*?<\/blockquote>/g,
      ),
    ].flatMap(([blockquote]) =>
      [...blockquote.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)]
        .map((match) => normalizedText(match[1]))
    );
    const excerptParagraphs = prototypeParagraphs;
    const attributionMatch = prototype.match(
      /<script type="application\/json" id="prototype-content-attribution">\s*([\s\S]*?)\s*<\/script>/,
    );

    expect(excerptParagraphs).toHaveLength(4);
    expect(fixture.paragraphs).toEqual(excerptParagraphs);
    expect(prototype).not.toMatch(
      /A newt, :, is a type of monster|Eating a newt's corpse or tin/,
    );
    expect(prototype).toContain('selectTab("strategy")');
    expect(prototype).not.toContain('selectTab("overview")');
    expect(attributionMatch).not.toBeNull();
    const attribution = JSON.parse(attributionMatch[1]).wiki;
    expect(fixture).toMatchObject({
      title: attribution.title,
      authors: attribution.author,
      revision: attribution.revision,
      revisionTimestamp: "2026-06-02T18:31:39Z",
      revisionSha256:
        "8255e5ed686ea657f3b5cea18449b31e11f5bfe731195797b4f2dc5263522032",
      source: attribution.source,
      history: attribution.history,
      licenseUrl: attribution.licenseUrl,
      selection: attribution.use,
      changes: attribution.changes,
    });
    expect(fixture.license).toBe(
      "Creative Commons Attribution-ShareAlike 3.0 Unported",
    );
    const normalizedNotice = notice.replace(/\s+/g, " ");
    for (const excluded of fixture.exclusions) {
      expect(normalizedNotice.toLowerCase()).toContain(excluded.toLowerCase());
    }
    expect(normalizedNotice).toContain(
      "does not summarize, translate, rewrite, or splice",
    );
  });
});
