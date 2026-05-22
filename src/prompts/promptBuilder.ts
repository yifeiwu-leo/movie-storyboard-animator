import type { AppConfig } from "../config.js";
import type { StoryboardStory, StoryScene } from "../story/types.js";

export type KeyframeKind = "start" | "end";

export type KeyframeRequest = {
  sceneId: string;
  kind: KeyframeKind;
  prompt: string;
  payload: Record<string, unknown>;
};

export type VideoRequest = {
  sceneId: string;
  prompt: string;
  payload: Record<string, unknown>;
};

export type CharacterReferenceRequest = {
  referenceId: string;
  prompt: string;
  payload: Record<string, unknown>;
};

export function buildImagePrompt(story: StoryboardStory, scene: StoryScene, kind: KeyframeKind): string {
  const moment =
    kind === "start"
      ? "opening keyframe, establishing the shot"
      : "ending keyframe, a natural continuation that gives the next motion beat somewhere to land";

  return [
    `${moment}.`,
    `${story.character.identity}, ${story.character.consistency}.`,
    `Scene: ${scene.visual}.`,
    `Location: ${scene.location}.`,
    `Mood: ${scene.narration}`,
    `Style: ${story.format.style}.`,
    "16:9 cinematic composition, clear subject action, coherent lighting, physical props, readable layout.",
    story.character.avoid,
  ].join(" ");
}

export function buildKeyframeRequests(story: StoryboardStory, config: AppConfig): KeyframeRequest[] {
  return story.scenes.flatMap((scene, sceneIndex) =>
    (["start", "end"] as const).map((kind, kindIndex) => {
      const prompt = buildImagePrompt(story, scene, kind);

      return {
        sceneId: scene.id,
        kind,
        prompt,
        payload: buildNanoBananaPayload(config, prompt),
      };
    }),
  );
}

export function buildCharacterReferenceRequests(
  story: StoryboardStory,
  config: AppConfig,
): CharacterReferenceRequest[] {
  const prompts = [
    {
      referenceId: "primary_character_reference",
      prompt: [
        `${story.character.identity}, ${story.character.consistency}.`,
        `Style: ${story.format.style}.`,
        "Neutral background, cinematic reference portrait, clear face or subject details, consistent materials and outfit.",
        story.character.avoid,
      ].join(" "),
    },
  ];

  return prompts.map((reference) => ({
    referenceId: reference.referenceId,
    prompt: reference.prompt,
    payload: buildNanoBananaPayload(config, reference.prompt),
  }));
}

export function withGeneratedContextImages<T extends KeyframeRequest>(
  request: T,
  imageIds: string[],
): T {
  return {
    ...request,
    payload: {
      ...request.payload,
      parameters: {
        ...((request.payload.parameters as Record<string, unknown> | undefined) ?? {}),
        guidances: {
          image_reference: imageIds.map((id) => ({
            image: {
              id,
              type: "GENERATED",
            },
            strength: "MID",
          })),
        },
      },
    },
  };
}

function buildNanoBananaPayload(config: AppConfig, prompt: string): Record<string, unknown> {
  return {
    model: config.nanoBananaModelId,
    parameters: {
      width: 1344,
      height: 768,
      prompt,
      quantity: 1,
      style_ids: [config.styleUUID],
      prompt_enhance: "OFF",
    },
    public: false,
  };
}

export function buildVideoPrompt(story: StoryboardStory, scene: StoryScene): string {
  return [
    scene.motion,
    "Tween naturally between the provided start and end frames.",
    `Caption beat: ${scene.caption}.`,
    `Narration mood: ${scene.narration}`,
    `Style: ${story.format.style}.`,
    "Preserve subject identity, outfit or material continuity, cinematic style, lighting, and environment while tweening naturally between the provided start and end frames.",
  ].join(" ");
}

export function buildVideoRequest(
  story: StoryboardStory,
  scene: StoryScene,
  startFrameId: string,
  endFrameId: string,
): VideoRequest {
  const prompt = buildVideoPrompt(story, scene);

  return {
    sceneId: scene.id,
    prompt,
    payload: {
      model: "kling-3.0",
      public: true,
      parameters: {
        duration: story.format.clipDurationSeconds,
        mode: "RESOLUTION_1080",
        prompt_enhance: "OFF",
        quantity: 1,
        prompt,
        width: story.format.width,
        height: story.format.height,
        audio: true,
        guidances: {
          start_frame: [
            {
              image: {
                id: startFrameId,
                type: "GENERATED",
              },
            },
          ],
          end_frame: [
            {
              image: {
                id: endFrameId,
                type: "GENERATED",
              },
            },
          ],
        },
      },
    },
  };
}
