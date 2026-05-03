/**
 * 界面绑定、日志
 */
(function () {
  var ST = window.NervSpeedtest;
  var Chart = window.NervChart;

  var chart;
  var rafId = 0;
  var controller = null;
  /** 测速结束时刻 performance.now()；>0 且 controller 存在时 loopFrame 显示剩余毫秒 */
  var missionDeadlinePerf = 0;
  var ewmaDl = 0;
  var ewmaUl = 0;
  var lastDlSample = { instant: 0, peak: 0, avg: 0 };
  var lastUlSample = { instant: 0, peak: 0, avg: 0 };
  var lastPing = { min: 0, max: 0, avg: 0, jitter: 0, tier: "NORMAL" };
  var lastDlResult = { avg: 0, peak: 0, tier: "NORMAL" };
  var lastUlResult = { avg: 0, peak: 0, tier: "NORMAL" };
  /** 面板 / 指示灯 / 仪表色调：由用户点击切换，不由测速结果推导 */
  var uiTier = "DANGER";
  /** 速率显示单位：mbps | mbs */
  var rateUnit = "mbps";
  /** 同步率读数低通状态，减轻 instant/peak 比值在 tick 间的剧烈跳动 */
  var syncGaugeSmoothed = 0;
  /** 与测速 goalPhase 同步，供折线图按阶段只采 DL 或 UL */
  var chartCapturePhase = "off";

  function $(id) {
    return document.getElementById(id);
  }

  function formatMbps(v) {
    if (!isFinite(v) || v < 0) return "0.00";
    return v.toFixed(2);
  }

  function formatMs(v) {
    if (!isFinite(v)) return "—";
    return v.toFixed(1);
  }

  function convertRate(mbps) {
    if (rateUnit === "mbs") return (mbps / 8).toFixed(2);
    return formatMbps(mbps);
  }

  function rateUnitLabel() {
    return rateUnit === "mbs" ? "MB/s" : "Mbps";
  }

  function applyRateUnitUi() {
    var b = $("btnUnitCycle");
    if (b) {
      b.textContent = rateUnitLabel();
      b.classList.remove("light--unit-mbps", "light--unit-mbs");
      b.classList.add(rateUnit === "mbs" ? "light--unit-mbs" : "light--unit-mbps");
      b.classList.add("active");
      b.setAttribute("aria-label", "速率单位：" + rateUnitLabel() + "，点击切换");
    }
    if ($("dlMain")) $("dlMain").textContent = convertRate(ewmaDl || lastDlResult.avg);
    if ($("ulMain")) $("ulMain").textContent = convertRate(ewmaUl || lastUlResult.avg);
    if ($("dlUnit")) $("dlUnit").textContent = rateUnitLabel();
  }

  /** 剩余毫秒倒计时，格式 MM:SS.mmm */
  function formatCountdownMs(remainMs) {
    if (!isFinite(remainMs) || remainMs <= 0) return "00:00.000";
    var total = Math.floor(remainMs);
    var m = Math.floor(total / 60000);
    var s = Math.floor((total % 60000) / 1000);
    var ms = total % 1000;
    function z2(n) {
      return n < 10 ? "0" + n : String(n);
    }
    function z3(n) {
      if (n < 10) return "00" + n;
      if (n < 100) return "0" + n;
      return String(n);
    }
    if (m > 99) m = 99;
    return z2(m) + ":" + z2(s) + "." + z3(ms);
  }

  function updateEwma(prev, instant, alpha) {
    if (!instant || instant < 0) return prev;
    if (!prev) return instant;
    return alpha * instant + (1 - alpha) * prev;
  }

  function setRunStatus(text) {
    var el = $("runStatus");
    if (el) el.textContent = text;
  }

  function setGoal(pct) {
    var n = Number(pct);
    if (!isFinite(n)) n = 0;
    n = Math.min(100, Math.max(0, n));
    var fill = $("goalFill");
    var pctEl = $("goalPct");
    if (fill) fill.style.width = n + "%";
    if (pctEl) pctEl.textContent = Math.round(n) + "%";
  }

  function setLights(tier) {
    var n = $("lightNormal");
    var c = $("lightCaution");
    var d = $("lightDanger");
    [n, c, d].forEach(function (x) {
      if (x) {
        x.classList.remove("active");
        if (x.setAttribute) x.setAttribute("aria-pressed", "false");
      }
    });
    if (tier === "NORMAL" && n) {
      n.classList.add("active");
      n.setAttribute("aria-pressed", "true");
    }
    if (tier === "CAUTION" && c) {
      c.classList.add("active");
      c.setAttribute("aria-pressed", "true");
    }
    if (tier === "DANGER" && d) {
      d.classList.add("active");
      d.setAttribute("aria-pressed", "true");
    }
  }

  function setPanelsTier(tier) {
    var ids = ["topPanel", "heroPanel", "chartPanel", "metricsPanel", "sysPanel", "logPanel", "goalPanel", "bottomBar"];
    ids.forEach(function (id) {
      var p = $(id);
      if (!p) return;
      p.classList.remove("panel--normal", "panel--caution", "panel--danger");
      p.classList.add(
        tier === "NORMAL" ? "panel--normal" : tier === "CAUTION" ? "panel--caution" : "panel--danger"
      );
    });
    document.body.classList.toggle("nerv-danger-flash", tier === "DANGER");
  }

  function fillBinaryRail() {
    var el = $("binaryRail");
    if (!el) return;
    var s = "";
    var i;
    for (i = 0; i < 400; i += 1) {
      s += Math.random() > 0.5 ? "1" : "0";
    }
    el.textContent = s;
  }

  async function loadIdentification() {
    var ua = typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "";
    if ($("browserUa")) $("browserUa").textContent = ua || "—";
    try {
      var data = await ST.fetchIp(undefined);
      var raw = data.rawIspInfo || {};
      if ($("ipExternal")) $("ipExternal").textContent = raw.ip || "—";
    } catch (e) {
      if (window.NervDebug && window.NervDebug.error) {
        window.NervDebug.error("loadIdentification/fetchIp", e);
      } else {
        console.error("[NERV loadIdentification]", e);
      }
      if ($("ipExternal")) $("ipExternal").textContent = "ERROR";
    }
  }

  var LOG_KEY = "nerv_mission_log_v1";

  function readLog() {
    try {
      var t = localStorage.getItem(LOG_KEY);
      return t ? JSON.parse(t) : [];
    } catch (e) {
      return [];
    }
  }

  function writeLog(arr) {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(0, 20)));
    } catch (e) {
      /* */
    }
  }

  function renderLog() {
    var box = $("missionLog");
    if (!box) return;
    var rows = readLog();
    box.innerHTML = rows
      .map(function (r) {
        return (
          "<div>" +
          r.t +
          " · DL " +
          formatMbps(r.dl) +
          " · UL " +
          formatMbps(r.ul) +
          " · PING " +
          formatMs(r.ping) +
          " · " +
          r.tier +
          "</div>"
        );
      })
      .join("");
  }

  function pushLog(entry) {
    var rows = readLog();
    rows.unshift(entry);
    writeLog(rows);
    renderLog();
  }

  function setPrimary(mode) {
    var btn = $("btnPrimary");
    if (!btn) return;
    btn.dataset.mode = mode;
    if (mode === "start") {
      btn.textContent = "START / 開始";
      btn.disabled = false;
    } else if (mode === "abort") {
      btn.textContent = "ABORT / 中止";
      btn.disabled = false;
    } else if (mode === "retry") {
      btn.textContent = "RETRY / 再起動";
      btn.disabled = false;
    }
  }

  function loopFrame() {
    var el = $("missionTimer");
    if (el && controller && missionDeadlinePerf > 0) {
      var rem = missionDeadlinePerf - performance.now();
      el.textContent = formatCountdownMs(rem);
    }
    if (chart) {
      /* 仅在节流写入新点后再 draw，避免每帧重绘数千线段占死主线程导致无法响应 ABORT */
      if (chart.push(ewmaDl, ewmaUl, false, chartCapturePhase)) {
        chart.draw();
      }
    }
    if (controller) {
      rafId = requestAnimationFrame(loopFrame);
    }
  }

  function syncReadoutSetTier(tier) {
    var el = $("syncReadout");
    if (!el) return;
    el.classList.remove("sync-readout--normal", "sync-readout--caution", "sync-readout--danger");
    var t = tier === "NORMAL" || tier === "CAUTION" || tier === "DANGER" ? tier : "DANGER";
    el.classList.add("sync-readout--" + t.toLowerCase());
  }

  function applyManualTier() {
    setLights(uiTier);
    setPanelsTier(uiTier);
    syncReadoutSetTier(uiTier);
  }

  function updateGaugeFromDl() {
    var peak = lastDlSample.peak || lastDlResult.peak || 1;
    if (!isFinite(peak) || peak <= 0) peak = 1;
    /* 与主 DL 读数同源：EWMA 相对峰值；避免用 instant 导致每 100ms 锯齿 */
    var ew = ewmaDl;
    if (!isFinite(ew) || ew < 0) ew = 0;
    var target = Math.min(100, (ew / peak) * 100);
    var k = 0.26;
    syncGaugeSmoothed += (target - syncGaugeSmoothed) * k;
    var pct = Math.min(100, Math.max(0, syncGaugeSmoothed));
    var srd = $("syncReadoutDigits");
    if (srd) srd.textContent = pct.toFixed(1) + "%";
    if ($("syncReadout")) $("syncReadout").setAttribute("aria-label", "同步率 " + pct.toFixed(1) + "%");
    if (window.NervSyncWave) window.NervSyncWave.setSync(pct);
    syncReadoutSetTier(uiTier);
  }

  async function runTest() {
    var ND = window.NervDebug;
    if (ND && ND.log) ND.log("runTest begin");
    controller = new AbortController();
    var signal = controller.signal;
    /* ping 耗时未定时：先给宽松上限，ping 结束后收紧为 dl+ul */
    var pingSlackMs = Math.max(12000, ST.DEFAULTS.pingSamples * 900);
    missionDeadlinePerf = performance.now() + pingSlackMs + ST.DEFAULTS.dlMs + ST.DEFAULTS.ulMs;
    ewmaDl = 0;
    ewmaUl = 0;
    syncGaugeSmoothed = 0;
    if (chart) chart.clear();
    setPrimary("abort");
    setRunStatus("BOOT STATUS: TESTING / 測定中");
    setGoal(0);
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loopFrame);

    /** 仅处理当前阶段的 onTick，避免 clearInterval 后仍排队的下载 tick 把 GOAL 拉回 45% 并卡在 52% */
    var goalPhase = "off";
    chartCapturePhase = "off";

    function onTick(sample) {
      if (sample.phase === "dl" && goalPhase !== "dl") return;
      if (sample.phase === "ul" && goalPhase !== "ul") return;

      if (sample.phase === "dl") {
        ewmaDl = updateEwma(ewmaDl, sample.instant, 0.28);
        lastDlSample = sample;
        if ($("dlMain")) $("dlMain").textContent = convertRate(ewmaDl);
        if ($("dlUnit")) $("dlUnit").textContent = rateUnitLabel();
        if ($("dlSub"))
          $("dlSub").textContent =
            convertRate(sample.instant) +
            " / " +
            convertRate(sample.peak) +
            " / " +
            convertRate(sample.avg);
        var dlPct = 8 + (sample.elapsed / ST.DEFAULTS.dlMs) * 44;
        setGoal(dlPct);
        updateGaugeFromDl();
      }
      if (sample.phase === "ul") {
        ewmaUl = updateEwma(ewmaUl, sample.instant, 0.28);
        lastUlSample = sample;
        if ($("ulMain")) $("ulMain").textContent = convertRate(ewmaUl);
        if ($("ulSub"))
          $("ulSub").textContent =
            convertRate(sample.instant) +
            " / " +
            convertRate(sample.peak) +
            " / " +
            convertRate(sample.avg);
        var ulPct = 52 + (sample.elapsed / ST.DEFAULTS.ulMs) * 48;
        setGoal(ulPct);
      }
    }

    var testSuccess = false;
    var testAborted = false;

    try {
      setGoal(2);
      if (ND && ND.log) ND.log("phase: ping");
      lastPing = await ST.probePing(signal, null);
      if (ND && ND.log) ND.log("phase: ping done avg_ms=", lastPing.avg);
      if ($("pingMain")) $("pingMain").textContent = formatMs(lastPing.avg);
      if ($("pingSub"))
        $("pingSub").textContent =
          formatMs(lastPing.min) + " / " + formatMs(lastPing.max) + " / " + formatMs(lastPing.jitter);
      if ($("jitterMain")) $("jitterMain").textContent = formatMs(lastPing.jitter);

      missionDeadlinePerf = performance.now() + ST.DEFAULTS.dlMs + ST.DEFAULTS.ulMs;

      setGoal(8);
      goalPhase = "dl";
      chartCapturePhase = "dl";
      if (ND && ND.log) ND.log("phase: download");
      lastDlResult = await ST.runDownload(signal, onTick);
      if (ND && ND.log) ND.log("phase: download done avg_Mbps=", lastDlResult.avg);
      goalPhase = "off";
      chartCapturePhase = "off";
      ewmaDl = lastDlResult.avg;
      if ($("dlMain")) $("dlMain").textContent = convertRate(lastDlResult.avg);
      if ($("dlSub"))
        $("dlSub").textContent =
          convertRate(lastDlSample.instant) +
          " / " +
          convertRate(lastDlResult.peak) +
          " / " +
          convertRate(lastDlResult.avg);

      missionDeadlinePerf = performance.now() + ST.DEFAULTS.ulMs;

      setGoal(52);
      goalPhase = "ul";
      chartCapturePhase = "ul";
      if (ND && ND.log) ND.log("phase: upload");
      lastUlResult = await ST.runUpload(signal, onTick);
      if (ND && ND.log) ND.log("phase: upload done avg_Mbps=", lastUlResult.avg);
      goalPhase = "off";
      chartCapturePhase = "off";
      ewmaUl = lastUlResult.avg;
      if ($("ulMain")) $("ulMain").textContent = convertRate(lastUlResult.avg);
      if ($("ulSub"))
        $("ulSub").textContent =
          convertRate(lastUlSample.instant) +
          " / " +
          convertRate(lastUlResult.peak) +
          " / " +
          convertRate(lastUlResult.avg);

      missionDeadlinePerf = performance.now();

      setGoal(100);
      testSuccess = true;
      var verdictTier = ST.combinedTier(lastDlResult.tier, lastUlResult.tier, lastPing.tier);

      var ts = new Date().toISOString().replace("T", " ").slice(0, 19);
      pushLog({
        t: ts,
        dl: lastDlResult.avg,
        ul: lastUlResult.avg,
        ping: lastPing.avg,
        tier: verdictTier,
      });

      setRunStatus("BOOT STATUS: COMPLETE / 完了");
      if (ND && ND.log) ND.log("runTest complete verdictTier=", verdictTier, "uiTier=", uiTier);
    } catch (e) {
      if (e && e.name === "AbortError") {
        testAborted = true;
        if (ND && ND.log) ND.log("runTest aborted by user");
        setRunStatus("BOOT STATUS: ABORTED / 中止");
      } else {
        if (window.NervDebug && window.NervDebug.error) {
          window.NervDebug.error("runTest", e);
        } else {
          console.error("[NERV runTest]", e);
        }
        setRunStatus("BOOT STATUS: ERROR / 異常");
      }
    } finally {
      goalPhase = "off";
      chartCapturePhase = "off";
      /* 非用户中止时一律收满进度条，避免上传失败/异常时永远停在 52% */
      if (!testAborted) {
        setGoal(100);
      }
      controller = null;
      missionDeadlinePerf = 0;
      cancelAnimationFrame(rafId);
      if ($("missionTimer")) $("missionTimer").textContent = "00:00.000";
      if (chart) {
        /* 不再在收尾时 push 最终平均/EWMA 点，折线以测速过程中最后一次采样为准 */
        chart.freeze();
        chart.draw();
      }
      setPrimary("retry");
      applyManualTier();
    }
  }

  function init() {
    window.addEventListener("error", function (ev) {
      console.error(
        "[NERV window.onerror]",
        ev.message,
        ev.filename,
        ev.lineno,
        ev.error && ev.error.stack ? ev.error.stack : ""
      );
    });
    window.addEventListener("unhandledrejection", function (ev) {
      console.error("[NERV unhandledrejection]", ev.reason);
      if (ev.reason && ev.reason.stack) console.error(ev.reason.stack);
    });
    console.info(
      '[NERV] 步骤级调试日志：在地址栏加 ?nerv_debug=1 或执行 localStorage.setItem("nerv_debug","1") 后刷新；异常会始终出现在本 Console。'
    );

    chart = new Chart($("chartCanvas"));
    if (window.NervSyncWave && $("syncWaveCanvas")) {
      window.NervSyncWave.start($("syncWaveCanvas"));
      window.NervSyncWave.setSync(syncGaugeSmoothed);
    }
    var srd0 = $("syncReadoutDigits");
    if (srd0) srd0.textContent = Math.min(100, Math.max(0, syncGaugeSmoothed)).toFixed(1) + "%";
    if ($("syncReadout")) {
      $("syncReadout").setAttribute(
        "aria-label",
        "同步率 " + Math.min(100, Math.max(0, syncGaugeSmoothed)).toFixed(1) + "%"
      );
    }
    fillBinaryRail();
    setPrimary("start");
    applyManualTier();
    renderLog();

    window.addEventListener("nervbootdone", function () {
      loadIdentification();
    });

    function bindTierPick(id, tier) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("click", function () {
        uiTier = tier;
        applyManualTier();
      });
    }
    bindTierPick("lightNormal", "NORMAL");
    bindTierPick("lightCaution", "CAUTION");
    bindTierPick("lightDanger", "DANGER");

    var uc = $("btnUnitCycle");
    if (uc) {
      uc.addEventListener("click", function () {
        rateUnit = rateUnit === "mbps" ? "mbs" : "mbps";
        applyRateUnitUi();
      });
    }
    applyRateUnitUi();

    $("btnPrimary").addEventListener("click", function () {
      var mode = $("btnPrimary").dataset.mode || "start";
      if (mode === "start" || mode === "retry") {
        runTest();
      } else if (mode === "abort" && controller) {
        controller.abort();
      }
    });

    $("btnClearLog").addEventListener("click", function () {
      if (!window.confirm("CLEAR MISSION LOG? / ログを消去しますか？")) return;
      localStorage.removeItem(LOG_KEY);
      renderLog();
    });

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
