---
name: h3-compact-motion-transfer
description: Write concise MiniMax H3 Ref2VA prompts for transferring a supplied video's action, cuts and camera to replacement subjects. Optionally replace the setting and generate requested audio. Use for video-based motion transfer, not first-frame I2V.
---

# H3 Compact Motion Transfer

Turn a source video plus reference images into the short six-section Ref2VA prompt used by an action-transfer workflow. This skill writes the prompt; it does not generate or verify the rendered video.

## Intake: get the mapping before writing anything

A task usually arrives as a video plus one or more reference images, with no mapping attached. The reference-image order and the subject-to-picture assignment belong to the operator, and nothing in the prompt can choose or correct them, so the mapping is the one input this skill must never assume. Load this skill naturally: take the attachments, do the mechanical work, and then ask for the mapping in the same message that makes answering it easy.

1. Take the delivered video's absolute path and each reference image, and sample the clip fresh.
2. Identify the source performers well enough to name them for a human: their visible role, their screen position, and where each one appears. Keep this description as short as a cast list and grounded in the frames actually reviewed.
3. Build and post the process mosaic for the whole clip, because the operator recognizes the people in it faster than in prose.
4. Ask for the mapping in one short question, naming each source performer by its role or position and offering the reference images by position: for example, “Picture 1 is the pink-haired subject and Picture 2 the black-haired one — which of them replaces the man who handles the revolver, and which replaces the man in the leather jacket?” State the source performers and the picture order, and ask which goes with which.
5. Confirm the mapping back in one line before drafting, and keep it fixed for every later segment of the same source. If the operator has already stated it — as an ordering, a filename, or a sentence — restate it as the confirmation instead of asking again, and only ask when a genuinely ambiguous correspondence remains.
6. Do not draft a prompt or a segment for a subject whose mapping is still unknown, and do not proceed on an inferred mapping the operator has not confirmed. A wrong mapping produces a fully rendered clip with the two subjects swapped, which costs a whole generation to discover.

Record the confirmed mapping at the top of the delivered prompt file, outside the prompt text, as a comment together with the source file, its hash, the measured duration and the shot list, so the pairing survives without the conversation.

## Mandatory complete visual review

**Do not write the prompt until the entire source clip has been visually inspected clearly from its first frame to its last.** Real-time playback is optional. A sequential frame review is acceptable if it covers the complete timeline at enough temporal detail to resolve every shot, brief insert, occlusion, subject handoff, and ending. Use denser frames around rapid action and suspected cuts. A sparse contact sheet, a few isolated frames, scene-detection score, transcript, or file metadata alone is insufficient.

Before drafting, make a chronological internal shot/interval record with no unreviewed gap: what the camera shows, which source subject is present, where the actual cuts occur, and how the clip ends. Check each interval against the visual evidence. In `detailed_description`, cover every verified shot or coherent continuous group, including the latter part of the clip and short inserts. Do not replace unreviewed or omitted intervals with a generic phrase such as “the camera changes angle” or “continue the source action.” Keep the prose concise by grouping only footage that was actually reviewed and belongs together.

If any interval cannot be viewed clearly or verified, **stop before producing a clip-specific prompt**. State exactly which interval or visual access is missing and request a usable source. Do not claim to have reviewed the whole video or invent the missing shots.

### Verify every suspicious cut at native frame density

A cut thinner than the review step falls between two reviewed frames and silently merges two shots into one. Whenever a cut is suspected at a sampled frame boundary, or two adjacent reviewed frames disagree about framing, subject, distance or camera angle, extract the native-rate frames across that boundary before deciding. Corroborate with the container's keyframe positions and scene-difference peaks, and note that encoder keyframes may also fall on ordinary frames. Fixed-interval or sparse sampling never establishes a cut count on its own: reviewing at a coarse step and treating the result as verified is the error this rule exists to prevent, because a missed cut produces a wrong shot count and misassigns every action afterwards.

### Extract fresh on every run — never reuse a previous extraction

Every run samples the source clip again from the source itself. Delete the working directory and recreate it before extracting; never read frames, contact sheets, frame indexes or any other extracted artifact left by an earlier run, even when the same clip is resubmitted and the files look identical, and even when the previous run in this same conversation produced them. Reuse is how a stale or mismatched frame set silently becomes the evidence a prompt is built on — a renamed file, a re-cut segment, a different reference image paired with the wrong clip — and every artifact here is disposable derived data, never an input. Treat a prior run's directory as if it did not exist, and re-derive the duration, the cut count and every timestamp as well.

