import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type { StoryboardStory } from "./types.js";

export async function loadStory(path = "story/storyboard.yaml"): Promise<StoryboardStory> {
  const content = await readFile(path, "utf8");
  const story = YAML.parse(content) as StoryboardStory;

  if (!story?.scenes?.length) {
    throw new Error(`No scenes found in ${path}`);
  }

  return story;
}
