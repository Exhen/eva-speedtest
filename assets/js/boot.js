/**
 * BOOT 序列 — ?boot=0 跳过；prefers-reduced-motion 跳过动效。
 * 文字打完后淡出，全屏 logo 渐显→停留→渐隐，再整层遮罩淡出。
 */
(function () {
  function skipBoot() {
    var el = document.getElementById("bootOverlay");
    if (el) {
      el.classList.add("hidden");
    }
    window.setTimeout(function () {
      window.dispatchEvent(new CustomEvent("nervbootdone"));
    }, 0);
  }

  function run() {
    var params = new URLSearchParams(window.location.search);
    if (params.get("boot") === "0") {
      skipBoot();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      skipBoot();
      return;
    }

    var overlay = document.getElementById("bootOverlay");
    var textEl = document.getElementById("bootText");
    var logoEl = document.getElementById("bootLogo");
    if (!overlay || !textEl) {
      skipBoot();
      return;
    }

    var full =
      "INITIALIZING NERV SPEED DIAGNOSTIC ...\n\n" +
      "[OK] MAGI ONLINE / マギ接続\n" +
      "[OK] NETWORK INTERFACE READY / 回線待機\n" +
      "[OK] TIME SYNCED / 時刻同步完了\n";

    var TYPE_MS = 10;
    var TEXT_FADE_MS = 520;
    var LOGO_ANIM_FALLBACK_MS = 1600;

    function endBootSequence() {
      overlay.style.opacity = "0";
      overlay.style.transition = "opacity 0.65s ease";
      window.setTimeout(function () {
        overlay.classList.add("hidden");
        overlay.style.opacity = "";
        overlay.style.transition = "";
        window.setTimeout(function () {
          window.dispatchEvent(new CustomEvent("nervbootdone"));
        }, 0);
      }, 680);
    }

    var i = 0;
    function tick() {
      if (i <= full.length) {
        textEl.textContent = full.slice(0, i);
        i += 1;
        window.setTimeout(tick, TYPE_MS);
        return;
      }
      textEl.classList.add("boot-text--fadeout");
      window.setTimeout(function () {
        textEl.setAttribute("aria-hidden", "true");
        if (logoEl) {
          logoEl.setAttribute("aria-hidden", "false");
          var stack = logoEl.querySelector(".boot-logo-stack");
          logoEl.classList.add("boot-logo--fullscreen");
          var finished = false;
          function finishOnce() {
            if (finished) return;
            finished = true;
            endBootSequence();
          }
          var failTid = window.setTimeout(finishOnce, LOGO_ANIM_FALLBACK_MS);
          if (stack) {
            stack.addEventListener(
              "animationend",
              function onLogoAnimEnd() {
                stack.removeEventListener("animationend", onLogoAnimEnd);
                window.clearTimeout(failTid);
                finishOnce();
              },
              false
            );
          }
        } else {
          endBootSequence();
        }
      }, TEXT_FADE_MS);
    }

    tick();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
