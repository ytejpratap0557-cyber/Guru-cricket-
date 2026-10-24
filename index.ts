// Supabase Edge Function: AI technique analysis + coach chat.
// The OpenAI key lives ONLY here as a secret (OPENAI_API_KEY). It is never sent to the browser.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o"; // any vision-capable OpenAI chat model
const DAILY_CAP = Number(Deno.env.get("DAILY_CAP") ?? 50);          // all callers, per 24h
const VIDEO_CAP = Number(Deno.env.get("CALLER_DAILY_CAP") ?? 3);    // video analyses per caller, per 24h
const COACH_CAP = Number(Deno.env.get("COACH_DAILY_CAP") ?? 20);    // coach questions per caller, per 24h
const MIN_FRAMES = 4, MAX_FRAMES = 12, MAX_FRAME_CHARS = 450_000;

const VIDEO_SYSTEM = `You are an experienced cricket coach reviewing still frames sampled in time order from one player's video.
Rules:
- Describe only what is visible. If something cannot be judged (camera angle, blur, cropping, too few frames), say so. Never invent measurements, angles in degrees, speeds or numeric scores.
- If the frames do not show a cricketer batting or bowling, set "visibility" to "poor" and explain in "summary".
- Be specific, encouraging and practical, in plain language for amateur players in India.
- Do not give medical advice; for pain or injury suggest a qualified coach or physiotherapist.
Return ONLY one JSON object, no markdown, with exactly these keys:
{"visibility":"good"|"limited"|"poor","summary":string,"observations":[{"title":string,"detail":string}] (3-5 items),"body_position":[{"area":string,"status":"good"|"needs_work"|"unclear","note":string}] (4-6 items),"improvements":[string] (2-4 items),"drills":[{"name":string,"how":string}] (3 items),"limitations":string}`;

const COACH_SYSTEM = `You are AI Cricket Guru, a friendly cricket coach for amateur players in India.
Answer cricket technique, fitness-for-cricket, and practice questions in under 180 words, in simple language. If a question is not about cricket, politely say you only help with cricket. Never give medical diagnoses; for pain or injury suggest a qualified coach or physiotherapist. You cannot see any video in this chat.`;

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const S = (v: unknown, n = 600) => (typeof v === "string" ? v.slice(0, n) : "");
const A = (v: unknown, n: number): any[] => (Array.isArray(v) ? v.slice(0, n) : []);

function clean(o: any) {
  if (!o || typeof o !== "object") throw new Error("shape");
  const st = (x: unknown) => (["good", "needs_work", "unclear"].includes(x as string) ? x : "unclear");
  return {
    visibility: ["good", "limited", "poor"].includes(o.visibility) ? o.visibility : "limited",
    summary: S(o.summary, 800),
    observations: A(o.observations, 5).map((x) => ({ title: S(x?.title, 80), detail: S(x?.detail) })),
    body_position: A(o.body_position, 6).map((x) => ({ area: S(x?.area, 80), status: st(x?.status), note: S(x?.note) })),
    improvements: A(o.improvements, 4).map((x) => S(x)),
    drills: A(o.drills, 3).map((x) => ({ name: S(x?.name, 80), how: S(x?.how) })),
    limitations: S(o.limitations),
  };
}

async function callModel(apiKey: string, system: string, content: unknown[], maxTokens: number, asJson = false) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content }],
      ...(asJson ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!r.ok) {
    console.error("openai error", r.status, (await r.text()).slice(0, 300));
    throw new Error("upstream");
  }
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method", message: "Method not allowed." }, 405);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "not_configured", message: "AI is not configured yet." }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_request", message: "Invalid request." }, 400); }
  const mode = body?.mode;

  // ---- validate input ----
  let content: unknown[] = [];
  if (mode === "video") {
    const frames = body.frames, kind = body.kind, angle = body.angle;
    if (!["batting", "bowling"].includes(kind) || !["Side View", "Front View", "Rear View"].includes(angle))
      return json({ error: "bad_request", message: "Choose a valid analysis type and camera angle." }, 400);
    if (!Array.isArray(frames) || frames.length < MIN_FRAMES || frames.length > MAX_FRAMES)
      return json({ error: "bad_request", message: `Send ${MIN_FRAMES}-${MAX_FRAMES} frames.` }, 400);
    const times: unknown[] = Array.isArray(body.times) ? body.times : [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (typeof f !== "string" || f.length > MAX_FRAME_CHARS || !/^[A-Za-z0-9+/=]+$/.test(f))
        return json({ error: "bad_request", message: "Invalid frame data." }, 400);
      const t = Number(times[i]);
      content.push({ type: "text", text: `Frame ${i + 1} of ${frames.length}${isFinite(t) ? ` (about ${t.toFixed(1)}s into the video)` : ""}` });
      content.push({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + f, detail: "auto" } });
    }
    content.push({ type: "text", text: `Analysis type: ${kind}. Camera angle: ${angle}. Please analyse the technique.` });
  } else if (mode === "coach") {
    const q = typeof body.question === "string" ? body.question.trim() : "";
    if (q.length < 3 || q.length > 300) return json({ error: "bad_request", message: "Ask a question of 3-300 characters." }, 400);
    content = [{ type: "text", text: q }];
  } else {
    return json({ error: "bad_request", message: "Unknown mode." }, 400);
  }

  // ---- abuse protection: caps on spend (fails closed) ----
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const caller = await sha256(ip + (Deno.env.get("HASH_SALT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")));
  const since = new Date(Date.now() - 864e5).toISOString();
  const [all, mine] = await Promise.all([
    sb.from("analysis_usage").select("id", { count: "exact", head: true }).gte("created_at", since),
    sb.from("analysis_usage").select("id", { count: "exact", head: true }).eq("caller_hash", caller).eq("mode", mode).gte("created_at", since),
  ]);
  if (all.error || mine.error) {
    console.error("usage check failed", all.error ?? mine.error);
    return json({ error: "unavailable", message: "Service temporarily unavailable." }, 503);
  }
  if ((all.count ?? 0) >= DAILY_CAP) return json({ error: "capacity", message: "Daily capacity reached. Please try again tomorrow." }, 429);
  if ((mine.count ?? 0) >= (mode === "video" ? VIDEO_CAP : COACH_CAP))
    return json({ error: "limit", message: "You’ve reached today’s limit. Please try again tomorrow." }, 429);
  const ins = await sb.from("analysis_usage").insert({ caller_hash: caller, mode });
  if (ins.error) { console.error("usage insert failed", ins.error); return json({ error: "unavailable", message: "Service temporarily unavailable." }, 503); }

  // ---- call the AI ----
  try {
    if (mode === "coach") {
      const answer = S(await callModel(apiKey, COACH_SYSTEM, content, 500), 1500);
      return json({ answer });
    }
    const text = await callModel(apiKey, VIDEO_SYSTEM, content, 1800, true);
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("parse");
    return json({ result: clean(JSON.parse(text.slice(a, b + 1))) });
  } catch (e) {
    console.error("analysis failed", (e as Error).message);
    return json({ error: "ai_failed", message: "The AI couldn’t complete this analysis. Please try again." }, 502);
  }
});
