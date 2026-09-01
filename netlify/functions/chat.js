// Este archivo es "el mesero" de Jerosis. Corre solo, en el hosting,
// nunca en el navegador del usuario. Le habla a Gemini (Google), que
// tiene una capa gratuita. Ahora además permite que le hablen desde
// otros lugares además de la página web (como la app de escritorio),
// gracias a los headers CORS de acá abajo.

const MODEL = "gemini-flash-latest";

// Estos headers son el "permiso" para que otros orígenes (como la
// app de escritorio, que no es una página web común) puedan hablarle
// a este mesero. Sin esto, el navegador bloquea el pedido antes de
// que llegue.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async function (event) {
  // Los navegadores mandan primero un pedido "OPTIONS" de prueba,
  // preguntando si tienen permiso, antes del pedido real. Acá le
  // decimos que sí.
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Método no permitido" };
  }

  try {
    const { messages, system } = JSON.parse(event.body);

    const contents = (messages || []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: contents,
      }),
    });

    const data = await response.json();

    const quotaExceeded =
      response.status === 429 ||
      (data.error && data.error.status === "RESOURCE_EXHAUSTED");

    if (quotaExceeded) {
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
          error: { message: (data.error && data.error.message) || "Error de Gemini" },
        }),
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
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: "El mesero se tropezó: " + err.message } }),
    };
  }
};
