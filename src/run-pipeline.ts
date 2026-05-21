import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";
import { LeonardoClient } from "./leonardo/client.js";
import type { AppConfig } from "./config.js";
import { ensureParentDir, readJson, writeJson } from "./utils/files.js";
import { loadPipelineConfig, loadStoryScript, resolveApiKey } from "./pipeline/loaders.js";
import type {
  PipelineClipEntry,
  PipelineConfig,
  PipelineImageEntry,
  PipelineManifest,
  PipelineStep,
  PipelineStepStatus,
  StoryScript,
  StoryShot,
} from "./pipeline/types.js";

type CliOptions = {
  configPath: string;
  scriptPath: string;
  dryRun: boolean;
  noAssemble: boolean;
  fresh: boolean;
};

const options = parseArgs(process.argv.slice(2));
let manifestWriteQueue = Promise.resolve();

async function main() {
  const config = await loadPipelineConfig(options.configPath);
  const script = await loadStoryScript(options.scriptPath, config);
  const paths = getOutputPaths(config, options.scriptPath);

  if (options.fresh && existsSync(paths.root)) {
    await rm(paths.root, { recursive: true, force: true });
    console.log(`Cleared existing pipeline output: ${paths.root}`);
  }

  if (options.dryRun) {
    await writeDryRun(config, script, paths.dryRunPath);
    console.log(`Wrote dry-run payloads to ${paths.dryRunPath}`);
    return;
  }

  const client = new LeonardoClient(toAppConfig(config));
  const manifest = await loadManifest(paths.manifestPath, script, paths.scriptName);
  ensureManifestSteps(manifest, script);
  await saveManifest(manifest, paths.manifestPath, script);

  const referenceIds = await generateReferences(client, config, script, manifest, paths);
  await generateKeyframes(client, config, script, manifest, paths, referenceIds);
  await generateClips(client, config, script, manifest, paths);

  if (!options.noAssemble) {
    await assembleVideo(script, manifest, paths);
  }

  console.log(`Pipeline complete. Manifest: ${paths.manifestPath}`);
}

async function generateReferences(
  client: LeonardoClient,
  config: PipelineConfig,
  script: StoryScript,
  manifest: PipelineManifest,
  paths: ReturnType<typeof getOutputPaths>,
): Promise<string[]> {
  const references = script.references ?? [];
  await runWithConcurrency(references, config.image.concurrency, async (reference) => {
    const stepId = referenceStepId(reference.id);
    if (manifest.images.some((entry) => entry.role === "reference" && entry.id === reference.id && entry.imageId)) {
      console.log(`Skipping reference ${reference.id}; already generated.`);
      setStepStatus(manifest, stepId, "succeeded", { outputPath: findReference(manifest, reference.id)?.localPath });
      await saveManifest(manifest, paths.manifestPath, script);
      return;
    }

    console.log(`Generating reference ${reference.id}...`);
    try {
      setStepStatus(manifest, stepId, "running");
      await saveManifest(manifest, paths.manifestPath, script);

      const prompt = withGlobalStyle(script, reference.prompt);
      const generation = await client.createImageGeneration(buildImagePayload(config, prompt));
      setStepStatus(manifest, stepId, "running", { generationId: generation.generationId });
      await saveManifest(manifest, paths.manifestPath, script);

      const status = await client.pollGeneration(generation.generationId, {
        intervalMs: config.image.pollIntervalSeconds * 1000,
        timeoutMs: config.image.timeoutSeconds * 1000,
      });
      if (status.status === "FAILED") {
        throw new Error(`Reference generation failed: ${reference.id}`);
      }

      const image = firstImage(status.images);
      const localPath = image.url ? join(paths.imagesDir, `${reference.id}.${extensionFromUrl(image.url)}`) : undefined;
      if (image.url && localPath) {
        await client.download(image.url, localPath);
      }

      manifest.images.push({
        id: reference.id,
        role: "reference",
        generationId: generation.generationId,
        imageId: image.id,
        imageUrl: image.url,
        localPath,
      });
      setStepStatus(manifest, stepId, "succeeded", { generationId: generation.generationId, outputPath: localPath });
      await saveManifest(manifest, paths.manifestPath, script);
    } catch (error) {
      setStepStatus(manifest, stepId, statusForError(error), { error: errorMessage(error) });
      await saveManifest(manifest, paths.manifestPath, script);
      throw error;
    }
  });

  return manifest.images.filter((entry) => entry.role === "reference").map((entry) => entry.imageId);
}

