import { memo } from "react";
import type { LocalInspectRequest } from "../../interactions/InspectTooltip";
import type {
  StatusMetric,
  StatusCondition,
} from "../../status-metrics";
import type { InformationLevel } from "../../settings/profile";
import {
  StatusEntry,
} from "./StatusArea";
import {
  statusAttributeClass,
  statusColorClass,
} from "./status-presentation";

const LINE_ONE_FIELDS = [
  "title",
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
  "alignment",
  "score",
] as const;

const LINE_TWO_FIELDS = [
  "dungeon-level",
  "gold",
  "hitpoints",
  "hitpoints-max",
  "power",
  "power-max",
  "armor-class",
  "experience-level",
  "experience",
  "HD",
  "time",
  "hunger",
  "carrying-capacity",
  "condition",
  "weapon",
  "armor",
  "terrain",
  "version",
] as const;

interface OriginalStatusAreaProps {
  informationLevel: InformationLevel;
  metrics: readonly StatusMetric[];
  onInspect?(request: LocalInspectRequest): void;
  onInspectLeave?(key?: string): void;
}

/**
 * Render core-enabled status fields in NetHack's original two-line TTY order.
 * @param props - active metrics and optional detailed inspection callbacks.
 * @returns a two-line text status area without graphical resource bars.
 */
export const OriginalStatusArea = memo(function OriginalStatusArea({
  informationLevel,
  metrics,
  onInspect,
  onInspectLeave,
}: OriginalStatusAreaProps) {
  const metricsById = new Map(metrics.map((metric) => [metric.id, metric]));
  return (
    <section className="nh-original-status" aria-label="Character status">
      <div className="nh-original-status-line" data-status-line="1">
        {LINE_ONE_FIELDS.map((id) =>
          renderOriginalMetric(
            metricsById.get(id),
            informationLevel,
            onInspect,
            onInspectLeave,
          ))}
      </div>
      <div className="nh-original-status-line" data-status-line="2">
        {LINE_TWO_FIELDS.map((id) =>
          renderOriginalMetric(
            metricsById.get(id),
            informationLevel,
            onInspect,
            onInspectLeave,
          ))}
      </div>
    </section>
  );
});

/**
 * Render one ordinary field or the independently styled active conditions.
 * @param metric - semantic status metric, or undefined for a hidden field.
 * @param informationLevel - whether explanatory inspection is enabled.
 * @param onInspect - optional shared tooltip publisher.
 * @param onInspectLeave - optional shared tooltip dismissal callback.
 * @returns one status field, a condition group, or null.
 */
function renderOriginalMetric(
  metric: StatusMetric | undefined,
  informationLevel: InformationLevel,
  onInspect?: (request: LocalInspectRequest) => void,
  onInspectLeave?: (key?: string) => void,
) {
  if (!metric) return null;
  if (metric.conditions) {
    return (
      <span
        className="nh-original-status-conditions"
        data-change={metric.change}
        data-status-field={metric.id}
        key={metric.field}
      >
        {metric.conditions.map((condition) =>
          renderOriginalCondition(
            metric,
            condition,
            informationLevel,
            onInspect,
            onInspectLeave,
          ))}
      </span>
    );
  }
  return (
    <StatusEntry
      className={[
        "nh-original-status-field",
        statusColorClass(metric.color),
        statusAttributeClass(metric.attributes),
      ].filter(Boolean).join(" ")}
      dataChange={metric.change}
      dataStatusField={metric.id}
      informationLevel={informationLevel}
      inspectKey={`status:${metric.id}`}
      key={metric.field}
      onInspect={onInspect}
      onInspectLeave={onInspectLeave}
      tooltip={metric.tooltip}
      tooltipId={`status-tooltip-${metric.id}`}
    >
      {metric.text}
    </StatusEntry>
  );
}

/**
 * Render one active TTY condition with its core-provided appearance.
 * @param metric - parent condition field.
 * @param condition - decoded condition and independent styling.
 * @param informationLevel - whether explanatory inspection is enabled.
 * @param onInspect - optional shared tooltip publisher.
 * @param onInspectLeave - optional shared tooltip dismissal callback.
 * @returns one styled condition status entry.
 */
function renderOriginalCondition(
  metric: StatusMetric,
  condition: StatusCondition,
  informationLevel: InformationLevel,
  onInspect?: (request: LocalInspectRequest) => void,
  onInspectLeave?: (key?: string) => void,
) {
  return (
    <StatusEntry
      className={[
        "nh-original-status-condition",
        statusColorClass(condition.color),
        statusAttributeClass(condition.attributes),
      ].filter(Boolean).join(" ")}
      dataChange={metric.change}
      dataStatusCondition={condition.id}
      informationLevel={informationLevel}
      inspectKey={`status:condition:${condition.id}`}
      key={condition.id}
      onInspect={onInspect}
      onInspectLeave={onInspectLeave}
      tooltip={condition.tooltip}
      tooltipId={`status-tooltip-condition-${condition.id}`}
    >
      {condition.label}
    </StatusEntry>
  );
}