### Build the process mosaic, save it locally, and return it to the chat

Every run produces one process mosaic: the whole-clip overview sheet whose cells each carry a frame index, an in-frame timestamp and the shot they belong to, with every cut cell boxed and labelled with its measured time, plus one native-rate boundary sheet per cut showing the frames immediately before and after it. The mosaic is the artifact a human checks, so a wrong shot count or a wrong action assignment is visible to them without re-running anything.

Save the mosaic under the working directory in the session workspace, keep a `frame-index.txt` mapping every frame index to its source time and a manifest recording the source path, the measured source frame rate and duration, the review step, and the shot list, and post the overview sheet into the chat window in the same message that states the shot count and cut times. Attach it as the primary image with the boundary sheets named and their local paths given, so the human can verify the cuts frame by frame. A mosaic is never a substitute for the review above — it is its published evidence.

## Source and reference roles

- Verify the clip duration and actual shot boundaries against the complete visual review; inspect adjacent frames where needed to refine uncertain cut times. Track each relevant source subject across cuts, occlusion and changes of screen position.
- Use the user's mapping of source subject to target reference. If missing, infer it only when the visual evidence is clear; otherwise ask for the ambiguous correspondence. A temporary prop, weapon or left/right position is not enough by itself to identify a subject.
- Character reference images define the requested target's appearance and identity; scene reference images, when explicitly assigned, define the requested setting. The source video defines the requested motion, interactions, camera, editing and timing. Treat a character-sheet background, pose and labels as reference-sheet content unless the user explicitly assigns another role to them.
- The number of pictures, target subjects, source people and shots is **not fixed**. One target may use several pictures; one picture may define several targets. Replace only what the user specifies.

### Re-establish identity at every cut

Most of the source's pixels belong to the source performers, so the model drifts back toward them at every cut and again at the end of a long continuous shot; a random seed changes which run drifts. Give each replacement subject's visible identity again at the start of each shot in which it appears, after the cut and before the action: name the subject and repeat two or three of its own readable features, such as its hair colour and shape, its ear or head detail, and one garment colour. State the action after that anchor, never before it.

Keep the appearance list in `subject_definitions`; the per-shot anchor is a reminder of the winning identity, not a second description of the source. Where one shot's framing is the hardest for the model, such as an extreme close view or a shot that follows the source performer's face, one short contrast is allowed — the close view shows the replacement subject, not the source performer — and it counts as the minimum exclusion rather than a repeated description.

### Give every subject its whole part once, in its definition

A cut is not the only place identity is lost: a subject that appears once, small, distant or partly hidden is dropped just as easily, because the prompt never told the model that body was that subject and the model leaves the source performer in it. Before drafting, trace each source person through the whole clip and write that entire part into the subject's own definition: every position it occupies, every action it performs, and how it exits, including a distant final appearance, a body seen only from behind, or a figure inside smoke or debris. Then let `retention_analysis` list the same shots for that subject, so the mapping and the shot list agree.

The reverse failure is the same error: a subject left unnamed in a shot reverts to the source performer. If a shot shows a body and the draft does not say whose it is, the draft is incomplete, however short or vague that shot is — a sub-second cut, a body at the back of a wide shot, or a figure thrown across the room all need the same one-clause identity as a close-up does. Prefer the subject's own `<Subject N>` plus its readable feature over a phrase such as “the source figure,” which names the source and licenses its pixels.

## Prop ownership across a replacement

A prop's owner is part of the transferred performance, not of the replacement appearance. A weapon, tool or held object keeps the hand it occupied in the source: the replacement subject standing in that hand's source body keeps it, and every other replacement subject keeps empty hands, whether the prop is small, prominent, or pushed into the foreground beside them. Foreground proximity is not ownership — a shot composed over someone's shoulder shows the holder's prop in front of a different person, and that framing is the most common way a prop migrates to the wrong character.

State ownership affirmatively and separately for each side, and never place the other subject and the prop in the same instruction. Give the holder one positive sentence naming the object and the continuity of its hand, and give the non-holder one positive sentence describing what those hands are doing instead, such as resting at the sides, hanging relaxed, staying at waist height, or gesturing. Write the whole prompt without negation, because a prohibition has to name the object it forbids and that mention licenses the object it was meant to prevent; keep ownership out of `subject_definitions` and `retention_analysis` except as a short clause, and let `detailed_description` carry the per-shot statement.

