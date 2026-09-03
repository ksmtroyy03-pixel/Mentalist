export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
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
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
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
            maxOutputTokens: 500, // Limit output to save tokens
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

    // Log token usage if available
    if (data.usageMetadata) {
      console.log("Token usage:", {
        promptTokens: data.usageMetadata.promptTokens,
        candidatesTokens: data.usageMetadata.candidatesTokens,
        totalTokens: data.usageMetadata.totalTokens
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
