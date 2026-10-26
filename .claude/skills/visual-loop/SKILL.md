---
name: visual-loop
description: >-
  Show design options rendered on the real thing, read every screenshot before the
  user sees it, and loop until they pick. Use for visual changes, and when the user asks
  for options, says a design looks wrong, or wants to check something.
---

# Visual loop

**The rule:** nobody picks a design from a description. Render the options on the real
thing, look at every image yourself first, then show them. Build only what was picked,
and look again at the build.

## 1. Options on the real thing, not mockups

- Inject each option into the real built page or artifact: a stylesheet and, where
  needed, a few lines of script scoped by an attribute (`html[data-opt="b"] ...`). The
  user judges the actual content, fonts, data and neighbors, not a drawing of them.
- Use the real words. A footer judged on placeholder text fails once the real line
  arrives. When the user says what the content usually is, rebuild the options with it.
- Three to five options that differ in kind, plus "Now" as the first, for reference.

## 2. Sheets people can read

- **Crop to the region at 1:1.** A detail shrunk inside a full screenshot is unreadable.
  Crop the part that changes (a footer, a toolbar, a card) at full resolution, and put
  one full view beside it for context.
- **Every state that matters, side by side:** both themes or grounds, a screen with the
  element and one without, the screen sizes the work targets.
- One labeled sheet per option, plus one combined sheet. Label each cell with what it
  is ("dark, with a footer"); a sheet without labels makes the user decode it.
- Compose with what is installed (a headless browser page of `<img>` tags, or PIL).

## 3. Read every image before showing it

Open each sheet and look for what is wrong before the user does: text touching a logo,
two things overlapping, an element at a different height on two screens, a color that
disappears on the other theme, a crop that cuts the point off. Fix and reshoot. Bugs in
the current design that the sheet exposes are findings too: fix them in every option,
and say so in one line.

## 4. Let them check it themselves

When the user wants to check, give a **live preview** rather than more stills: the real
page with all options injected and a small floating switcher (buttons for each option,
a link to the other theme, a key to hide the switcher). Open it for them. Stills still
go with it, for a phone or a quick look.

## 5. When they reject it

"Ugly" or "redundant" means the frame is wrong, not the details. Do not send variants of
the rejected option. Ask what is repeated or unclear on the screen (the same brand three
times, two marks doing one job) and make options that remove it in different ways.
Keep the next round small and different in kind. When every option in a round is
rejected, look for the premise they share (a framed photo beside the title, say): options
that share a premise are one option. Name it, and vary that.

## 6. Build the pick, then look again

- Build the chosen option in the real code, on a branch.
- Shoot the real build on every state from step 2 and read it. The mock and the build
  differ more often than expected.
- Show the user the build, then open the PR. Record what was rejected and why where the
  project keeps its review log.

## 7. Briefing an agent to run the loop

Agents skip the looking unless the brief makes it the job. Write into the brief:

- the states to shoot (themes, screen sizes, with and without the element);
- the exact things to check ("the page number at bottom right reads on both themes",
  "no headline sits over the busiest part of the background");
- "make a contact sheet, Read it yourself, fix and reshoot until it reads";
- the path of the sheet in the report.

Then review the sheet, not the diff. One glance at a good contact sheet replaces a
round of back and forth.

## Gotchas

- **Settle before shooting.** Animated or eased content must be at rest: call the page's
  own finish or still hook, wait for images to decode, then shoot. A shot on a timer is
  a picture of a transition.
- **Stills cannot verify motion.** A tool that disables transitions or freezes on a settled
  frame hides what a motion fix changed. Record frames across the real navigation (every 80 to
  160 ms on a frozen clock, press to 2.4 s after) and read them, before and after the fix. Cover
  forward, back to the start, a press mid-transition, reduced motion and a cut between two light
  positions, and keep a test that fails on the broken version.
- **Git Bash rewrites URL paths.** An argument like `/t/page/` becomes `T:/page/`; set
  `MSYS_NO_PATHCONV=1` for commands that take one.
- **A file open in a viewer can be locked** on Windows; a screenshot write fails with
  `UNKNOWN`. Retry after a moment, or write to a new name.
