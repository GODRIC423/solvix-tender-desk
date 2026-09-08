/**
 * POST /functions/v1/ingest-load
 *
 * The endpoint the standalone connector posts a parsed LoadTender to. It
 * creates one `loads` row in the `qc_review` stage plus its parties, stops,
 * stop references, charges and header references, optionally stashes the
 * source document in the private `tender-uploads` bucket, and hands back the
 * load number a dispatcher can search for.
 *
 * The request body is:
 *   {
 *     tender:             LoadTender,   // see src/types/tender.ts
 *     source_file_name?:  string,
 *     source_file_base64?: string,      // raw base64 or a data: URL
 *     source_kind?:       string        // 'pdf' | 'edi' | ... informational
 *   }
 *
 * Auth is EITHER a normal Supabase user JWT (a logged-in dispatcher driving
 * the connector) OR a scoped `x-ingest-token` matched against the INGEST_TOKEN
 * secret. Because a token caller has no user identity, all writes go through
 * the service-role key. `verify_jwt` is off for this function in config.toml -
 * the gateway would otherwise reject the token-only calls before we ran.
 *
 * Nothing here trusts the client: the QC score is recomputed server-side, the
 * customer and carrier links are left NULL for a human to confirm at QC, and a
 * payload without stops is rejected outright.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types - a local, minimal restatement of src/types/tender.ts. The Edge
// Function bundle cannot reach outside supabase/functions, so this mirrors the
// canonical file rather than importing it. Keep them in step.
// ---------------------------------------------------------------------------
interface Field<T = unknown> {
  v: T | null;
  c: number;
  s: string;
  raw: string;
}

type Party = Record<string, Field | undefined>;

interface TenderReference {
  label?: string;
  qualifier?: Field;
  value?: Field;
}

interface TenderCharge {
  description?: Field;
  code?: Field;
  quantity?: Field;
  rate?: Field;
  amount?: Field;
}

interface Stop {
  sequence?: Field;
  stop_type?: Field;
  reason_code?: Field;
  party?: Party;
  earliest?: Field;
  latest?: Field;
  appointment?: Field;
  appointment_number?: Field;
  weight?: Field;
  weight_uom?: Field;
  quantity?: Field;
  instructions?: Field;
  references?: TenderReference[];
  items?: unknown[];
}

interface LoadTender {
  [key: string]: unknown;
  stops?: Stop[];
  charges?: TenderCharge[];
  references?: TenderReference[];
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// CORS - the connector is served from a different origin and will preflight.
// ---------------------------------------------------------------------------
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-ingest-token, content-type, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // matches the bucket's file_size_limit

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------
function isField(x: unknown): x is Field {
  return typeof x === "object" && x !== null && "v" in x && "c" in x;
}

/** The parsed value of a Field leaf, or null. */
function fv(f: unknown): unknown {
  if (!isField(f)) return null;
  const v = f.v;
  return v === undefined || v === "" ? null : v;
}

