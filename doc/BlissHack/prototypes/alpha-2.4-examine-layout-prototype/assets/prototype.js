(function () {
  "use strict";

  var body = document.body;
  var frame = document.querySelector("[data-runtime-snapshot]");
  var modeButtons = Array.from(
    document.querySelectorAll("[data-mode-control]"),
  );
  var fontButtons = Array.from(
    document.querySelectorAll("[data-font-control]"),
  );
  var collapseButton = document.querySelector("[data-controls-collapse]");
  var expandButton = document.querySelector("[data-controls-expand]");
  var dialogToggle = document.querySelector("[data-dialog-toggle]");
  var captionTitle = document.querySelector("[data-caption-title]");
  var captionCopy = document.querySelector("[data-caption-copy]");
  var frameState = null;

  var PROPOSAL_STYLES = [
    "html[data-prototype-mode=\"proposal\"] .examine-dialog {",
    "  width: min(1180px, calc(100vw - 56px));",
    "  height: min(760px, calc(100dvh - 56px));",
    "  font-family: var(--blisshack-monospace-font);",
    "  font-size: inherit;",
    "  line-height: 1.3;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-header {",
    "  min-height: 88px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-heading {",
    "  min-width: 0;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-title-row {",
    "  min-width: 0;",
    "  display: flex;",
    "  align-items: center;",
    "  gap: 12px;",
    "  flex-wrap: wrap;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-title-row h1 {",
    "  min-width: 0;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-wiki-link {",
    "  min-height: 28px;",
    "  flex: 0 0 auto;",
    "  display: inline-flex;",
    "  align-items: center;",
    "  gap: 6px;",
    "  padding: 4px 7px;",
    "  border: 1px solid #59666a;",
    "  border-radius: 3px;",
    "  color: #78bac8;",
    "  font-size: 12px;",
    "  font-weight: 700;",
    "  line-height: 1;",
    "  text-decoration: none;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-wiki-link:hover,",
    "html[data-prototype-mode=\"proposal\"] .prototype-wiki-link:focus-visible {",
    "  border-color: #78bac8;",
    "  outline: none;",
    "  background: #20292d;",
    "  color: #fff;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-wiki-link svg {",
    "  width: 14px;",
    "  height: 14px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-heading p {",
    "  font-size: 13px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-badge {",
    "  font: 600 12px/1.2 var(--blisshack-monospace-font);",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-layout[data-facts-only=\"true\"] {",
    "  grid-template-columns: minmax(0, 1fr);",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-layout[data-facts-only=\"true\"] .examine-facts {",
    "  width: 100%;",
    "  max-width: none;",
    "  display: grid;",
    "  grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);",
    "  gap: 0 28px;",
    "  align-content: start;",
    "  justify-self: stretch;",
    "  padding: 24px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-facts-column {",
    "  min-width: 0;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-facts-primary {",
    "  padding-right: 28px;",
    "  border-right: 1px solid #30383a;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-facts section {",
    "  padding-bottom: 20px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-facts section + section {",
    "  padding-top: 20px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-facts h2 {",
    "  margin-bottom: 12px;",
    "  color: #b9c2c2;",
    "  font-size: 12px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-facts-primary .prototype-section-primary > h2 {",
    "  color: #e5ca70;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-detail-row {",
    "  grid-template-columns: minmax(9rem, auto) minmax(0, 1fr);",
    "  gap: 14px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-detail-row dt {",
    "  color: #9ba5a6;",
    "  font-size: 13px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-detail-row dd {",
    "  color: #e6e8e4;",
    "  font-size: 14px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-detail-list {",
    "  grid-template-columns: repeat(2, minmax(0, 1fr));",
    "  gap: 0;",
    "  border-top: 1px solid #30383a;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-detail-row {",
    "  display: block;",
    "  padding: 10px 12px 11px 0;",
    "  border-bottom: 1px solid #30383a;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-detail-row:nth-child(even) {",
    "  padding-right: 0;",
    "  padding-left: 14px;",
    "  border-left: 1px solid #30383a;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-detail-row dt {",
    "  font-size: 12px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-detail-row dd {",
    "  margin-top: 4px;",
    "  color: #f4f6f3;",
    "  font-size: 16px;",
    "  font-weight: 700;",
    "  text-align: left;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .prototype-key-field dd {",
    "  color: #fff;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-stat-grid {",
    "  margin-top: 12px;",
    "  padding: 11px 12px;",
    "  border: 1px solid #706438;",
    "  background: #17170f;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-stat-grid dt {",
    "  font-size: 12px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-stat-grid dd {",
    "  color: #e5ca70;",
    "  font-size: 18px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-attack {",
    "  grid-template-columns: 30px minmax(0, 1fr) auto;",
    "  gap: 11px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-attack-index {",
    "  width: 30px;",
    "  height: 30px;",
    "  font-size: 13px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-attack strong {",
    "  font-size: 14px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-attack span {",
    "  font-size: 12px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-attack > code {",
    "  font-size: 17px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-trait {",
    "  padding: 5px 8px;",
    "  font-size: 13px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-empty-value {",
    "  font-size: 13px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-provenance {",
    "  grid-column: 1 / -1;",
    "  margin-top: 2px;",
    "  padding-top: 18px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-provenance h2,",
    "html[data-prototype-mode=\"proposal\"] .prototype-provenance p,",
    "html[data-prototype-mode=\"proposal\"] .prototype-provenance code {",
    "  font-size: 11px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-provenance .examine-source-list {",
    "  grid-template-columns: repeat(2, minmax(0, 1fr));",
    "}",
    "html[data-prototype-mode=\"proposal\"] .prototype-provenance .examine-source-list span {",
    "  font-size: 10px;",
    "}",
    "html[data-prototype-mode=\"proposal\"] .examine-license-note {",
    "  font-size: 11px;",
    "}",
    ".prototype-dialog-closed {",
    "  display: none !important;",
    "}",
    "@media (max-width: 760px) {",
    "  html[data-prototype-mode=\"proposal\"] .examine-layout[data-facts-only=\"true\"] .examine-facts {",
    "    display: block;",
    "    padding: 18px;",
    "  }",
    "  html[data-prototype-mode=\"proposal\"] .prototype-facts-primary {",
    "    padding-right: 0;",
    "    border-right: 0;",
    "  }",
    "  html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-detail-list {",
    "    grid-template-columns: minmax(0, 1fr);",
    "  }",
    "  html[data-prototype-mode=\"proposal\"] .prototype-core-statistics .examine-detail-row:nth-child(even) {",
    "    padding-left: 0;",
    "    border-left: 0;",
    "  }",
    "  html[data-prototype-mode=\"proposal\"] .prototype-provenance .examine-source-list {",
    "    grid-template-columns: minmax(0, 1fr);",
    "  }",
    "}",
  ].join("\n");

  /**
   * Return the current same-origin snapshot document.
   * @returns {Document|null} Loaded frame document or null before readiness.
   */
  function getFrameDocument() {
    try {
      return frame.contentDocument;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Build stable references to the captured Examine DOM.
   * @param {Document} doc - Loaded snapshot document.
   * @returns {object|null} Mutable prototype state or null if capture is invalid.
   */
  function createFrameState(doc) {
    var facts = doc.querySelector(".examine-facts");
    var heading = doc.querySelector(".examine-heading");
    var backdrop = doc.querySelector(".examine-backdrop");
    if (!facts || !heading || !backdrop) return null;
    return {
      backdrop: backdrop,
      closeButton: null,
      doc: doc,
      facts: facts,
      heading: heading,
      h1: heading.querySelector("h1"),
      sections: Array.from(facts.querySelectorAll(":scope > section")),
      titleRow: null,
      wikiLink: null,
      wrappers: [],
    };
  }

  /**
   * Add proposal-only CSS after the captured production stylesheet.
   * @param {Document} doc - Loaded snapshot document.
   * @returns {void}
   */
  function installProposalStyles(doc) {
    if (doc.querySelector("#examine-layout-proposal-styles")) return;
    var style = doc.createElement("style");
    style.id = "examine-layout-proposal-styles";
    style.textContent = PROPOSAL_STYLES;
    doc.head.appendChild(style);
  }

  /**
   * Restore the tile bitmap that an HTML DOM snapshot cannot serialize.
   * @param {Document} doc - Loaded snapshot document.
   * @returns {void}
   */
  function restorePortraitTile(doc) {
    var canvas = doc.querySelector(".examine-portrait-tile");
    var portrait = doc.querySelector(".examine-portrait");
    if (!canvas || !portrait) return;
    var tileIndex = Number(portrait.dataset.tileIndex);
    if (!Number.isInteger(tileIndex) || tileIndex < 0) return;
    var image = new Image();
    image.addEventListener("load", function () {
      var context = canvas.getContext("2d");
      if (!context) return;
      var tileSize = 16;
      var columns = 40;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, tileSize, tileSize);
      context.drawImage(
        image,
        (tileIndex % columns) * tileSize,
        Math.floor(tileIndex / columns) * tileSize,
        tileSize,
        tileSize,
        0,
        0,
        tileSize,
        tileSize,
      );
    });
    image.src = new URL(
      "./assets/nethack-classic.png",
      window.location.href,
    ).href;
  }

  /**
   * Create the direct, identity-safe Wiki page link for the captured kitten.
   * @param {Document} doc - Loaded snapshot document.
   * @returns {HTMLAnchorElement} Fixed external link.
   */
  function createWikiLink(doc) {
    var link = doc.createElement("a");
    link.className = "prototype-wiki-link";
    link.href = "https://nethackwiki.com/wiki/Kitten";
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.title = "Open Kitten on NetHackWiki";
    link.setAttribute("aria-label", "Open Kitten on NetHackWiki");
    link.innerHTML = [
      "<svg aria-hidden=\"true\" class=\"lucide lucide-external-link\" ",
      "fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\" ",
      "stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\">",
      "<path d=\"M15 3h6v6\"></path>",
      "<path d=\"M10 14 21 3\"></path>",
      "<path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8",
      "a2 2 0 0 1 2-2h6\"></path>",
      "</svg><span>Wiki</span>",
    ].join("");
    return link;
  }

  /**
   * Add the proposal header row without changing the captured current mode.
   * @param {object} state - Mutable frame state.
   * @returns {void}
   */
  function installProposalHeader(state) {
    if (!state.h1 || state.titleRow) return;
    var row = state.doc.createElement("div");
    row.className = "prototype-title-row";
    var link = createWikiLink(state.doc);
    state.heading.insertBefore(row, state.h1);
    row.append(state.h1, link);
    state.titleRow = row;
    state.wikiLink = link;
  }

  /**
   * Restore the exact captured header node order.
   * @param {object} state - Mutable frame state.
   * @returns {void}
   */
  function restoreCurrentHeader(state) {
    if (!state.titleRow || !state.h1) return;
    state.heading.insertBefore(state.h1, state.titleRow);
    state.titleRow.remove();
    state.titleRow = null;
    state.wikiLink = null;
  }

  /**
   * Return one fact section by its production heading.
   * @param {object} state - Mutable frame state.
   * @param {string} title - Exact h2 text.
   * @returns {HTMLElement|null} Matching section.
   */
  function sectionByTitle(state, title) {
    return state.sections.find(function (section) {
      var heading = section.querySelector("h2");
      return heading && heading.textContent.trim() === title;
    }) || null;
  }

  /**
   * Mark key core rows for stronger proposal emphasis.
   * @param {HTMLElement} section - Core statistics section.
   * @returns {void}
   */
  function markKeyRows(section) {
    var keyLabels = [
      "monsterClass",
      "level",
      "difficulty",
      "speed",
      "armorClass",
      "magicResistance",
      "alignment",
    ];
    Array.from(section.querySelectorAll(".examine-detail-row")).forEach(
      function (row) {
        var label = row.querySelector("dt");
        row.classList.toggle(
          "prototype-key-field",
          Boolean(label && keyLabels.includes(label.textContent.trim())),
        );
      },
    );
  }

  /**
   * Reorder the captured fact sections into primary and secondary columns.
   * @param {object} state - Mutable frame state.
   * @returns {void}
   */
  function installProposalFacts(state) {
    if (state.wrappers.length > 0) return;
    var primary = state.doc.createElement("div");
    var secondary = state.doc.createElement("div");
    primary.className = "prototype-facts-column prototype-facts-primary";
    secondary.className = "prototype-facts-column prototype-facts-secondary";

    ["Core statistics", "Attack", "Generation"].forEach(function (title) {
      var section = sectionByTitle(state, title);
      if (!section) return;
      section.classList.add("prototype-section-primary");
      primary.appendChild(section);
    });
    ["HP rule", "Traits and resistances", "Corpse"].forEach(function (title) {
      var section = sectionByTitle(state, title);
      if (section) secondary.appendChild(section);
    });

    var core = sectionByTitle(state, "Core statistics");
    if (core) {
      core.classList.add("prototype-core-statistics");
      markKeyRows(core);
    }
    var provenance = sectionByTitle(state, "Core provenance");
    if (provenance) provenance.classList.add("prototype-provenance");

    state.facts.append(primary, secondary);
    if (provenance) state.facts.appendChild(provenance);
    state.wrappers = [primary, secondary];
  }

  /**
   * Restore every production fact section to its captured source order.
   * @param {object} state - Mutable frame state.
   * @returns {void}
   */
  function restoreCurrentFacts(state) {
    state.sections.forEach(function (section) {
      section.classList.remove(
        "prototype-section-primary",
        "prototype-core-statistics",
        "prototype-provenance",
      );
      Array.from(section.querySelectorAll(".prototype-key-field")).forEach(
        function (row) {
          row.classList.remove("prototype-key-field");
        },
      );
      state.facts.appendChild(section);
    });
    state.wrappers.forEach(function (wrapper) {
      wrapper.remove();
    });
    state.wrappers = [];
  }

  /**
   * Apply one of the game's real terminal font-size classes.
   * @param {string} font - small, medium, or large.
   * @returns {void}
   */
  function applyFrameFont(font) {
    if (!frameState) return;
    var shell = frameState.doc.querySelector(".nh-shell");
    if (!shell) return;
    shell.classList.remove("nh-font-small", "nh-font-medium", "nh-font-large");
    shell.classList.add("nh-font-" + font);
  }

  /**
   * Apply current or proposal mode to the captured frame.
   * @param {string} mode - current or proposal.
   * @returns {void}
   */
  function applyFrameMode(mode) {
    if (!frameState) return;
    if (mode === "proposal") {
      installProposalHeader(frameState);
      installProposalFacts(frameState);
    } else {
      restoreCurrentHeader(frameState);
      restoreCurrentFacts(frameState);
    }
    frameState.doc.documentElement.dataset.prototypeMode = mode;
    frameState.facts.scrollTop = 0;
  }

  /**
   * Keep the compare controls and caption synchronized.
   * @param {string} mode - current or proposal.
   * @returns {void}
   */
  function selectMode(mode) {
    body.dataset.mode = mode;
    modeButtons.forEach(function (button) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.modeControl === mode),
      );
    });
    captionTitle.textContent = mode === "proposal" ? "建议方案" : "当前实现";
    captionCopy.textContent = mode === "proposal"
      ? "：同一份 Kitten DOM；继承游戏等宽正文、主次双栏、重点字段与 Wiki 链接。"
      : "：直接渲染游戏内保存的 Kitten facts-only 快照。";
    applyFrameMode(mode);
  }

  /**
   * Keep the host controls and game font class synchronized.
   * @param {string} font - small, medium, or large.
   * @returns {void}
   */
  function selectFont(font) {
    body.dataset.font = font;
    fontButtons.forEach(function (button) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.fontControl === font),
      );
    });
    applyFrameFont(font);
  }

  /**
   * Show or hide the captured dialog and update its control label.
   * @param {boolean} open - Whether the dialog should be visible.
   * @returns {void}
   */
  function setDialogOpen(open) {
    if (!frameState) return;
    frameState.backdrop.classList.toggle("prototype-dialog-closed", !open);
    dialogToggle.setAttribute("aria-pressed", String(open));
    dialogToggle.setAttribute(
      "aria-label",
      open ? "关闭 Examine 窗口" : "重新打开 Examine 窗口",
    );
    dialogToggle.title = open
      ? "关闭 Examine 窗口"
      : "重新打开 Examine 窗口";
    if (open && frameState.closeButton) {
      frameState.closeButton.focus({ preventScroll: true });
    }
  }

  /**
   * Bind static snapshot controls that were originally owned by React.
   * @param {object} state - Mutable frame state.
   * @returns {void}
   */
  function bindSnapshotControls(state) {
    var close = state.doc.querySelector(".examine-close");
    if (close) {
      state.closeButton = close;
      close.addEventListener("click", function (event) {
        event.preventDefault();
        setDialogOpen(false);
      });
    }
    state.backdrop.addEventListener("click", function (event) {
      if (event.target === state.backdrop) setDialogOpen(false);
    });
    state.doc.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setDialogOpen(false);
    });
  }

  /**
   * Initialize the saved page after its production stylesheet is ready.
   * @returns {void}
   */
  function initializeFrame() {
    var doc = getFrameDocument();
    if (!doc) return;
    frameState = createFrameState(doc);
    if (!frameState) return;
    installProposalStyles(doc);
    restorePortraitTile(doc);
    bindSnapshotControls(frameState);
    selectFont(body.dataset.font || "medium");
    selectMode(body.dataset.mode || "current");
    setDialogOpen(true);
  }

  modeButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectMode(button.dataset.modeControl);
    });
  });

  fontButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectFont(button.dataset.fontControl);
    });
  });

  collapseButton.addEventListener("click", function () {
    body.dataset.controls = "collapsed";
  });
  expandButton.addEventListener("click", function () {
    body.dataset.controls = "expanded";
  });
  dialogToggle.addEventListener("click", function () {
    var open = dialogToggle.getAttribute("aria-pressed") !== "true";
    setDialogOpen(open);
  });
  frame.addEventListener("load", initializeFrame);
  frame.srcdoc = window.BLISSHACK_EXAMINE_SNAPSHOT;
}());
