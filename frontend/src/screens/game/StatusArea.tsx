import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { LocalInspectRequest } from "../../interactions/InspectTooltip";
import {
  planLocalInspectActivity,
  type LocalInspectActivity,
  type LocalInspectActivityEvent,
} from "../../interactions/local-inspect-activity";
import {
  type StatusCondition,
  type StatusMetric,
  type StatusMetricGroup,
  type StatusTooltip,
} from "../../status-metrics";
import type { InformationLevel } from "../../settings/profile";
import {
  statusAttributeClass,
  statusColorClass,
} from "./status-presentation";

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
  informationLevel,
  metrics,
  onInspect,
  onInspectLeave,
}: {
  informationLevel: InformationLevel;
  metrics: readonly StatusMetric[];
  onInspect?(request: LocalInspectRequest): void;
  onInspectLeave?(key?: string): void;
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
            {groupedMetrics.map((metric) =>
              renderStatusMetric(
                metric,
                informationLevel,
                onInspect,
                onInspectLeave,
              ))}
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
function renderStatusMetric(
  metric: StatusMetric,
  informationLevel: InformationLevel,
  onInspect?: (request: LocalInspectRequest) => void,
  onInspectLeave?: (key?: string) => void,
) {
  if (metric.conditions) {
    return (
      <span
        className="nh-status-conditions"
        data-change={metric.change}
        data-status-field={metric.id}
        key={metric.field}
      >
        {metric.conditions.map((condition) =>
          renderCondition(
            metric,
            condition,
            informationLevel,
            onInspect,
            onInspectLeave,
          ))}
      </span>
    );
  }

  const barKind = RESOURCE_BARS[metric.id];
  return barKind && metric.percent !== undefined
    ? renderResourceMetric(
      metric,
      barKind,
      informationLevel,
      onInspect,
      onInspectLeave,
    )
    : renderCompactMetric(
      metric,
      informationLevel,
      onInspect,
      onInspectLeave,
    );
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
  informationLevel: InformationLevel,
  onInspect?: (request: LocalInspectRequest) => void,
  onInspectLeave?: (key?: string) => void,
) {
  const tooltipId = `status-tooltip-${metric.id}`;
  return (
    <StatusEntry
      className={`nh-status-metric nh-status-resource ${statusClasses(metric)}`}
      dataChange={metric.change}
      dataStatusField={metric.id}
      informationLevel={informationLevel}
      key={metric.field}
      inspectKey={`status:${metric.id}`}
      onInspect={onInspect}
      onInspectLeave={onInspectLeave}
      tooltipId={tooltipId}
      tooltip={metric.tooltip}
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
    </StatusEntry>
  );
}

/**
 * Render a compact non-percentage status field.
 * @param metric - active semantic status metric.
 * @returns one focusable value and its description.
 */
function renderCompactMetric(
  metric: StatusMetric,
  informationLevel: InformationLevel,
  onInspect?: (request: LocalInspectRequest) => void,
  onInspectLeave?: (key?: string) => void,
) {
  const tooltipId = `status-tooltip-${metric.id}`;
  return (
    <StatusEntry
      className={`nh-status-metric ${statusClasses(metric)}`}
      dataChange={metric.change}
      dataStatusField={metric.id}
      informationLevel={informationLevel}
      key={metric.field}
      inspectKey={`status:${metric.id}`}
      onInspect={onInspect}
      onInspectLeave={onInspectLeave}
      tooltipId={tooltipId}
      tooltip={metric.tooltip}
    >
      <span className="nh-status-value">{metric.text}</span>
    </StatusEntry>
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
  informationLevel: InformationLevel,
  onInspect?: (request: LocalInspectRequest) => void,
  onInspectLeave?: (key?: string) => void,
) {
  const tooltipId = `status-tooltip-condition-${condition.id}`;
  return (
    <StatusEntry
      className="nh-status-condition-entry"
      dataChange={metric.change}
      informationLevel={informationLevel}
      key={condition.id}
      inspectKey={`status:condition:${condition.id}`}
      onInspect={onInspect}
      onInspectLeave={onInspectLeave}
      tooltipId={tooltipId}
      tooltip={condition.tooltip}
    >
      <span
        className={`nh-condition ${statusColorClass(condition.color)} ${statusAttributeClass(condition.attributes)}`}
      >
        {condition.label}
      </span>
    </StatusEntry>
  );
}

/**
 * Add explanatory inspection behavior only for the detailed information level.
 * @param props - status content, semantic change, and optional inspect callbacks.
 * @returns a plain status value or a focusable detailed-inspection target.
 */
export function StatusEntry({
  children,
  className,
  dataChange,
  dataStatusCondition,
  dataStatusField,
  informationLevel,
  inspectKey,
  onInspect,
  onInspectLeave,
  tooltip,
  tooltipId,
}: {
  children: ReactNode;
  className: string;
  dataChange: number;
  dataStatusCondition?: string;
  dataStatusField?: string;
  informationLevel: InformationLevel;
  inspectKey: string;
  onInspect?: (request: LocalInspectRequest) => void;
  onInspectLeave?: (key?: string) => void;
  tooltip: StatusTooltip;
  tooltipId: string;
}) {
  if (informationLevel === "original") {
    return (
      <span
        className={className}
        data-change={dataChange}
        data-status-condition={dataStatusCondition}
        data-status-field={dataStatusField}
      >
        {children}
      </span>
    );
  }
  return (
    <InspectableStatus
      className={className}
      dataChange={dataChange}
      dataStatusCondition={dataStatusCondition}
      dataStatusField={dataStatusField}
      describedBy={tooltipId}
      inspectKey={inspectKey}
      onInspect={onInspect}
      onInspectLeave={onInspectLeave}
      tooltip={tooltip}
    >
      {children}
      <StatusTooltipContent id={tooltipId} tooltip={tooltip} />
    </InspectableStatus>
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
 * Own hover and focus jointly for one status field in the shared overlay.
 * @param props - visual content, tooltip data, and overlay callbacks.
 * @returns one focusable status wrapper.
 */
function InspectableStatus({
  children,
  className,
  dataChange,
  dataStatusCondition,
  dataStatusField,
  describedBy,
  inspectKey,
  onInspect,
  onInspectLeave,
  tooltip,
}: {
  children: ReactNode;
  className: string;
  dataChange: number;
  dataStatusCondition?: string;
  dataStatusField?: string;
  describedBy: string;
  inspectKey: string;
  onInspect?: (request: LocalInspectRequest) => void;
  onInspectLeave?: (key?: string) => void;
  tooltip: StatusTooltip;
}) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const wasActiveRef = useRef(false);
  const [activity, setActivity] = useState<LocalInspectActivity>({
    focused: false,
    pointerInside: false,
  });
  const active = activity.focused || activity.pointerInside;

  useEffect(() => () => {
    if (wasActiveRef.current) onInspectLeave?.(inspectKey);
  }, [inspectKey, onInspectLeave]);

  useEffect(() => {
    if (active && elementRef.current && onInspect) {
      const bounds = elementRef.current.getBoundingClientRect();
      onInspect({
        kind: "status",
        key: inspectKey,
        anchor: {
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top,
        },
        content: {
          title: tooltip.currentValue,
          description: tooltip.description,
        },
      });
    } else if (wasActiveRef.current && !active) {
      onInspectLeave?.(inspectKey);
    }
    wasActiveRef.current = active;
  }, [active, inspectKey, onInspect, onInspectLeave, tooltip]);

  /** Apply one pointer or focus boundary to the joint ownership state. */
  function updateActivity(event: LocalInspectActivityEvent): void {
    setActivity((current) => planLocalInspectActivity(current, event).next);
  }

  return (
    <span
      aria-describedby={describedBy}
      className={className}
      data-browser-tab-navigation
      data-change={dataChange}
      data-inspect-target={inspectKey}
      data-status-condition={dataStatusCondition}
      data-status-field={dataStatusField}
      onBlur={() => updateActivity("blur")}
      onFocus={() => updateActivity("focus")}
      onPointerEnter={() => updateActivity("pointer-enter")}
      onPointerLeave={() => updateActivity("pointer-leave")}
      ref={elementRef}
      tabIndex={0}
    >
      {children}
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
