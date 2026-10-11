"use strict";

// Colors shell and C# snippets and adds a copy button to every code block.
// Highlighting only wraps tokens in spans; the copied text is always the
// original textContent, never the decorated HTML.
(function () {
  var rules = {
    sh: [
      ["comment", /#[^\n]*/y],
      ["string", /"(?:[^"\\]|\\.)*"|'[^']*'/y],
      ["variable", /\b[A-Z][A-Z0-9_]*(?==)/y],
      ["flag", /(?<![\w-])--?[a-z][\w-]*/y],
      ["command", /(?<![\w./-])(?:curl|sudo|env|sh|sbox-ns)(?![\w-])/y],
      ["url", /https?:\/\/[^\s"'\\|]+/y],
      ["operator", /\||\\(?=\n)/y]
    ],
    csharp: [
      ["comment", /\/\/[^\n]*/y],
      ["string", /\$?"(?:[^"\\]|\\.)*"/y],
      ["keyword", /\b(?:var|new|public|private|static|async|await|return|class|void|string|int|bool|true|false|null)\b/y],
      ["type", /\b[A-Z][A-Za-z0-9_]*(?=\s*\.)/y],
      ["method", /\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/y],
      ["number", /\b\d+(?:\.\d+)?\b/y]
    ]
  };

  function escape(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlight(source, languageRules) {
    var html = "";
    var plain = "";
    var index = 0;
    while (index < source.length) {
      var matched = null;
      for (var i = 0; i < languageRules.length && !matched; i++) {
        var pattern = languageRules[i][1];
        pattern.lastIndex = index;
        var result = pattern.exec(source);
        if (result && result[0].length > 0) matched = [languageRules[i][0], result[0]];
      }
      if (matched) {
        html += escape(plain) + '<span class="tok-' + matched[0] + '">' + escape(matched[1]) + "</span>";
        plain = "";
        index += matched[1].length;
      } else {
        plain += source[index];
        index++;
      }
    }
    return html + escape(plain);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.className = "copy-buffer";
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(area);
      ok ? resolve() : reject(new Error("copy failed"));
    });
  }

  var status = document.createElement("div");
  status.className = "sr-only";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  document.body.appendChild(status);

  function announce(message) {
    // Clear first so repeating the same message is announced again.
    status.textContent = "";
    setTimeout(function () { status.textContent = message; }, 50);
  }

  document.querySelectorAll("pre > code").forEach(function (code) {
    var source = code.textContent;
    var language = (code.className.match(/language-(\w+)/) || [])[1];
    if (language && rules[language]) code.innerHTML = highlight(source, rules[language]);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = "Copy";
    var container = code.closest("article, li, section");
    var heading = container && container.querySelector("h4, h3, h2");
    var subject = heading ? heading.textContent.trim() : "code";
    button.setAttribute("aria-label", "Copy code: " + subject);
    button.addEventListener("click", function () {
      copyText(source).then(function () {
        button.textContent = "Copied";
        announce("Copied code: " + subject);
      }, function () {
        button.textContent = "Select and copy";
        announce("Could not copy automatically. Select the text and copy it.");
      }).then(function () {
        setTimeout(function () { button.textContent = "Copy"; }, 1800);
      });
    });
    code.parentElement.classList.add("has-copy");
    code.parentElement.appendChild(button);
  });
})();
