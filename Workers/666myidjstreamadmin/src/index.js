// ============================================================
// 666myidjstreamadmin — MyIDJ / Stream Admin Worker
// Phase 2C-19 REAL SKIP PATCH
//
// Zweck:
// - Echter SHOUTcast-Skip über admin.cgi?sid=1&mode=skip
// - Keine Stream-URL als NowPlaying-Quelle erzwingen
// - Kein künstlicher +1 Listener durch Skip-/Status-Klick
// - Playlist-/Wellness-Wechsel nur mit bestätigtem SonicPanel-Endpoint
//
// Cloudflare Vars / Secrets:
// - STREAM_ADMIN_BASE_URL = http://my.idjstream.com:8686/admin.cgi
// - STREAM_ADMIN_USER      (Secret)
// - STREAM_ADMIN_PASSWORD  (Secret)
// - STREAM_SID = 1
// - ADMIN_TOKEN            (Secret, required for admin actions)
//
// Optional:
// - NOWPLAYING_URL                  = admin.cgi/viewxml oder externer JSON/XML Status, NICHT /stream
// - RADIO_AUTODJ_SKIP_URL           = direkter Override, normalerweise NICHT nötig
// - RADIO_AUTODJ_PLAYLIST_SWITCH_URL= nur wenn echter SonicPanel-Request bekannt
// ============================================================

const VERSION = "v1.2.2-real-skip-fail-closed";
const WORKER_NAME = "666myidjstreamadmin";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-admin-token"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

function html(data, status = 200) {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function publicConfig(env) {
  const np = env.NOWPLAYING_URL || "";
  return {
    ok: true,
    worker: WORKER_NAME,
    role: env.PUBLIC_WORKER_ROLE || "MyIDJ Stream Admin Worker",
    project: env.PUBLIC_PROJECT_NAME || "666SOUNDsDESIGn WebRadio / RadioBotAI",
    version: env.PUBLIC_VERSION || VERSION,
    customDomain: "https://666myidjstreamadmin.666soundsdesign-broadcaster.com",
    workerDevUrl: "https://666myidjstreamadmin.digital-underground-connected.workers.dev",
    nowplayingConfigured: Boolean(np),
    nowplayingLooksLikeRawStream: looksLikeRawStreamUrl(np),
    streamAdminBaseConfigured: Boolean(env.STREAM_ADMIN_BASE_URL),
    streamAdminUserConfigured: Boolean(env.STREAM_ADMIN_USER),
    streamAdminPasswordConfigured: Boolean(env.STREAM_ADMIN_PASSWORD),
    streamSid: env.STREAM_SID || "1",
    adminTokenConfigured: Boolean(env.ADMIN_TOKEN),
    playlistSwitchConfirmed: Boolean(env.RADIO_AUTODJ_PLAYLIST_SWITCH_URL),
    endpoints: [
      "GET  /health",
      "GET  /status",
      "GET  /config/public",
      "GET  /nowplaying",
      "GET  /api/radio/nowplaying",
      "POST /admin/autodj/skip",
      "POST /radio/autodj/skip",
      "POST /api/radio/skip",
      "POST /admin/autodj/playlist-switch"
    ]
  };
}

function looksLikeRawStreamUrl(input = "") {
  const url = String(input).toLowerCase();
  if (!url) return false;
  if (url.includes("admin.cgi")) return false;
  if (url.includes("viewxml")) return false;
  if (url.includes("status-json")) return false;
  if (url.includes("nowplaying")) return false;
  return url.includes("/stream") || /:\d+\/?$/.test(url);
}

function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function requireAdmin(request, env) {
  const expected = env.ADMIN_TOKEN || "";
  if (!expected) {
    return { ok: false, status: 503, reason: "ADMIN_TOKEN_NOT_CONFIGURED" };
  }

  const xToken = request.headers.get("x-admin-token") || "";
  const bToken = bearerToken(request);

  if (xToken === expected || bToken === expected) {
    return { ok: true, mode: xToken ? "x-admin-token-ok" : "bearer-token-ok" };
  }

  return { ok: false, status: 401, reason: "UNAUTHORIZED" };
}

function basicAuthHeader(env) {
  const user = env.STREAM_ADMIN_USER || "";
  const pass = env.STREAM_ADMIN_PASSWORD || "";
  if (!user || !pass) return "";
  return "Basic " + btoa(`${user}:${pass}`);
}

function buildAdminUrl(env, params = {}) {
  const base = env.STREAM_ADMIN_BASE_URL || "";
  if (!base) return "";

  const url = new URL(base);
  if (env.STREAM_SID) url.searchParams.set("sid", env.STREAM_SID);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).length) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      "accept": "application/json,text/xml,text/plain,*/*",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    text,
    contentType: res.headers.get("content-type") || "text/plain; charset=utf-8"
  };
}

