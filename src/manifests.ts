import type { GeneratedImage } from "./leonardo/client.js";

export type KeyframeManifestEntry = {
  sceneId: string;
  kind: "start" | "end";
  generationId: string;
  imageId?: string;
  imageUrl?: string;
  localPath?: string;
};

export type CharacterReferenceManifestEntry = {
  referenceId: string;
  generationId: string;
  imageId?: string;
  imageUrl?: string;
  localPath?: string;
};

export type KeyframeManifest = {
  createdAt: string;
  characterReferences: CharacterReferenceManifestEntry[];
  keyframes: KeyframeManifestEntry[];
};

export type ClipManifestEntry = {
  sceneId: string;
  generationId: string;
  videoUrl?: string;
  localPath?: string;
};

export type ClipManifest = {
  createdAt: string;
  clips: ClipManifestEntry[];
};

export function selectFirstImage(images: GeneratedImage[]): GeneratedImage {
  const image = images[0];
  if (!image) {
    throw new Error("Generation completed without generated_images.");
  }
  return image;
}

export function findKeyframe(
  manifest: KeyframeManifest,
  sceneId: string,
  kind: "start" | "end",
): KeyframeManifestEntry {
  const keyframe = manifest.keyframes.find((entry) => entry.sceneId === sceneId && entry.kind === kind);
  if (!keyframe?.imageId) {
    throw new Error(`Missing ${kind} keyframe imageId for scene ${sceneId}`);
  }
  return keyframe;
}
