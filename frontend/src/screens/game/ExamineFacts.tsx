import type { ReactNode } from "react";
import type { CoreEntityRecord } from "../../encyclopedia/core-schema";

interface AttackFact {
  attackType: string;
  damageType: string;
  dice: {
    count: number;
    sides: number;
  };
}

const NETHACK_LICENSE_URL =
  "https://github.com/NetHack/NetHack/blob/"
  + "04834a93165482a28257bac282543e3583658622/dat/license";
const KEY_MONSTER_FACTS = new Set([
  "monsterClass",
  "level",
  "difficulty",
  "speed",
  "armorClass",
  "magicResistance",
  "alignment",
]);

/**
 * Render validated NetHack source facts without merging their NGPL provenance
 * with optional Wiki text.
 * @param props - core entity and the manifest version which produced it.
 * @returns a lossless facts column with kind-specific grouping.
 */
export function ExamineFacts({
  core,
  nethackVersion,
}: {
  core: CoreEntityRecord;
  nethackVersion: string;
}) {
  return (
    <aside
      aria-label={`${displayName(core.names.primary)} facts`}
      className="examine-facts"
      data-content-license="NGPL"
      data-entity-kind={core.kind}
    >
      {core.kind === "monster"
        ? <MonsterFacts facts={core.facts} />
        : (
          <FactSection title={`${displayName(core.kind)} facts`}>
            <FactTree value={core.facts} />
          </FactSection>
        )}
      <section className="examine-provenance">
        <h2>Core provenance</h2>
        <p>
          NetHack {nethackVersion} source
        </p>
        <ul className="examine-source-list">
          {core.sourceRefs.map((source) => (
            <li key={`${source.path}:${source.symbol}`}>
              <code>{source.path}</code>
              <span>{source.symbol}</span>
            </li>
          ))}
        </ul>
        <p className="examine-license-note">
          NetHack source facts are distributed under the{" "}
          <a
            href={NETHACK_LICENSE_URL}
            rel="license noopener noreferrer"
            target="_blank"
          >
            NGPL in dat/license
          </a>.
        </p>
      </section>
    </aside>
  );
}

/**
 * Preserve the monster schema's meaningful groups and source ordering.
 * @param props - strictly validated monster facts.
 * @returns grouped statistics, formulas, attacks, flags, and effects.
 */
function MonsterFacts({ facts }: { facts: Record<string, unknown> }) {
  const attacks = Array.isArray(facts.attacks)
    ? facts.attacks as AttackFact[]
    : [];
  const hpRule = objectFact(facts.hpRule);
  const generation = objectFact(facts.generation);
  const flags = objectFact(facts.flags);
  const corpse = objectFact(facts.corpse);
  const specialEffects = Array.isArray(facts.specialEffects)
    ? facts.specialEffects
    : null;
  const coreStatistics = pickFacts(facts, [
    "monsterClass",
    "level",
    "difficulty",
    "speed",
    "armorClass",
    "magicResistance",
    "alignment",
    "size",
    "weight",
    "nutrition",
    "sound",
  ]);

  return (
    <>
      <div className="examine-facts-primary">
        <FactSection
          className="examine-core-statistics"
          title="Core statistics"
        >
          <FactTree
            emphasizedKeys={KEY_MONSTER_FACTS}
            value={coreStatistics}
          />
          {zeroLevelHpRange(hpRule) && (
            <dl className="examine-stat-grid">
              <div>
                <dt>HP at level 0</dt>
                <dd>{zeroLevelHpRange(hpRule)}</dd>
              </div>
            </dl>
          )}
        </FactSection>
        {attacks.length > 0 && (
          <FactSection title={attacks.length === 1 ? "Attack" : "Attacks"}>
            <div className="examine-attacks">
              {attacks.map((attack, index) => (
                <div
                  className="examine-attack"
                  key={`${index}:${attack.attackType}`}
                >
                  <span className="examine-attack-index">{index + 1}</span>
                  <div>
                    <strong>{attack.attackType}</strong>
                    <span>{attack.damageType}</span>
                  </div>
                  <code>{diceLabel(attack.dice)}</code>
                </div>
              ))}
            </div>
          </FactSection>
        )}
        {Object.keys(generation).length > 0 && (
          <FactSection title="Generation">
            <FactTree value={generation} />
          </FactSection>
        )}
      </div>
      <div className="examine-facts-secondary">
        {Object.keys(hpRule).length > 0 && (
          <FactSection title="HP rule">
            <FactTree value={hpRule} />
          </FactSection>
        )}
        <FactSection title="Traits and resistances">
          <FactTree value={{
            resistances: facts.resistances,
            conveys: facts.conveys,
            ...flags,
          }} />
        </FactSection>
        {Object.keys(corpse).length > 0 && (
          <FactSection title="Corpse">
            <FactTree value={corpse} />
          </FactSection>
        )}
        {specialEffects && specialEffects.length > 0 && (
          <FactSection title="Special effects">
            <FactTree value={specialEffects} />
          </FactSection>
        )}
      </div>
    </>
  );
}