function adminHeaders(env) {
  const basic = basicAuthHeader(env);
  return basic ? { authorization: basic } : {};
}

async function readNowPlaying(env) {
  const configured = env.NOWPLAYING_URL || "";
  const headers = configured.includes("admin.cgi") ? adminHeaders(env) : {};

  if (configured && !looksLikeRawStreamUrl(configured)) {
    return await fetchText(configured, { method: "GET", headers });
  }

  if (configured && looksLikeRawStreamUrl(configured)) {
    // Schutz: rohe Stream-URL NICHT fetchen, weil das als Hörer zählen kann.
    return {
      ok: false,
      status: 409,
      contentType: "application/json; charset=utf-8",
      text: JSON.stringify({
        ok: false,
        error: "NOWPLAYING_URL_LOOKS_LIKE_RAW_STREAM",
        message: "NOWPLAYING_URL darf nicht auf /stream zeigen. Nutze admin.cgi?mode=viewxml oder einen echten Status-Endpunkt."
      })
    };
  }

  const viewXml = buildAdminUrl(env, { mode: "viewxml" });
  if (!viewXml) {
    return {
      ok: false,
      status: 503,
      contentType: "application/json; charset=utf-8",
      text: JSON.stringify({ ok: false, error: "NOWPLAYING_NOT_CONFIGURED" })
    };
  }

  return await fetchText(viewXml, { method: "GET", headers: adminHeaders(env) });
}

async function handleSkip(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, auth.status);

  const target = env.RADIO_AUTODJ_SKIP_URL || buildAdminUrl(env, { mode: "skip" });
  if (!target) {
    return json({
      ok: false,
      error: "SKIP_TARGET_NOT_CONFIGURED",
      needed: ["STREAM_ADMIN_BASE_URL", "STREAM_ADMIN_USER", "STREAM_ADMIN_PASSWORD", "STREAM_SID"],
      note: "STREAM_ADMIN_BASE_URL soll auf admin.cgi zeigen, nicht auf die Stream-URL."
    }, 503);
  }

  const method = env.RADIO_AUTODJ_SKIP_URL ? "POST" : "GET";
  const startedAt = Date.now();

  const result = await fetchText(target, {
    method,
    headers: method === "GET" ? adminHeaders(env) : {
      ...adminHeaders(env),
      "content-type": "application/json"
    },
    body: method === "POST" ? "{}" : undefined
  });

  return json({
    ok: result.ok,
    action: "skip",
    status: result.status,
    durationMs: Date.now() - startedAt,
    targetMode: target.includes("admin.cgi") ? "SHOUTCAST_ADMIN_CGI" : "DIRECT_OVERRIDE",
    verifyAfterMs: 10000,
    listenerSpikeGuard: "ACTIVE_NO_FRONTEND_STREAM_FETCH",
    message: result.ok
      ? "Skip-Befehl angenommen. AutoDJ nach 10 Sekunden neu prüfen."
      : "Skip-Befehl fehlgeschlagen.",
    responsePreview: result.text.slice(0, 800)
  }, result.ok ? 200 : 502);
}

async function handlePlaylistSwitch(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, auth.status);

  if (!env.RADIO_AUTODJ_PLAYLIST_SWITCH_URL) {
    return json({
      ok: false,
      action: "playlist-switch",
      error: "PLAYLIST_SWITCH_ENDPOINT_NOT_CONFIRMED",
      message: "SonicPanel-Root-API ist keine AutoDJ-Playlist-API. Für Wellness/Playlist-Wechsel wird der echte Browser-Netzwerkrequest aus SonicPanel benötigt.",
      safeState: "disabled"
    }, 501);
  }

  const bodyText = await request.text().catch(() => "{}");
  const result = await fetchText(env.RADIO_AUTODJ_PLAYLIST_SWITCH_URL, {
    method: "POST",
    headers: {
      ...adminHeaders(env),
      "content-type": "application/json"
    },
    body: bodyText || "{}"
  });

  return json({
    ok: result.ok,
    action: "playlist-switch",
    status: result.status,
    targetMode: "CONFIRMED_DIRECT_OVERRIDE",
    responsePreview: result.text.slice(0, 800)
  }, result.ok ? 200 : 502);
}

