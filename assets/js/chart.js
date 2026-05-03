/**
 * 实时折线图 — 下行与上行共用同一横轴绘图区：各序列按「本阶段时间」独立映射到全宽，
 * 上行开始时仍从画布左侧起画，不再与下行左右拼接在同一绝对时间轴上。
 * 采样节流 + 点数上限，避免每帧 push 在高刷 / 长测速下撑爆内存（OOM）。
 */
(function () {
  var PUSH_INTERVAL_MS = 50;
  var MAX_POINTS = 2400;
  var FONT_CHART_NUM = '10px "True LCD NGE", "JetBrains Mono", Consolas, monospace';
  var FONT_CHART_EN = '10px "JetBrains Mono", Consolas, monospace';

  function NervChart(canvas) {
    this.canvas = canvas;
    this.pointsDl = [];
    this.pointsUl = [];
    /** 测速结束后为 true：各序列横轴上界固定，折线占满各自映射下的全宽 */
    this.frozen = false;
    this._lastPushT = null;
    /** 当前仍在增长的序列：dl / ul / none（收尾或 freeze 后不向 now 延伸） */
    this._liveTail = "off";
  }

  /**
   * @param {boolean} [force] 为 true 时忽略节流（测速结束前写入最终采样）
   * @param {string} [phase] off — 不写点；dl — 只写下行；ul — 只写上行；both — 同时写（用于收尾）
   * @returns {boolean} 是否新写入了一个点
   */
  NervChart.prototype.push = function (dlMbps, ulMbps, force, phase) {
    var ph = phase || "off";
    if (!force && (ph === "off" || ph === "")) {
      return false;
    }
    var t = performance.now();
    if (!force && this._lastPushT != null && t - this._lastPushT < PUSH_INTERVAL_MS) {
      return false;
    }
    this._lastPushT = t;
    if (ph === "dl" || ph === "both") {
      this.pointsDl.push({ t: t, v: dlMbps });
    }
    if (ph === "ul" || ph === "both") {
      this.pointsUl.push({ t: t, v: ulMbps });
    }
    if (ph === "dl") {
      this._liveTail = "dl";
    } else if (ph === "ul") {
      this._liveTail = "ul";
    } else if (ph === "both") {
      this._liveTail = "none";
    }
    while (this.pointsDl.length > MAX_POINTS) {
      this.pointsDl.shift();
    }
    while (this.pointsUl.length > MAX_POINTS) {
      this.pointsUl.shift();
    }
    return true;
  };

  NervChart.prototype.clear = function () {
    this.pointsDl = [];
    this.pointsUl = [];
    this.frozen = false;
    this._lastPushT = null;
    this._liveTail = "off";
  };

  /** 本轮测速结束调用：各序列横轴冻结在末采样时刻 */
  NervChart.prototype.freeze = function () {
    this.frozen = true;
    this._liveTail = "none";
  };

  NervChart.prototype.draw = function () {
    var c = this.canvas;
    if (!c) return;
    var ctx = c.getContext("2d");
    if (!ctx) return;
    var w = c.width;
    var h = c.height;
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);

    var padL = 48;
    var padR = 12;
    var padT = 14;
    var padB = 28;
    var gw = w - padL - padR;
    var gh = h - padT - padB;

    var maxV = 100;
    var i;
    for (i = 0; i < this.pointsDl.length; i += 1) {
      maxV = Math.max(maxV, this.pointsDl[i].v);
    }
    for (i = 0; i < this.pointsUl.length; i += 1) {
      maxV = Math.max(maxV, this.pointsUl[i].v);
    }
    maxV = Math.ceil(maxV / 20) * 20 + 20;

    ctx.strokeStyle = "rgba(255,102,0,0.12)";
    ctx.lineWidth = 1;
    var gx;
    for (gx = 0; gx <= 8; gx += 1) {
      var xg = padL + (gw * gx) / 8;
      ctx.beginPath();
      ctx.moveTo(xg, padT);
      ctx.lineTo(xg, padT + gh);
      ctx.stroke();
    }
    var gy;
    for (gy = 0; gy <= 4; gy += 1) {
      var yg = padT + (gh * gy) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, yg);
      ctx.lineTo(padL + gw, yg);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(160,160,160,0.7)";
    ctx.textAlign = "right";
    for (gy = 0; gy <= 4; gy += 1) {
      var y2 = padT + (gh * gy) / 4;
      var val = maxV * (1 - gy / 4);
      var numStr = val.toFixed(0);
      var suf = " M";
      ctx.font = FONT_CHART_EN;
      var wSuf = ctx.measureText(suf).width;
      ctx.font = FONT_CHART_NUM;
      ctx.fillText(numStr, padL - 6 - wSuf, y2 + 4);
      ctx.font = FONT_CHART_EN;
      ctx.fillText(suf, padL - 6, y2 + 4);
    }

    /** 去掉前导的 0 / 无效值，避免下行/上行开头一长段贴底（EWMA 与首几拍 instant 常为 0） */
    function trimLeadingFlat(points) {
      if (!points || points.length <= 1) return points;
      var i = 0;
      while (i < points.length) {
        var v = points[i].v;
        if (isFinite(v) && v > 0) break;
        i += 1;
      }
      if (i === 0) return points;
      if (i >= points.length) return points;
      return points.slice(i);
    }

    function plotLine(points, color, extendRightToNow) {
      if (points.length < 1) return;
      var t0s = points[0].t;
      var t1s = points[points.length - 1].t;
      if (extendRightToNow) {
        t1s = Math.max(t1s, performance.now());
      }
      if (t1s - t0s < 16) {
        t1s = t0s + 16;
      }
      var span = t1s - t0s;
      ctx.beginPath();
      var first = true;
      for (var k = 0; k < points.length; k += 1) {
        var p = points[k];
        var tx = padL + ((p.t - t0s) / span) * gw;
        var ty = padT + gh - (p.v / maxV) * gh;
        if (first) {
          ctx.moveTo(tx, ty);
          first = false;
        } else {
          ctx.lineTo(tx, ty);
        }
      }
      if (extendRightToNow && points.length > 0) {
        var pLast = points[points.length - 1];
        var txEnd = padL + gw;
        var tyEnd = padT + gh - (pLast.v / maxV) * gh;
        ctx.lineTo(txEnd, tyEnd);
      }
      if (points.length < 2 && !extendRightToNow) {
        return;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    var extDl = !this.frozen && this._liveTail === "dl";
    var extUl = !this.frozen && this._liveTail === "ul";
    plotLine(trimLeadingFlat(this.pointsDl), "#ff6600", extDl);
    plotLine(trimLeadingFlat(this.pointsUl), "#00e5cc", extUl);

    ctx.fillStyle = "#ff6600";
    ctx.font = FONT_CHART_EN;
    ctx.textAlign = "left";
    ctx.fillText("DL", padL, h - 8);
    ctx.fillStyle = "#00e5cc";
    ctx.fillText("UL", padL + 28, h - 8);
  };

  window.NervChart = NervChart;
})();
