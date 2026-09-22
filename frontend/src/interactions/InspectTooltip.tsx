import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import {
  placeAnchoredOverlay,
  type AnchoredOverlayPosition,
} from "./anchored-overlay";

export interface InspectTooltipContent {
  title: string;
  description?: string;
  glyph?: string;
}

export interface LocalInspectRequest {
  kind: "inventory" | "status";
  key: string;
  anchor: { clientX: number; clientY: number };
  content: InspectTooltipContent;
}

interface PositionedInspectTooltipProps {
  content: InspectTooltipContent;
  elementRef?: Ref<HTMLDivElement>;
  hidden?: boolean;
  id: string;
  position: AnchoredOverlayPosition;
}

interface AnchoredInspectTooltipProps {
  anchor: { clientX: number; clientY: number };
  content: InspectTooltipContent;
  id: string;
}

/**
 * Render one non-interactive tooltip at already resolved viewport coordinates.
 * @param props - tooltip content, identity, and fixed position.
 * @returns accessible ephemeral inspection content.
 */
export function InspectTooltip({
  content,
  elementRef,
  hidden,
  id,
  position,
}: PositionedInspectTooltipProps) {
  return (
    <div
      aria-hidden={hidden ? "true" : undefined}
      className="nh-tooltip nh-inspect-tooltip"
      data-horizontal={position.horizontal}
      data-vertical={position.vertical}
      id={id}
      ref={elementRef}
      role="tooltip"
      style={{
        "--overlay-left": `${position.left}px`,
        "--overlay-top": `${position.top}px`,
      } as CSSProperties}
    >
      {content.glyph && (
        <span aria-hidden="true" className="nh-inspect-glyph">
          {content.glyph}
        </span>
      )}
      <strong>{content.title}</strong>
      {content.description && <span>{content.description}</span>}
    </div>
  );
}

/**
 * Measure and place one tooltip beside a client-coordinate anchor.
 * @param props - tooltip content and serializable viewport anchor.
 * @returns a measured tooltip which flips at viewport edges.
 */
export function AnchoredInspectTooltip({
  anchor,
  content,
  id,
}: AnchoredInspectTooltipProps) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<AnchoredOverlayPosition | null>(null);

  useLayoutEffect(() => {
    const tooltip = measureRef.current;
    if (!tooltip) return;

    /** Measure again after viewport geometry changes. */
    const update = (): void => {
      const bounds = tooltip.getBoundingClientRect();
      setPosition(placeAnchoredOverlay({
        anchor: { x: anchor.clientX, y: anchor.clientY },
        gap: 10,
        margin: 8,
        overlay: { width: bounds.width, height: bounds.height },
        viewport: {
          width: globalThis.innerWidth,
          height: globalThis.innerHeight,
        },
      }));
    };

    update();
    globalThis.addEventListener("resize", update);
    return () => globalThis.removeEventListener("resize", update);
  }, [anchor.clientX, anchor.clientY, content]);

  const resolved = position ?? {
    left: anchor.clientX + 10,
    top: anchor.clientY + 10,
    horizontal: "after" as const,
    vertical: "after" as const,
  };

  return (
    <InspectTooltip
      content={content}
      elementRef={measureRef}
      hidden={position === null}
      id={id}
      position={resolved}
    />
  );
}
