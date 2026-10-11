"use strict";

// Opens each demo screenshot in a native <dialog> (focus trap, Esc to close, no history entries).
// Without JavaScript the thumbnail is a plain link to the full image.
(function () {
  if (typeof HTMLDialogElement !== "function") return;

  document.querySelectorAll("a[data-lightbox]").forEach(function (link) {
    var dialog = document.getElementById(link.getAttribute("data-lightbox"));
    if (!dialog || typeof dialog.showModal !== "function") return;

    link.addEventListener("click", function (event) {
      event.preventDefault();
      dialog.showModal();
    });
    // A click on the backdrop (the dialog element itself) closes it, like Esc does.
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
    // Return focus to the thumbnail that opened the dialog.
    dialog.addEventListener("close", function () { link.focus(); });
  });
})();
