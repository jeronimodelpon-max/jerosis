// Este archivo es "el mesero" de Jerosis. Corre solo, en el hosting,
// nunca en el navegador del usuario. Usa DOS cerebros distintos según
// lo que le pidan:
//   1) Chat normal de texto -> Groq.
//   2) "Modo Live" (reaccionar a una imagen) -> Cloudflare Workers AI
//      (Llama 3.2 Vision), que tiene mucha más cuota gratis por día
//      que Gemini para este uso.

const TEXT_MODEL = "openai/gpt-oss-120b";
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

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
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_VISION_MODEL}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.CLOUDFLARE_API_TOKEN,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: body.system },
        { role: "user", content: body.prompt || "Reaccioná a esta captura de pantalla." },
      ],
      image: body.image, // ya viene como "data:image/jpeg;base64,..."
    }),
  });

  const data = await response.json();

  if (response.status === 429) {
    return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ quotaExceeded: true }) };
  }
  if (!response.ok || data.success === false) {
    const msg = (data.errors && data.errors[0] && data.errors[0].message) || "Error de Cloudflare";
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: msg } }) };
  }

  const reply =
    (data.result && (data.result.response || data.result.description)) ||
    (typeof data.result === "string" ? data.result : "");

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ content: [{ type: "text", text: reply }] }),
  };
}
