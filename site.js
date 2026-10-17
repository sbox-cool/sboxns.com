"use strict";

// Page behavior: theme toggle, mobile menu, tabs, the server-validation
// simulator, the owner console theme preview and the analytics consent
// dialog. Every section renders readable content without this file.
(function () {
  var root = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function icon(name) {
    return '<svg class="i" aria-hidden="true"><use href="/images/icons.svg?v=d0eeac5061#i-' + name + '"></use></svg>';
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

  // GitHub repo picker: the nav icon toggles a dropdown with the server
  // and frontend library repositories. Closes on outside click or Escape.
  document.querySelectorAll(".nav-drop").forEach(function (drop) {
    var button = drop.querySelector("button");
    var menu = drop.querySelector(".nav-drop-menu");
    if (!button || !menu) return;
    function close(refocus) {
      if (menu.hidden) return;
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
      if (refocus) button.focus();
    }
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = menu.hidden;
      document.querySelectorAll(".nav-drop").forEach(function (other) {
        other.querySelector(".nav-drop-menu").hidden = true;
        other.querySelector("button").setAttribute("aria-expanded", "false");
      });
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".nav-drop")) close(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close(true);
    });
  });

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

  // Regional analytics: prior opt-in in consent-first regions and on by default
  // elsewhere. Explicit opt-out always wins. Unknown location fails to opt-in.
  var MEASUREMENT_ID = "G-WZQ52W7QRH";
  var CONSENT_KEY = "sboxns-analytics-consent";
  // Purpose changes require renewed affirmative consent, never discard an opt-out.
  var CONSENT_VERSION = 2;
  var CONSENT_DAYS = 180;
  var PAGE_TITLE = "sboxns.com";
  var GA_COOKIE = /^(_ga(_[A-Za-z0-9]+)?|_gid|_gat(_[A-Za-z0-9_]+)?)$/;
  var CONSENT_REGIONS = new Set(("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO " +
    "GB CH AD MC SM VA GG JE IM GI AX GF GP MQ RE YT MF BL FO GL BQ CW SX " +
    "BR KR TR ZA TH CN JP IN ID VN IL SG MY PH TW AR CO EC PE CL MX AE SA RU UA RS BA AL MK ME MD GE AM AZ KZ BY").split(" "));
  var COUNTRIES = new Set(("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
    "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
    "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" "));

  async function regionRequiresConsent() {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 2500);
    try {
      // Existing operator-owned CDN endpoint; no Worker or third-party geo vendor.
      // Discard everything except the two-letter country; do not persist the trace.
      var response = await fetch("https://sboxcool.com/cdn-cgi/trace", {
        credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal
      });
      if (!response.ok) return true;
      var country = (await response.text()).match(/^loc=([A-Z]{2})\r?$/m);
      return !country || !COUNTRIES.has(country[1]) || CONSENT_REGIONS.has(country[1]);
    } catch (e) { return true; }
    finally { clearTimeout(timeout); }
  }

  function pageAddress() { return location.origin + location.pathname; }

  function setupAnalytics() {
    var gaLoaded = false;  // gtag.js has been inserted into this document
    var gaStopped = false; // analytics was withdrawn here; Google code stays in memory until reload
    var consentRequired = true;
    var storageAvailable = false;
    var settingsOpen = false;
    var privacySignal = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";

    function gtag() { window.dataLayer.push(arguments); }

    function running() { return gaLoaded && !gaStopped; }

    // Affirmative consent expires after 180 days; explicit opt-out has no expiry.
    // Default-on acknowledgement is not affirmative consent when regions change.
    function readChoice() {
      var raw;
      try {
        raw = window.localStorage.getItem(CONSENT_KEY);
        // Check real writability, not a no-op rewrite that can succeed at quota.
        // A stale acceptance must not survive an unpersistable withdrawal.
        window.localStorage.setItem(CONSENT_KEY + "-check", "1");
        window.localStorage.removeItem(CONSENT_KEY + "-check");
        storageAvailable = true;
      } catch (e) { storageAvailable = false; return null; }
      if (raw === null) return null;
      var record = null;
      try { record = JSON.parse(raw); } catch (e) { record = null; }
      if (record && record.analytics === false) return record;
      if (record && record.v === CONSENT_VERSION && record.analytics === true &&
          typeof record.explicit === "boolean" && typeof record.expires === "number" && Date.now() < record.expires) {
        return record;
      }
      try { window.localStorage.removeItem(CONSENT_KEY); } catch (e) { /* stays unreadable: still no choice */ }
      return null;
    }

    // Returns true only when the record was written and reads back intact.
    function saveChoice(granted, explicit) {
      var value = JSON.stringify({ v: CONSENT_VERSION, analytics: granted, explicit: explicit,
        expires: granted ? Date.now() + CONSENT_DAYS * 24 * 60 * 60 * 1000 : null });
      try {
        window.localStorage.setItem(CONSENT_KEY, value);
        return window.localStorage.getItem(CONSENT_KEY) === value;
      } catch (e) { return false; }
    }

    // Deletes GA cookies for this host and each parent domain. Only names that
    // match the GA pattern are touched; unrelated cookies are left alone.
    function clearAnalyticsCookies() {
      try {
        var names = [];
        document.cookie.split(";").forEach(function (pair) {
          var name = pair.split("=")[0].trim();
          if (GA_COOKIE.test(name) && names.indexOf(name) < 0) names.push(name);
        });
        var labels = location.hostname.split(".");
        var domains = [""];
        for (var i = 0; i < labels.length - 1; i++) domains.push(labels.slice(i).join("."));
        names.forEach(function (name) {
          domains.forEach(function (domain) {
            document.cookie = name + "=; Max-Age=0; path=/" + (domain ? "; domain=" + domain : "");
          });
        });
      } catch (e) { /* cookies unavailable: nothing could have been set */ }
    }

    function startAnalytics() {
      if (privacySignal || !storageAvailable) return;
      if (gaLoaded) return;
      gaLoaded = true;
      window.dataLayer = window.dataLayer || [];
      gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
      gtag("js", new Date());
      // Global values sanitized before config: they apply to every event Google
      // sends (page_view, session_start, user_engagement), not only page_view.
      // No query string, hash, referrer or real title is ever passed.
      gtag("set", { page_location: pageAddress(), page_referrer: "", page_title: PAGE_TITLE });
      gtag("set", "ads_data_redaction", true);
      gtag("config", MEASUREMENT_ID, {
        send_page_view: false,
        ignore_referrer: true,
        allow_google_signals: false,
        allow_ad_personalization_signals: false
      });
      gtag("event", "page_view");
      var script = document.createElement("script");
      script.async = true;
      script.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
      document.head.appendChild(script);
    }

    // Disable Google's tag before removing its cookies. Reload after a persisted
    // opt-out to remove its listeners too, without sending consent-denied pings.
    function stopAnalytics() {
      if (gaLoaded && !gaStopped) {
        gaStopped = true;
        window["ga-disable-" + MEASUREMENT_ID] = true;
      }
      clearAnalyticsCookies();
    }

    // Google code from a withdrawn session is still in memory, so re-enabling
    // in the same document needs a reload.
    function enableAnalytics() {
      if (gaStopped) location.reload();
      else startAnalytics();
    }

    var dialog = document.createElement("dialog");
    dialog.className = "ck-dialog";
    dialog.setAttribute("aria-labelledby", "ck-title");
    dialog.setAttribute("aria-describedby", "ck-desc");
    dialog.innerHTML =
      '<div class="ck-body">' +
        '<h2 id="ck-title" tabindex="-1">Analytics on sboxns.com</h2>' +
        '<p class="ck-region"></p><p id="ck-desc">Google Analytics counts visits to this website using analytics cookies. ' +
        'Query strings, fragments and referrers are excluded; advertising features are off. ' +
        'Change your choice anytime in Cookie settings in the footer. ' +
        '<a href="/privacy/">Read the privacy notice</a>.</p>' +
        '<p class="ck-status" role="status"></p>' +
        '<div class="ck-actions">' +
          '<button type="button" class="btn" data-ck="accept">Accept analytics</button>' +
          '<button type="button" class="btn" data-ck="reject">Reject analytics</button>' +
          '<button type="button" class="btn" data-ck="close" hidden>Close</button>' +
        '</div>' +
      '</div>';
    var heading = dialog.querySelector("h2");
    var status = dialog.querySelector(".ck-status");
    var footButton = null;

    function isOpen() { return dialog.hasAttribute("open"); }
    function hide() {
      if (dialog.close) dialog.close();
      else dialog.removeAttribute("open");
    }
    // Non-modal show() never blocks the page. Modal (settings from the footer)
    // gives native focus trapping and Escape; the fallback just sets [open].
    function describe() {
      dialog.querySelector(".ck-region").textContent = consentRequired
        ? "Analytics needs your permission in consent-first or undetermined regions. You can enable or disable it below."
        : "Analytics is on by default in your region. You can turn it off below.";
      status.textContent = privacySignal ? "Your browser privacy signal keeps analytics off."
        : !storageAvailable ? "Analytics is off because this browser cannot save your preference."
        : running() ? "Analytics is on." : "Analytics is off.";
      dialog.querySelector('[data-ck="accept"]').textContent = !consentRequired && !settingsOpen ? "Got it" : "Enable analytics";
      dialog.querySelector('[data-ck="accept"]').disabled = privacySignal;
      dialog.querySelector('[data-ck="reject"]').textContent = consentRequired ? "Disable analytics" : "Turn off analytics";
      dialog.querySelector('[data-ck="close"]').hidden = !settingsOpen;
    }
    function show(modal) {
      if (isOpen()) hide();
      describe();
      if (modal && dialog.showModal) dialog.showModal();
      else if (dialog.show) dialog.show();
      else dialog.setAttribute("open", "");
    }
    // If focus was inside the dialog, return it to the persistent footer button.
    function closePanel() {
      var hadFocus = dialog.contains(document.activeElement);
      hide();
      if (hadFocus && footButton) footButton.focus({ preventScroll: true });
    }
    function openSettings() {
      settingsOpen = true;
      show(true);
      heading.focus();
    }

    function accept() {
      if (!saveChoice(true, consentRequired || settingsOpen)) {
        status.textContent = "Couldn't save your choice in this browser, so analytics stays off.";
        return;
      }
      enableAnalytics();
      closePanel();
    }

    function reject() {
      var wasLoaded = gaLoaded;
      var saved = saveChoice(false, true);
      stopAnalytics();
      if (!saved) {
        status.textContent = "Couldn't save your choice. Analytics is off; browsers with unavailable storage are never opted in.";
        return;
      }
      closePanel();
      // Google code loaded in this document can only be fully stopped by a reload.
      if (wasLoaded) location.reload();
    }

    // Re-evaluates the stored choice: used for storage events from other tabs.
    function sync() {
      var choice = readChoice();
      var allowed = !privacySignal && storageAvailable &&
        (choice ? choice.analytics && (choice.explicit || !consentRequired) : !consentRequired);
      if (allowed) enableAnalytics();
      else {
        var wasLoaded = gaLoaded;
        stopAnalytics();
        if (wasLoaded) { location.reload(); return; }
      }
      describe();
      if (choice === null || (choice.analytics && !choice.explicit && consentRequired)) {
        if (!isOpen()) { settingsOpen = false; show(false); }
      } else if (isOpen()) closePanel();
    }

    dialog.addEventListener("click", function (event) {
      var button = event.target.closest("[data-ck]");
      if (!button) return;
      var action = button.getAttribute("data-ck");
      if (action === "accept") accept();
      else if (action === "reject") reject();
      else closePanel();
    });
    dialog.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); closePanel(); }
    });
    window.addEventListener("storage", function (event) {
      if (event.key === null || event.key === CONSENT_KEY) sync();
    });

    // Older generated documentation shares this script but predates the site notice.
    document.querySelectorAll('.foot a[href="https://sboxcool.com/privacy"]').forEach(function (link) {
      link.href = "/privacy/";
      link.removeAttribute("target");
    });
    var navs = document.querySelectorAll(".foot nav");
    var trust = navs[navs.length - 1];
    if (trust) {
      footButton = document.createElement("button");
      footButton.type = "button";
      footButton.className = "ck-link";
      footButton.textContent = "Cookie settings";
      footButton.addEventListener("click", openSettings);
      trust.appendChild(footButton);
    }

    document.body.insertBefore(dialog, document.body.firstChild);
    var choice = readChoice();
    if (privacySignal || (choice && (!choice.analytics || choice.explicit))) sync();
    else regionRequiresConsent().then(function (required) {
      consentRequired = required;
      // Read again: a footer opt-out made while lookup was pending must win.
      sync();
    });
  }

  setupAnalytics();
})();