async function generateKeyframes(
  client: LeonardoClient,
  config: PipelineConfig,
  script: StoryScript,
  manifest: PipelineManifest,
  paths: ReturnType<typeof getOutputPaths>,
  referenceImageIds: string[],
): Promise<void> {
  const work = script.shots.flatMap((shot) => [
    { shot, role: "start" as const, prompt: shot.startKeyframePrompt },
    { shot, role: "end" as const, prompt: shot.endKeyframePrompt },
  ]);

  await runWithConcurrency(work, config.image.concurrency, async ({ shot, role, prompt }) => {
    const stepId = keyframeStepId(shot.id, role);
    if (findImage(manifest, shot.id, role)?.imageId) {
      console.log(`Skipping ${shot.id}/${role}; already generated.`);
      setStepStatus(manifest, stepId, "succeeded", { outputPath: findImage(manifest, shot.id, role)?.localPath });
      await saveManifest(manifest, paths.manifestPath, script);
      return;
    }

    console.log(`Generating ${shot.id}/${role} keyframe...`);
    try {
      setStepStatus(manifest, stepId, "running");
      await saveManifest(manifest, paths.manifestPath, script);

      const generation = await client.createImageGeneration(
        buildImagePayload(config, withGlobalStyle(script, prompt), referenceImageIds),
      );
      setStepStatus(manifest, stepId, "running", { generationId: generation.generationId });
      await saveManifest(manifest, paths.manifestPath, script);

      const status = await client.pollGeneration(generation.generationId, {
        intervalMs: config.image.pollIntervalSeconds * 1000,
        timeoutMs: config.image.timeoutSeconds * 1000,
      });
      if (status.status === "FAILED") {
        throw new Error(`Keyframe generation failed: ${shot.id}/${role}`);
      }

      const image = firstImage(status.images);
      const localPath = image.url
        ? join(paths.imagesDir, `${shot.id}-${role}.${extensionFromUrl(image.url)}`)
        : undefined;
      if (image.url && localPath) {
        await client.download(image.url, localPath);
      }

      manifest.images.push({
        id: `${shot.id}_${role}`,
        role,
        shotId: shot.id,
        generationId: generation.generationId,
        imageId: image.id,
        imageUrl: image.url,
        localPath,
      });
      setStepStatus(manifest, stepId, "succeeded", { generationId: generation.generationId, outputPath: localPath });
      await saveManifest(manifest, paths.manifestPath, script);
    } catch (error) {
      setStepStatus(manifest, stepId, statusForError(error), { error: errorMessage(error) });
      await saveManifest(manifest, paths.manifestPath, script);
      throw error;
    }
  });
}

async function generateClips(
  client: LeonardoClient,
  config: PipelineConfig,
  script: StoryScript,
  manifest: PipelineManifest,
  paths: ReturnType<typeof getOutputPaths>,
): Promise<void> {
  await runWithConcurrency(script.shots, config.video.concurrency, async (shot) => {
    const stepId = clipStepId(shot.id);
    if (manifest.clips.some((clip) => clip.shotId === shot.id && clip.localPath)) {
      console.log(`Skipping clip ${shot.id}; already generated.`);
      setStepStatus(manifest, stepId, "succeeded", {
        outputPath: manifest.clips.find((clip) => clip.shotId === shot.id)?.localPath,
      });
      await saveManifest(manifest, paths.manifestPath, script);
      return;
    }

    const start = findImage(manifest, shot.id, "start");
    const end = findImage(manifest, shot.id, "end");
    if (!start?.imageId || !end?.imageId) {
      throw new Error(`Missing start/end keyframes for ${shot.id}`);
    }

    console.log(`Generating clip ${shot.id}...`);
    try {
      setStepStatus(manifest, stepId, "running");
      await saveManifest(manifest, paths.manifestPath, script);

      const generation = await client.createVideoGeneration(buildVideoPayload(config, script, shot, start.imageId, end.imageId));
      setStepStatus(manifest, stepId, "running", { generationId: generation.generationId });
      await saveManifest(manifest, paths.manifestPath, script);

      const status = await client.pollGeneration(generation.generationId, {
        intervalMs: config.video.pollIntervalSeconds * 1000,
        timeoutMs: config.video.timeoutSeconds * 1000,
      });
      if (status.status === "FAILED") {
        throw new Error(`Video generation failed: ${shot.id}`);
      }

      const videoUrl = status.images.find((image) => image.motionMP4URL)?.motionMP4URL ?? undefined;
      if (!videoUrl) {
        throw new Error(`Video generation completed without motionMP4URL: ${shot.id}`);
      }

      const localPath = join(paths.clipsDir, `${shot.id}.mp4`);
      await client.download(videoUrl, localPath);
      upsertClip(manifest, {
        shotId: shot.id,
        generationId: generation.generationId,
        videoUrl,
        localPath,
      });
      setStepStatus(manifest, stepId, "succeeded", { generationId: generation.generationId, outputPath: localPath });
      await saveManifest(manifest, paths.manifestPath, script);
    } catch (error) {
      setStepStatus(manifest, stepId, statusForError(error), { error: errorMessage(error) });
      await saveManifest(manifest, paths.manifestPath, script);
      throw error;
    }
  });
}

