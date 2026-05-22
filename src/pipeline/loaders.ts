import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { PipelineConfig, StoryScript } from "./types.js";

export function loadLocalEnv(path = ".env"): void {
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

export async function loadPipelineConfig(path: string): Promise<PipelineConfig> {
  loadLocalEnv();
  const config = JSON.parse(await readFile(path, "utf8")) as PipelineConfig;
  validateConfig(config, path);
  return config;
}

export async function loadStoryScript(path: string, config: PipelineConfig): Promise<StoryScript> {
  const script = JSON.parse(await readFile(path, "utf8")) as StoryScript;
  validateScript(script, config, path);
  return script;
}

export function resolveApiKey(config: PipelineConfig): string {
  const apiKey = config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined);
  if (!apiKey) {
    throw new Error(`Missing API key. Set config.apiKey or environment variable ${config.apiKeyEnv ?? "LEONARDO_API_KEY"}.`);
  }
  return apiKey;
}

function validateConfig(config: PipelineConfig, path: string): void {
  if (!config.baseUrl || !config.models?.image || !config.models?.video) {
    throw new Error(`Invalid config ${path}: baseUrl, models.image, and models.video are required.`);
  }

  assertPositive(config.image.timeoutSeconds, "image.timeoutSeconds");
  assertPositive(config.video.timeoutSeconds, "video.timeoutSeconds");
  assertPositive(config.image.concurrency, "image.concurrency");
  assertPositive(config.video.concurrency, "video.concurrency");

  if (config.video.maxDurationSeconds > 15) {
    throw new Error("video.maxDurationSeconds cannot exceed Kling's 15 second shot limit.");
  }
}

function validateScript(script: StoryScript, config: PipelineConfig, path: string): void {
  if (!script.title || !script.outputName || !Array.isArray(script.shots) || script.shots.length === 0) {
    throw new Error(`Invalid script ${path}: title, outputName, and at least one shot are required.`);
  }

  if (!/^[a-z0-9-]+$/.test(script.outputName)) {
    throw new Error(`Invalid outputName "${script.outputName}". Use lowercase letters, numbers, and hyphens.`);
  }

  const ids = new Set<string>();
  const referenceIds = new Set<string>();
  for (const reference of script.references ?? []) {
    if (!/^[a-z0-9_]+$/.test(reference.id)) {
      throw new Error(`Invalid reference id "${reference.id}". Use lowercase letters, numbers, and underscores.`);
    }
    if (referenceIds.has(reference.id)) {
      throw new Error(`Duplicate reference id "${reference.id}".`);
    }
    if (reference.scope && reference.scope !== "global" && reference.scope !== "shot") {
      throw new Error(`Invalid reference scope "${reference.scope}" for "${reference.id}". Use "global" or "shot".`);
    }
    referenceIds.add(reference.id);
  }

  for (const shot of script.shots) {
    if (!/^[a-z0-9_]+$/.test(shot.id)) {
      throw new Error(`Invalid shot id "${shot.id}". Use lowercase letters, numbers, and underscores.`);
    }
    if (ids.has(shot.id)) {
      throw new Error(`Duplicate shot id "${shot.id}".`);
    }
    ids.add(shot.id);

    if (shot.durationSeconds < 1 || shot.durationSeconds > config.video.maxDurationSeconds) {
      throw new Error(
        `Shot "${shot.id}" duration ${shot.durationSeconds}s exceeds configured limit ${config.video.maxDurationSeconds}s.`,
      );
    }

    for (const referenceId of shot.referenceIds ?? []) {
      if (!referenceIds.has(referenceId)) {
        throw new Error(`Shot "${shot.id}" references unknown reference id "${referenceId}".`);
      }
    }
  }
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
}
