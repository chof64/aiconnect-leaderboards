import systemsCsv from "../systems.csv";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      const response = await routeApi(request, env, url);
      return withSecurityHeaders(response);
    } catch (error) {
      console.error("Unhandled API error", error);
      return withSecurityHeaders(json({ error: "Internal server error." }, 500));
    }
  }
};

async function routeApi(request, env, url) {
  if (request.method === "GET" && url.pathname === "/api/status") {
    return json(await getStatus(env));
  }

  if (request.method === "GET" && url.pathname === "/api/systems") {
    return json(await getSystemsWithVotes(env));
  }

  if (request.method === "GET" && url.pathname === "/api/leaderboard") {
    return json(await getSystemsWithVotes(env));
  }

  if (request.method === "POST" && url.pathname === "/api/participants") {
    return registerParticipant(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/me") {
    const participant = await getAuthenticatedParticipant(request, env);
    if (!participant) return json({ error: "A valid participant credential is required." }, 401);
    const vote = await env.DB.prepare(
      "SELECT system_id, created_at, updated_at FROM votes WHERE participant_id = ?"
    ).bind(participant.id).first();
    return json({ participant: { name: participant.display_name }, vote });
  }

  if (request.method === "PUT" && url.pathname === "/api/vote") {
    return castVote(request, env);
  }

  return json({ error: "Not found." }, 404);
}

async function getStatus(env) {
  const row = await env.DB.prepare(
    "SELECT is_open FROM voting_config WHERE id = 1"
  ).first();
  return { votingOpen: row ? row.is_open === 1 : false };
}

async function getSystemsWithVotes(env) {
  const systems = parseSystemsCsv(systemsCsv);
  const rows = await env.DB.prepare(
    "SELECT system_id, COUNT(*) AS votes FROM votes GROUP BY system_id"
  ).all();
  const counts = new Map((rows.results || []).map(row => [row.system_id, Number(row.votes)]));
  const results = systems.map(system => ({
    ...system,
    votes: counts.get(system.id) || 0
  }));
  results.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  let previousVotes = null;
  let currentRank = 0;
  results.forEach((system, index) => {
    if (system.votes !== previousVotes) currentRank = index + 1;
    system.rank = currentRank;
    previousVotes = system.votes;
  });
  return { systems: results, totalVotes: results.reduce((sum, system) => sum + system.votes, 0) };
}

async function registerParticipant(request, env) {
  if (!isJsonRequest(request)) return json({ error: "Send a JSON request." }, 415);
  const body = await readJson(request);
  if (!body.ok) return json({ error: "Invalid JSON body." }, 400);

  const displayName = typeof body.value.name === "string" ? body.value.name.trim().replace(/\s+/g, " ") : "";
  if (displayName.length < 2 || displayName.length > 50) {
    return json({ error: "Name must be between 2 and 50 characters." }, 400);
  }

  const normalizedName = displayName.normalize("NFKC").toLocaleLowerCase("en-US");
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes, byte => byte.toString(16).padStart(2, "0")).join("");
  const credentialHash = await sha256(token);

  try {
    const inserted = await env.DB.prepare(
      "INSERT INTO participants (display_name, normalized_name, credential_hash) VALUES (?, ?, ?) RETURNING id"
    ).bind(displayName, normalizedName, credentialHash).first();

    return json({
      participant: { name: displayName },
      credential: token
    }, 201);
  } catch (error) {
    const message = String(error?.message || "");
    if (/unique constraint|UNIQUE constraint/i.test(message)) {
      return json({ error: "That name is already registered. Use a different name." }, 409);
    }
    throw error;
  }
}

async function castVote(request, env) {
  if (!isJsonRequest(request)) return json({ error: "Send a JSON request." }, 415);
  const participant = await getAuthenticatedParticipant(request, env);
  if (!participant) return json({ error: "A valid participant credential is required." }, 401);

  const body = await readJson(request);
  if (!body.ok) return json({ error: "Invalid JSON body." }, 400);
  const systemId = typeof body.value.systemId === "string" ? body.value.systemId.trim() : "";
  const systems = parseSystemsCsv(systemsCsv);
  if (!systems.some(system => system.id === systemId)) {
    return json({ error: "Choose a valid system from the approved list." }, 400);
  }

  // The voting-open check and write happen in one SQL statement to avoid a close/vote race.
  const result = await env.DB.prepare(
    `INSERT INTO votes (participant_id, system_id)
     SELECT ?, ?
     WHERE EXISTS (SELECT 1 FROM voting_config WHERE id = 1 AND is_open = 1)
     ON CONFLICT(participant_id) DO UPDATE SET
       system_id = excluded.system_id,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(participant.id, systemId).run();

  if (!result.meta || result.meta.changes === 0) {
    const status = await getStatus(env);
    if (!status.votingOpen) return json({ error: "Voting is closed." }, 423);
    return json({ error: "Vote could not be saved." }, 500);
  }

  const vote = await env.DB.prepare(
    "SELECT system_id, created_at, updated_at FROM votes WHERE participant_id = ?"
  ).bind(participant.id).first();
  return json({ message: "Vote saved.", vote });
}

async function getAuthenticatedParticipant(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (!match) return null;
  const credentialHash = await sha256(match[1].toLowerCase());
  return env.DB.prepare(
    "SELECT id, display_name FROM participants WHERE credential_hash = ?"
  ).bind(credentialHash).first();
}

function parseSystemsCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field.trim());
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(value => value !== "")) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows.shift().map(value => value.toLowerCase());
  const idIndex = headers.indexOf("id");
  const nameIndex = headers.indexOf("name");
  const descriptionIndex = headers.indexOf("description");
  if (idIndex === -1 || nameIndex === -1) {
    throw new Error("systems.csv must contain id and name columns.");
  }

  const seen = new Set();
  return rows.map(values => ({
    id: (values[idIndex] || "").trim(),
    name: (values[nameIndex] || "").trim(),
    description: descriptionIndex === -1 ? "" : (values[descriptionIndex] || "").trim()
  })).filter(system => {
    if (!system.id || !system.name || seen.has(system.id)) return false;
    seen.add(system.id);
    return true;
  });
}

function isJsonRequest(request) {
  return (request.headers.get("content-type") || "").toLowerCase().includes("application/json");
}

async function readJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? { ok: true, value }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS }
  });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
