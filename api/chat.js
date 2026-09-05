// --- Very lightweight in-memory rate limiter ---------------------------
// This endpoint calls Gemini using YOUR server-side API key, so without
// some limit, anyone who finds this URL can hit it directly (bypassing
// your frontend entirely) and burn through your quota.
//
// Caveat: this only protects a single serverless instance's memory, and
// resets on cold start / redeploy. It's a reasonable speed bump for a
// small demo app, but it is NOT a substitute for real auth or a proper
// rate-limiting service (e.g. Upstash Ratelimit, Vercel's built-in
// firewall rules) if this goes to real users.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const requestLog = new Map(); // ip -> array of timestamps

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter(
    t => now - t < RATE_LIMIT_WINDOW_MS
  );
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: "Too many requests. Please wait a minute and try again."
    });
  }

  try {
    const { message } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in Vercel."
      });
    }

    // Add request timeout to prevent unnecessary retries
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: message
                }
              ]
            }
          ],
          // Token optimization settings
          generationConfig: {
            maxOutputTokens: 1500, // Raised from 500 so JSON-structured
            // responses (notes + flashcards + plan) don't get cut off mid-way
            temperature: 0.7 // Consistent responses, fewer retries
          }
        })
      }
    );

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", data);

      // Handle quota errors specifically
      if (response.status === 429 || response.status === 403) {
        return res.status(429).json({
          error: "API quota exceeded. Please try again later or check your token usage."
        });
      }

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "Gemini API request failed."
      });
    }

    const answer =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!answer) {
      console.error("Unexpected Gemini response:", data);

      return res.status(500).json({
        error: "Gemini returned no text."
      });
    }

    // Log token usage if available.
    // Note: Gemini's actual field names are promptTokenCount /
    // candidatesTokenCount / totalTokenCount (not …Tokens) — the previous
    // version of this log referenced the wrong keys and always printed
    // "undefined".
    if (data.usageMetadata) {
      console.log("Token usage:", {
        promptTokens: data.usageMetadata.promptTokenCount,
        candidatesTokens: data.usageMetadata.candidatesTokenCount,
        totalTokens: data.usageMetadata.totalTokenCount
      });
    }

    return res.status(200).json({
      answer
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(408).json({
        error: "Request timeout. The API took too long to respond."
      });
    }

    console.error("Server error:", error);

    return res.status(500).json({
      error: "Something went wrong while contacting Gemini."
    });
  }
}
