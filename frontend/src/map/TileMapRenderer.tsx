import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { COLNO, ROWNO } from "../game-state";
import {
  createFrameScheduler,
  drawTileMap,
  resizeCanvasBackingStore,
  type FrameScheduler,
} from "./canvas-rendering";
import {
  loadTileAtlas,
  type TileAtlas,
} from "./tile-assets";
import {
  AsciiMapRenderer,
  type MapRendererProps,
} from "./AsciiMapRenderer";

const FALLBACK_TILE_SIZE = 16;

/**
 * Render the map into a pixel-aligned Canvas with an ASCII loading fallback.
 * @param props - current map and cursor state.
 * @returns a Canvas map after assets load, otherwise the ASCII renderer.
 */
export const TileMapRenderer = memo(function TileMapRenderer({
  cursor,
  map,
}: MapRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const schedulerRef = useRef<FrameScheduler | null>(null);
  const latestState = useRef({ cursor, map });
  const [atlas, setAtlas] = useState<TileAtlas | null>(null);
  const [atlasFailed, setAtlasFailed] = useState(false);
  const [hasPainted, setHasPainted] = useState(false);

  useLayoutEffect(() => {
    latestState.current = { cursor, map };
  }, [cursor, map]);

  useEffect(() => {
    let active = true;
    void loadTileAtlas().then(
      (loadedAtlas) => {
        if (active) setAtlas(loadedAtlas);
      },
      () => {
        if (active) setAtlasFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !atlas || atlasFailed) return;

    /**
     * Resize and repaint using the latest immutable game snapshot.
     */
    function renderMap(): void {
      if (!canvas || !atlas) return;
      const context = resizeCanvasBackingStore(
        canvas,
        COLNO * atlas.manifest.tile.width,
        ROWNO * atlas.manifest.tile.height,
        window.devicePixelRatio,
      );
      if (!context) {
        setAtlasFailed(true);
        return;
      }
      drawTileMap({
        context,
        atlas,
        map: latestState.current.map,
        cursor: latestState.current.cursor,
      });
      setHasPainted(true);
    }

    const scheduler = createFrameScheduler(
      renderMap,
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
    );
    schedulerRef.current = scheduler;
    scheduler.schedule();
    window.addEventListener("resize", scheduler.schedule);

    return () => {
      window.removeEventListener("resize", scheduler.schedule);
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [atlas, atlasFailed]);

  useEffect(() => {
    schedulerRef.current?.schedule();
  }, [cursor, map]);

  if (!atlas || atlasFailed) {
    return (
      <div className="nh-map-fallback">
        <AsciiMapRenderer cursor={cursor} map={map} />
      </div>
    );
  }

  return (
    <>
      <canvas
        aria-label="Dungeon map"
        className="nh-map nh-map-tiles"
        height={ROWNO * FALLBACK_TILE_SIZE}
        hidden={!hasPainted}
        ref={canvasRef}
        role="img"
        width={COLNO * FALLBACK_TILE_SIZE}
      />
      {!hasPainted && (
        <div className="nh-map-fallback">
          <AsciiMapRenderer cursor={cursor} map={map} />
        </div>
      )}
    </>
  );
});
