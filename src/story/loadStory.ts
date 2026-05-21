import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type { LifeJourneyStory } from "./types.js";

export async function loadStory(path = "story/life-journey.yaml"): Promise<LifeJourneyStory> {
  const content = await readFile(path, "utf8");
  const story = YAML.parse(content) as LifeJourneyStory;

  if (!story?.scenes?.length) {
    throw new Error(`No scenes found in ${path}`);
  }

  return story;
}
