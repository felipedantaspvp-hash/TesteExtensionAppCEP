const FAKE_ACCESS_TOKEN = "9f3c1c2a-6f7e-4c1d-9b8a-2e5d8a0f6c47";

function doGet() {
	return ContentService.createTextOutput("OK");
}

function doPost(e) {
	const action = String(e?.parameter?.action || "");

	if (action === "oauthToken") return oauthToken_(e);
	if (action === "getTypeNames") return getTypeNames_();
	if (action === "getTypeDefinitions") return getTypeDefinitions_();
	if (action === "verify") return verifyCEP_(e);

	return json_({ error: "Unknown action", actionReceived: action });
}

function oauthToken_(e) {
	const params = e?.parameter || {};
	const grantType = String(params.grant_type || "").trim();

	if (grantType && grantType !== "client_credentials") {
		return json_({
			error: "unsupported_grant_type",
			error_description: "Only client_credentials is supported"
		});
	}

	return json_({
		access_token: FAKE_ACCESS_TOKEN,
		token_type: "Bearer",
		expires_in: 3600
	});
}

function getTypeNames_() {
	return json_({ typeNames: ["ConsultaCEP"] });
}

function getTypeDefinitions_() {
	return json_({
		typeDefinitions: [
			{
				typeName: "ConsultaCEP",
				displayName: "Consulta CEP",
				description: "Consulta CEP via ViaCEP e preenche logradouro",
				properties: {
					cep: { type: "string", displayName: "CEP", requiredForVerifyingType: true },
					logradouro: { type: "string", displayName: "Logradouro" }
				}
			}
		]
	});
}

function verifyCEP_(e) {
	try {
		const req = parseJsonBody_(e) || {};
		const data = req.data || {};

		const cepRaw = String(data.cep || "");
		const cepDigits = cepRaw.replace(/\D/g, "");
		if (cepDigits.length !== 8) {
			return json_({
				verified: false,
				verifyResponseMessage: "CEP inválido (precisa ter 8 dígitos).",
				verifyFailureReason: "CEP inválido.",
				verificationResultCode: "VALIDATION_ERRORS",
				suggestions: [{ cep: cepRaw, logradouro: "" }]
			});
		}

		const cepFormatado = cepDigits.substring(0, 5) + "-" + cepDigits.substring(5);
		const url = "https://viacep.com.br/ws/" + cepFormatado + "/json/";

		const resp = UrlFetchApp.fetch(url, {
			method: "get",
			muteHttpExceptions: true,
			followRedirects: true,
			headers: { "Accept": "application/json" }
		});

		const status = resp.getResponseCode();
		const bodyText = resp.getContentText();

		if (status < 200 || status >= 300) {
			return json_({
				verified: false,
				verifyResponseMessage: "Falha ao consultar ViaCEP (HTTP " + status + ").",
				verifyFailureReason: "Falha ao consultar ViaCEP.",
				verificationResultCode: "EXTERNAL_SERVICE_ERROR",
				suggestions: [{ cep: cepRaw, logradouro: "" }]
			});
		}

		const payload = JSON.parse(bodyText);
		if (payload?.erro) {
			return json_({
				verified: false,
				verifyResponseMessage: "CEP não encontrado.",
				verifyFailureReason: "CEP não encontrado.",
				verificationResultCode: "VALIDATION_ERRORS",
				suggestions: [{ cep: cepRaw, logradouro: "" }]
			});
		}

		return json_({
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
		return json_({
			verified: false,
			verifyResponseMessage: "Erro interno no verify.",
			verifyFailureReason: String(err?.stack || err),
			verificationResultCode: "INTERNAL_ERROR",
			suggestions: []
		});
	}
}

function parseJsonBody_(e) {
	const raw = e?.postData?.contents ? String(e.postData.contents) : "";
	if (!raw) return null;
	const t = raw.trim();
	if (!(t.startsWith("{") || t.startsWith("["))) return null;
	return JSON.parse(t);
}

function json_(obj) {
	return ContentService
		.createTextOutput(JSON.stringify(obj))
		.setMimeType(ContentService.MimeType.JSON);
}
