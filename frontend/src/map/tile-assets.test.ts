import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadTileAtlas,
  resetTileAtlasCacheForTests,
  type TileAssetLoadOptions,
  type TileAtlas,
  type TileManifest,
} from "./tile-assets";

/** Return the checked-in classic tile manifest fields consumed at runtime. */
function manifest(
  overrides: Partial<TileManifest["atlas"]> = {},
): TileManifest {
  return {
    formatVersion: 1,
    tile: {
      width: 16,
      height: 16,
    },
    atlas: {
      file: "nethack-classic.png",
      columns: 40,
      rows: 58,
      tileCount: 2307,
      ...overrides,
    },
    specialTiles: {
      blank: 1470,
      unexplored: 1469,
      petMark: 2305,
      pileMark: 2306,
    },
  };
}

/** Return an image-shaped object without requiring a browser DOM. */
function image(width = 640, height = 928): TileAtlas["image"] {
  return {
    naturalWidth: width,
    naturalHeight: height,
  } as TileAtlas["image"];
}

/** Create injectable asset loaders with observable call counts. */
function loaders(
  tileManifest: TileManifest = manifest(),
  tileImage: TileAtlas["image"] = image(),
): Required<Pick<TileAssetLoadOptions, "fetchManifest" | "loadImage">> {
  return {
    fetchManifest: vi.fn(async () => tileManifest),
    loadImage: vi.fn(async () => tileImage),
  };
}

beforeEach(() => {
  resetTileAtlasCacheForTests();
});

describe("loadTileAtlas", () => {
  it("shares one concurrent manifest and image load", async () => {
    const dependencies = loaders();

    const [first, second] = await Promise.all([
      loadTileAtlas(dependencies),
      loadTileAtlas(dependencies),
    ]);

    expect(first).toBe(second);
    expect(first.manifest.atlas.tileCount).toBe(2307);
    expect(first.image.naturalWidth).toBe(640);
    expect(first.image.naturalHeight).toBe(928);
    expect(dependencies.fetchManifest).toHaveBeenCalledOnce();
    expect(dependencies.fetchManifest).toHaveBeenCalledWith(
      "/tiles/nethack-classic.json",
    );
    expect(dependencies.loadImage).toHaveBeenCalledOnce();
    expect(dependencies.loadImage).toHaveBeenCalledWith(
      "/tiles/nethack-classic.png",
    );
  });

  it.each(["/BlissHack", "/BlissHack/"])(
    "normalizes custom base URL %s",
    async (baseUrl) => {
      const dependencies = loaders();

      await loadTileAtlas({ baseUrl, ...dependencies });

      expect(dependencies.fetchManifest).toHaveBeenCalledWith(
        "/BlissHack/tiles/nethack-classic.json",
      );
      expect(dependencies.loadImage).toHaveBeenCalledWith(
        "/BlissHack/tiles/nethack-classic.png",
      );
    },
  );

  it.each([
    {
      name: "tile count",
      tileManifest: manifest({ tileCount: 2306 }),
      tileImage: image(),
      expected: /2307/,
    },
    {
      name: "image width",
      tileManifest: manifest(),
      tileImage: image(639, 928),
      expected: /640/,
    },
    {
      name: "image height",
      tileManifest: manifest(),
      tileImage: image(640, 927),
      expected: /928/,
    },
  ])(
    "rejects an atlas with the wrong $name",
    async ({ tileManifest, tileImage, expected }) => {
      await expect(loadTileAtlas(loaders(tileManifest, tileImage)))
        .rejects.toThrow(expected);
    },
  );

  it("allows a failed image load to be retried", async () => {
    const fetchManifest = vi.fn(async () => manifest());
    const loadImage = vi.fn()
      .mockRejectedValueOnce(new Error("image unavailable"))
      .mockResolvedValueOnce(image());
    const dependencies = { fetchManifest, loadImage };

    await expect(loadTileAtlas(dependencies)).rejects.toThrow(
      "image unavailable",
    );
    await expect(loadTileAtlas(dependencies)).resolves.toMatchObject({
      manifest: {
        atlas: {
          tileCount: 2307,
        },
      },
    });

    expect(fetchManifest).toHaveBeenCalledTimes(2);
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it("allows a failed manifest fetch to be retried", async () => {
    const fetchManifest = vi.fn()
      .mockRejectedValueOnce(new Error("manifest unavailable"))
      .mockResolvedValueOnce(manifest());
    const loadImage = vi.fn(async () => image());
    const dependencies = { fetchManifest, loadImage };

    await expect(loadTileAtlas(dependencies)).rejects.toThrow(
      "manifest unavailable",
    );
    await expect(loadTileAtlas(dependencies)).resolves.toMatchObject({
      manifest: {
        atlas: {
          tileCount: 2307,
        },
      },
    });

    expect(fetchManifest).toHaveBeenCalledTimes(2);
    expect(loadImage).toHaveBeenCalledOnce();
  });

  it("reuses a successful atlas across different injected loaders", async () => {
    const firstDependencies = loaders();
    const laterDependencies = loaders();

    const first = await loadTileAtlas(firstDependencies);
    const later = await loadTileAtlas(laterDependencies);

    expect(later).toBe(first);
    expect(firstDependencies.fetchManifest).toHaveBeenCalledOnce();
    expect(firstDependencies.loadImage).toHaveBeenCalledOnce();
    expect(laterDependencies.fetchManifest).not.toHaveBeenCalled();
    expect(laterDependencies.loadImage).not.toHaveBeenCalled();
  });

  it("loads the assets again after the test cache is reset", async () => {
    const dependencies = loaders();

    await loadTileAtlas(dependencies);
    resetTileAtlasCacheForTests();
    await loadTileAtlas(dependencies);

    expect(dependencies.fetchManifest).toHaveBeenCalledTimes(2);
    expect(dependencies.loadImage).toHaveBeenCalledTimes(2);
  });
});