function buildImagePayload(config: PipelineConfig, prompt: string, referenceImageIds: string[] = []) {
  const guidances =
    referenceImageIds.length > 0
      ? {
          image_reference: referenceImageIds.map((id) => ({
            image: { id, type: "GENERATED" },
            strength: config.image.referenceStrength,
          })),
        }
      : undefined;

  return {
    model: config.models.image,
    parameters: {
      width: config.image.width,
      height: config.image.height,
      prompt,
      quantity: config.image.quantity,
      style_ids: config.styleIds,
      prompt_enhance: config.image.promptEnhance,
      ...(guidances ? { guidances } : {}),
    },
    public: false,
  };
}

function buildVideoPayload(config: PipelineConfig, script: StoryScript, shot: StoryShot, startFrameId: string, endFrameId: string) {
  return {
    model: config.models.video,
    public: true,
    parameters: {
      duration: shot.durationSeconds,
      mode: config.video.mode,
      prompt_enhance: config.video.promptEnhance,
      quantity: config.video.quantity,
      prompt: withGlobalStyle(script, shot.videoPrompt),
      width: config.video.width,
      height: config.video.height,
      audio: config.video.audio,
      guidances: {
        start_frame: [{ image: { id: startFrameId, type: "GENERATED" } }],
        end_frame: [{ image: { id: endFrameId, type: "GENERATED" } }],
      },
    },
  };
}

async function writeDryRun(config: PipelineConfig, script: StoryScript, path: string): Promise<void> {
  const placeholderReferenceIds = (script.references ?? []).map((reference) => `${reference.id}-generated-image-id`);
  await writeJson(path, {
    createdAt: new Date().toISOString(),
    imageEndpoint: `${config.baseUrl}/v2/generations`,
    videoEndpoint: `${config.baseUrl}/v2/generations`,
    statusEndpoint: `${config.baseUrl}/v1/generations/{generationId}`,
    references: (script.references ?? []).map((reference) => ({
      id: reference.id,
      payload: buildImagePayload(config, withGlobalStyle(script, reference.prompt)),
    })),
    keyframes: script.shots.flatMap((shot) => [
      {
        shotId: shot.id,
        role: "start",
        payload: buildImagePayload(config, withGlobalStyle(script, shot.startKeyframePrompt), placeholderReferenceIds),
      },
      {
        shotId: shot.id,
        role: "end",
        payload: buildImagePayload(config, withGlobalStyle(script, shot.endKeyframePrompt), placeholderReferenceIds),
      },
    ]),
    videos: script.shots.map((shot) => ({
      shotId: shot.id,
      payload: buildVideoPayload(config, script, shot, `${shot.id}-start-generated-image-id`, `${shot.id}-end-generated-image-id`),
    })),
  });
}

