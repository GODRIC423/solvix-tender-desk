/**
 * The carrier-facing upload path.
 *
 *   GET  /functions/v1/upload-document?token=...  -> which load this link is for
 *   POST /functions/v1/upload-document            -> { token, kind, file_name,
 *                                                    content_type?, data_base64, notes? }
 *
 * A dispatcher makes a link for a load (load_upload_links); the carrier opens
 * /upload/<token> in the app, which calls this with no login. The token is the
 * whole authorisation, so it is long, random, expiring and revocable, and every
 * write goes through the service role only after the token has been checked.
 * `verify_jwt` is off for this function in config.toml - the gateway would
 * otherwise reject the login-less calls before we ran.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // matches the bucket's file_size_limit
const BUCKET = "load-documents";

/** What a carrier may send in. Generated kinds are ours alone. */
const ALLOWED_KINDS = new Set(["pod", "carrier_invoice", "lumper_receipt", "scale_ticket", "other"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

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
  return cleaned.length > 0 ? cleaned : "upload.bin";
}

function contentTypeFor(fileName: string, declared: string | null): string {
  if (declared && /^[\w.+-]+\/[\w.+-]+$/.test(declared)) return declared;
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "tif":
    case "tiff": return "image/tiff";
    case "heic": return "image/heic";
    case "txt": return "text/plain";
    default: return "application/octet-stream";
  }
}

interface UploadLink {
  id: string;
  load_id: string;
  expires_at: string;
  revoked_at: string | null;
  uses: number;
}

/** The link for a token, or a response explaining why there is none. */
async function resolveLink(
  admin: SupabaseClient,
  token: string | null,
): Promise<{ link: UploadLink } | { error: Response }> {
  if (!token || !/^[a-f0-9]{32,128}$/i.test(token)) {
    return { error: json({ ok: false, error: "This upload link is not valid." }, 404) };
  }
  const { data, error } = await admin
    .from("load_upload_links")
    .select("id, load_id, expires_at, revoked_at, uses")
    .eq("token", token)
    .maybeSingle();
  if (error) {
    console.error("upload-document: link lookup failed", error);
    return { error: json({ ok: false, error: "Could not check this link. Try again." }, 500) };
  }
  if (!data) {
    return { error: json({ ok: false, error: "This upload link is not valid." }, 404) };
  }
  const link = data as UploadLink;
  if (link.revoked_at || new Date(link.expires_at).getTime() < Date.now()) {
    return {
      error: json(
        { ok: false, error: "This upload link has expired. Ask your broker contact for a new one." },
        410,
      ),
    };
  }
  return { link };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("upload-document: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    return json({ ok: false, error: "Server is not configured." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- GET: what is this link for? -----------------------------------------
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token");
    const resolved = await resolveLink(admin, token);
    if ("error" in resolved) return resolved.error;

    const { data: load, error } = await admin
      .from("loads")
      .select(
        "load_number, shipment_id, origin_city, origin_state, dest_city, dest_state, carriers(name)",
      )
      .eq("id", resolved.link.load_id)
      .maybeSingle();
    if (error || !load) {
      return json({ ok: false, error: "The load for this link no longer exists." }, 404);
    }
    const row = load as Record<string, unknown>;
    const carrier = row.carriers as { name?: string } | null;
    return json({
      ok: true,
      load: {
        load_number: row.load_number,
        shipment_id: row.shipment_id,
        origin_city: row.origin_city,
        origin_state: row.origin_state,
        dest_city: row.dest_city,
        dest_state: row.dest_state,
        carrier_name: carrier?.name ?? null,
      },
      expires_at: resolved.link.expires_at,
      kinds: [...ALLOWED_KINDS],
    });
  }

  // ---- POST: take the file --------------------------------------------------
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

  const resolved = await resolveLink(admin, typeof body.token === "string" ? body.token : null);
  if ("error" in resolved) return resolved.error;
  const { link } = resolved;

  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!ALLOWED_KINDS.has(kind)) {
    return json({ ok: false, error: "Choose what kind of document this is." }, 400);
  }

  const fileName = safeFileName(typeof body.file_name === "string" ? body.file_name : null);
  const rawBase64 = typeof body.data_base64 === "string" ? body.data_base64 : "";
  if (!rawBase64) {
    return json({ ok: false, error: "No file was attached." }, 400);
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(rawBase64);
  } catch {
    return json({ ok: false, error: "The file could not be read." }, 400);
  }
  if (bytes.byteLength === 0) {
    return json({ ok: false, error: "The file is empty." }, 400);
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return json({ ok: false, error: "The file is larger than 25 MB." }, 413);
  }
  const contentType = contentTypeFor(
    fileName,
    typeof body.content_type === "string" ? body.content_type : null,
  );
  const notes = typeof body.notes === "string" && body.notes.trim() !== ""
    ? body.notes.trim().slice(0, 1000)
    : null;

  const storagePath = `${link.load_id}/${Date.now()}-${fileName}`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: false });
  if (uploadError) {
    console.error("upload-document: storage upload failed", uploadError);
    return json({ ok: false, error: "The file could not be stored. Try again." }, 500);
  }

  // Version numbers continue from whatever the desk already has of this kind.
  const { count } = await admin
    .from("load_documents")
    .select("id", { count: "exact", head: true })
    .eq("load_id", link.load_id)
    .eq("kind", kind);

  const { data: doc, error: insertError } = await admin
    .from("load_documents")
    .insert({
      load_id: link.load_id,
      kind,
      origin: "uploaded",
      file_name: fileName,
      storage_path: storagePath,
      content_type: contentType,
      size_bytes: bytes.byteLength,
      version: (count ?? 0) + 1,
      notes,
      uploaded_via: "carrier_link",
      uploaded_by: null,
    })
    .select("id")
    .single();

  if (insertError || !doc) {
    console.error("upload-document: row insert failed", insertError);
    // Do not leave an orphaned object behind.
    await admin.storage.from(BUCKET).remove([storagePath]);
    return json({ ok: false, error: "The file could not be recorded. Try again." }, 500);
  }

  // Count the use. Read-then-write is fine here: nobody races a carrier for
  // their own link, and an off-by-one in a counter is harmless.
  await admin
    .from("load_upload_links")
    .update({ uses: link.uses + 1 })
    .eq("id", link.id);

  return json({ ok: true, document_id: (doc as { id: string }).id, file_name: fileName });
});