When the user reports that a character who never held the prop is holding it, treat it as a prompt defect before an input defect, but check both: verify the source prop's owner and hand in the native-rate frames, then confirm the negative case — that no frame shows the other character grasping it — and rewrite ownership as two affirmative sentences before changing any seed or input.

## Incidental overlays in the source

During the full visual review, distinguish intentional scene content (such as a title, sign, or effect that belongs to the edit) from incidental overlays: creator watermarks, platform logos, AI-generated labels, player controls, progress bars, recording borders, and UI. The latter are source-video noise by default, even when they are legible or persist across the entire clip. Never define them as subjects or include them in the retained setting, graphics, or `fully_preserved` attributes. Preserve intentional on-screen text in its original language unless the user requests a text-free result; retain incidental overlays only if the user explicitly requests them.

In model-facing text, describe a clean target frame and the intended content. Avoid repeating the names, words, or visual shapes of unwanted overlays. Write one short affirmative editing instruction for them in the setup line of `detailed_description` and nothing anywhere else — never in `subject_definitions`, `summary` or `retention_analysis`, and never a second time per shot. A described unwanted overlay is reproduced rather than removed.

Word that instruction as the property of the target frame rather than as an order to delete something, because the model executes a described result better than a removal verb: write that the target frame is clean and carries no creator or platform text or graphics, or that the output video shows no such overlay in any frame. Keep it to one sentence and never name, quote, locate or describe what is being left out — naming it feeds it back into the conditioning.

Overlay removal is probabilistic, not deterministic, and the retention pressure of the reference video works against it at every sampling step and again during any latent upscale pass. When the user wants it handled in the prompt rather than in the input, state that the wording raises the odds instead of guaranteeing the result, and give them the honest escalation: if the mark survives a couple of seeds with the instruction present, the reliable fix is an input-side one, such as a cleaned or masked reference clip or re-exporting without the burn-in. The `boxblur`-over-a-fixed-box and crop treatments are both acceptable input-side fixes; crop costs composition, blur keeps it.

## Optional setting and audio

- **Default:** Keep the source video's setting and lighting; generate no audio. Character-sheet backgrounds do not change the setting. Keep the six-section format, with `overall_soundscape: N/A.` and `non_diegetic_music: N/A.` when audio is not requested.
- **Setting replacement with image reference:** When the user requests a new setting and supplies scene image(s), assign their actual `<Picture N>` labels to the new environment, architecture, lighting and atmosphere. Assign `<Video 1>` to the complete action, interactions, timing, cuts, framing and camera motion. Describe the target characters performing that sequence in the new setting. The new scene images are setting references, not first frames.
- **Setting replacement from text:** When the user requests a new setting without a scene image, define it from the user's description in `subject_definitions` and carry it consistently through `summary`, `retention_analysis` and `detailed_description`. Do not invent a particular location when the request leaves it unspecified; ask for the intended setting if needed.
- **Audio on request only:** If the user asks for generated audio, write `overall_soundscape` for requested or visually supported effects, ambience and dialogue, synchronized to the target scene. Write `non_diegetic_music` only when music is requested; otherwise use `N/A.` Do not assume the source soundtrack is transferred when its audio is absent. An audio task type belongs in `summary` only when an actual audio reference or signal is reused, not merely because sound is described in text. The workflow must have its audio-generation and decoding path enabled for these fields to produce audible output.

## Positive model-facing wording

Write the H3 prompt as a description of the frames to generate. Name the target subjects, their reference images, their source performance roles, and the scene/camera/action to carry forward. Prefer affirmative instructions such as “Tifa remains the spear performer in every shot” and “the final frame shows the ongoing exchange.” Do not repeatedly describe the unwanted source faces, costumes, watermarks, or invented outcomes, even inside negative phrases; these words can contaminate the generated video. Use only the minimum exclusion needed to resolve a real ambiguity, and express it as a positive target whenever possible. Apply this rule to all six prompt sections, including `retention_analysis` and `detailed_description`. The example prompts are format references, not wording to copy.

## Prompt shape

Write the prompt in English unless the user requests another language. Preserve verified spoken words and intentional on-screen text in their source language; apply the incidental-overlay rule above before deciding which text belongs in the target. Use exactly these sections, in this order:

