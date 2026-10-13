"use strict";

// Runs in <head> before first paint: marks JavaScript as available and applies
// a stored theme. Without a stored choice the page follows prefers-color-scheme
// and prefers-contrast (see site.css).
(function () {
  var root = document.documentElement;
  root.classList.remove("no-js");
  root.classList.add("js");
  try {
    var theme = localStorage.getItem("sboxns-theme");
    if (theme === "dark" || theme === "light" || theme === "contrast") root.setAttribute("data-theme", theme);
  } catch (e) { /* Storage blocked: follow the system theme. */ }
})();
