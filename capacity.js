"use strict";

// Shows live hosted-name usage from the sboxcool registry. The block stays
// hidden when the stats endpoint is unreachable, so the page never shows
// stale or placeholder numbers.
(function () {
  var endpoint = "https://sboxcool.com/api/network-storage/names/stats";
  var MIN_NAMES_SHOWN = 10;
  var block = document.getElementById("capacity");
  if (!block || !window.fetch) return;

  function count(value) {
    return typeof value === "number" && isFinite(value) && value >= 0 ? value : null;
  }

  fetch(endpoint, { headers: { Accept: "application/json" } })
    .then(function (response) {
      if (!response.ok) throw new Error("stats unavailable");
      return response.json();
    })
    .then(function (stats) {
      var dns = stats.dns || {};
      var tunnels = stats.tunnels || {};
      var values = {
        names: [count(dns.names), count(tunnels.names)],
        capacity: [count(dns.capacityNames), count(tunnels.capacity)],
        // Each tunnel name keeps one DNS record.
        records: [count(dns.records), count(tunnels.names)]
      };
      var format = new Intl.NumberFormat("en");
      Object.keys(values).forEach(function (key) {
        var parts = values[key];
        if (parts[0] === null || parts[1] === null) throw new Error("incomplete stats");
        block.querySelector('[data-stat="' + key + '"]').textContent = format.format(parts[0] + parts[1]);
      });
      // A handful of names reads like an outage, not a launch. Show the counters only once there is something to count.
      var total = values.names[0] + values.names[1];
      ["names", "records"].forEach(function (key) {
        block.querySelector('[data-tile="' + key + '"]').hidden = total < MIN_NAMES_SHOWN;
      });
      block.hidden = false;
    })
    .catch(function () {
      block.hidden = true;
    });
})();
