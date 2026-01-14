import express from "express";

const PORT = process.env.PORT || 3000;

// Opcional: mantenha fake para testes.
// Se quiser, pode sobrescrever via env ACCESS_TOKEN.
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "9f3c1c2a-6f7e-4c1d-9b8a-2e5d8a0f6c47";

const app = express();
app.use(express.json({ limit: "1mb" }));
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
        return getTypeDefinitions(req, res);

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
  const grantType = String(req.query?.grant_type || "").trim();

  if (grantType && grantType !== "client_credentials") {
    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Only client_credentials is supported"
    });
  }

  return res.json({
    access_token: ACCESS_TOKEN,
    token_type: "Bearer",
    expires_in: 3600
  });
}

function getTypeNames(res) {
  return res.status(200).json({
    typeNames: [
      {
        typeName: "ConsultaCEP",
        label: "Consulta CEP",
        description: "Consulta CEP via ViaCEP e retorna dados de endereço para autopreenchimento"
      }
    ]
  });
}

function getTypeDefinitions(req, res) {
  const body = normalizeBody(req);
  const typeNamesRaw = body?.typeNames || [];
  const typeNames = typeNamesRaw
    .map((t) => (typeof t === "string" ? t : t?.typeName))
    .filter(Boolean);

  if (!typeNames.includes("ConsultaCEP")) {
    return res.json({ declarations: [] });
  }

  return res.json({
    declarations: [
      {
        $class: "concerto.metamodel@1.0.0.ConceptDeclaration",
        name: "ConsultaCEP",
        isAbstract: false,
        properties: [
          // Input
          concertoStringProp("cep", "CEP", { requiredForVerifyingType: true, maxLength: 9 }),

          // Retorno ViaCEP (campos úteis para autopreenchimento)
          concertoStringProp("logradouro", "Logradouro", { maxLength: 256 }),
          concertoStringProp("complemento", "Complemento", { maxLength: 256 }),
          concertoStringProp("bairro", "Bairro", { maxLength: 128 }),
          concertoStringProp("localidade", "Cidade", { maxLength: 128 }),
          concertoStringProp("uf", "UF", { maxLength: 2 }),
          concertoStringProp("estado", "Estado", { maxLength: 64 }),
          concertoStringProp("regiao", "Região", { maxLength: 64 }),

          // Aliases (caso o formulário use nomes diferentes)
          concertoStringProp("cidade", "Cidade (Alias)", { maxLength: 128 }),
          concertoStringProp("estadoSigla", "UF (Alias)", { maxLength: 2 })
        ],
        decorators: [
          { $class: "concerto.metamodel@1.0.0.Decorator", name: "VerifiableType" },
          {
            $class: "concerto.metamodel@1.0.0.Decorator",
            name: "Term",
            arguments: [{ $class: "concerto.metamodel@1.0.0.DecoratorString", value: "Consulta CEP" }]
          }
        ]
      }
    ]
  });
}

async function verifyCEP(req, res) {
  const body = normalizeBody(req);
  const data = body?.data || {};
  const cepRaw = String(data.cep || "");
  const cepDigits = cepRaw.replace(/\D/g, "");

  if (cepDigits.length !== 8) {
    return res.json({
      verified: false,
      verifyResponseMessage: "CEP inválido (precisa ter 8 dígitos).",
      verifyFailureReason: "CEP inválido.",
      verificationResultCode: "VALIDATION_ERRORS",
      suggestions: [{ cep: cepRaw }]
    });
  }

  const url = `https://viacep.com.br/ws/${cepDigits}/json/`;

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
        suggestions: [{ cep: cepRaw }]
      });
    }

    const payload = await resp.json();

    if (payload?.erro) {
      return res.json({
        verified: false,
        verifyResponseMessage: "CEP não encontrado.",
        verifyFailureReason: "CEP não encontrado.",
        verificationResultCode: "VALIDATION_ERRORS",
        suggestions: [{ cep: cepRaw }]
      });
    }

    const suggestion = {
      cep: cepRaw,
      cepFormatado: String(payload.cep || ""),

      logradouro: String(payload.logradouro || ""),
      complemento: String(payload.complemento || ""),
      bairro: String(payload.bairro || ""),
      localidade: String(payload.localidade || ""),
      uf: String(payload.uf || ""),

      estado: String(payload.estado || ""),
      regiao: String(payload.regiao || ""),

      // Aliases
      cidade: String(payload.localidade || ""),
      estadoSigla: String(payload.uf || "")
    };

    return res.json({
      verified: true,
      verifyResponseMessage: "OK",
      verificationResultCode: "SUCCESS",
      verificationResultDescription: "OK",
      suggestions: [suggestion]
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

function normalizeBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body || {};
}

/**
 * Helper para reduzir repetição na declaração do Concerto.
 */
function concertoStringProp(name, term, opts = {}) {
  const decorators = [];

  if (opts.requiredForVerifyingType) {
    decorators.push({ $class: "concerto.metamodel@1.0.0.Decorator", name: "IsRequiredForVerifyingType" });
  }

  decorators.push({
    $class: "concerto.metamodel@1.0.0.Decorator",
    name: "Term",
    arguments: [{ $class: "concerto.metamodel@1.0.0.DecoratorString", value: term }]
  });

  const prop = {
    $class: "concerto.metamodel@1.0.0.StringProperty",
    name,
    isArray: false,
    isOptional: !opts.requiredForVerifyingType,
    decorators
  };

  if (opts.maxLength) {
    prop.lengthValidator = {
      $class: "concerto.metamodel@1.0.0.StringLengthValidator",
      maxLength: opts.maxLength
    };
  }

  return prop;
}
