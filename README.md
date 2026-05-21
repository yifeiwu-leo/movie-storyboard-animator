# Movie Storyboard Animator

This project turns a structured movie storyboard JSON into an animated video using Leonardo AI:

- Gemini/Nano Banana image generation creates consistent reference images and start/end keyframes.
- Kling 3.0 video generation animates each shot between generated keyframes.
- Local manifests preserve generated IDs so shots can be resumed or regenerated.
- The pipeline only needs a config file and a storyboard script JSON after the initial LLM script-writing step.

## Setup

1. Set Up Env Vars

Create `.env`:

```bash
LEONARDO_API_KEY=...
```

Edit `config/pipeline.json` if you need to change the base URL, models, timeouts, or concurrency. The defaults use:

- Base URL: [https://cloud.leonardo.ai/api/rest/](https://cloud.leonardo.ai/api/rest/)
- Image model: `gemini-2.5-flash-image`
- Video model: `kling-3.0`
- Image timeout: 3 minutes
- Video timeout: 15 minutes
- Max Kling shot duration: 15 seconds

Install ffmpeg, which is required for the final video assembly step:

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install ffmpeg
```

Verify it is available on your `PATH`:

```bash
ffmpeg -version
```

Install Node.js, which provides the `node` and `npm` commands used by the pipeline:

```bash
# macOS
brew install node

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install nodejs npm
```

Verify Node.js and npm are available on your `PATH`:

```bash
node --version
npm --version
```

Install dependencies once:

```bash
npm install
```

1. Generate Script

Use `prompts/create-story-script.md` with an LLM to generate a storyboard script JSON.

Save the LLM output as:

```bash
scripts/your-storyboard.script.json
```

You can start from `scripts/placeholder.script.json`. The script must include shot-level start keyframe prompts, end keyframe prompts, video prompts, and `durationSeconds` values from 1 to 15.

1. Run Pipeline Commands

Review payloads without spending credits:

```bash
npm run pipeline -- --dry-run --config config/pipeline.json --script scripts/your-storyboard.script.json
```

Generate references, keyframes, Kling clips, downloads, and final assembly:

```bash
npm run pipeline -- --config config/pipeline.json --script scripts/your-storyboard.script.json
```

Skip assembly if you only want generated assets and manifests:

```bash
npm run pipeline -- --no-assemble --config config/pipeline.json --script scripts/your-storyboard.script.json
```

Start from scratch and ignore existing assets/status for that script:

```bash
npm run pipeline -- --fresh --config config/pipeline.json --script scripts/your-storyboard.script.json
```

Outputs are written under a folder matching the script filename. For example, `scripts/your-storyboard.script.json` writes to `outputs/pipeline/your-storyboard/`.

The pipeline writes `manifest.json` in that output folder. It tracks every reference, keyframe, clip, and final assembly step with `pending`, `running`, `succeeded`, `failed`, or `timed_out` status so a later run can resume completed work and show where a failure happened.

### TODO

1. Support error handling from failed generations
2. Support uploaded references
3. Soundtracking

