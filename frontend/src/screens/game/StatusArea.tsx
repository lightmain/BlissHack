import { memo, type CSSProperties } from "react";
import {
  type StatusCondition,
  type StatusMetric,
  type StatusMetricGroup,
  type StatusTooltip,
} from "../../status-metrics";
import { colorClass } from "../../text-styling";

const GROUP_ORDER: readonly StatusMetricGroup[] = [
  "identity",
  "resource",
  "attribute",
  "world",
  "condition",
];

const RESOURCE_BARS: Readonly<
  Record<string, "primary" | "secondary">
> = {
  hitpoints: "primary",
  power: "primary",
  "experience-level": "secondary",
};

const METRIC_DISPLAY_ORDER = [
  "title",
  "alignment",
  "hitpoints",
  "hitpoints-max",
  "power",
  "power-max",
  "experience-level",
  "experience",
  "HD",
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
  "armor-class",
  "dungeon-level",
  "gold",
  "time",
  "score",
  "weapon",
  "armor",
  "terrain",
  "version",
  "hunger",
  "carrying-capacity",
  "condition",
] as const;

const METRIC_DISPLAY_INDEX: ReadonlyMap<string, number> = new Map(
  METRIC_DISPLAY_ORDER.map((id, index) => [id, index]),
);

/**
 * Render semantic status metrics in compact HUD groups.
 * @param props - active metrics produced by buildStatusMetrics.
 * @returns the graphical character status area.
 */
export const StatusArea = memo(function StatusArea({
  metrics,
}: {
  metrics: readonly StatusMetric[];
}) {
  return (
    <section className="nh-status" aria-label="Character status">
      {GROUP_ORDER.map((group) => {
        const groupedMetrics = sortStatusMetrics(
          metrics.filter((metric) => metric.group === group),
        );
        if (groupedMetrics.length === 0) return null;
        return (
          <div
            className={`nh-status-group nh-status-group-${group}`}
            data-status-group={group}
            key={group}
          >
            {groupedMetrics.map(renderStatusMetric)}
          </div>
        );
      })}
    </section>
  );
});

/**
 * Render one status metric using its semantic presentation.
 * @param metric - active semantic status metric.
 * @returns one resource, condition, or compact value element.
 */
function renderStatusMetric(metric: StatusMetric) {
  if (metric.conditions) {
    return (
      <span
        className="nh-status-conditions"
        data-change={metric.change}
        key={metric.field}
      >
        {metric.conditions.map((condition) =>
          renderCondition(metric, condition))}
      </span>
    );
  }

  const barKind = RESOURCE_BARS[metric.id];
  return barKind && metric.percent !== undefined
    ? renderResourceMetric(metric, barKind)
    : renderCompactMetric(metric);
}

/**
 * Render a field with a visual percentage bar and accessible range metadata.
 * @param metric - active resource metric.
 * @param barKind - primary or secondary visual emphasis.
 * @returns a progress-based status field.
 */
