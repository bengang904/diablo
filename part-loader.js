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

        console.log("[FileMerge] 读取分片清单:", config.manifestUrl);

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

        console.log(
            "[FileMerge] 清单解析完成, 分片数:",
            resolvedParts.length,
            "目标:",
            resolvedTarget
        );
    }

    async function mergeFiles() {
        if (mergePromise) {
            return mergePromise;
        }

        mergePromise = (async () => {
            await loadManifest();

            const targetUrl = resolvedTarget;
            const parts = resolvedParts;
            const cacheName = config.cacheName || "file-merge-cache";

            console.log("[FileMerge] 目标文件:", targetUrl);
            console.log(
                "[FileMerge] 分片列表:",
                parts.map(function (p) {
                    return p.url;
                })
            );

            const cache = await caches.open(cacheName);
            let cached =
                (await cache.match(targetUrl)) ||
                (await cache.match(resolvedAbsoluteTarget));

            if (cached) {
                console.log("[FileMerge] 使用已有合并缓存");
                return cached;
            }

            console.log("[FileMerge] 开始加载分片, 共", parts.length, "个");

            const responses = await Promise.all(
                parts.map(function (p) {
                    return window.__fileMergeNativeFetch(p.url, {
                        cache: "no-store"
                    });
                })
            );

            for (let i = 0; i < responses.length; i++) {
                if (!responses[i].ok) {
                    throw new Error(
                        "分片加载失败: " +
                            parts[i].name +
                            " status=" +
                            responses[i].status
                    );
                }
            }

            const buffers = await Promise.all(
                responses.map(function (r) {
                    return r.arrayBuffer();
                })
            );

            let totalSize = 0;
            for (let i = 0; i < buffers.length; i++) {
                console.log(
                    "[FileMerge]",
                    parts[i].name,
                    "大小:",
                    buffers[i].byteLength,
                    "bytes"
                );
                totalSize += buffers[i].byteLength;
            }

            const mergedArray = new Uint8Array(totalSize);
            let offset = 0;

            for (let i = 0; i < buffers.length; i++) {
                mergedArray.set(new Uint8Array(buffers[i]), offset);
                offset += buffers[i].byteLength;
            }

            console.log(
                "[FileMerge] 合并完成:",
                mergedArray.byteLength,
                "bytes"
            );

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
            console.log("[FileMerge] 完整文件已写入 Cache Storage");

            return finalResponse;
        })();

        try {
            return await mergePromise;
        } catch (error) {
            mergePromise = null;
            throw error;
        }
    }

    const nativeFetch = window.fetch.bind(window);
    window.__fileMergeNativeFetch = nativeFetch;

    window.fetch = async function (input, init) {
        if (isTargetRequest(input)) {
            console.log("[FileMerge] 拦截目标文件请求, 返回合并结果");
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

    mergeFiles().catch(function (error) {
        console.error("[FileMerge] 合并失败:", error);
    });

    console.log("[FileMerge] 分片加载器已安装");
})();
