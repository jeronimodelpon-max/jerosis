// Este archivo es "el mesero" de Jerosis. Corre solo, en el hosting,
// nunca en el navegador del usuario. Le habla a Groq. Ahora hace dos
// trabajos distintos según lo que le pidan:
//   1) Chat normal de texto (como siempre).
//   2) "Modo Live": le mandan una foto de la pantalla y devuelve una
//      reacción cortita, para la mascota de escritorio.

const TEXT_MODEL = "openai/gpt-oss-120b";
const VISION_MODEL = "qwen/qwen3.6-27b"; // modelo de visión "preview" de Groq

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

    let chatMessages;
    let model;

    if (body.image) {
      // Modo Live: una sola pregunta con una imagen adjunta, sin
      // historial (cada pantallazo es una reacción independiente).
      model = VISION_MODEL;
      chatMessages = [
        { role: "system", content: body.system },
        {
          role: "user",
          content: [
            { type: "text", text: body.prompt || "Reaccioná a lo que ves en esta captura de pantalla." },
            { type: "image_url", image_url: { url: body.image } },
          ],
        },
      ];
    } else {
      // Chat normal de texto.
      model = TEXT_MODEL;
      chatMessages = [
        { role: "system", content: body.system },
        ...(body.messages || []).map((m) => ({ role: m.role, content: m.content })),
      ];
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.GROQ_API_KEY,
      },
      body: JSON.stringify({
        model: model,
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
