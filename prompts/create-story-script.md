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

1. Generate optional global reference images, such as characters, props, or style anchors.
2. Generate optional shot-scoped background scene reference images.
3. Generate each shot's start keyframe using global references plus the shot's listed `referenceIds`.
4. Generate each shot's end keyframe using those same references plus the generated start keyframe image as an additional reference.
5. Use those generated keyframe image IDs as Kling start/end frames.
6. Assemble all downloaded clips in shot order.

Do not include markdown. Return only valid JSON matching the schema below.

## Storyboard Guidance

- Define the main subject, characters, setting, mood, visual style, and intended runtime.
- Keep character, object, location, and style continuity consistent across all shots.
- Use recurring visual motifs where useful.
- Create reusable `references` for important characters, props, and background scenes before the shots.
- Give each reference a `kind`: `"character"`, `"prop"`, `"background"`, or `"style"`.
- Mark character/style references as `"scope": "global"` when they should guide every keyframe.
- Mark background and prop references as `"scope": "shot"` when they should guide only shots that list them in `referenceIds`.
- Use prop references for major props that must stay consistent between keyframes or across shots, such as hero products, machines, vehicles, signs, weapons, instruments, or distinctive tools.
- If a keyframe shows a specific reusable prop, include that prop's reference `id` in the shot `referenceIds` so generation is grounded by the prop reference image.
- Keep each shot within one background scene reference by default. Use multiple background references for one shot only when the shot clearly transitions between locations or setups, and explain that transition explicitly in `videoPrompt`.
- Group consecutive shots by set when possible. Stay in the same background scene for related story beats before moving to a new set.
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
- Reference prompts must be self-contained. Do not refer to other references, reference ids, or phrases like "same as the character reference"; rely on the shared style context for matching.
- For background scene references, generate clean establishing images of the environment without the main action. Include stable layout, lighting, major props, and camera perspective.
- For prop references, generate clean isolated or tabletop images of the prop with stable shape, material, color, labels, and scale. Avoid adding unrelated characters or action.
- For start/end keyframes, mention which referenced background scene they should follow by name in natural language, and include the matching reference id in `referenceIds`.
- For shots where a major prop is central, include the prop reference id in `referenceIds` and mention the prop by the same name in the start/end prompts.
- If a shot includes any prop `referenceIds`, both `startKeyframePrompt` and `endKeyframePrompt` should explicitly mention those same props unless the `videoPrompt` describes a deliberate prop removal, handoff, or destruction.
- For start/end keyframes in the same shot, stay in the same referenced background unless the video prompt describes a visible transition from one background to another.
- Write `endKeyframePrompt` as a continuation of the start frame when possible. Describe the end frame as specific changes from the starting scene, while still making it understandable as a standalone image.
- The generated start keyframe image will be passed as an image reference for the end keyframe generation, so preserve the same camera angle, background layout, character identity, and props unless the shot intentionally changes them.
- Prefer match cuts between `startKeyframePrompt` and `endKeyframePrompt`: same camera angle, same set geography, same main props, with only the story change advanced.
- Use insert shots for detail-heavy beats such as readable text, hands, cards, machines, screens, or important props.
- For keyframe pairs, make the end keyframe a natural visual continuation of the start keyframe, while still describing it as a complete standalone image.
- Keep image prompts concise enough that the appended shared context stays under the final prompt length limit.

## Video Prompt Guidance For Kling 3.0

Use `videoPrompt` as the motion direction between the generated start and end frames. Write it like instructions for a short cinematic scene.

- Anchor the subject early using the same character/object names used in the keyframes.
- Describe the shot in time order: what the viewer sees first, how the action progresses, and what the final beat should be.
- Include explicit subject motion and camera behavior: push in, pan, track, hold steady, orbit, follow, or rack focus.
- Avoid unnecessary camera moves. Prefer locked-off shots, gentle push-ins, or simple insert shots unless the movement is needed to explain the action.
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
      "kind": "character",
      "scope": "global",
      "prompt": "reference image prompt"
    },
    {
      "id": "studio_background_reference",
      "kind": "background",
      "scope": "shot",
      "prompt": "background scene reference prompt"
    },
    {
      "id": "hero_prop_reference",
      "kind": "prop",
      "scope": "shot",
      "prompt": "prop reference prompt"
    }
  ],
  "shots": [
    {
      "id": "unique_snake_case_id",
      "title": "Shot title",
      "durationSeconds": 5,
      "caption": "short on-screen caption",
      "narration": "optional narration line",
      "referenceIds": ["studio_background_reference", "hero_prop_reference"],
      "startKeyframePrompt": "complete prompt for the shot's starting image",
      "endKeyframePrompt": "complete prompt for the shot's ending image",
      "videoPrompt": "motion prompt for tweening between the start and end frames"
    }
  ]
}
```

## Validation Rules

- `durationSeconds` must be between 1 and 15.
- `id` fields for shots and references must be unique and filesystem-safe: lowercase letters, numbers, and underscores only.
- `outputName` must be filesystem-safe: lowercase letters, numbers, and hyphens only.
- Reference `scope` must be `"global"` or `"shot"` when present. Omit it only for older global references.
- Reference `kind` must be `"character"`, `"prop"`, `"background"`, or `"style"` when present.
- Every `referenceIds` entry on a shot must match an existing reference `id`.
- Use `referenceIds` for shot-scoped background and prop references. Do not attach every shot-scoped reference to every shot.
- A shot should usually list at most one background reference. It may also list one or more prop references when those props are central to the shot.
- If a start or end keyframe prompt includes a reusable named prop, that shot must include the matching prop reference `id` in `referenceIds`.
- If a shot includes a prop reference `id`, both keyframe prompts must mention that prop name unless intentional removal/transition is explicitly described in `videoPrompt`.
- If a shot lists more than one background reference, `videoPrompt` must describe the transition between those backgrounds.
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
