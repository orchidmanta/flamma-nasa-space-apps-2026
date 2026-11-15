// ================= Light / dark theme =================
// Loaded in <head> so the right theme is applied before the page is drawn.
// Default: follow the computer's setting. The header button overrides it,
// and the choice is remembered in this browser.

(function () {
  const root = document.documentElement;

  function savedTheme() {
    try { return localStorage.getItem("theme"); } catch (e) { return null; }
  }
  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
  }

  // 1. apply right away (before the page is drawn)
  applyTheme(savedTheme() || systemTheme());

  // 2. once the page exists, wire up the button
  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(root.getAttribute("data-theme")); // updates the button label
    document.getElementById("theme-toggle").addEventListener("click", function () {
      const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next);
      try { localStorage.setItem("theme", next); } catch (e) { /* private mode: just don't remember */ }
    });
  });
})();
