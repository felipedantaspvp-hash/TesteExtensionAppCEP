import express from "express";

const FAKE_ACCESS_TOKEN = "9f3c1c2a-6f7e-4c1d-9b8a-2e5d8a0f6c47";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.type("text/plain").send("OK");
});

app.post("/", async (req, res) => {
  const action = String(req.query?.action || "").trim();

  try {
    switch (action) {
      case "oauthToken":
        return oauthToken(req, res);
      case "getTypeNames":
        return getTypeNames(res);
      case "getTypeDefinitions":
        return getTypeDefinitions(res);
      case "verify":
        return await verifyCEP(req, res);
      default:
        return res.status(400).json({
          error: "Unknown action",
          actionReceived: action
        });
    }
  } catch (err) {
    return res.status(500).json({
      verified: false,
      verifyResponseMessage: "Erro interno (handler).",
      verifyFailureReason: String(err?.stack || err),
      verificationResultCode: "INTERNAL_ERROR",
      suggestions: []
    });
  }
});

app.listen(PORT, () => {
  console.log(`ConsultaCEP server listening on port ${PORT}`);
});

function oauthToken(req, res) {
  const params = req.query || {};
  const grantType = String(params.grant_type || "").trim();

  if (grantType && grantType !== "client_credentials") {
    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Only client_credentials is supported"
    });
  }

  return res.json({
    access_token: FAKE_ACCESS_TOKEN,
    token_type: "Bearer",
    expires_in: 3600
  });
}

function getTypeNames(res) {
  return res.json({ typeNames: ["ConsultaCEP"] });
}

function getTypeDefinitions(res) {
  return res.json({
    typeDefinitions: [
      {
        typeName: "ConsultaCEP",
        displayName: "Consulta CEP",
        description: "Consulta CEP via ViaCEP e preenche logradouro",
        properties: {
          cep: {
            type: "string",
            displayName: "CEP",
            requiredForVerifyingType: true
          },
          logradouro: {
            type: "string",
            displayName: "Logradouro"
          }
        }
      }
    ]
  });
}

async function verifyCEP(req, res) {
  const body = parseJsonBody(req);
  const data = body?.data || {};
  const cepRaw = String(data.cep || "");
  const cepDigits = cepRaw.replace(/\D/g, "");

  if (cepDigits.length !== 8) {
    return res.json({
      verified: false,
      verifyResponseMessage: "CEP inválido (precisa ter 8 dígitos).",
      verifyFailureReason: "CEP inválido.",
      verificationResultCode: "VALIDATION_ERRORS",
      suggestions: [{ cep: cepRaw, logradouro: "" }]
    });
  }

  const cepFormatado = `${cepDigits.substring(0, 5)}-${cepDigits.substring(5)}`;
  const url = `https://viacep.com.br/ws/${cepFormatado}/json/`;

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    if (!resp.ok) {
      return res.json({
        verified: false,
        verifyResponseMessage: `Falha ao consultar ViaCEP (HTTP ${resp.status}).`,
        verifyFailureReason: "Falha ao consultar ViaCEP.",
        verificationResultCode: "EXTERNAL_SERVICE_ERROR",
        suggestions: [{ cep: cepRaw, logradouro: "" }]
      });
    }

    const payload = await resp.json();
    if (payload?.erro) {
      return res.json({
        verified: false,
        verifyResponseMessage: "CEP não encontrado.",
        verifyFailureReason: "CEP não encontrado.",
        verificationResultCode: "VALIDATION_ERRORS",
        suggestions: [{ cep: cepRaw, logradouro: "" }]
      });
    }

    return res.json({
      verified: true,
      verifyResponseMessage: "OK",
      verificationResultCode: "SUCCESS",
      verificationResultDescription: "OK",
      suggestions: [
        {
          cep: cepRaw,
          logradouro: String(payload.logradouro || "")
        }
      ]
    });
  } catch (err) {
    return res.status(500).json({
      verified: false,
      verifyResponseMessage: "Erro interno no verify.",
      verifyFailureReason: String(err?.stack || err),
      verificationResultCode: "INTERNAL_ERROR",
      suggestions: []
    });
  }
}

function parseJsonBody(req) {
  // Express já parseia JSON e urlencoded; aqui garantimos estrutura semelhante ao Apps Script.
  if (req.is("application/json")) return req.body;
  const raw = req.body && typeof req.body === "string" ? req.body : "";
  if (!raw) return req.body || {};
  const t = raw.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return {};
  try {
    return JSON.parse(t);
  } catch (_err) {
    return {};
  }
}