1. `subject_definitions:` — define each target subject, its actual source counterpart and `<Picture N>` references; define the retained source setting or requested new setting (and its scene-image references when provided), plus any source-performance subject needed for this edit; define `<Video 1>` with measured duration.
2. `summary:` — begin with `[video editing + reference generation] The target video is an edited version of <Video 1>.` State the requested subject and setting choices plus the video attributes carried over. Add an audio task type only if the audio signal is actually reused or referenced.
3. `retention_analysis:` — give one concise line per defined reference item. Use `fully_preserved` for target appearance and the selected setting, whether retained or newly specified; `attribute_transfer` for motion/camera attributes; and `partially_preserved` for the edited source video. For a setting swap, transfer the source video's performance and camera attributes while the target environment comes from its scene reference or description.
4. `detailed_description:` — short setup carrying the single overlay instruction from “Incidental overlays in the source,” then one or two sentences per verified shot or coherent shot group. Within each shot, re-establish the appearing subject's identity first and state the action after it, per “Re-establish identity at every cut.” Anchor who appears, what the source camera shows, and where the action takes place in the selected setting. Let the source video supply the choreography. Include local cut times only when verified. Preserve the exact duration and end state; invent no move, contact, dialogue, prop ownership, camera change or outcome.
5. `overall_soundscape:` — `N/A.` by default; when generated audio is requested, describe only requested or visually supported sound in the target scene.
6. `non_diegetic_music:` — describe requested music; otherwise `N/A.`

Keep the density close to the two successful examples: [nonhuman courtyard fight](references/example-hero-fight.txt) and [live-action office replacement](references/example-office-action.txt). **They illustrate format and length, not default characters, weapons, scene, style, shot count or wording.** Read them when applying this skill, then adapt every content field to the new assets. Avoid turning either example into a fill-in-the-blanks form.

## Working procedure

This skill ships two tools in `tools/` under the skill's base directory reported when it loads. Run them with a Node executable; both delete their output directory before writing, which enforces the fresh-extraction rule.

0. `tools/lib/resolve-bin.mjs` finds ffmpeg and ffprobe for this machine, in this order: `--ffmpeg`/`--ffprobe`, `DSH_FFMPEG`/`DSH_FFPROBE` (or `FFMPEG_PATH`/`FFPROBE_PATH`), `tools/ffmpeg-path.json`, the plugin's `tools/vendor/bin/<platform>-<arch>/`, the npm packages `@ffmpeg-installer/ffmpeg` + `ffmpeg-static` (and the ffprobe equivalents), then PATH and well-known install locations. Nothing found is never a dead end: run

   `node <base>/tools/prefetch-ffmpeg.mjs`

   to fetch both binaries into `tools/vendor/bin/<platform>-<arch>/` (tries a mirror, gyan.dev, BtbN nightly builds, then npm; honours `HTTPS_PROXY`; never fails an install). `node <base>/tools/check.mjs` then reports the resolved paths and sources in one screen, and `node <base>/tools/frames.mjs --doctor` additionally reports the `drawtext` font in use and whether the build has the `drawtext`, `tile`, `fps`, `scale` and `select` filters the sheets need.

1. `tools/frames.mjs` — sample the clip, index every frame, build the contact sheets, and optionally render a motion preview. Give it the absolute path of the video delivered for this task, never a path left over from an earlier run.

   `node <base>/tools/frames.mjs --video <absolute mp4> --out <absolute dir> --fps 8 --scale 448 --cols 4 --rows 3 --motion 16`

   Start at 8 frames per second for a clip of roughly five to ten seconds and keep roughly forty to eighty sampled frames: dense enough to resolve brief inserts and occlusion, small enough to read. Scale the review step so the sampled count lands in that range. Raise the density only across rapid action and suspected cuts, not across the whole clip. For a longer clip, lower `--fps` until the sampled count lands in that range, and cover the clip in one pass before raising density anywhere.

   The tool refuses to write into a non-empty `--out` folder, because a batch that reuses one folder for clips sharing a BaseName (for example `01_full.mp4` and `01_clean.mp4`) would silently keep only the last clip. Pass `--force` when replacing that folder is genuinely intended. It also reports `lastSampledTimestamp` and `coverageComplete`, so a tail frame that falls outside the clip is visible instead of assumed.

