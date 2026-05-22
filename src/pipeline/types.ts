export type PipelineConfig = {
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl: string;
  models: {
    image: string;
    video: string;
  };
  styleIds: string[];
  image: {
    width: number;
    height: number;
    quantity: number;
    promptEnhance: "ON" | "OFF";
    timeoutSeconds: number;
    pollIntervalSeconds: number;
    concurrency: number;
    referenceStrength: "LOW" | "MID" | "HIGH";
  };
  video: {
    width: number;
    height: number;
    quantity: number;
    mode: string;
    audio: boolean;
    promptEnhance: "ON" | "OFF";
    timeoutSeconds: number;
    pollIntervalSeconds: number;
    concurrency: number;
    maxDurationSeconds: number;
  };
  outputDir: string;
};

export type StoryScript = {
  title: string;
  outputName: string;
  style: string;
  character: {
    description: string;
    continuityRules: string[];
  };
  references?: StoryReference[];
  shots: StoryShot[];
};

export type StoryReference = {
  id: string;
  kind?: "character" | "prop" | "background" | "style";
  scope?: "global" | "shot";
  prompt: string;
};

export type StoryShot = {
  id: string;
  title: string;
  durationSeconds: number;
  caption?: string;
  narration?: string;
  referenceIds?: string[];
  startKeyframePrompt: string;
  endKeyframePrompt: string;
  videoPrompt: string;
};

export type PipelineImageEntry = {
  id: string;
  role: "reference" | "start" | "end";
  shotId?: string;
  generationId: string;
  imageId: string;
  imageUrl?: string;
  localPath?: string;
};

export type PipelineClipEntry = {
  shotId: string;
  generationId: string;
  videoUrl?: string;
  localPath?: string;
};

export type PipelineStepStatus = "pending" | "running" | "succeeded" | "failed" | "timed_out";

export type PipelineStep = {
  id: string;
  type: "reference" | "keyframe" | "clip" | "assembly";
  status: PipelineStepStatus;
  shotId?: string;
  role?: "reference" | "start" | "end";
  generationId?: string;
  outputPath?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type PipelineManifest = {
  createdAt: string;
  scriptTitle: string;
  outputName: string;
  steps: PipelineStep[];
  images: PipelineImageEntry[];
  clips: PipelineClipEntry[];
};
