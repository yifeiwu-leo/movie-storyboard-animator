import { getConfig } from "./config.js";
import {
  buildCharacterReferenceRequests,
  buildKeyframeRequests,
  buildVideoRequest,
  withGeneratedContextImages,
} from "./prompts/promptBuilder.js";
import { loadStory } from "./story/loadStory.js";
import { writeJson } from "./utils/files.js";

async function main() {
  const config = getConfig();
  const story = await loadStory();
  const characterReferences = buildCharacterReferenceRequests(story, config);
  const keyframes = buildKeyframeRequests(story, config).map((request) =>
    withGeneratedContextImages(request, ["primary-character-reference-generated-image-id"]),
  );

  await writeJson("outputs/dry-runs/keyframe-payloads.json", {
    createdAt: new Date().toISOString(),
    endpoint: config.imageGenerationUrl,
    characterReferences,
    keyframes,
  });

  const placeholderVideos = story.scenes.map((scene) =>
    buildVideoRequest(story, scene, `${scene.id}-start-generated-image-id`, `${scene.id}-end-generated-image-id`),
  );

  await writeJson("outputs/dry-runs/video-payloads.placeholders.json", {
    createdAt: new Date().toISOString(),
    endpoint: config.videoGenerationUrl,
    videos: placeholderVideos,
    note: "Replace placeholder image IDs with generated Nano Banana image IDs before executing Kling requests.",
  });

  console.log(
    `Wrote ${characterReferences.length} character reference payloads, ${keyframes.length} keyframe payloads, and ${placeholderVideos.length} video payloads.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
