import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import type { ClipManifest } from "./manifests.js";
import { loadStory } from "./story/loadStory.js";
import { ensureParentDir, readJson, writeJson } from "./utils/files.js";

async function main() {
  const story = await loadStory();
  const clips = await readJson<ClipManifest>("outputs/manifests/clips.json");
  const localClips = clips.clips.filter((clip) => clip.localPath);

  if (localClips.length === 0) {
    throw new Error("No downloaded clips found in outputs/manifests/clips.json");
  }

  const concatPath = "outputs/final/concat.txt";
  const finalPath = "outputs/final/storyboard.mp4";
  const captionsPath = "outputs/final/captions.json";

  await ensureParentDir(concatPath);
  await writeFile(
    concatPath,
    localClips.map((clip) => `file '../../${clip.localPath!.replaceAll("'", "'\\''")}'`).join("\n") + "\n",
    "utf8",
  );

  await writeJson(captionsPath, {
    title: story.title,
    captions: story.scenes.map((scene, index) => ({
      sceneId: scene.id,
      startSeconds: index * story.format.clipDurationSeconds,
      endSeconds: (index + 1) * story.format.clipDurationSeconds,
      caption: scene.caption,
      narration: scene.narration,
    })),
  });

  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-af",
    "aresample=async=1",
    finalPath,
  ]);

  console.log(`Wrote ${finalPath}`);
  console.log(`Wrote caption/narration timing to ${captionsPath}`);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
