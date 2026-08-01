/* Device fingerprinting for fin-fy.
 *
 * Collects device signals (canvas render, WebGL GPU string, UA, locale,
 * timezone, screen, platform…) and hashes them into a stable device id.
 * The result is sent as the X-Device-Fp header and is the credential that
 * binds a device to a member. Pure-JS SHA-256 — works on plain http (no
 * secure-context crypto available on the LAN).
 */
"use strict";

(function (global) {
  // ---- compact SHA-256 (ASCII input) ----
  function sha256(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var i, j;
    var result = "";
    var words = [];
    var asciiBitLength = ascii.length * 8;

    var hash = (sha256.h = sha256.h || []);
    var k = (sha256.k = sha256.k || []);
    var primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) {
          isComposite[i] = candidate;
        }
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }

    ascii += "\x80";
    while (ascii.length % 64 - 56) ascii += "\x00";
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return ""; // ASCII only
      words[i >> 2] |= j << (((3 - i) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;

    for (j = 0; j < words.length; ) {
      var w = words.slice(j, (j += 16));
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 =
          hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : (w[i - 16] +
                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                0);
        var temp2 =
          (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? 0 : "") + b.toString(16);
      }
    }
    return result;
  }

  // ---- signals ----
  function canvasFp() {
    try {
      var c = document.createElement("canvas");
      c.width = 240;
      c.height = 60;
      var ctx = c.getContext("2d");
      if (!ctx) return "canvas:unavailable";
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillStyle = "#f60";
      ctx.fillRect(100, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("fin-fy 1234567890", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("abcdefghijklmnopqrstuvwxyz", 4, 40);
      return sha256(c.toDataURL());
    } catch (e) {
      return "canvas:unavailable";
    }
  }

  function webglFp() {
    try {
      var c = document.createElement("canvas");
      var gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!gl) return "webgl:unavailable";
      var ext = gl.getExtension("WEBGL_debug_renderer_info");
      var renderer = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      var vendor = ext
        ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR);
      return String(vendor || "") + "|" + String(renderer || "");
    } catch (e) {
      return "webgl:unavailable";
    }
  }

  function collect() {
    var components = [
      ["canvas", canvasFp()],
      ["webgl", webglFp()],
      ["ua", navigator.userAgent],
      ["lang", navigator.language || ""],
      ["langs", (navigator.languages || []).join(",")],
      ["tz", (Intl.DateTimeFormat().resolvedOptions().timeZone) || ""],
      ["dpr", String(window.devicePixelRatio || 1)],
      ["cores", String(navigator.hardwareConcurrency || "?")],
      ["platform", navigator.platform || ""],
    ];
    var raw = components.map(function (c) { return c[0] + "=" + c[1]; }).join("|");
    return { hash: sha256(raw), components: components };
  }

  global.finfyFingerprint = {
    compute: collect,
    sha256: sha256,
  };
})(window);