function renderResourceMetric(
  metric: StatusMetric,
  barKind: "primary" | "secondary",
) {
  const tooltipId = `status-tooltip-${metric.id}`;
  return (
    <span
      aria-describedby={tooltipId}
      className={`nh-status-metric nh-status-resource ${statusClasses(metric)}`}
      data-change={metric.change}
      data-browser-tab-navigation
      key={metric.field}
      tabIndex={0}
    >
      <span className="nh-status-resource-value">{metric.text}</span>
      <span
        aria-label={`${metric.label}: ${metric.text}`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={metric.percent}
        className={`nh-status-bar nh-status-bar-${barKind}`}
        data-status-bar={barKind}
        role="progressbar"
      >
        <span
          aria-hidden="true"
          className={`nh-status-bar-fill nh-status-bar-${metric.id}`}
          style={{ "--status-percent": `${metric.percent}%` } as CSSProperties}
        />
      </span>
      <StatusTooltipContent id={tooltipId} tooltip={metric.tooltip} />
    </span>
  );
}

/**
 * Render a compact non-percentage status field.
 * @param metric - active semantic status metric.
 * @returns one focusable value and its description.
 */
function renderCompactMetric(metric: StatusMetric) {
  const tooltipId = `status-tooltip-${metric.id}`;
  return (
    <span
      aria-describedby={tooltipId}
      className={`nh-status-metric ${statusClasses(metric)}`}
      data-change={metric.change}
      data-browser-tab-navigation
      key={metric.field}
      tabIndex={0}
    >
      <span className="nh-status-value">{metric.text}</span>
      <StatusTooltipContent id={tooltipId} tooltip={metric.tooltip} />
    </span>
  );
}

/**
 * Render one condition label using the core-provided color and attributes.
 * @param metric - parent BL_CONDITION metric.
 * @param condition - decoded active condition.
 * @returns one focusable condition tag and its description.
 */
function renderCondition(
  metric: StatusMetric,
  condition: StatusCondition,
) {
  const tooltipId = `status-tooltip-condition-${condition.id}`;
  return (
    <span
      className="nh-status-condition-entry"
      data-change={metric.change}
      data-browser-tab-navigation
      key={condition.id}
      tabIndex={0}
      aria-describedby={tooltipId}
    >
      <span
        className={`nh-condition ${statusColorClass(condition.color)} ${statusAttributeClass(condition.attributes)}`}
      >
        {condition.label}
      </span>
      <StatusTooltipContent id={tooltipId} tooltip={condition.tooltip} />
    </span>
  );
}

/**
 * Render accessible tooltip content for one current status value.
 * @param props - stable identifier and constrained tooltip data.
 * @returns tooltip content revealed by CSS hover or keyboard focus.
 */
function StatusTooltipContent({
  id,
  tooltip,
}: {
  id: string;
  tooltip: StatusTooltip;
}) {
  return (
    <span className="nh-status-tooltip" id={id} role="tooltip">
      <strong>{tooltip.currentValue}</strong>
      <span>{tooltip.description}</span>
    </span>
  );
}

/**
 * Build the CSS classes for one ordinary status field.
 * @param metric - semantic status metric.
 * @returns core color and highlight attribute classes.
 */
function statusClasses(metric: StatusMetric): string {
  return [
    statusColorClass(metric.color),
    statusAttributeClass(metric.attributes),
  ].filter(Boolean).join(" ");
}

/**
 * Treat NetHack's NO_COLOR sentinel as inherited HUD text color.
 * @param color - core color index.
 * @returns a color class or an empty string for NO_COLOR.
 */
function statusColorClass(color: number): string {
  return color === 8 ? "" : colorClass(color);
}

/**
 * Order metrics for scanning while keeping unknown future fields stable.
 * @param metrics - active metrics from one semantic group.
 * @returns a display-ordered copy.
 */
function sortStatusMetrics(
  metrics: readonly StatusMetric[],
): StatusMetric[] {
  return [...metrics].sort((left, right) =>
    (METRIC_DISPLAY_INDEX.get(left.id) ?? Number.MAX_SAFE_INTEGER)
    - (METRIC_DISPLAY_INDEX.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Convert composable NetHack HL_* bits into CSS classes.
 * @param attributes - highlight mask from status_update or cond_hilites.
 * @returns space-separated presentation classes.
 */
function statusAttributeClass(attributes: number): string {
  const classes: string[] = [];
  if ((attributes & 0x02) !== 0) classes.push("nh-bold");
  if ((attributes & 0x04) !== 0) classes.push("nh-dim");
  if ((attributes & 0x08) !== 0) classes.push("nh-italic");
  if ((attributes & 0x10) !== 0) classes.push("nh-underline");
  if ((attributes & 0x20) !== 0) classes.push("nh-blink");
  if ((attributes & 0x40) !== 0) classes.push("nh-inverse");
  return classes.join(" ");
}
