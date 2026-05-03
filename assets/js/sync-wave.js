/**
 * EVA 风格「同步率」波形：组 A（红橙）与组 B（紫）各为多条同幅、仅相位不同的平行正弦，
 * 持续横向滚动；两组之间 Δφ = (1 − S) × 2π（S 为 0~1），S 升高时 B 与 A 重合。
 */
(function () {
  var LAYERS = 9;
  /** 同组内相邻平行曲线的相位间隔（弧度） */
  var LAYER_PHASE_STEP = 0.34;
  /** 画布横向完整周期数，使 Δφ 在视觉上产生可辨干涉 */
  var CYCLES = 1.1;
  var SCROLL_RAD_S = 1.2;
  var WAVE_PAD_X = 10;
  var SCALE_H = 26;
  var FONT_AXIS = '10px "True LCD NGE", "JetBrains Mono", Consolas, monospace';

  function NervSyncWave(canvas) {
    this.canvas = canvas;
    this._sync01 = 0;
    this._running = false;
    this._raf = 0;
    this._scroll = 0;
    this._lastT = 0;
    this._dpr = 1;
  }

  NervSyncWave.prototype.setSync = function (pct0to100) {
    var v = Number(pct0to100);
    if (!isFinite(v)) v = 0;
    this._sync01 = Math.min(1, Math.max(0, v / 100));
  };

  NervSyncWave.prototype._resize = function () {
    var c = this.canvas;
    if (!c) return;
    var rect = c.getBoundingClientRect();
    var w = Math.max(160, Math.floor(rect.width));
    var h = Math.max(120, Math.floor(rect.height));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    this._dpr = dpr;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
  };

  NervSyncWave.prototype._draw = function (now) {
    var c = this.canvas;
    if (!c) return;
    var ctx = c.getContext("2d");
    if (!ctx) return;
    var dpr = this._dpr;
    var W = c.width;
    var H = c.height;
    var dt = this._lastT > 0 ? (now - this._lastT) / 1000 : 0;
    this._lastT = now;
    if (dt > 0.2) dt = 0.016;
    this._scroll += SCROLL_RAD_S * dt * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    var cssW = W / dpr;
    var cssH = H / dpr;
    var waveTop = 14;
    var waveBottom = cssH - SCALE_H - 8;
    var waveH = Math.max(40, waveBottom - waveTop);
    var waveMid = waveTop + waveH * 0.5;
    var x0 = WAVE_PAD_X;
    var x1 = cssW - WAVE_PAD_X;
    var plotW = x1 - x0;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, cssW, cssH);

    /* 上下框线 */
    ctx.strokeStyle = "rgba(255, 80, 40, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, waveTop);
    ctx.lineTo(x1, waveTop);
    ctx.moveTo(x0, waveBottom);
    ctx.lineTo(x1, waveBottom);
    ctx.stroke();

    /* 弱水平参考线 */
    ctx.strokeStyle = "rgba(255, 102, 0, 0.12)";
    for (var gy = 0; gy <= 4; gy += 1) {
      var yy = waveTop + (waveH * gy) / 4;
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x1, yy);
      ctx.stroke();
    }

    /* 左侧竖虚线参考 */
    var dashX = x0 + plotW * 0.12;
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "rgba(255, 120, 60, 0.35)";
    ctx.beginPath();
    ctx.moveTo(dashX, waveTop);
    ctx.lineTo(dashX, waveBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    /* 背景小十字 */
    ctx.strokeStyle = "rgba(255, 140, 80, 0.14)";
    ctx.lineWidth = 1;
    var cx;
    var cy;
    for (cx = x0 + 24; cx < x1; cx += 52) {
      for (cy = waveTop + 16; cy < waveBottom; cy += 36) {
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy);
        ctx.lineTo(cx + 3, cy);
        ctx.moveTo(cx, cy - 3);
        ctx.lineTo(cx, cy + 3);
        ctx.stroke();
      }
    }

    var S = this._sync01;
    var deltaPhi = (1 - S) * Math.PI * 2;
    /** 各层共用波幅，仅相位错开 → 平行正弦族 */
    var amp = waveH * 0.38;
    var midJ = (LAYERS - 1) * 0.5;

    function strokeBundle(isA) {
      var j;
      for (j = 0; j < LAYERS; j += 1) {
        var phaseLayer = (j - midJ) * LAYER_PHASE_STEP;
        var bundleShift = isA ? 0 : deltaPhi;
        var alpha = 0.09 + (j / LAYERS) * 0.1;
        if (isA) {
          ctx.strokeStyle = "rgba(255, 70, 30, " + alpha.toFixed(3) + ")";
        } else {
          ctx.strokeStyle = "rgba(150, 90, 255, " + (alpha + 0.02).toFixed(3) + ")";
        }
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        var x;
        var step = 2;
        var first = true;
        for (x = x0; x <= x1 + 0.5; x += step) {
          var u = (2 * Math.PI * CYCLES * (x - x0)) / plotW + this._scroll + phaseLayer + bundleShift;
          var y = waveMid + amp * Math.sin(u);
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    }

    var prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    strokeBundle.call(this, true);
    strokeBundle.call(this, false);
    ctx.globalCompositeOperation = prev;

    /* 底轴刻度 -5 … +5 */
    var scaleY = cssH - SCALE_H * 0.55;
    ctx.font = FONT_AXIS;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 160, 90, 0.75)";
    ctx.strokeStyle = "rgba(255, 140, 80, 0.5)";
    ctx.lineWidth = 1;
    var n;
    for (n = -5; n <= 5; n += 1) {
      var tx = x0 + ((n + 5) / 10) * plotW;
      ctx.beginPath();
      ctx.moveTo(tx, scaleY + 4);
      ctx.lineTo(tx, scaleY + 10);
      ctx.stroke();
      ctx.fillText(String(n), tx, scaleY + 22);
    }
  };

  NervSyncWave.prototype._loop = function (t) {
    if (!this._running) return;
    this._draw(t);
    var self = this;
    this._raf = requestAnimationFrame(function (x) {
      self._loop(x);
    });
  };

  NervSyncWave.prototype.start = function () {
    if (!this.canvas || this._running) return;
    this._running = true;
    this._lastT = 0;
    var self = this;
    this._onResize = function () {
      self._resize();
    };
    window.addEventListener("resize", this._onResize);
    if (typeof ResizeObserver !== "undefined" && this.canvas.parentElement) {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.canvas.parentElement);
    }
    this._resize();
    this._loop(performance.now());
  };

  NervSyncWave.prototype.stop = function () {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    window.removeEventListener("resize", this._onResize);
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  };

  var singleton = null;

  window.NervSyncWave = {
    start: function (canvasEl) {
      if (!canvasEl) return;
      if (singleton) singleton.stop();
      singleton = new NervSyncWave(canvasEl);
      singleton.start();
      return singleton;
    },
    stop: function () {
      if (singleton) singleton.stop();
      singleton = null;
    },
    setSync: function (pct0to100) {
      if (singleton) singleton.setSync(pct0to100);
    },
  };
})();
