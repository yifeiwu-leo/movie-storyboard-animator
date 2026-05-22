import { existsSync } from "node:fs";
import { getConfig } from "./config.js";
import { LeonardoClient } from "./leonardo/client.js";
import type { KeyframeManifest } from "./manifests.js";
import { selectFirstImage } from "./manifests.js";
import {
  buildCharacterReferenceRequests,
  buildKeyframeRequests,
  withGeneratedContextImages,
} from "./prompts/promptBuilder.js";
import { loadStory } from "./story/loadStory.js";
import { readJson, writeJson } from "./utils/files.js";

const submitOnly = process.argv.includes("--submit-only");
const noDownload = process.argv.includes("--no-download");
const concurrency = readConcurrency();

async function main() {
  const config = getConfig();
  const story = await loadStory();
  const client = new LeonardoClient(config);
  const manifest = await loadExistingManifest();
  const referenceImageIds: string[] = [];
  let pendingManifestWrite = Promise.resolve();
  const saveManifest = () => {
    pendingManifestWrite = pendingManifestWrite.then(() => writeJson("outputs/manifests/keyframes.json", manifest));
    return pendingManifestWrite;
  };

  for (const request of buildCharacterReferenceRequests(story, config)) {
    const existing = manifest.characterReferences.find((entry) => entry.referenceId === request.referenceId);
    if (existing?.imageId) {
      console.log(`Skipping ${request.referenceId}; already generated.`);
      referenceImageIds.push(existing.imageId);
      continue;
    }

    console.log(`Creating ${request.referenceId}...`);
    const generation = await client.createImageGeneration(request.payload);

    if (submitOnly) {
      manifest.characterReferences.push({
        referenceId: request.referenceId,
        generationId: generation.generationId,
      });
      continue;
    }

    const status = await client.pollGeneration(generation.generationId);
    if (status.status === "FAILED") {
      throw new Error(`Character reference generation failed for ${request.referenceId}`);
    }

    const image = selectFirstImage(status.images);
    referenceImageIds.push(image.id);

    const localPath = image.url
      ? `outputs/keyframes/${request.referenceId}.${extensionFromUrl(image.url)}`
      : undefined;

    if (image.url && localPath && !noDownload) {
      await client.download(image.url, localPath);
    }

    manifest.characterReferences.push({
      referenceId: request.referenceId,
      generationId: generation.generationId,
      imageId: image.id,
      imageUrl: image.url,
      localPath: noDownload ? undefined : localPath,
    });

    await saveManifest();
  }

  const requests =
    referenceImageIds.length > 0
      ? buildKeyframeRequests(story, config).map((request) =>
          withGeneratedContextImages(request, referenceImageIds),
        )
      : buildKeyframeRequests(story, config);

  await runWithConcurrency(requests, concurrency, async (request) => {
    const existing = manifest.keyframes.find(
      (entry) => entry.sceneId === request.sceneId && entry.kind === request.kind && entry.imageId,
    );
    if (existing) {
      console.log(`Skipping ${request.sceneId}/${request.kind}; already generated.`);
      return;
    }

    console.log(`Creating ${request.sceneId}/${request.kind} keyframe...`);
    const generation = await client.createImageGeneration(request.payload);

    if (submitOnly) {
      manifest.keyframes.push({
        sceneId: request.sceneId,
        kind: request.kind,
        generationId: generation.generationId,
      });
      await saveManifest();
      return;
    }

    const status = await client.pollGeneration(generation.generationId);
    if (status.status === "FAILED") {
      throw new Error(`Keyframe generation failed for ${request.sceneId}/${request.kind}`);
    }

    const image = selectFirstImage(status.images);
    const localPath = image.url
      ? `outputs/keyframes/${request.sceneId}-${request.kind}.${extensionFromUrl(image.url)}`
      : undefined;

    if (image.url && localPath && !noDownload) {
      await client.download(image.url, localPath);
    }

    manifest.keyframes.push({
      sceneId: request.sceneId,
      kind: request.kind,
      generationId: generation.generationId,
      imageId: image.id,
      imageUrl: image.url,
      localPath: noDownload ? undefined : localPath,
    });

    await saveManifest();
  });

  await pendingManifestWrite;
  await writeJson("outputs/manifests/keyframes.json", manifest);
  console.log(`Wrote ${manifest.keyframes.length} keyframe entries to outputs/manifests/keyframes.json`);
}

async function loadExistingManifest(): Promise<KeyframeManifest> {
  if (existsSync("outputs/manifests/keyframes.json")) {
    return readJson<KeyframeManifest>("outputs/manifests/keyframes.json");
  }

  return {
    createdAt: new Date().toISOString(),
    characterReferences: [],
    keyframes: [],
  };
}

function extensionFromUrl(url: string): string {
  const clean = new URL(url).pathname.split("/").pop() ?? "";
  const extension = clean.split(".").pop()?.toLowerCase();
  return extension && ["png", "jpg", "jpeg", "webp"].includes(extension) ? extension : "png";
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  });

  await Promise.all(workers);
}

function readConcurrency(): number {
  const arg = process.argv.find((value) => value.startsWith("--concurrency="));
  const raw = arg?.split("=")[1] ?? process.env.KEYFRAME_CONCURRENCY ?? "4";
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid concurrency value: ${raw}`);
  }

  return parsed;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