function asString(f: unknown): string | null {
  const v = fv(f);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function asNumber(f: unknown): number | null {
  const v = fv(f);
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Tenders carry "$1,250.00", "45,000 LBS", "53'" and friends.
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function asBool(f: unknown): boolean | null {
  const v = fv(f);
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["y", "yes", "true", "t", "1"].includes(s)) return true;
  if (["n", "no", "false", "f", "0"].includes(s)) return false;
  return null;
}

/** ISO timestamp string, or null when the value is not a parseable date. */
function asTimestamp(f: unknown): string | null {
  const v = fv(f);
  if (v === null) return null;
  if (typeof v === "number") return null; // ambiguous: epoch seconds vs ms
  const parsed = Date.parse(String(v));
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/** YYYY-MM-DD, or null. */
function asDate(f: unknown): string | null {
  const ts = asTimestamp(f);
  return ts === null ? null : ts.slice(0, 10);
}

/**
 * Server-side QC score, mirroring the legacy Pipeline.confidenceReport():
 * walk every Field leaf, keep the ones with a populated value, round each
 * confidence to 2dp, take the mean, round to 3dp. The same keys the legacy
 * walker skipped are skipped here so the numbers stay comparable.
 *
 * A client-supplied score is ignored entirely - it decides what lands in a
 * dispatcher's QC queue, so it is not the connector's to assert.
 */
const QC_SKIP_KEYS = new Set([
  "source_file",
  "source_kind",
  "extracted_at",
  "warnings",
  "pages",
  "id",
]);

function computeQcScore(tender: unknown): number {
  const confidences: number[] = [];

  const walk = (node: unknown): void => {
    if (isField(node)) {
      const v = node.v;
      if (v !== null && v !== undefined && v !== "") {
        const c = typeof node.c === "number" && Number.isFinite(node.c) ? node.c : 0;
        confidences.push(Math.round(c * 100) / 100);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [k, val] of Object.entries(node)) {
        if (QC_SKIP_KEYS.has(k)) continue;
        walk(val);
      }
    }
  };

  walk(tender);
  if (confidences.length === 0) return 0;
  const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  return Math.round(mean * 1000) / 1000;
}

/** Flatten a tender Party into the shared party column set. */
function partyColumns(party: Party | undefined): Record<string, string | null> {
  const p = party ?? {};
  return {
    name: asString(p.name),
    address1: asString(p.address1),
    address2: asString(p.address2),
    city: asString(p.city),
    state: asString(p.state),
    postal: asString(p.postal),
    country: asString(p.country),
    code: asString(p.code),
    contact_name: asString(p.contact_name),
    phone: asString(p.phone),
    email: asString(p.email),
    fax: asString(p.fax),
  };
}

function hasAnyValue(cols: Record<string, unknown>): boolean {
  return Object.values(cols).some((v) => v !== null && v !== undefined && v !== "");
}

/** The tender's free-form stop_type mapped onto the load_stops check constraint. */
function normalizeStopType(raw: unknown): "pickup" | "delivery" | "other" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.startsWith("pick") || s === "pu" || s === "origin" || s === "load") return "pickup";
  if (s.startsWith("del") || s.startsWith("drop") || s === "do" || s === "dest" || s === "unload") {
    return "delivery";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
/**
 * Constant-time string comparison. Both sides are hashed first so the loop
 * always runs over 32 equal-length bytes and neither the length nor the
 * position of the first differing byte leaks through timing.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

type Actor =
  | { kind: "ingest_token" }
  | { kind: "user"; userId: string };

async function authenticate(req: Request, admin: SupabaseClient): Promise<Actor | null> {
  // 1. Scoped ingest token.
  const presented = req.headers.get("x-ingest-token");
  if (presented) {
    const expected = Deno.env.get("INGEST_TOKEN") ?? "";
    if (expected.length === 0) return null; // unset secret must never authorize
    return (await timingSafeEqual(presented, expected)) ? { kind: "ingest_token" } : null;
  }

  // 2. A logged-in dispatcher's JWT.
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;

  // A valid JWT is not enough - the account has to still be an active member.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || profile.active !== true) return null;
  return { kind: "user", userId: data.user.id };
}

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------
function decodeBase64(input: string): Uint8Array {
  const trimmed = input.trim();
  const payload = trimmed.startsWith("data:") && trimmed.includes(",")
    ? trimmed.slice(trimmed.indexOf(",") + 1)
    : trimmed;
  const binary = atob(payload.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeFileName(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 180);
  return cleaned.length > 0 ? cleaned : "tender.bin";
}

function contentTypeFor(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "txt":
      return "text/plain";
    case "edi":
    case "x12":
    case "204":
      return "application/edi-x12";
    default:
      return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed. Use POST." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("ingest-load: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    return json({ ok: false, error: "Server is not configured." }, 500);
  }

  // Service role: a scoped-token caller has no user identity, so the inserts
  // cannot go through RLS. Authorization is the `authenticate()` call below.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const actor = await authenticate(req, admin);
  if (!actor) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }

  // ---- parse + validate the payload ---------------------------------------
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return json({ ok: false, error: "Request body must be a JSON object." }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Request body is not valid JSON." }, 400);
  }

  const tender = body.tender as LoadTender | undefined;
  if (typeof tender !== "object" || tender === null || Array.isArray(tender)) {
    return json({ ok: false, error: "Missing `tender` object in request body." }, 400);
  }

  const stops = Array.isArray(tender.stops) ? tender.stops : [];
  if (stops.length === 0) {
    return json(
      {
        ok: false,
        error: "`tender.stops` must be a non-empty array - a load needs at least one stop.",
      },
      400,
    );
  }
  if (stops.some((s) => typeof s !== "object" || s === null)) {
    return json({ ok: false, error: "Every entry in `tender.stops` must be an object." }, 400);
  }

  // Decode the attachment up front so a bad one fails before we create a load.
  const rawBase64 = typeof body.source_file_base64 === "string" ? body.source_file_base64 : null;
  const fileName = safeFileName(
    (typeof body.source_file_name === "string" ? body.source_file_name : null) ??
      (typeof tender.source_file === "string" ? tender.source_file : null),
  );
  let fileBytes: Uint8Array | null = null;
  if (rawBase64) {
    try {
      fileBytes = decodeBase64(rawBase64);
    } catch {
      return json({ ok: false, error: "`source_file_base64` is not valid base64." }, 400);
    }
    if (fileBytes.byteLength === 0) {
      return json({ ok: false, error: "`source_file_base64` decoded to zero bytes." }, 400);
    }
    if (fileBytes.byteLength > MAX_UPLOAD_BYTES) {
      return json(
        { ok: false, error: `Source file exceeds the ${MAX_UPLOAD_BYTES} byte limit.` },
        413,
      );
    }
  }

  // Never trust a client-supplied score.
  const qcScore = computeQcScore(tender);

  // ---- resolve the QC Review stage ----------------------------------------
  const { data: stage, error: stageError } = await admin
    .from("pipeline_stages")
    .select("id")
    .eq("key", "qc_review")
    .maybeSingle();

  if (stageError || !stage) {
    console.error("ingest-load: pipeline stage 'qc_review' missing", stageError);
    return json({ ok: false, error: "Pipeline stage 'qc_review' is not configured." }, 500);
  }

  // ---- insert the parent load ---------------------------------------------
  const equipment = (tender.equipment ?? {}) as Record<string, Field | undefined>;
  const warnings = Array.isArray(tender.warnings)
    ? tender.warnings.filter((w): w is string => typeof w === "string")
    : [];

  const loadRow = {
    pipeline_stage_id: stage.id,
    source: "tender_upload",
    source_file_name: rawBase64 || tender.source_file ? fileName : null,
    qc_score: qcScore,
    raw_extraction: tender,
    warnings,

    // Confirmed by a human at QC - deliberately left unset.
    customer_id: null,
    carrier_id: null,

    shipment_id: asString(tender.shipment_id),
    purpose: asString(tender.purpose),
    scac: asString(tender.scac),
    method_of_payment: asString(tender.method_of_payment),
    tender_date: asDate(tender.tender_date),
    mc_number: asString(tender.mc_number),

    equipment_type_code: asString(equipment.type_code),
    equipment_type_text: asString(equipment.type_text),
    equipment_length_ft: asNumber(equipment.length_ft),
    equipment_initial: asString(equipment.initial),
    equipment_number: asString(equipment.number),
    temp_min: asNumber(equipment.temp_min),
    temp_max: asNumber(equipment.temp_max),

    total_weight: asNumber(tender.total_weight),
    weight_uom: asString(tender.weight_uom),
    commodity: asString(tender.commodity),
    distance_miles: asNumber(tender.distance_miles),
    total_quantity: asNumber(tender.total_quantity),
    hazmat: asBool(tender.hazmat),
    notes: asString(tender.notes),
    terms: asString(tender.terms),
    driver_name: asString(tender.driver_name),
    driver_phone: asString(tender.driver_phone),

    // A tender's total_charge is what the customer is offering to pay us, so
    // it seeds customer_rate. carrier_rate stays null until the load is
    // covered. See the reviewer note in the README of this change.
    customer_rate: asNumber(tender.total_charge),
    currency: asString(tender.currency) ?? "USD",

    created_by: actor.kind === "user" ? actor.userId : null,
  };

  const { data: created, error: loadError } = await admin
    .from("loads")
    .insert(loadRow)
    .select("id, load_number")
    .single();

  if (loadError || !created) {
    console.error("ingest-load: failed to insert load", loadError);
    return json({ ok: false, error: "Failed to create the load." }, 500);
  }

  const loadId: string = created.id;
  const loadNumber: string = created.load_number;
  let storagePath: string | null = null;

  // Everything past this point is "all or nothing": Supabase gives us no
  // cross-request transaction, so on any failure we delete the parent load
  // (children cascade) and the uploaded object rather than leaving a
  // half-created load in someone's QC queue.
  try {
    // ---- source document -------------------------------------------------
    if (fileBytes) {
      const path = `${loadId}/${fileName}`;
      const { error: uploadError } = await admin.storage
        .from("tender-uploads")
        .upload(path, fileBytes, { contentType: contentTypeFor(fileName), upsert: true });
      if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);
      storagePath = path;

      const { error: urlError } = await admin
        .from("loads")
        .update({ source_file_url: path })
        .eq("id", loadId);
      if (urlError) throw new Error(`source_file_url update failed: ${urlError.message}`);
    }

    // ---- header parties --------------------------------------------------
    const partyRows: Record<string, unknown>[] = [];
    for (const [role, key] of [
      ["shipper", "shipper"],
      ["bill_to", "bill_to"],
      ["carrier", "carrier"],
    ] as const) {
      const cols = partyColumns(tender[key] as Party | undefined);
      if (hasAnyValue(cols)) partyRows.push({ load_id: loadId, role, ...cols });
    }
    if (partyRows.length > 0) {
      const { error } = await admin.from("load_parties").insert(partyRows);
      if (error) throw new Error(`load_parties insert failed: ${error.message}`);
    }

    // ---- stops (+ their references) -------------------------------------
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i] as Stop;
      const cols = partyColumns(stop.party);

      // Resolve the metro from city/state, falling back to the ZIP. Never let
      // a metro miss cost us the whole ingest - a null metro is fixable at QC.
      let metroId: string | null = null;
      try {
        const { data: resolved, error: metroError } = await admin.rpc("resolve_metro", {
          p_city: cols.city,
          p_state: cols.state,
          p_postal: cols.postal,
        });
        if (!metroError && typeof resolved === "string") metroId = resolved;
      } catch (metroErr) {
        console.warn("ingest-load: resolve_metro failed", metroErr);
      }

      const seq = asNumber(stop.sequence);
      const stopRow = {
        load_id: loadId,
        sequence: seq === null ? i + 1 : Math.trunc(seq),
        stop_type: normalizeStopType(fv(stop.stop_type)),
        reason_code: asString(stop.reason_code),
        ...cols,
        metro_id: metroId,
        earliest: asTimestamp(stop.earliest),
        latest: asTimestamp(stop.latest),
        appointment: asTimestamp(stop.appointment),
        appointment_number: asString(stop.appointment_number),
        weight: asNumber(stop.weight),
        weight_uom: asString(stop.weight_uom),
        quantity: asNumber(stop.quantity),
        instructions: asString(stop.instructions),
        // Keeps the tender's `items[]`, which has no table of its own yet.
        raw_extraction: stop,
      };

      const { data: insertedStop, error: stopError } = await admin
        .from("load_stops")
        .insert(stopRow)
        .select("id")
        .single();
      if (stopError || !insertedStop) {
        throw new Error(`load_stops insert failed: ${stopError?.message ?? "no row returned"}`);
      }

      const stopRefs = (Array.isArray(stop.references) ? stop.references : [])
        .map((r) => ({
          load_id: loadId,
          stop_id: insertedStop.id,
          qualifier: asString(r?.qualifier),
          value: asString(r?.value),
          label: typeof r?.label === "string" ? r.label : null,
        }))
        .filter((r) => r.qualifier !== null || r.value !== null);

      if (stopRefs.length > 0) {
        const { error } = await admin.from("load_references").insert(stopRefs);
        if (error) throw new Error(`stop load_references insert failed: ${error.message}`);
      }
    }

    // ---- charges ---------------------------------------------------------
    const chargeRows = (Array.isArray(tender.charges) ? tender.charges : [])
      .map((c) => ({
        load_id: loadId,
        description: asString(c?.description),
        accessorial_code: asString(c?.code),
        quantity: asNumber(c?.quantity),
        rate: asNumber(c?.rate),
        amount: asNumber(c?.amount),
        // A tender describes what the customer pays us; carrier-side charges
        // are entered when the load is covered.
        side: "customer",
      }))
      .filter((c) => c.description !== null || c.amount !== null || c.accessorial_code !== null);

    if (chargeRows.length > 0) {
      const { error } = await admin.from("load_charges").insert(chargeRows);
      if (error) throw new Error(`load_charges insert failed: ${error.message}`);
    }

    // ---- header references ----------------------------------------------
    const headerRefs = (Array.isArray(tender.references) ? tender.references : [])
      .map((r) => ({
        load_id: loadId,
        stop_id: null,
        qualifier: asString(r?.qualifier),
        value: asString(r?.value),
        label: typeof r?.label === "string" ? r.label : null,
      }))
      .filter((r) => r.qualifier !== null || r.value !== null);

    if (headerRefs.length > 0) {
      const { error } = await admin.from("load_references").insert(headerRefs);
      if (error) throw new Error(`header load_references insert failed: ${error.message}`);
    }
  } catch (err) {
    console.error(`ingest-load: rolling back load ${loadId}`, err);

    if (storagePath) {
      const { error: removeError } = await admin.storage
        .from("tender-uploads")
        .remove([storagePath]);
      if (removeError) {
        console.error("ingest-load: failed to remove orphaned upload", removeError);
      }
    }

    const { error: deleteError } = await admin.from("loads").delete().eq("id", loadId);
    if (deleteError) {
      // Worth shouting about: a load survived that nothing else references.
      console.error(`ingest-load: ROLLBACK FAILED for load ${loadId}`, deleteError);
    }

    return json(
      { ok: false, error: "Failed to create the load's child records; the load was rolled back." },
      500,
    );
  }

  return json({ ok: true, load_id: loadId, load_number: loadNumber, qc_score: qcScore }, 200);
});
