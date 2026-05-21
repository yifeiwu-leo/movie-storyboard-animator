import { existsSync } from "node:fs";
import { getConfig } from "./config.js";
import { LeonardoClient } from "./leonardo/client.js";
import type { ClipManifest, KeyframeManifest } from "./manifests.js";
import { findKeyframe } from "./manifests.js";
import { buildVideoRequest } from "./prompts/promptBuilder.js";
import { loadStory } from "./story/loadStory.js";
import { readJson, writeJson } from "./utils/files.js";

const submitOnly = process.argv.includes("--submit-only");
const noDownload = process.argv.includes("--no-download");
const concurrency = readConcurrency();

async function main() {
  const config = getConfig();
  const story = await loadStory();
  const keyframes = await readJson<KeyframeManifest>("outputs/manifests/keyframes.json");
  const client = new LeonardoClient(config);
  const manifest = await loadExistingManifest();
  const sceneOrder = new Map(story.scenes.map((scene, index) => [scene.id, index]));
  let pendingManifestWrite = Promise.resolve();
  const saveManifest = () => {
    pendingManifestWrite = pendingManifestWrite.then(() => writeManifest(manifest, sceneOrder));
    return pendingManifestWrite;
  };

  await runWithConcurrency(story.scenes, concurrency, async (scene) => {
    const existing = manifest.clips.find(
      (clip) => clip.sceneId === scene.id && (clip.localPath || (noDownload && clip.videoUrl) || submitOnly),
    );
    if (existing) {
      console.log(`Skipping video clip for ${scene.id}; already generated.`);
      return;
    }

    const start = findKeyframe(keyframes, scene.id, "start");
    const end = findKeyframe(keyframes, scene.id, "end");
    const request = buildVideoRequest(story, scene, start.imageId!, end.imageId!);

    console.log(`Creating video clip for ${scene.id}...`);
    const generation = await client.createVideoGeneration(request.payload);

    if (submitOnly) {
      manifest.clips.push({
        sceneId: scene.id,
        generationId: generation.generationId,
      });
      await saveManifest();
      return;
    }

    const status = await client.pollGeneration(generation.generationId, { timeoutMs: 20 * 60 * 1000 });
    if (status.status === "FAILED") {
      throw new Error(`Video generation failed for ${scene.id}`);
    }

    const videoUrl = status.images.find((image) => image.motionMP4URL)?.motionMP4URL ?? undefined;
    const localPath = videoUrl ? `outputs/clips/${scene.id}.mp4` : undefined;

    if (videoUrl && localPath && !noDownload) {
      await client.download(videoUrl, localPath);
    }

    manifest.clips.push({
      sceneId: scene.id,
      generationId: generation.generationId,
      videoUrl,
      localPath: noDownload ? undefined : localPath,
    });

    await saveManifest();
  });

  await pendingManifestWrite;
  await writeManifest(manifest, sceneOrder);
  console.log(`Wrote ${manifest.clips.length} clip entries to outputs/manifests/clips.json`);
}

async function loadExistingManifest(): Promise<ClipManifest> {
  if (existsSync("outputs/manifests/clips.json")) {
    return readJson<ClipManifest>("outputs/manifests/clips.json");
  }

  return {
    createdAt: new Date().toISOString(),
    clips: [],
  };
}

async function writeManifest(manifest: ClipManifest, sceneOrder: Map<string, number>): Promise<void> {
  manifest.clips.sort((a, b) => (sceneOrder.get(a.sceneId) ?? 9999) - (sceneOrder.get(b.sceneId) ?? 9999));
  await writeJson("outputs/manifests/clips.json", manifest);
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
  const raw = arg?.split("=")[1] ?? process.env.KLING_CONCURRENCY ?? "3";
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
