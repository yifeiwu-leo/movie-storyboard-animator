import { writeFile } from "node:fs/promises";
import type { AppConfig } from "../config.js";
import { ensureParentDir } from "../utils/files.js";

export type GenerationSummary = {
  generationId: string;
  raw: unknown;
};

export type GeneratedImage = {
  id: string;
  url?: string;
  motionMP4URL?: string | null;
};

export type GenerationStatus = {
  id: string;
  status?: string;
  images: GeneratedImage[];
  raw: unknown;
};

export class LeonardoClient {
  constructor(private readonly config: AppConfig) {}

  async createImageGeneration(payload: Record<string, unknown>): Promise<GenerationSummary> {
    const raw = await this.postJson(this.config.imageGenerationUrl, payload);
    return {
      generationId: extractGenerationId(raw),
      raw,
    };
  }

  async createVideoGeneration(payload: Record<string, unknown>): Promise<GenerationSummary> {
    const raw = await this.postJson(this.config.videoGenerationUrl, payload);
    return {
      generationId: extractGenerationId(raw),
      raw,
    };
  }

  async getGeneration(generationId: string): Promise<GenerationStatus> {
    const raw = await this.getJson(`${this.config.generationStatusBaseUrl}/${generationId}`);
    return normalizeGenerationStatus(generationId, raw);
  }

  async pollGeneration(generationId: string, options: { intervalMs?: number; timeoutMs?: number } = {}) {
    const intervalMs = options.intervalMs ?? 5000;
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await this.getGeneration(generationId);
      if (status.status === "COMPLETE" || status.status === "FAILED") {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timed out waiting for generation ${generationId}`);
  }

  async download(url: string, path: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed ${response.status}: ${await response.text()}`);
    }

    await ensureParentDir(path);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(path, bytes);
  }

  private async postJson(url: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.config.leonardoApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`POST ${url} failed ${response.status}: ${await response.text()}\nPayload: ${redactPayload(payload)}`);
    }

    return validateApiBody(await response.json(), url);
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.config.leonardoApiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`GET ${url} failed ${response.status}: ${await response.text()}`);
    }

    return validateApiBody(await response.json(), url);
  }
}

function validateApiBody(body: unknown, url: string): unknown {
  const errors = Array.isArray(body)
    ? body.filter((entry) => asRecord(entry).message || asRecord(entry).extensions)
    : Array.isArray(asRecord(body).errors)
      ? (asRecord(body).errors as unknown[])
      : [];

  if (errors.length > 0) {
    throw new Error(`API validation error from ${url}: ${JSON.stringify(errors, null, 2)}`);
  }

  return body;
}

function redactPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2);
}

function extractGenerationId(raw: unknown): string {
  const object = asRecord(raw);
  const candidates = [
    object.sdGenerationJob,
    object.generate,
    object.generation,
    object.generationJob,
    object.videoGenerationJob,
    object,
  ].map(asRecord);

  for (const candidate of candidates) {
    const id =
      candidate.generationId ??
      candidate.id ??
      candidate.generation_id ??
      candidate.jobId ??
      candidate.job_id;

    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  throw new Error(`Could not find generation id in response: ${JSON.stringify(raw, null, 2)}`);
}

function normalizeGenerationStatus(generationId: string, raw: unknown): GenerationStatus {
  const root = asRecord(raw);
  const generation = asRecord(root.generations_by_pk ?? root.generation ?? root);
  const images = Array.isArray(generation.generated_images)
    ? generation.generated_images.map(asRecord).flatMap((image) => {
        const id = typeof image.id === "string" ? image.id : undefined;
        if (!id) {
          return [];
        }
        return [
          {
            id,
            url: typeof image.url === "string" ? image.url : undefined,
            motionMP4URL: typeof image.motionMP4URL === "string" ? image.motionMP4URL : null,
          },
        ];
      })
    : [];

  return {
    id: typeof generation.id === "string" ? generation.id : generationId,
    status: typeof generation.status === "string" ? generation.status : undefined,
    images,
    raw,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
