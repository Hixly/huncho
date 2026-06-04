/**
 * Huncho Proxy Worker
 * Proxies requests to Claude, ElevenLabs, and Groq (Whisper) APIs.
 * Keys stored as Cloudflare secrets.
 */

interface Env {
  ANTHROPIC_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  GROQ_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      if (url.pathname === "/chat") return await handleChat(request, env);
      if (url.pathname === "/tts") return await handleTTS(request, env);
      if (url.pathname === "/transcribe") return await handleTranscribe(request, env);
    } catch (error) {
      console.error(`[${url.pathname}] Unhandled error:`, error);
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body,
  });
  if (!response.ok) {
    const errorBody = await response.text();
    return new Response(errorBody, { status: response.status, headers: { "content-type": "application/json" } });
  }
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "text/event-stream", "cache-control": "no-cache" },
  });
}

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  // Receive raw binary audio (no base64 JSON — cleaner, no corruption)
  const audioBuffer = await request.arrayBuffer();
  console.log(`[/transcribe] Received ${audioBuffer.byteLength} bytes of audio`);

  // Build multipart form for Groq Whisper
  const formData = new FormData();
  const audioBlob = new Blob([audioBuffer], { type: "audio/webm" });
  formData.append("file", audioBlob, "audio.webm");
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "json");
  formData.append("language", "en");
  formData.append("temperature", "0");
  formData.append("prompt", "Voice command to an AI assistant.");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("[/transcribe] Groq error:", err);
    return new Response(JSON.stringify({ error: err }), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }

  const result = await response.json() as { text: string };
  console.log("[/transcribe] Transcript:", result.text);
  return new Response(JSON.stringify({ transcript: result.text }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function handleTTS(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const voiceId = env.ELEVENLABS_VOICE_ID;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body,
  });
  if (!response.ok) {
    const errorBody = await response.text();
    return new Response(errorBody, { status: response.status, headers: { "content-type": "application/json" } });
  }
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "audio/mpeg" },
  });
}