async function handleStreamStatus(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, auth.status);

  const target = buildAdminUrl(env, { mode: "viewxml" });
  if (!target) return json({ ok: false, error: "STREAM_STATUS_TARGET_NOT_CONFIGURED" }, 503);

  const result = await fetchText(target, { method: "GET", headers: adminHeaders(env) });
  return new Response(result.text, {
    status: result.status,
    headers: {
      "content-type": result.contentType,
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function dashboardHtml(cfg) {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>666myidjstreamadmin</title>
<style>
body{margin:0;background:#070711;color:#eaffff;font-family:Arial,sans-serif}
.wrap{max-width:1040px;margin:40px auto;padding:24px;border:1px solid #18fff0;border-radius:18px;box-shadow:0 0 30px #18fff044}
h1{color:#18fff0}.badge{display:inline-block;padding:6px 10px;border-radius:999px;background:#24124d;color:#ff4fd8;margin:4px}
.ok{color:#18ff9a}.warn{color:#ffd34d}.bad{color:#ff3c7a}pre{background:#050508;border:1px solid #333;padding:12px;border-radius:12px;overflow:auto}
</style></head>
<body><div class="wrap">
<h1>666myidjstreamadmin</h1>
<p class="badge">REAL SKIP PATCH</p>
<p class="badge">No Listener Spike Guard</p>
<p class="badge">Secrets bleiben verschlüsselt</p>
<p>Version: <b>${cfg.version}</b></p>
<p>NOWPLAYING_URL: <b class="${cfg.nowplayingConfigured ? "ok" : "warn"}">${cfg.nowplayingConfigured ? "OK" : "FEHLT"}</b></p>
<p>NOWPLAYING raw stream check: <b class="${cfg.nowplayingLooksLikeRawStream ? "bad" : "ok"}">${cfg.nowplayingLooksLikeRawStream ? "GEFÄHRLICH /stream" : "OK"}</b></p>
<p>STREAM_ADMIN_BASE_URL: <b class="${cfg.streamAdminBaseConfigured ? "ok" : "warn"}">${cfg.streamAdminBaseConfigured ? "OK" : "FEHLT"}</b></p>
<p>STREAM_ADMIN_USER/PASSWORD: <b class="${cfg.streamAdminUserConfigured && cfg.streamAdminPasswordConfigured ? "ok" : "warn"}">${cfg.streamAdminUserConfigured && cfg.streamAdminPasswordConfigured ? "OK" : "FEHLT"}</b></p>
<p>Playlist/Wellness switch: <b class="${cfg.playlistSwitchConfirmed ? "ok" : "warn"}">${cfg.playlistSwitchConfirmed ? "CONFIRMED" : "DISABLED BIS PANEL-REQUEST BEKANNT"}</b></p>
<pre>${cfg.endpoints.join("\n")}</pre>
</div></body></html>`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/" || path === "/dashboard") {
        return html(dashboardHtml(publicConfig(env)));
      }

      if (path === "/health") {
        return json({ ok: true, worker: WORKER_NAME, version: VERSION, role: "MyIDJ Stream Admin Worker" });
      }

      if (path === "/status" || path === "/config/public") {
        return json(publicConfig(env));
      }

      if (path === "/nowplaying" || path === "/api/radio/nowplaying") {
        const result = await readNowPlaying(env);
        return new Response(result.text, {
          status: result.status,
          headers: {
            "content-type": result.contentType,
            "cache-control": "no-store",
            "access-control-allow-origin": "*"
          }
        });
      }

      if (
        path === "/admin/autodj/skip" ||
        path === "/radio/autodj/skip" ||
        path === "/autodj/skip" ||
        path === "/api/radio/skip"
      ) {
        if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED_USE_POST" }, 405);
        return await handleSkip(request, env);
      }

      if (
        path === "/admin/autodj/playlist-switch" ||
        path === "/admin/autodj/playlist" ||
        path === "/radio/autodj/playlist" ||
        path === "/radio/autodj/playlist-switch" ||
        path === "/autodj/playlist" ||
        path === "/autodj/playlist-switch"
      ) {
        if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED_USE_POST" }, 405);
        return await handlePlaylistSwitch(request, env);
      }

      if (path === "/admin/stream/status" || path === "/stream/status") {
        return await handleStreamStatus(request, env);
      }

      return json({ ok: false, error: "NOT_FOUND", path }, 404);
    } catch (err) {
      return json({
        ok: false,
        error: "WORKER_EXCEPTION",
        message: String(err && err.message ? err.message : err)
      }, 500);
    }
  }
};
