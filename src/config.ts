import { existsSync, readFileSync } from "node:fs";

export type AppConfig = {
  leonardoApiKey: string;
  imageGenerationUrl: string;
  videoGenerationUrl: string;
  generationStatusBaseUrl: string;
  nanoBananaModelId: string;
  styleUUID: string;
};

function loadLocalEnv(path = ".env"): void {
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    process.env[key] ??= valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}

export function getConfig(): AppConfig {
  loadLocalEnv();

  const leonardoApiKey = process.env.LEONARDO_API_KEY;
  if (!leonardoApiKey) {
    throw new Error("Missing LEONARDO_API_KEY. Add it to .env or your shell environment.");
  }

  return {
    leonardoApiKey,
    imageGenerationUrl:
      process.env.LEONARDO_IMAGE_GENERATION_URL ??
      "https://dev-webhook-api.hasura.app/api/rest/v2/generations",
    videoGenerationUrl:
      process.env.LEONARDO_VIDEO_GENERATION_URL ??
      "https://dev-webhook-api.hasura.app/api/rest/v2/generations",
    generationStatusBaseUrl:
      process.env.LEONARDO_GENERATION_STATUS_BASE_URL ??
      "https://dev-webhook-api.hasura.app/api/rest/v1/generations",
    nanoBananaModelId:
      process.env.LEONARDO_NANO_BANANA_MODEL_ID ?? "gemini-2.5-flash-image",
    styleUUID: process.env.LEONARDO_STYLE_UUID ?? "111dc692-d470-4eec-b791-3475abac4c46",
  };
}
