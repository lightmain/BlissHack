(function () {
  "use strict";

  var body = document.body;
  var backdrop = document.querySelector("[data-backdrop]");
  var closeButton = document.querySelector("[data-close-dialog]");
  var openButton = document.querySelector("[data-open-dialog]");
  var modeButtons = Array.from(document.querySelectorAll("[data-mode-control]"));
  var fontButtons = Array.from(document.querySelectorAll("[data-font-control]"));
  var tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
  var panels = Array.from(document.querySelectorAll("[data-panel]"));
  var fontSizes = {
    small: "12px",
    medium: "14px",
    large: "16px",
  };

  function selectMode(mode) {
    body.dataset.mode = mode;
    modeButtons.forEach(function (button) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.modeControl === mode),
      );
    });
  }

  function selectFont(font) {
    body.dataset.font = font;
    document.documentElement.style.setProperty(
      "--terminal-size",
      fontSizes[font] || fontSizes.medium,
    );
    fontButtons.forEach(function (button) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.fontControl === font),
      );
    });
  }

  function selectTab(tab, focus) {
    tabButtons.forEach(function (button) {
      var selected = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
    panels.forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== tab;
    });
  }

  function closeDialog() {
    backdrop.hidden = true;
    openButton.focus();
  }

  function openDialog() {
    backdrop.hidden = false;
    closeButton.focus({ preventScroll: true });
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

  tabButtons.forEach(function (button, index) {
    button.addEventListener("click", function () {
      selectTab(button.dataset.tab, false);
    });
    button.addEventListener("keydown", function (event) {
      var destination = null;
      if (event.key === "ArrowRight") {
        destination = (index + 1) % tabButtons.length;
      } else if (event.key === "ArrowLeft") {
        destination = (index - 1 + tabButtons.length) % tabButtons.length;
      } else if (event.key === "Home") {
        destination = 0;
      } else if (event.key === "End") {
        destination = tabButtons.length - 1;
      }
      if (destination === null) return;
      event.preventDefault();
      selectTab(tabButtons[destination].dataset.tab, true);
    });
  });

  closeButton.addEventListener("click", closeDialog);
  openButton.addEventListener("click", openDialog);
  backdrop.addEventListener("click", function (event) {
    if (event.target === backdrop) closeDialog();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !backdrop.hidden) closeDialog();
  });

  selectMode(body.dataset.mode || "proposal");
  selectFont(body.dataset.font || "medium");
  selectTab("strategy", false);
}());