async function assembleVideo(
  script: StoryScript,
  manifest: PipelineManifest,
  paths: ReturnType<typeof getOutputPaths>,
): Promise<void> {
  try {
    setStepStatus(manifest, assemblyStepId(), "running");
    await saveManifest(manifest, paths.manifestPath, script);

    const clips = script.shots.map((shot) => {
      const clip = manifest.clips.find((entry) => entry.shotId === shot.id);
      if (!clip?.localPath) {
        throw new Error(`Missing downloaded clip for ${shot.id}`);
      }
      return clip.localPath;
    });

    await ensureParentDir(paths.concatPath);
    await writeFile(paths.concatPath, clips.map((clip) => `file '${escapeConcatPath(resolve(clip))}'`).join("\n") + "\n");
    await writeJson(paths.captionsPath, {
      title: script.title,
      captions: script.shots.map((shot, index) => ({
        shotId: shot.id,
        startSeconds: script.shots.slice(0, index).reduce((total, item) => total + item.durationSeconds, 0),
        endSeconds: script.shots.slice(0, index + 1).reduce((total, item) => total + item.durationSeconds, 0),
        caption: shot.caption,
        narration: shot.narration,
      })),
    });

    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      paths.concatPath,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-af",
      "aresample=async=1",
      paths.finalVideoPath,
    ]);
    setStepStatus(manifest, assemblyStepId(), "succeeded", { outputPath: paths.finalVideoPath });
    await saveManifest(manifest, paths.manifestPath, script);
    console.log(`Wrote ${paths.finalVideoPath}`);
  } catch (error) {
    setStepStatus(manifest, assemblyStepId(), statusForError(error), { error: errorMessage(error) });
    await saveManifest(manifest, paths.manifestPath, script);
    throw error;
  }
}

function toAppConfig(config: PipelineConfig): AppConfig {
  return {
    leonardoApiKey: resolveApiKey(config),
    imageGenerationUrl: `${config.baseUrl}/v2/generations`,
    videoGenerationUrl: `${config.baseUrl}/v2/generations`,
    generationStatusBaseUrl: `${config.baseUrl}/v1/generations`,
    nanoBananaModelId: config.models.image,
    styleUUID: config.styleIds[0] ?? "",
  };
}

async function loadManifest(path: string, script: StoryScript, outputName: string): Promise<PipelineManifest> {
  if (existsSync(path)) {
    return readJson<PipelineManifest>(path);
  }

  return {
    createdAt: new Date().toISOString(),
    scriptTitle: script.title,
    outputName,
    steps: [],
    images: [],
    clips: [],
  };
}

async function saveManifest(manifest: PipelineManifest, path: string, script: StoryScript): Promise<void> {
  manifestWriteQueue = manifestWriteQueue.then(async () => {
    const shotOrder = new Map(script.shots.map((shot, index) => [shot.id, index]));
    ensureManifestSteps(manifest, script);
    manifest.steps.sort((a, b) => stepSortKey(a, shotOrder).localeCompare(stepSortKey(b, shotOrder)));
    manifest.images.sort((a, b) => {
      const shotDiff = (shotOrder.get(a.shotId ?? "") ?? -1) - (shotOrder.get(b.shotId ?? "") ?? -1);
      return shotDiff || a.role.localeCompare(b.role) || a.id.localeCompare(b.id);
    });
    manifest.clips.sort((a, b) => (shotOrder.get(a.shotId) ?? 9999) - (shotOrder.get(b.shotId) ?? 9999));
    await writeJson(path, manifest);
  });
  await manifestWriteQueue;
}

function getOutputPaths(config: PipelineConfig, scriptPath: string) {
  const scriptName = scriptNameFromPath(scriptPath);
  const root = join(config.outputDir, scriptName);
  return {
    scriptName,
    root,
    imagesDir: join(root, "images"),
    clipsDir: join(root, "clips"),
    dryRunPath: join(root, "dry-run.json"),
    manifestPath: join(root, "manifest.json"),
    concatPath: join(root, "final", "concat.txt"),
    captionsPath: join(root, "final", "captions.json"),
    finalVideoPath: join(root, "final", `${scriptName}.mp4`),
  };
}

function scriptNameFromPath(scriptPath: string): string {
  return basename(scriptPath).replace(/\.script\.json$/i, "").replace(/\.json$/i, "");
}

function ensureManifestSteps(manifest: PipelineManifest, script: StoryScript): void {
  manifest.steps ??= [];
  for (const reference of script.references ?? []) {
    ensureStep(manifest, {
      id: referenceStepId(reference.id),
      type: "reference",
      role: "reference",
      status: "pending",
      updatedAt: new Date().toISOString(),
    });
  }

  for (const shot of script.shots) {
    ensureStep(manifest, {
      id: keyframeStepId(shot.id, "start"),
      type: "keyframe",
      shotId: shot.id,
      role: "start",
      status: "pending",
      updatedAt: new Date().toISOString(),
    });
    ensureStep(manifest, {
      id: keyframeStepId(shot.id, "end"),
      type: "keyframe",
      shotId: shot.id,
      role: "end",
      status: "pending",
      updatedAt: new Date().toISOString(),
    });
    ensureStep(manifest, {
      id: clipStepId(shot.id),
      type: "clip",
      shotId: shot.id,
      status: "pending",
      updatedAt: new Date().toISOString(),
    });
  }

  ensureStep(manifest, {
    id: assemblyStepId(),
    type: "assembly",
    status: "pending",
    updatedAt: new Date().toISOString(),
  });
}

