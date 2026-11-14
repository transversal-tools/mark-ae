/**
 * responsive.js — set body class based on panel size for adaptive layout.
 *
 * Modes (width × height of the panel):
 *   mode-full    → both dimensions comfortable (default — show everything)
 *   mode-compact → narrow (< 340px wide) OR short (< 450px tall) — trim status, hide shortcuts
 *   mode-tiny    → very small (< 220px wide) OR (< 280px tall) — keep only essentials
 *
 * Also exposes a manual override via window.__aePortalSetMode("auto" | "full" | "compact" | "tiny").
 */
(function () {
  var override = "auto";

  function classify(w, h){
    if (w < 220 || h < 280) return "mode-tiny";
    if (w < 340 || h < 450) return "mode-compact";
    return "mode-full";
  }

  function apply(){
    var b = document.body;
    if (!b) return;
    b.classList.remove("mode-tiny", "mode-compact", "mode-full");
    var mode;
    if (override === "auto"){
      mode = classify(window.innerWidth, window.innerHeight);
    } else {
      mode = "mode-" + override;
    }
    b.classList.add(mode);
    b.setAttribute("data-mode", mode);
  }

  window.addEventListener("resize", apply);
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }

  window.__aePortalSetMode = function(m){
    override = m || "auto";
    apply();
  };
})();
