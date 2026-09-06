// Este archivo es "el mesero" de Jerosis. Corre solo, en el hosting,
// nunca en el navegador del usuario. Usa DOS cerebros distintos según
// lo que le pidan:
//   1) Chat normal de texto -> Groq (rápido, gratis, confiable para texto).
//   2) "Modo Live" (reaccionar a una imagen) -> Gemini, porque el
//      modelo de visión gratis de Groq es un "preview" que alucina
//      cualquier cosa con las imágenes.
//
// Para que el modo Live funcione, en Netlify tiene que seguir
// existiendo la variable de entorno GEMINI_API_KEY (la misma que
// usábamos antes de pasar el chat de texto a Groq).

const TEXT_MODEL = "openai/gpt-oss-120b";
const VISION_MODEL = "gemini-flash-latest";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Método no permitido" };
  }

  try {
    const body = JSON.parse(event.body);

    if (body.image) {
      return await handleVision(body);
    }
    return await handleText(body);
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: "El mesero se tropezó: " + err.message } }),
    };
  }
};

async function handleText(body) {
  const chatMessages = [
    { role: "system", content: body.system },
    ...(body.messages || []).map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.GROQ_API_KEY,
    },
    body: JSON.stringify({ model: TEXT_MODEL, messages: chatMessages }),
  });

  const data = await response.json();

  if (response.status === 429) {
    return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ quotaExceeded: true }) };
  }
  if (!response.ok) {
    return {
      statusCode: response.status,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: (data.error && data.error.message) || "Error de Groq" } }),
    };
  }

  const reply = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ content: [{ type: "text", text: reply }] }),
  };
}

async function handleVision(body) {
  // El canvas del navegador manda la imagen como
  // "data:image/jpeg;base64,XXXXX" — a Gemini hay que pasarle solo la
  // parte de después de la coma, sin el encabezado.
  const base64Data = body.image.split(",")[1] || body.image;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: body.system }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: body.prompt || "Reaccioná a esta captura de pantalla." },
            { inline_data: { mime_type: "image/jpeg", data: base64Data } },
          ],
        },
      ],
    }),
  });

  const data = await response.json();

  const quotaExceeded =
    response.status === 429 || (data.error && data.error.status === "RESOURCE_EXHAUSTED");
  if (quotaExceeded) {
    return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ quotaExceeded: true }) };
  }
  if (!response.ok) {
    return {
      statusCode: response.status,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: (data.error && data.error.message) || "Error de Gemini" } }),
    };
  }

  const reply =
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0]
      ? data.candidates[0].content.parts[0].text
      : "";

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ content: [{ type: "text", text: reply }] }),
  };
}
