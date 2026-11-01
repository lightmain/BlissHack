import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { writeFileSpy } = vi.hoisted(() => ({
  writeFileSpy: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal(),
  writeFile: writeFileSpy,
}));

const frontendRoot = join(import.meta.dirname, "..");
const authoritativeSvg = await readFile(
  join(frontendRoot, "public", "favicon.svg"),
  "utf8",
);
const iconGenerator = await import("./scripts/generate-icons.mjs");
const parseIconSvg = iconGenerator.parseIconSvg;

it("can be imported for unit tests without generating files", () => {
  expect.soft(
    writeFileSpy,
    "importing the icon generator must not write generated assets",
  ).not.toHaveBeenCalled();
  expect(
    parseIconSvg,
    "the icon generator must export parseIconSvg for focused validation tests",
  ).toBeTypeOf("function");
});

describe.runIf(typeof parseIconSvg === "function")("parseIconSvg", () => {
  it("accepts the checked-in authoritative favicon", () => {
    expect(() => parseIconSvg(authoritativeSvg)).not.toThrow();
  });

  it.each([
    ["circle", '<circle cx="8" cy="8" r="2" fill="#ffffff"/>'],
    ["rectangle", '<rect x="1" y="1" width="2" height="2" fill="#ffffff"/>'],
    ["path", '<path fill="#ffffff" d="M1 1h2v2h-2z"/>'],
    ["text", '<text x="1" y="2" fill="#ffffff">x</text>'],
    ["use reference", '<use href="#player" x="1" y="1"/>'],
  ])("rejects an extra visible %s element", (_label, extraElement) => {
    expect(() => parseIconSvg(iconSvg({ extraElement }))).toThrow();
  });

  it.each([
    ["root", "transform", "translate(1 0)"],
    ["background", "transform", "translate(1 0)"],
    ["glyph", "transform", "translate(1 0)"],
    ["root", "style", "opacity: 0.5"],
    ["background", "style", "opacity: 0.5"],
    ["glyph", "style", "opacity: 0.5"],
    ["root", "stroke", "#ffffff"],
    ["background", "stroke", "#ffffff"],
    ["glyph", "stroke", "#ffffff"],
  ])("rejects %s %s", (target, attribute, value) => {
    expect(() =>
      parseIconSvg(iconSvg({
        [`${target}Attributes`]: `${attribute}="${value}"`,
      }))
    ).toThrow();
  });

  it.each([
    ["opacity", "0.5"],
    ["fill-opacity", "0.5"],
    ["display", "none"],
    ["visibility", "hidden"],
    ["filter", "url(#shadow)"],
    ["clip-path", "url(#clip)"],
  ])("rejects glyph %s that would diverge from raster output", (
    attribute,
    value,
  ) => {
    expect(() =>
      parseIconSvg(iconSvg({
        glyphAttributes: `${attribute}="${value}"`,
      }))
    ).toThrow();
  });

  it("rejects embedded CSS that could alter browser rendering", () => {
    expect(() =>
      parseIconSvg(iconSvg({
        extraElement: "<style>path { opacity: 0 }</style>",
      }))
    ).toThrow();
  });
});

/** Build a complete SVG fixture while varying only the contract under test. */
function iconSvg({
  rootAttributes = "",
  backgroundAttributes = "",
  glyphAttributes = "",
  extraElement = "",
} = {}) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img"`,
    ` aria-labelledby="icon-title" viewBox="0 0 16 16"`,
    ` shape-rendering="crispEdges" ${rootAttributes}>`,
    '<title id="icon-title">BlissHack @ dungeon tile</title>',
    `<rect width="16" height="16" fill="#141817"`,
    ` ${backgroundAttributes}/>`,
    `<path data-glyph="@" fill="#f5f1e8"`,
    ` d="M4 4h8v8h-8z" ${glyphAttributes}/>`,
    extraElement,
    "</svg>",
  ].join("");
}
