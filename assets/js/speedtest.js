/**
 * 测速核心 — 多并发、滑动采样、慢启动忽略（PRD FR-01~03, §9.3）
 */
(function () {
  function isNervDebug() {
    try {
      var q = new URLSearchParams(location.search || "");
      if (q.get("nerv_debug") === "1") return true;
      if (typeof localStorage !== "undefined" && localStorage.getItem("nerv_debug") === "1") return true;
    } catch (e) {
      /* */
    }
    return false;
  }

  function nervLog() {
    if (!isNervDebug()) return;
    var a = Array.prototype.slice.call(arguments);
    a.unshift("[NERV]");
    console.log.apply(console, a);
  }

  /** 不受 nerv_debug 开关影响，用于异常与失败路径 */
  function nervError(where, err) {
    var msg = err && err.message ? err.message : String(err);
    console.error("[NERV ERROR @" + where + "]", msg);
    if (err && err.stack) console.error(err.stack);
  }

  window.NervDebug = {
    isDebug: isNervDebug,
    log: nervLog,
    error: nervError,
  };

  var API = {
    garbage: "backend/garbage.php",
    empty: "backend/empty.php",
    ping: "backend/empty.php",
    getIP: "backend/getIP.php",
  };

  /**
   * LibreSpeed server-list 条目：server + dlURL / ulURL / pingURL / getIpURL
   * @see https://github.com/librespeed/speedtest/blob/master/frontend/server-list.json
   */
  function normalizeServerOrigin(server) {
    var s = server == null ? "" : String(server).trim();
    if (!s) {
      try {
        return new URL("./", window.location.href).href;
      } catch (e0) {
        return String(window.location.origin || "") + "/";
      }
    }
    if (s.indexOf("//") === 0) {
      s = (typeof location !== "undefined" ? location.protocol : "https:") + s;
    } else if (!/^https?:\/\//i.test(s)) {
      s = "https://" + s.replace(/^\/+/, "");
    }
    if (s.slice(-1) !== "/") {
      s += "/";
    }
    return s;
  }

  function endpointUrl(server, path) {
    var base = normalizeServerOrigin(server);
    var p = path == null ? "" : String(path).trim();
    if (!p) {
      return base.replace(/\/+$/, "") || base;
    }
    try {
      return new URL(p, base).href;
    } catch (e1) {
      return base.replace(/\/+$/, "") + "/" + p.replace(/^\//, "");
    }
  }

  /**
   * 对单条 LibreSpeed 服务器做 GET ping（与 probePing 单发相同路径），超时返回失败。
   * @param {{ server?: string, pingURL?: string, ulURL?: string }} entry
   * @param {number} [timeoutMs=1000]
   */
  async function probeServerLatency(entry, timeoutMs) {
    var limit = timeoutMs == null ? 1000 : Math.max(50, timeoutMs);
    var pingPath =
      entry && entry.pingURL != null
        ? entry.pingURL
        : entry && entry.ulURL != null
          ? entry.ulURL
          : "empty.php";
    var baseUrl = endpointUrl(entry.server, pingPath);
    var sep = baseUrl.indexOf("?") >= 0 ? "&" : "?";
    var url = baseUrl + sep + "r=" + Math.random();
    var ctrl = new AbortController();
    var tid = window.setTimeout(function () {
      ctrl.abort();
    }, limit);
    var t0 = performance.now();
    try {
      var res = await fetch(url, { method: "GET", cache: "no-store", signal: ctrl.signal });
      if (!res.ok) {
        return { ok: false, ms: Infinity, status: res.status };
      }
      await res.arrayBuffer();
      return { ok: true, ms: performance.now() - t0, status: res.status };
    } catch (e2) {
      return { ok: false, ms: Infinity, error: e2 && e2.name };
    } finally {
      window.clearTimeout(tid);
    }
  }

  function applyLibreSpeedEntry(entry) {
    if (!entry || typeof entry !== "object") return;
    var srv = entry.server;
    var dl = entry.dlURL != null ? entry.dlURL : "garbage.php";
    var ul = entry.ulURL != null ? entry.ulURL : "empty.php";
    var ping = entry.pingURL != null ? entry.pingURL : ul;
    var gip = entry.getIpURL != null ? entry.getIpURL : "getIP.php";
    API.garbage = endpointUrl(srv, dl);
    API.empty = endpointUrl(srv, ul);
    API.ping = endpointUrl(srv, ping);
    API.getIP = endpointUrl(srv, gip);
    nervLog("applyLibreSpeedEntry", entry.name || "", API.getIP);
  }

  var DEFAULT_LIBRE_ENTRY = {
    name: "本域 backend (PHP)",
    server: "",
    id: 0,
    dlURL: "backend/garbage.php",
    ulURL: "backend/empty.php",
    pingURL: "backend/empty.php",
    getIpURL: "backend/getIP.php",
  };

  applyLibreSpeedEntry(DEFAULT_LIBRE_ENTRY);

  var DEFAULTS = {
    /* 并发过大时 PHP 内置服务器等单线程后端会长时间卡在首个大响应，表现为下载阶段永不结束 */
    dlThreads: 4,
    ulThreads: 3,
    dlMs: 15000,
    ulMs: 15000,
    dlIgnoreMs: 1500,
    ulIgnoreMs: 3000,
    tickMs: 100,
    /** 单次 garbage 响应体积（MiB）；过大会拖死弱服务端，过小会增加 HTTP 往返次数 */
    ckSizeMiB: 16,
    pingSamples: 11,
    ulChunkBytes: 1048576,
  };

  /** Web Crypto 规定单次 getRandomValues 最多 65536 字节 */
  var CRYPTO_RANDOM_MAX = 65536;

  function fillRandomBytes(view) {
    var len = view.length;
    var off = 0;
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      /* 必须对「独立小视图」调用 getRandomValues；对大 buffer 的 subarray 在部分环境仍会按整段配额报错 */
      var scratch = new Uint8Array(CRYPTO_RANDOM_MAX);
      while (off < len) {
        var n = Math.min(CRYPTO_RANDOM_MAX, len - off);
        var slice = n === CRYPTO_RANDOM_MAX ? scratch : scratch.subarray(0, n);
        window.crypto.getRandomValues(slice);
        view.set(slice, off);
        off += n;
      }
      return;
    }
    var ri;
    for (ri = 0; ri < len; ri += 1) {
      view[ri] = Math.floor(Math.random() * 256);
    }
  }

  function tierDownload(mbps) {
    if (mbps >= 100) return "NORMAL";
    if (mbps >= 20) return "CAUTION";
    return "DANGER";
  }

  function tierPing(ms) {
    if (ms < 30) return "NORMAL";
    if (ms < 100) return "CAUTION";
    return "DANGER";
  }

  function combinedTier(dlT, ulT, pingT) {
    var order = { DANGER: 0, CAUTION: 1, NORMAL: 2 };
    var worst = dlT;
    if (order[ulT] < order[worst]) worst = ulT;
    if (order[pingT] < order[worst]) worst = pingT;
    return worst;
  }

  async function fetchIp(signal) {
    nervLog("fetchIp GET", API.getIP);
    var opt = { cache: "no-store" };
    if (signal) opt.signal = signal;
    var t0 = performance.now();
    var res = await fetch(API.getIP, opt);
    nervLog("fetchIp response", res.status, Math.round(performance.now() - t0) + "ms");
    if (!res.ok) {
      nervError("fetchIp", new Error("HTTP " + res.status));
      throw new Error("getIP failed");
    }
    var text = await res.text();
    var forJson = text.replace(/^\uFEFF/, "");

    function looksLikeUnexecutedPhp(s) {
      var head = s.slice(0, 512);
      var i = head.search(/<\?php/i);
      return i >= 0 && i <= 32;
    }

    function throwPhpNotExecuted() {
      var whyPhp =
        typeof location !== "undefined" && location.protocol === "file:"
          ? "不要用 file:// 直接打开页面；在项目根目录执行 php -S 0.0.0.0:8080，再用浏览器打开 http://127.0.0.1:8080/ 。"
          : "当前站点未执行 PHP（例如纯静态服务器）；请换用带 PHP 的 Web 服务器，并保证能访问 backend/getIP.php。";
      var errPhp = new Error("getIP 返回了 .php 源码而非 JSON，说明 PHP 未被执行。" + whyPhp);
      nervError("fetchIp", errPhp);
      throw errPhp;
    }

    if (looksLikeUnexecutedPhp(forJson)) {
      throwPhpNotExecuted();
    }

    try {
      return JSON.parse(forJson);
    } catch (parseErr) {
      if (looksLikeUnexecutedPhp(forJson)) {
        throwPhpNotExecuted();
      }
      var trimmed = forJson.trimStart();
      if (trimmed.charAt(0) === "<") {
        var errHtml = new Error(
          "getIP 返回内容以「<」开头（多为 HTML/错误页），不是 JSON。请确认用 PHP 服务器访问且 URL 指向正确的 backend/getIP.php。"
        );
        nervError("fetchIp", errHtml);
        throw errHtml;
      }
      var snippet = text.slice(0, 160).replace(/\s+/g, " ");
      var errJson = new Error(
        "getIP 响应不是合法 JSON: " + (parseErr && parseErr.message ? parseErr.message : parseErr) + " | 开头: " + snippet
      );
      nervError("fetchIp", errJson);
      throw errJson;
    }
  }

  async function probePing(signal, onSample) {
    nervLog("probePing start samples=", DEFAULTS.pingSamples);
    var times = [];
    var k;
    for (k = 0; k < DEFAULTS.pingSamples; k += 1) {
      if (signal.aborted) break;
      var t0 = performance.now();
      try {
        var pingUrl = API.ping || API.empty;
        var pres = await fetch(pingUrl + "?r=" + Math.random(), {
          method: "GET",
          cache: "no-store",
          signal: signal,
        });
        if (!pres.ok) {
          var pe = new Error("GET empty HTTP " + pres.status);
          nervError("probePing", pe);
          throw pe;
        }
      } catch (e) {
        if (e && e.name === "AbortError") break;
        nervError("probePing sample " + k, e);
        throw e;
      }
      var dt = performance.now() - t0;
      times.push(dt);
      nervLog("probePing sample", k, "rtt_ms=", Math.round(dt * 10) / 10);
      if (onSample) onSample({ index: k, rtt: dt });
    }
    var arr = times.length > 1 ? times.slice(1) : times;
    if (arr.length === 0) {
      return { min: 0, max: 0, avg: 0, jitter: 0, tier: "NORMAL" };
    }
    var min = Math.min.apply(null, arr);
    var max = Math.max.apply(null, arr);
    var sum = 0;
    for (k = 0; k < arr.length; k += 1) sum += arr[k];
    var avg = sum / arr.length;
    var jitters = [];
    for (k = 1; k < arr.length; k += 1) {
      jitters.push(Math.abs(arr[k] - arr[k - 1]));
    }
    var jitter = jitters.length
      ? jitters.reduce(function (a, b) {
          return a + b;
        }, 0) / jitters.length
      : 0;
    var out = {
      min: min,
      max: max,
      avg: avg,
      jitter: jitter,
      tier: tierPing(avg),
    };
    nervLog("probePing done avg_ms=", Math.round(avg * 10) / 10, "tier=", out.tier);
    return out;
  }

  async function runDownload(signal, onTick) {
    nervLog("runDownload start threads=", DEFAULTS.dlThreads, "duration_ms=", DEFAULTS.dlMs);
    var start = performance.now();
    var bytes = 0;
    var bytesAtIgnore = 0;
    var ignoreMarked = false;
    var peak = 0;
    var lastT = start;
    var lastB = 0;

    function add(n) {
      bytes += n;
    }

    var combinedAbort = new AbortController();
    var dlSignal = combinedAbort.signal;
    var forwardUserAbort = function () {
      combinedAbort.abort();
    };
    signal.addEventListener("abort", forwardUserAbort);
    var hardDeadlineMs = DEFAULTS.dlMs + 25000;
    var deadlineId = window.setTimeout(function () {
      nervLog("runDownload hard deadline (ms)", hardDeadlineMs);
      combinedAbort.abort();
    }, hardDeadlineMs);

    function backoffFetchError() {
      return new Promise(function (resolve) {
        window.setTimeout(resolve, 200);
      });
    }

    var workers = [];
    var t;
    for (t = 0; t < DEFAULTS.dlThreads; t += 1) {
      workers.push(
        (function (idx) {
          return (async function () {
            while (!dlSignal.aborted && performance.now() - start < DEFAULTS.dlMs) {
              var url =
                API.garbage +
                "?ckSize=" +
                DEFAULTS.ckSizeMiB +
                "&r=" +
                Math.random() +
                "_" +
                idx +
                "_" +
                Date.now();
              try {
                var res = await fetch(url, { cache: "no-store", signal: dlSignal });
                if (!res.ok) {
                  nervLog("runDownload garbage HTTP", res.status, url.slice(0, 80));
                  await backoffFetchError();
                  continue;
                }
                if (!res.body) {
                  nervLog("runDownload no body", url.slice(0, 80));
                  await backoffFetchError();
                  continue;
                }
                var reader = res.body.getReader();
                try {
                  while (!dlSignal.aborted && performance.now() - start < DEFAULTS.dlMs) {
                    var chunk = await reader.read();
                    if (chunk.done) break;
                    add(chunk.value.length);
                  }
                } finally {
                  try {
                    reader.cancel();
                  } catch (eCancel) {
                    /* */
                  }
                }
              } catch (e) {
                if (e && e.name === "AbortError") return;
                nervError("runDownload worker", e);
                throw e;
              }
            }
          })();
        })(t)
      );
    }

    var iv = window.setInterval(function () {
      if (signal.aborted || dlSignal.aborted) return;
      var now = performance.now();
      var elapsed = now - start;
      if (!ignoreMarked && elapsed >= DEFAULTS.dlIgnoreMs) {
        bytesAtIgnore = bytes;
        ignoreMarked = true;
      }
      var dt = (now - lastT) / 1000;
      var db = bytes - lastB;
      var instant = dt > 0 ? (db * 8) / (dt * 1e6) : 0;
      lastT = now;
      lastB = bytes;
      if (ignoreMarked) {
        peak = Math.max(peak, instant);
      }
      var avg = 0;
      if (ignoreMarked && elapsed > DEFAULTS.dlIgnoreMs + 50) {
        var effSec = (elapsed - DEFAULTS.dlIgnoreMs) / 1000;
        avg = effSec > 0 ? ((bytes - bytesAtIgnore) * 8) / (effSec * 1e6) : 0;
      }
      if (onTick) {
        onTick({
          phase: "dl",
          instant: instant,
          peak: peak,
          avg: avg,
          bytes: bytes,
          elapsed: elapsed,
          ignoreReady: ignoreMarked,
        });
      }
    }, DEFAULTS.tickMs);

    try {
      await Promise.all(workers);
    } finally {
      window.clearInterval(iv);
      window.clearTimeout(deadlineId);
      signal.removeEventListener("abort", forwardUserAbort);
    }

    var end = performance.now();
    var effMs = Math.max(1, end - start - DEFAULTS.dlIgnoreMs);
    var avgFinal = ignoreMarked
      ? ((bytes - bytesAtIgnore) * 8) / (effMs / 1000) / 1e6
      : 0;
    var dlOut = {
      bytes: bytes,
      avg: avgFinal,
      peak: peak,
      tier: tierDownload(avgFinal),
      duration: end - start,
    };
    nervLog(
      "runDownload done avg_Mbps=",
      Math.round(avgFinal * 100) / 100,
      "bytes=",
      bytes,
      "duration_ms=",
      Math.round(dlOut.duration)
    );
    return dlOut;
  }

  async function runUpload(signal, onTick) {
    nervLog("runUpload start threads=", DEFAULTS.ulThreads, "POST", API.empty);
    var start = performance.now();
    var bytes = 0;
    var bytesAtIgnore = 0;
    var ignoreMarked = false;
    var peak = 0;
    var lastT = start;
    var lastB = 0;

    /** 每路 worker 独立 buffer，禁止多并发 fetch 共用同一 Uint8Array body（易挂死、无速度、无法中止） */
    var uploadBuffers = [];
    var bi;
    for (bi = 0; bi < DEFAULTS.ulThreads; bi += 1) {
      var ub = new Uint8Array(DEFAULTS.ulChunkBytes);
      fillRandomBytes(ub);
      uploadBuffers.push(ub);
    }

    var workers = [];
    var u;
    for (u = 0; u < DEFAULTS.ulThreads; u += 1) {
      workers.push(
        (async function (bodyBuf) {
          while (!signal.aborted && performance.now() - start < DEFAULTS.ulMs) {
            try {
              var res = await fetch(API.empty, {
                method: "POST",
                body: bodyBuf,
                headers: { "Content-Type": "application/octet-stream" },
                cache: "no-store",
                signal: signal,
              });
              if (!res.ok) {
                throw new Error("UPLOAD_HTTP_" + res.status);
              }
              bytes += bodyBuf.byteLength;
            } catch (e) {
              if (e && e.name === "AbortError") return;
              nervError("runUpload worker", e);
              throw e;
            }
          }
        })(uploadBuffers[u])
      );
    }

    var iv = window.setInterval(function () {
      if (signal.aborted) return;
      var now = performance.now();
      var elapsed = now - start;
      if (!ignoreMarked && elapsed >= DEFAULTS.ulIgnoreMs) {
        bytesAtIgnore = bytes;
        ignoreMarked = true;
      }
      var dt = (now - lastT) / 1000;
      var db = bytes - lastB;
      var instant = dt > 0 ? (db * 8) / (dt * 1e6) : 0;
      lastT = now;
      lastB = bytes;
      if (ignoreMarked) {
        peak = Math.max(peak, instant);
      }
      var avg = 0;
      if (ignoreMarked && elapsed > DEFAULTS.ulIgnoreMs + 50) {
        var effSec = (elapsed - DEFAULTS.ulIgnoreMs) / 1000;
        avg = effSec > 0 ? ((bytes - bytesAtIgnore) * 8) / (effSec * 1e6) : 0;
      }
      if (onTick) {
        onTick({
          phase: "ul",
          instant: instant,
          peak: peak,
          avg: avg,
          bytes: bytes,
          elapsed: elapsed,
          ignoreReady: ignoreMarked,
        });
      }
    }, DEFAULTS.tickMs);

    try {
      await Promise.all(workers);
    } finally {
      window.clearInterval(iv);
    }

    var end = performance.now();
    var effMs = Math.max(1, end - start - DEFAULTS.ulIgnoreMs);
    var avgFinal = ignoreMarked
      ? ((bytes - bytesAtIgnore) * 8) / (effMs / 1000) / 1e6
      : 0;
    var ulOut = {
      bytes: bytes,
      avg: avgFinal,
      peak: peak,
      tier: tierDownload(avgFinal),
      duration: end - start,
    };
    nervLog(
      "runUpload done avg_Mbps=",
      Math.round(avgFinal * 100) / 100,
      "bytes=",
      bytes,
      "duration_ms=",
      Math.round(ulOut.duration)
    );
    return ulOut;
  }

  window.NervSpeedtest = {
    API: API,
    DEFAULTS: DEFAULTS,
    DEFAULT_LIBRE_ENTRY: DEFAULT_LIBRE_ENTRY,
    applyLibreSpeedEntry: applyLibreSpeedEntry,
    probeServerLatency: probeServerLatency,
    endpointUrl: endpointUrl,
    normalizeServerOrigin: normalizeServerOrigin,
    tierDownload: tierDownload,
    tierPing: tierPing,
    combinedTier: combinedTier,
    fetchIp: fetchIp,
    probePing: probePing,
    runDownload: runDownload,
    runUpload: runUpload,
  };
})();
