// Este archivo es "el mesero". Corre solo, en el hosting, nunca en el
// navegador del usuario. Ahora le habla a Gemini (Google), que tiene
// una capa gratuita, en vez de a Anthropic. Su trabajo sigue siendo el
// mismo: recibir el mensaje que mandó la página, agregarle la llave
// secreta, llevárselo a la IA, y traer la respuesta de vuelta.

const MODEL = "gemini-flash-latest";

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Método no permitido" };
  }

  try {
    // Esto es lo que la página (jerosis.html) le mandó al mesero:
    // el historial de la charla y las instrucciones de personalidad.
    const { messages, system } = JSON.parse(event.body);

    // Gemini espera el historial en un formato un poco distinto al
    // que usa la página: en vez de "assistant" usa "model". Acá lo
    // traducimos.
    const contents = (messages || []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY_SANTIS,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: contents,
      }),
    });

    const data = await response.json();

    // Gemini avisa que se acabó la cuota gratis del día con un
    // error 429 (o el estado "RESOURCE_EXHAUSTED"). Acá lo
    // detectamos y le avisamos a la página con una señal clara,
    // para que muestre el cartelito en vez de un error feo.
    const quotaExceeded =
      response.status === 429 ||
      (data.error && data.error.status === "RESOURCE_EXHAUSTED");

    if (quotaExceeded) {
      return {
        statusCode: 429,
        body: JSON.stringify({ quotaExceeded: true }),
      };
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
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

    // Devolvemos la respuesta en el mismo formato que ya entendía la
    // página, para no tener que tocar mucho más código del lado del chat.
    return {
      statusCode: 200,
      body: JSON.stringify({ content: [{ type: "text", text: reply }] }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: "El mesero se tropezó: " + err.message } }),
    };
  }
};
