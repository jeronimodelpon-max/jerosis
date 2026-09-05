// Este archivo es "el mesero" de Jerosis. Corre solo, en el hosting,
// nunca en el navegador del usuario. Ahora le habla a Groq (modelos
// abiertos, gratis, sin tarjeta) en vez de a Gemini, porque el modelo
// gratis de Gemini viene mostrando saturación seguido. También
// permite que le hablen desde otros lugares además de la página web
// (como la app de escritorio), gracias a los headers CORS de abajo.

const MODEL = "openai/gpt-oss-120b";

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
    const { messages, system } = JSON.parse(event.body);

    // Groq habla el mismo "idioma" que OpenAI: un array de mensajes
    // con role/content, donde el system prompt es un mensaje más,
    // el primero de la lista.
    const chatMessages = [
      { role: "system", content: system },
      ...(messages || []).map((m) => ({ role: m.role, content: m.content })),
    ];

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.GROQ_API_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: chatMessages,
      }),
    });

    const data = await response.json();

    if (response.status === 429) {
      return {
        statusCode: 429,
        headers: CORS_HEADERS,
        body: JSON.stringify({ quotaExceeded: true }),
      };
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: { message: (data.error && data.error.message) || "Error de Groq" },
        }),
      };
    }

    const reply =
      data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "";

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ content: [{ type: "text", text: reply }] }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: "El mesero se tropezó: " + err.message } }),
    };
  }
};
