import pdf from "pdf-parse";
import mammoth from "mammoth";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const contentType = req.headers["content-type"] || "";

    if (!contentType.includes("application/json")) {
      return res.status(400).json({
        error: "Please send a file."
      });
    }

    const { fileData, fileType } = req.body || {};

    if (!fileData || !fileType) {
      return res.status(400).json({
        error: "File data is missing."
      });
    }

    const buffer = Buffer.from(fileData, "base64");

    let text = "";

    if (fileType === "text/plain") {
      text = buffer.toString("utf8");
    }

    else if (fileType === "application/pdf") {
      const result = await pdf(buffer);
      text = result.text;
    }

    else if (
      fileType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({
        buffer
      });

      text = result.value;
    }

    else {
      return res.status(400).json({
        error: "Unsupported file type."
      });
    }

    if (!text.trim()) {
      return res.status(400).json({
        error: "No readable text was found in the file."
      });
    }

    return res.status(200).json({
      text
    });

  } catch (error) {
    console.error("File analysis error:", error);

    return res.status(500).json({
      error: "Could not read the file."
    });
  }
}