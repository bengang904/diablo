(() => {
    "use strict";

    const DEFAULT_CONFIG = {
        manifestUrl: null,
        targetUrl: "./DIABDAT.MPQ",
        cacheName: "file-merge-cache",
        parts: [
            "./part/DIABDAT.MPQ.part1",
            "./part/DIABDAT.MPQ.part2",
            "./part/DIABDAT.MPQ.part3",
            "./part/DIABDAT.MPQ.part4",
            "./part/DIABDAT.MPQ.part5",
            "./part/DIABDAT.MPQ.part6",
            "./part/DIABDAT.MPQ.part7",
            "./part/DIABDAT.MPQ.part8",
            "./part/DIABDAT.MPQ.part9",
            "./part/DIABDAT.MPQ.part10"
        ]
    };

    const userConfig =
        typeof window !== "undefined" && window.FILE_MERGE_CONFIG
            ? window.FILE_MERGE_CONFIG
            : {};

    let config = Object.assign({}, DEFAULT_CONFIG, userConfig);
    let mergePromise = null;
    let resolvedParts = null;
    let resolvedTarget = null;
    let resolvedAbsoluteTarget = null;

    const progressState = {
        phase: "idle",
        partIndex: 0,
        partCount: 0,
        partName: "",
        partLoaded: 0,
        partTotal: 0,
        totalLoaded: 0,
        totalExpected: 0,
        mergeOffset: 0,
        mergeTotal: 0
    };

    let uiRoot = null;
    let uiBar = null;
    let uiPercent = null;
    let uiStatus = null;
    let uiLog = null;
    let lastUiLog = "";
    let uiStyle = null;

    function bringToFront() {
        if (!uiRoot) return;
        const parent = document.documentElement || document.body;
        if (!parent) return;
        if (uiRoot.parentNode !== parent) {
            parent.appendChild(uiRoot);
        } else if (parent.lastChild !== uiRoot) {
            parent.appendChild(uiRoot);
        }
        uiRoot.style.zIndex = "2147483647";
        uiRoot.style.display = "flex";
        uiRoot.style.visibility = "visible";
        uiRoot.style.opacity = "1";
        uiRoot.style.pointerEvents = "auto";
    }

    function ensureUI() {
        const host = document.body || document.documentElement;
        if (!host) {
            document.addEventListener("DOMContentLoaded", ensureUI, { once: true });
            return;
        }

        if (!uiStyle) {
            uiStyle = document.createElement("style");
            uiStyle.id = "filemerge-style";
            uiStyle.textContent =
                "#filemerge-overlay{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;display:flex!important;align-items:center;justify-content:center;background:rgba(0,0,0,.92)!important;color:#fff!important;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif!important;margin:0!important;padding:16px!important;box-sizing:border-box!important;pointer-events:auto!important;visibility:visible!important;opacity:1!important}" +
                "#filemerge-overlay.filemerge-hide{opacity:0!important;pointer-events:none!important;transition:opacity .35s ease}" +
                "#filemerge-panel{width:min(94vw,520px);max-height:90vh;overflow:auto;background:#121212;border:1px solid #333;border-radius:14px;padding:20px 18px 16px;box-shadow:0 16px 48px rgba(0,0,0,.6);box-sizing:border-box}" +
                "#filemerge-title{font-size:17px;font-weight:700;margin:0 0 14px;color:#fff}" +
                "#filemerge-track{height:14px;background:#2b2b2b;border-radius:999px;overflow:hidden;margin:0 0 10px}" +
                "#filemerge-bar{height:100%;width:0%;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:999px;transition:width .1s linear}" +
                "#filemerge-meta{display:flex;justify-content:space-between;gap:12px;font-size:13px;margin:0 0 12px;color:#ddd}" +
                "#filemerge-percent{font-weight:700;color:#86efac}" +
                "#filemerge-status{font-size:13px;line-height:1.5;color:#eee;min-height:3.2em;margin:0 0 12px;white-space:pre-wrap;word-break:break-all}" +
                "#filemerge-log{display:block!important;max-height:220px;min-height:120px;overflow:auto;background:#000;border:1px solid #333;border-radius:10px;padding:10px;font-size:12px;line-height:1.5;color:#9fef9f;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}";
            (document.head || document.documentElement).appendChild(uiStyle);
        }

        if (!uiRoot || !document.getElementById("filemerge-overlay")) {
            uiRoot = document.createElement("div");
            uiRoot.id = "filemerge-overlay";
            uiRoot.setAttribute("data-filemerge", "1");
            uiRoot.innerHTML =
                '<div id="filemerge-panel">' +
                '<div id="filemerge-title">Loading Game Data</div>' +
                '<div id="filemerge-track"><div id="filemerge-bar"></div></div>' +
                '<div id="filemerge-meta"><span id="filemerge-status-label">Preparing…</span><span id="filemerge-percent">0%</span></div>' +
                '<div id="filemerge-status">Waiting…</div>' +
                '<div id="filemerge-log"></div>' +
                "</div>";
            host.appendChild(uiRoot);
        } else {
            uiRoot = document.getElementById("filemerge-overlay");
        }

        uiBar = document.getElementById("filemerge-bar");
        uiPercent = document.getElementById("filemerge-percent");
        uiStatus = document.getElementById("filemerge-status");
        uiLog = document.getElementById("filemerge-log");

        bringToFront();
    }

    function appendLog(line) {
        ensureUI();
        bringToFront();
        if (!uiLog) {
            console.log("[FileMerge]", line);
            return;
        }
        if (line === lastUiLog) return;
        lastUiLog = line;
        const time = new Date().toLocaleTimeString();
        uiLog.textContent += "[" + time + "] " + line + "\n";
        uiLog.scrollTop = uiLog.scrollHeight;
    }

    function updateUI(detail) {
        ensureUI();
        bringToFront();
        if (!uiRoot) return;

        uiRoot.classList.remove("filemerge-hide");

        const pct = detail.percent || 0;
        if (uiBar) uiBar.style.width = pct + "%";
        if (uiPercent) uiPercent.textContent = pct + "%";

        let status = "";
        if (detail.phase === "download") {
            status =
                "下载分片 " +
                (detail.partIndex + 1) +
                "/" +
                detail.partCount +
                "\n" +
                detail.partName +
                "\n" +
                detail.partLoadedText +
                (detail.partTotal ? " / " + detail.partTotalText : "") +
                "\n合计 " +
                detail.totalLoadedText +
                (detail.totalExpected ? " / " + detail.totalExpectedText : "");
        } else if (detail.phase === "merge") {
            status =
                "正在合并分片…\n" +
                detail.mergeOffsetText +
                " / " +
                detail.mergeTotalText;
        } else if (detail.phase === "done") {
            status = "完成 " + detail.totalLoadedText;
        } else {
            status = "准备中…";
        }

        if (uiStatus) uiStatus.textContent = status;

        const label = document.getElementById("filemerge-status-label");
        if (label) {
            if (detail.phase === "download") label.textContent = "Downloading";
            else if (detail.phase === "merge") label.textContent = "Merging";
            else if (detail.phase === "done") label.textContent = "Done";
            else label.textContent = "Preparing";
        }
    }

    function hideUISoon() {
        if (!uiRoot) return;
        setTimeout(function () {
            if (!uiRoot) return;
            uiRoot.classList.add("filemerge-hide");
            setTimeout(function () {
                if (uiRoot && uiRoot.parentNode) {
                    uiRoot.parentNode.removeChild(uiRoot);
                }
                uiRoot = null;
                uiBar = null;
                uiPercent = null;
                uiStatus = null;
                uiLog = null;
            }, 400);
        }, 800);
    }

    function formatBytes(n) {
        if (!n || n < 0) return "0 B";
        const u = ["B", "KB", "MB", "GB"];
        let i = 0;
        let v = n;
        while (v >= 1024 && i < u.length - 1) {
            v /= 1024;
            i++;
        }
        return v.toFixed(i === 0 ? 0 : 2) + " " + u[i];
    }

    function emitProgress(extra) {
        const s = Object.assign({}, progressState, extra || {});
        Object.assign(progressState, s);

        let pct = 0;
        if (s.phase === "download" && s.totalExpected > 0) {
            pct = Math.min(100, (s.totalLoaded / s.totalExpected) * 100);
        } else if (s.phase === "download" && s.partCount > 0) {
            const partPct = s.partTotal > 0 ? s.partLoaded / s.partTotal : 0;
            pct = Math.min(99, ((s.partIndex + partPct) / s.partCount) * 100);
        } else if (s.phase === "merge" && s.mergeTotal > 0) {
            pct = Math.min(100, (s.mergeOffset / s.mergeTotal) * 100);
        } else if (s.phase === "done") {
            pct = 100;
        }

        const detail = {
            phase: s.phase,
            percent: Math.round(pct * 10) / 10,
            partIndex: s.partIndex,
            partCount: s.partCount,
            partName: s.partName,
            partLoaded: s.partLoaded,
            partTotal: s.partTotal,
            totalLoaded: s.totalLoaded,
            totalExpected: s.totalExpected,
            mergeOffset: s.mergeOffset,
            mergeTotal: s.mergeTotal,
            partLoadedText: formatBytes(s.partLoaded),
            partTotalText: formatBytes(s.partTotal),
            totalLoadedText: formatBytes(s.totalLoaded),
            totalExpectedText: formatBytes(s.totalExpected),
            mergeOffsetText: formatBytes(s.mergeOffset),
            mergeTotalText: formatBytes(s.mergeTotal)
        };

        updateUI(detail);

        let logLine = "";
        if (s.phase === "download") {
            logLine =
                "下载 " +
                (s.partIndex + 1) +
                "/" +
                s.partCount +
                " " +
                s.partName +
                " " +
                detail.partLoadedText +
                (s.partTotal ? "/" + detail.partTotalText : "") +
                " | 合计 " +
                detail.totalLoadedText +
                (s.totalExpected ? "/" + detail.totalExpectedText : "") +
                " (" +
                detail.percent +
                "%)";
        } else if (s.phase === "merge") {
            logLine =
                "合并 " +
                detail.mergeOffsetText +
                "/" +
                detail.mergeTotalText +
                " (" +
                detail.percent +
                "%)";
        } else if (s.phase === "done") {
            logLine = "完成 " + detail.totalLoadedText + " (100%)";
        }

        if (logLine) {
            appendLog(logLine);
            console.log("[FileMerge] " + logLine);
        }

        if (typeof config.onProgress === "function") {
            try {
                config.onProgress(detail);
            } catch (_) {}
        }

        try {
            window.dispatchEvent(
                new CustomEvent("filemerge-progress", { detail: detail })
            );
        } catch (_) {}
    }

    function toAbsoluteUrl(url) {
        try {
            return new URL(url, location.href).href;
        } catch (_) {
            return url;
        }
    }

    function normalizePartEntry(entry) {
        if (typeof entry === "string") {
            return { url: entry, name: entry };
        }
        if (entry && typeof entry === "object" && entry.url) {
            return {
                url: entry.url,
                name: entry.name || entry.url
            };
        }
        throw new Error("无效的分片配置: " + JSON.stringify(entry));
    }

    function isTargetRequest(input) {
        const targetAbs =
            resolvedAbsoluteTarget || toAbsoluteUrl(config.targetUrl);
        let reqUrl = "";

        if (typeof input === "string") {
            reqUrl = toAbsoluteUrl(input);
        } else if (input && typeof input.url === "string") {
            reqUrl = toAbsoluteUrl(input.url);
        } else {
            return false;
        }

        const a = reqUrl.split("#")[0].split("?")[0];
        const b = targetAbs.split("#")[0].split("?")[0];
        if (a === b) return true;

        const name = (config.targetUrl || "").split("/").pop();
        if (name && a.endsWith("/" + name)) return true;

        return false;
    }

    async function loadManifest() {
        if (Array.isArray(config.parts) && config.parts.length > 0) {
            resolvedParts = config.parts.map(normalizePartEntry);
            resolvedTarget = config.targetUrl;
            resolvedAbsoluteTarget = toAbsoluteUrl(resolvedTarget);
            return;
        }

        if (!config.manifestUrl) {
            throw new Error("未配置 parts，也未配置 manifestUrl");
        }

        appendLog("读取分片清单: " + config.manifestUrl);

        const res = await window.__fileMergeNativeFetch(config.manifestUrl, {
            cache: "no-store"
        });
        if (!res.ok) {
            throw new Error(
                "清单加载失败: " + config.manifestUrl + " status=" + res.status
            );
        }

        const json = await res.json();

        if (!json || !Array.isArray(json.parts) || json.parts.length === 0) {
            throw new Error("清单中缺少有效的 parts 数组");
        }

        resolvedParts = json.parts.map(normalizePartEntry);
        resolvedTarget = json.target || json.targetUrl || config.targetUrl;
        resolvedAbsoluteTarget = toAbsoluteUrl(resolvedTarget);

        if (!resolvedTarget) {
            throw new Error("清单中缺少 target / targetUrl");
        }

        appendLog(
            "清单解析完成, 分片数: " +
                resolvedParts.length +
                " 目标: " +
                resolvedTarget
        );
    }

    async function fetchPartWithProgress(part, partIndex, partCount, baseLoaded) {
        const res = await window.__fileMergeNativeFetch(part.url, {
            cache: "no-store"
        });

        if (!res.ok) {
            throw new Error(
                "分片加载失败: " + part.name + " status=" + res.status
            );
        }

        const totalHeader = Number(res.headers.get("content-length")) || 0;

        if (!res.body || !res.body.getReader) {
            const buf = await res.arrayBuffer();
            emitProgress({
                phase: "download",
                partIndex: partIndex,
                partCount: partCount,
                partName: part.name,
                partLoaded: buf.byteLength,
                partTotal: buf.byteLength,
                totalLoaded: baseLoaded + buf.byteLength,
                totalExpected:
                    progressState.totalExpected || baseLoaded + buf.byteLength
            });
            return buf;
        }

        const reader = res.body.getReader();
        const chunks = [];
        let loaded = 0;
        let lastEmit = 0;

        for (;;) {
            const result = await reader.read();
            if (result.done) break;

            chunks.push(result.value);
            loaded += result.value.byteLength;

            const now = Date.now();
            if (now - lastEmit >= 80 || (totalHeader && loaded >= totalHeader)) {
                lastEmit = now;
                emitProgress({
                    phase: "download",
                    partIndex: partIndex,
                    partCount: partCount,
                    partName: part.name,
                    partLoaded: loaded,
                    partTotal: totalHeader,
                    totalLoaded: baseLoaded + loaded,
                    totalExpected: progressState.totalExpected
                });
            }
        }

        const out = new Uint8Array(loaded);
        let offset = 0;
        for (let i = 0; i < chunks.length; i++) {
            out.set(chunks[i], offset);
            offset += chunks[i].byteLength;
        }

        emitProgress({
            phase: "download",
            partIndex: partIndex,
            partCount: partCount,
            partName: part.name,
            partLoaded: loaded,
            partTotal: totalHeader || loaded,
            totalLoaded: baseLoaded + loaded,
            totalExpected: progressState.totalExpected
        });

        return out.buffer;
    }

    async function mergeFiles() {
        if (mergePromise) {
            return mergePromise;
        }

        mergePromise = (async () => {
            ensureUI();
            bringToFront();
            appendLog("开始处理…");

            await loadManifest();

            const targetUrl = resolvedTarget;
            const parts = resolvedParts;
            const cacheName = config.cacheName || "file-merge-cache";

            appendLog("目标文件: " + targetUrl);
            appendLog("分片数: " + parts.length);

            const cache = await caches.open(cacheName);
            let cached =
                (await cache.match(targetUrl)) ||
                (await cache.match(resolvedAbsoluteTarget));

            if (cached) {
                appendLog("使用已有合并缓存");
                const len = Number(cached.headers.get("content-length")) || 0;
                emitProgress({
                    phase: "done",
                    partIndex: parts.length - 1,
                    partCount: parts.length,
                    partName: "cache",
                    partLoaded: len,
                    partTotal: len,
                    totalLoaded: len,
                    totalExpected: len,
                    mergeOffset: len,
                    mergeTotal: len
                });
                hideUISoon();
                return cached;
            }

            appendLog("开始加载分片, 共 " + parts.length + " 个");

            emitProgress({
                phase: "download",
                partIndex: 0,
                partCount: parts.length,
                partName: parts[0].name,
                partLoaded: 0,
                partTotal: 0,
                totalLoaded: 0,
                totalExpected: 0,
                mergeOffset: 0,
                mergeTotal: 0
            });

            const buffers = [];
            let totalLoaded = 0;

            for (let i = 0; i < parts.length; i++) {
                const buf = await fetchPartWithProgress(
                    parts[i],
                    i,
                    parts.length,
                    totalLoaded
                );
                buffers.push(buf);
                totalLoaded += buf.byteLength;

                emitProgress({
                    phase: "download",
                    partIndex: i,
                    partCount: parts.length,
                    partName: parts[i].name,
                    partLoaded: buf.byteLength,
                    partTotal: buf.byteLength,
                    totalLoaded: totalLoaded,
                    totalExpected:
                        progressState.totalExpected > totalLoaded
                            ? progressState.totalExpected
                            : totalLoaded
                });
            }

            let totalSize = 0;
            for (let i = 0; i < buffers.length; i++) {
                totalSize += buffers[i].byteLength;
            }

            emitProgress({
                phase: "merge",
                partIndex: parts.length - 1,
                partCount: parts.length,
                partName: "merge",
                partLoaded: totalSize,
                partTotal: totalSize,
                totalLoaded: totalSize,
                totalExpected: totalSize,
                mergeOffset: 0,
                mergeTotal: totalSize
            });

            const mergedArray = new Uint8Array(totalSize);
            let offset = 0;
            let lastEmit = 0;

            for (let i = 0; i < buffers.length; i++) {
                mergedArray.set(new Uint8Array(buffers[i]), offset);
                offset += buffers[i].byteLength;

                const now = Date.now();
                if (now - lastEmit >= 40 || offset === totalSize) {
                    lastEmit = now;
                    emitProgress({
                        phase: "merge",
                        mergeOffset: offset,
                        mergeTotal: totalSize,
                        totalLoaded: totalSize,
                        totalExpected: totalSize
                    });
                }
            }

            appendLog("合并完成: " + totalSize + " bytes");

            const finalResponse = new Response(mergedArray, {
                status: 200,
                statusText: "OK",
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Content-Length": String(mergedArray.byteLength)
                }
            });

            await cache.put(targetUrl, finalResponse.clone());
            await cache.put(resolvedAbsoluteTarget, finalResponse.clone());
            appendLog("完整文件已写入 Cache Storage");

            emitProgress({
                phase: "done",
                mergeOffset: totalSize,
                mergeTotal: totalSize,
                totalLoaded: totalSize,
                totalExpected: totalSize
            });

            hideUISoon();
            return finalResponse;
        })();

        try {
            return await mergePromise;
        } catch (error) {
            mergePromise = null;
            ensureUI();
            bringToFront();
            appendLog(
                "失败: " + (error && error.message ? error.message : error)
            );
            if (uiStatus) {
                uiStatus.textContent =
                    "合并失败\n" +
                    (error && error.message ? error.message : String(error));
            }
            throw error;
        }
    }

    const nativeFetch = window.fetch.bind(window);
    window.__fileMergeNativeFetch = nativeFetch;

    window.fetch = async function (input, init) {
        if (isTargetRequest(input)) {
            appendLog("拦截目标文件请求, 返回合并结果");
            const res = await mergeFiles();
            return res.clone();
        }
        return nativeFetch(input, init);
    };

    window.FileMergeLoader = {
        load: mergeFiles,
        getConfig: function () {
            return Object.assign({}, config);
        },
        setConfig: function (next) {
            config = Object.assign({}, config, next);
            mergePromise = null;
            resolvedParts = null;
            resolvedTarget = null;
            resolvedAbsoluteTarget = null;
        },
        getProgress: function () {
            return Object.assign({}, progressState);
        },
        get target() {
            return resolvedTarget || config.targetUrl;
        },
        get parts() {
            if (resolvedParts) {
                return resolvedParts.map(function (p) {
                    return p.url;
                });
            }
            return (config.parts || []).map(function (p) {
                return typeof p === "string" ? p : p.url;
            });
        }
    };

    const keepTopTimer = setInterval(function () {
        if (!uiRoot || !document.getElementById("filemerge-overlay")) {
            return;
        }
        if (progressState.phase === "done") {
            clearInterval(keepTopTimer);
            return;
        }
        bringToFront();
    }, 300);

    if (document.body || document.documentElement) {
        ensureUI();
    } else {
        document.addEventListener("DOMContentLoaded", ensureUI, { once: true });
    }

    mergeFiles().catch(function (error) {
        console.error("[FileMerge] 合并失败:", error);
    });

    console.log("[FileMerge] 分片加载器已安装");
})();
