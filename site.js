"use strict";

// Page behavior: theme toggle, mobile menu, tabs, the server-validation
// simulator and the owner console theme preview. Every section renders
// readable content without this file.
(function () {
  var root = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function icon(name) {
    return '<svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-' + name + '"></use></svg>';
  }

  // Theme toggle: flips between dark and light and remembers the choice.
  document.querySelectorAll(".theme-toggle").forEach(function (button) {
    button.addEventListener("click", function () {
      var current = root.getAttribute("data-theme");
      if (!current) current = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      var next = current === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("sboxns-theme", next); } catch (e) { /* not persisted */ }
    });
  });

  // Mobile menu.
  var menuButton = document.querySelector(".menu-btn");
  var menu = document.getElementById("mobile-menu");
  if (menuButton && menu) {
    menuButton.addEventListener("click", function () {
      var open = menu.hidden;
      menu.hidden = !open;
      menuButton.setAttribute("aria-expanded", String(open));
    });
    menu.addEventListener("click", function (event) {
      if (event.target.closest("a")) { menu.hidden = true; menuButton.setAttribute("aria-expanded", "false"); }
    });
  }

  // Tabs: role="tablist" with role="tab" buttons pointing at panels via aria-controls.
  document.querySelectorAll('[role="tablist"]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    function select(tab, focus) {
      tabs.forEach(function (other) {
        var selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        other.tabIndex = selected ? 0 : -1;
        var panel = document.getElementById(other.getAttribute("aria-controls"));
        if (panel) panel.hidden = !selected;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () { select(tab, false); });
      tab.addEventListener("keydown", function (event) {
        var step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        select(tabs[(index + step + tabs.length) % tabs.length], true);
      });
    });
    select(tabs.filter(function (t) { return t.getAttribute("aria-selected") === "true"; })[0] || tabs[0], false);
  });

  // Server-validation simulator. The rules and error codes match the
  // purchase-item and claim-daily endpoint examples, a requiresSecretKey
  // endpoint, and the ENDPOINT_ONLY check on endpoint-only collections.
  var sim = document.getElementById("sim");
  if (sim) {
    var state = { mode: "player", gold: 240, items: ["Potion"], claimed: false };
    var goldEl = sim.querySelector("[data-gold]");
    var bagEl = sim.querySelector("[data-bag]");
    var log = sim.querySelector(".sim-log");
    var packet = sim.querySelector(".packet");
    var hostName = sim.querySelector("[data-host-name]");
    var hostNote = sim.querySelector("[data-host-note]");
    var hostIcon = sim.querySelector("[data-host-icon]");
    var points = { client: { left: "14%", top: "34px" }, host: { left: "14%", top: "132px" }, ns: { left: "52%", top: "84px" }, db: { left: "87%", top: "84px" } };

    function render(changed) {
      goldEl.textContent = new Intl.NumberFormat("en").format(state.gold);
      bagEl.textContent = state.items.join(", ");
      if (changed && !reduceMotion) {
        goldEl.parentElement.classList.remove("bump");
        void goldEl.offsetWidth;
        goldEl.parentElement.classList.add("bump");
        setTimeout(function () { goldEl.parentElement.classList.remove("bump"); }, 700);
      }
    }

    var narrow = window.matchMedia("(max-width: 760px)");
    function point(key) {
      var p = points[key];
      if (!narrow.matches) return p;
      return { left: key === "client" || key === "host" ? "17%" : key === "db" ? "84%" : p.left, top: p.top };
    }

    function animate(from, ok) {
      if (reduceMotion || !packet.animate) return Promise.resolve();
      packet.classList.toggle("bad", !ok);
      var path = ok ? [from, "ns", "db"] : [from, "ns"];
      var frames = path.map(function (key) { var p = point(key); return { left: p.left, top: p.top, opacity: 1 }; });
      var last = point(path[path.length - 1]);
      frames.push({ left: last.left, top: last.top, opacity: 0 });
      return packet.animate(frames, { duration: 380 * path.length, easing: "ease-in-out" }).finished.catch(function () {});
    }

    function addLog(ok, status, what, why) {
      var placeholder = log.querySelector(".empty");
      if (placeholder) placeholder.remove();
      var item = document.createElement("li");
      item.className = (ok ? "ok" : "no") + (reduceMotion ? "" : " enter");
      item.innerHTML = '<span class="st"></span><span class="what"></span><span class="why"></span>';
      item.children[0].textContent = status;
      item.children[1].textContent = what;
      item.children[2].textContent = why;
      log.insertBefore(item, log.firstChild);
      while (log.children.length > 3) log.removeChild(log.lastChild);
    }

    var actions = {
      buy: function () {
        if (state.gold < 150) return [false, "client", "400 INSUFFICIENT_GOLD", "POST purchase-item {item: sword}", "Sword costs 150 gold. Nothing was written."];
        state.gold -= 150; state.items.push("Sword");
        return [true, "client", "200", "POST purchase-item {item: sword}", "Price read from game values, balance checked, charged and added in one write."];
      },
      daily: function () {
        if (state.claimed) return [false, "client", "409 ALREADY_CLAIMED", "POST claim-daily", "Daily reward already claimed. Come back tomorrow."];
        state.claimed = true; state.gold += 50;
        return [true, "client", "200", "POST claim-daily", "+50 gold, date from the server clock, ledger reason: Daily login."];
      },
      prize: function () {
        if (state.mode === "player") return [false, "host", "401 SECRET_KEY_REQUIRED", "POST award-prize (public key)", "A player host only holds the public key. Dedicated-only endpoints refuse it."];
        state.gold += 500;
        return [true, "host", "200", "POST award-prize (secret key)", "+500 gold from your dedicated server, which holds the secret key."];
      },
      cheat: function () {
        return [false, "client", "403 ENDPOINT_ONLY", "PUT players/{steamId} {gold: 999999}", "This collection can only be accessed through endpoints. Gold is unchanged."];
      }
    };

    sim.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        var before = state.gold;
        var result = actions[button.getAttribute("data-action")]();
        animate(result[1], result[0]).then(function () {
          addLog(result[0], result[2], result[3], result[4]);
          render(state.gold !== before);
        });
      });
    });

    sim.querySelectorAll("[data-mode]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.mode = button.getAttribute("data-mode");
        sim.querySelectorAll("[data-mode]").forEach(function (other) { other.setAttribute("aria-pressed", String(other === button)); });
        var dedicated = state.mode === "dedicated";
        hostName.textContent = dedicated ? "Dedicated server" : "Player host";
        hostNote.textContent = dedicated ? "secret key" : "public key";
        hostIcon.innerHTML = icon(dedicated ? "server" : "computer");
      });
    });
    render(false);
  }

  // Owner console theme preview: cycles through the themes until someone picks one.
  var preview = document.getElementById("console-preview");
  var picks = Array.prototype.slice.call(document.querySelectorAll("[data-preview-theme]"));
  if (preview && picks.length) {
    var order = picks.map(function (b) { return b.getAttribute("data-preview-theme"); });
    var index = 0;
    var timer = null;
    var visible = false;
    function show(theme) {
      preview.setAttribute("data-theme", theme);
      picks.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-preview-theme") === theme)); });
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    function start() {
      if (reduceMotion || timer || !visible || preview.hasAttribute("data-picked")) return;
      timer = setInterval(function () { index = (index + 1) % order.length; show(order[index]); }, 3200);
    }
    picks.forEach(function (button, i) {
      button.addEventListener("click", function () {
        preview.setAttribute("data-picked", "");
        stop(); index = i; show(order[i]);
      });
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        visible ? start() : stop();
      }, { threshold: 0.3 }).observe(preview);
    }
  }
})();