2. `tools/verify-sheets.mjs` — build the process mosaic: the whole-clip overview with shot labels and boxed cut cells, plus one native-rate boundary sheet per cut.

   `node <base>/tools/verify-sheets.mjs --video <absolute mp4> --out <dir>/verify --shot 0-1.750:SHOT1 --shot 1.750-2.750:SHOT2 --shot 2.750-5.501:SHOT3 --fps 24 --boundary 0.35 --scale 640`

   Pass one `--shot <start>-<end>:<label>` per verified shot, in order, using the cut times the native-rate check confirmed. If a boundary sheet shows a shot change where none was declared, or shows continuous footage where a cut was declared, correct the shot list and rerun both tools before drafting. The manifest records `shot_count`, `boundary_sheets` and `cut_times`; a continuous clip passes a single `--shot` and produces `boundary_sheets: 0` with only the overview and shot-start sheets, which is the expected result and not a failure.

   Add `--overviewFps <n>` when the clip is shorter than roughly five seconds, where the default overview step packs more cells than the grid holds; four or five frames per second suits a four-to-five-second clip. For longer clips the step is chosen so the sheet stays inside its 4x6 grid.

   To test a suspected cut that the sampled review could not settle, rerun this tool with two throwaway shots meeting at that candidate time, for example `--shot 0-1.667:CUSP --shot 1.667-4.179:TAIL`. Its boundary sheet then holds native-rate frames on both sides of the candidate, which is the evidence needed to decide whether a cut is real. Keep the same candidates out of the delivered shot list until they are confirmed.

3. Reading cut candidates before step 2 — the tools do not detect cuts, so get candidates from the container with a scene-score pass and confirm each one at native rate in step 2:

   `ffmpeg -hide_banner -nostats -i <mp4> -vf "select='gt(scene\,0.12)',metadata=print:file=-" -an -f null -`

   A hard cut sits at a scene-score peak of roughly 0.3 and above; motion, blur and flashes also score, so every candidate is a question for the boundary sheet, not a confirmed cut. A clip that returns no candidate at 0.12 is continuous, which is the evidence for a single `--shot` in step 2.

### Troubleshooting the tools

- **`exit code 3221225794` / `0xC0000142` on every command, including `cmd /c echo`**: Windows failed to create the process, so no tool can run. This is a host or session fault, not a prompt or skill defect. Restart the DSH process (close every window, not just the stuck one) and retry; shell commands recover, nothing needs reinstalling.
- **`ffmpeg` or `ffprobe` not found**: run `node <base>/tools/prefetch-ffmpeg.mjs` first — it installs both into `tools/vendor/bin/<platform>-<arch>/` with no admin rights and no PATH edit. If that cannot reach the network, set `DSH_FFMPEG` and `DSH_FFPROBE`, or drop the executables into the same vendor directory.
- **`drawtext` missing**: a reduced ffmpeg build fails on or silently drops the timestamp stamps. Install a full build or point `DSH_FFMPEG` at one; `--doctor` reports this before any extraction runs, and the tools fall back to ffmpeg's built-in default font when no platform font file is present.
- **A folder that suddenly holds another clip's frames**: the collision guard was bypassed with `--force`, or a batch reused one `--out` for files sharing a BaseName. Give each source clip its own folder.


## Before delivering a prompt

Check the draft against every rule above before sending it; each item below is a failure this skill has already produced once.

- The mapping was stated by the operator and confirmed back, and every `<Picture N>` label matches the operator's declared picture order.
- The shot count and every cut time come from native-rate evidence, not from the sampled step, and the shot list covers the whole clip with no unverified interval.
- Every subject that appears anywhere — including a sub-second shot, a distant body, a backward view, or a figure inside smoke — is named by `<Subject N>` with one readable feature, and no shot describes a body as “the source figure.”
- Each subject's whole part is written once in its own definition: every position, every action, and how it exits.
- Every prop has one affirmative owner statement, no sentence pairs the non-holder with the prop, and no ownership claim is phrased as a negation.
- Every shot that opens at a cut re-establishes the appearing subject's identity before its action.
- The overlay instruction appears once in the `detailed_description` setup line and nowhere else, and no section names what is being left out.
- `overall_soundscape` and `non_diegetic_music` are `N/A.` unless audio was requested, and the setting is the retained one unless a swap was requested.
- `detailed_description` sits near the reference examples' density: about 150 to 250 words, with one or two sentences per shot.

## Closing rules

If the video is split, use real source cut boundaries and produce a separate prompt and measured duration for each delivered clip. In the response, explain the mapping briefly in the user's language and state the duration. If a generation keeps the source actor despite a correct prompt, verify inputs and mapping, then try another seed before adding more instructions; seed variation alone can change the result.