/**
 * Render one consistently separated fact group.
 * @param props - group title and structured child content.
 * @returns one facts-column section.
 */
function FactSection({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={className}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Recursively render every validated JSON field without flattening arrays or
 * discarding source enum symbols.
 * @param props - validated facts subtree.
 * @returns semantic definition lists and ordered collections.
 */
function FactTree({
  emphasizedKeys,
  value,
}: {
  emphasizedKeys?: ReadonlySet<string>;
  value: unknown;
}): ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="examine-empty-value">None</span>;
    if (value.every(isScalar)) {
      return (
        <div className="examine-traits">
          {value.map((entry, index) => (
            <code className="examine-trait" key={`${String(entry)}:${index}`}>
              {formatScalar(entry)}
            </code>
          ))}
        </div>
      );
    }
    return (
      <ol className="examine-fact-sequence">
        {value.map((entry, index) => (
          <li key={index}><FactTree value={entry} /></li>
        ))}
      </ol>
    );
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const attackDice = nestedAttackDice(record);
    return (
      <>
        {attackDice && (
          <code className="examine-attack-dice">{attackDice}</code>
        )}
        <dl className="examine-detail-list">
          {Object.entries(record).map(([key, entry]) => (
            <div
              className={[
                "examine-detail-row",
                emphasizedKeys?.has(key) ? "examine-key-fact" : "",
              ].filter(Boolean).join(" ")}
              key={key}
            >
              <dt>{key}</dt>
              <dd>
                {isScalar(entry)
                  ? <code>{formatScalar(entry)}</code>
                  : <FactTree value={entry} />}
              </dd>
            </div>
          ))}
        </dl>
      </>
    );
  }
  return <code>{formatScalar(value)}</code>;
}

/**
 * Expose the conventional dice notation alongside an attack's full structure.
 * @param value - candidate attack object.
 * @returns NdS text or null for non-attack records.
 */
function nestedAttackDice(value: Record<string, unknown>): string | null {
  if (
    typeof value.attackType !== "string"
    || typeof value.damageType !== "string"
  ) {
    return null;
  }
  const dice = objectFact(value.dice);
  return typeof dice.count === "number" && typeof dice.sides === "number"
    ? `${dice.count}d${dice.sides}`
    : null;
}

/**
 * Narrow a facts member to a plain object after schema validation.
 * @param value - candidate facts member.
 * @returns the object or an empty record.
 */
function objectFact(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Copy selected fields in schema order, omitting absent values.
 * @param source - complete facts record.
 * @param keys - ordered field names.
 * @returns selected facts.
 */
function pickFacts(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, source[key]]),
  );
}

/**
 * Calculate the directly represented ordinary level-zero HP range.
 * @param hpRule - validated HP rule.
 * @returns an inclusive range, or null for other rule variants.
 */
function zeroLevelHpRange(hpRule: Record<string, unknown>): string | null {
  if (
    hpRule.kind !== "ordinary"
    || typeof hpRule.zeroLevelDieSides !== "number"
  ) {
    return null;
  }
  const minimum = hpRule.minimumRollBoost === true ? 2 : 1;
  return `${minimum}\u2013${hpRule.zeroLevelDieSides}`;
}

/**
 * Format one attack dice tuple without changing zero values.
 * @param dice - count and side count from the source schema.
 * @returns conventional NdS text.
 */
function diceLabel(dice: AttackFact["dice"]): string {
  return `${dice.count}d${dice.sides}`;
}

/**
 * Identify JSON scalar values for compact rendering.
 * @param value - facts value.
 * @returns whether the value can be rendered directly.
 */
function isScalar(
  value: unknown,
): value is string | number | boolean | null {
  return value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean";
}

/**
 * Render one scalar deterministically.
 * @param value - validated JSON scalar.
 * @returns visible source value.
 */
function formatScalar(value: string | number | boolean | null | unknown): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Capitalize a display label while preserving the remaining source text.
 * @param value - validated name or kind.
 * @returns sentence-case label.
 */
function displayName(value: string): string {
  return value.length === 0
    ? value
    : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
