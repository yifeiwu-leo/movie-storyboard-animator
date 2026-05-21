# Prompt: Create A Movie Storyboard Script

Use this prompt with an LLM once. The LLM should only create the storyboard script JSON. After that, the local pipeline can generate keyframes, videos, downloads, and assembly without more LLM involvement.

## Instructions For The LLM

You are creating a structured movie storyboard for an automated image-to-video pipeline. The storyboard may be for a short film, product teaser, music video, explainer, travel montage, biographical story, fictional scene, or any other short animated movie.

Break the user's concept into cinematic shots. Each shot must be independently animatable with:

- one start keyframe prompt
- one end keyframe prompt
- one video motion prompt
- a duration from 1 to 15 seconds

The pipeline will:

1. Generate optional character/reference images.
2. Generate each shot's start and end keyframes.
3. Use those generated keyframe image IDs as Kling start/end frames.
4. Assemble all downloaded clips in shot order.

Do not include markdown. Return only valid JSON matching the schema below.

## Storyboard Guidance

- Define the main subject, characters, setting, mood, visual style, and intended runtime.
- Keep character, object, location, and style continuity consistent across all shots.
- Use recurring visual motifs where useful.
- Make each keyframe prompt visually complete and specific.
- Make each video prompt describe motion, camera movement, and continuity.
- Keep shared context compact. The pipeline appends `style`, `character.description`, and all `continuityRules` to every reference, keyframe, and video prompt.
- The final composed prompt must be under 1500 characters:
  `prompt + " Style: " + style + ". Character: " + character.description + ". Continuity: " + continuityRules.join(" ")`
- Prefer a shared context under 650 characters total, leaving about 850 characters for each individual prompt.
- Avoid exact logos and copyrighted brand marks unless the user explicitly asks for them.
- If a shot would exceed 15 seconds, split it into multiple shots.
- If the user gives only a vague idea, make sensible creative choices and keep the film short.

## Image Prompt Guidance For Gemini / Nano Banana

Use `references`, `startKeyframePrompt`, and `endKeyframePrompt` as image-generation prompts. Write them like a creative director, not a keyword list.

- Start with a clear operation such as `Generate a realistic keyframe image` or `Generate a character reference image`.
- Structure each image prompt around: subject, action, location/context, composition, and style.
- Be concrete about lighting, camera angle, framing, lens feel, focus, color grade, material texture, and important props.
- Use positive framing: describe what should appear, rather than listing what should not appear.
- If text must appear in the image, quote the exact text and describe the typography, for example `"Script to Movie" in bold readable sans-serif letters`.
- For keyframe pairs, make the end keyframe a natural visual continuation of the start keyframe, while still describing it as a complete standalone image.
- Keep image prompts concise enough that the appended shared context stays under the final prompt length limit.

## Video Prompt Guidance For Kling 3.0

Use `videoPrompt` as the motion direction between the generated start and end frames. Write it like instructions for a short cinematic scene.

- Anchor the subject early using the same character/object names used in the keyframes.
- Describe the shot in time order: what the viewer sees first, how the action progresses, and what the final beat should be.
- Include explicit subject motion and camera behavior: push in, pan, track, hold steady, orbit, follow, or rack focus.
- Use cinematic language when helpful: wide shot, medium close shot, overhead shot, hero shot, practical lighting, shallow depth of field.
- For longer clips, describe a simple progression with two or three clear beats instead of one static moment.
- Preserve continuity with the start and end keyframes; the prompt should tween naturally between them, not introduce a new scene.
- Avoid overloading one shot with too many actions. Split into another shot if the motion would feel rushed or exceed 15 seconds.

## Output JSON Shape

```json
{
  "title": "Short title",
  "outputName": "kebab-case-output-name",
  "style": "global visual style shared by every generated asset",
  "character": {
    "description": "consistent character, subject, or world description",
    "continuityRules": [
      "rule 1",
      "rule 2"
    ]
  },
  "references": [
    {
      "id": "primary_character_reference",
      "prompt": "reference image prompt"
    }
  ],
  "shots": [
    {
      "id": "unique_snake_case_id",
      "title": "Shot title",
      "durationSeconds": 5,
      "caption": "short on-screen caption",
      "narration": "optional narration line",
      "startKeyframePrompt": "complete prompt for the shot's starting image",
      "endKeyframePrompt": "complete prompt for the shot's ending image",
      "videoPrompt": "motion prompt for tweening between the start and end frames"
    }
  ]
}
```

## Validation Rules

- `durationSeconds` must be between 1 and 15.
- `id` fields must be unique and filesystem-safe: lowercase letters, numbers, and underscores only.
- `outputName` must be filesystem-safe: lowercase letters, numbers, and hyphens only.
- Each final composed generation prompt must be under 1500 characters after appending `style`, `character.description`, and `continuityRules`.
- Keep `style`, `character.description`, and `continuityRules` concise. Do not repeat the full character or location description in every shot prompt.
- Prompts must not rely on the pipeline or user to infer missing visual details.
- Individual prompts should usually be 300-700 characters so the appended shared context stays within the limit.
- The JSON must be parseable without comments or trailing commas.

## Placeholder Input Users Can Replace

Use this shape when asking the LLM to create a storyboard:

```text
Create a storyboard script for:

Movie concept: [describe the movie, scene, product, life event, or visual idea]
Target runtime: [for example, 30 seconds or 90 seconds]
Visual style: [for example, warm cinematic animation, watercolor storybook, realistic documentary, stylized 3D]
Main subject or characters: [describe who or what must stay consistent]
Setting or world: [locations, time period, genre, atmosphere]
Must include: [specific beats, objects, captions, moments, or brand-safe references]
Must avoid: [logos, real likenesses, sensitive details, text artifacts, unwanted styles]
Audience or purpose: [personal keepsake, pitch video, social post, explainer, trailer]

Return only the JSON script.
```