function ensureStep(manifest: PipelineManifest, step: PipelineStep): void {
  if (!manifest.steps.some((existing) => existing.id === step.id)) {
    manifest.steps.push(step);
  }
}

function setStepStatus(
  manifest: PipelineManifest,
  id: string,
  status: PipelineStepStatus,
  details: Partial<Pick<PipelineStep, "generationId" | "outputPath" | "error">> = {},
): void {
  const step = manifest.steps.find((entry) => entry.id === id);
  if (!step) {
    throw new Error(`Unknown pipeline step: ${id}`);
  }

  step.status = status;
  step.updatedAt = new Date().toISOString();
  step.generationId = details.generationId ?? step.generationId;
  step.outputPath = details.outputPath ?? step.outputPath;
  step.error = details.error;

  if (status === "running") {
    step.startedAt ??= step.updatedAt;
    step.completedAt = undefined;
  }

  if (status === "succeeded" || status === "failed" || status === "timed_out") {
    step.completedAt = step.updatedAt;
  }
}

function referenceStepId(referenceId: string): string {
  return `reference:${referenceId}`;
}

function keyframeStepId(shotId: string, role: "start" | "end"): string {
  return `keyframe:${shotId}:${role}`;
}

function clipStepId(shotId: string): string {
  return `clip:${shotId}`;
}

function assemblyStepId(): string {
  return "assembly:final";
}

function stepSortKey(step: PipelineStep, shotOrder: Map<string, number>): string {
  const typeOrder = { reference: 0, keyframe: 1, clip: 2, assembly: 3 }[step.type];
  const shotIndex = step.shotId ? (shotOrder.get(step.shotId) ?? 9999) : -1;
  const roleOrder = step.role === "start" ? 0 : step.role === "end" ? 1 : 2;
  return `${typeOrder}:${String(shotIndex).padStart(4, "0")}:${roleOrder}:${step.id}`;
}

function withGlobalStyle(script: StoryScript, prompt: string): string {
  const rules = script.character.continuityRules.join(" ");
  return `${prompt} Style: ${script.style}. Character: ${script.character.description}. Continuity: ${rules}`;
}

function findReference(manifest: PipelineManifest, referenceId: string): PipelineImageEntry | undefined {
  return manifest.images.find((entry) => entry.role === "reference" && entry.id === referenceId);
}

function findImage(manifest: PipelineManifest, shotId: string, role: "start" | "end") {
  return manifest.images.find((entry) => entry.shotId === shotId && entry.role === role);
}

function upsertClip(manifest: PipelineManifest, clip: PipelineClipEntry): void {
  const index = manifest.clips.findIndex((entry) => entry.shotId === clip.shotId);
  if (index >= 0) {
    manifest.clips[index] = clip;
  } else {
    manifest.clips.push(clip);
  }
}

function firstImage(images: { id: string; url?: string }[]) {
  const image = images[0];
  if (!image) {
    throw new Error("Generation completed without generated images.");
  }
  return image;
}

function extensionFromUrl(url: string): string {
  const clean = new URL(url).pathname.split("/").pop() ?? "";
  const extension = clean.split(".").pop()?.toLowerCase();
  return extension && ["png", "jpg", "jpeg", "webp"].includes(extension) ? extension : "jpg";
}

function escapeConcatPath(path: string): string {
  return path.replaceAll("'", "'\\''");
}

function statusForError(error: unknown): PipelineStepStatus {
  return errorMessage(error).toLowerCase().includes("timed out") ? "timed_out" : "failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function parseArgs(args: string[]): CliOptions {
  return {
    configPath: readArg(args, "--config") ?? "config/pipeline.json",
    scriptPath: readArg(args, "--script") ?? "scripts/life-journey.script.json",
    dryRun: args.includes("--dry-run"),
    noAssemble: args.includes("--no-assemble"),
    fresh: args.includes("--fresh"),
  };
}

function readArg(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
