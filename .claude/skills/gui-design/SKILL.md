---
name: gui-design
description: Twenty researched best practices for graphical user interface design — Nielsen's usability heuristics, the UX laws (Fitts, Hick, Miller, Jakob, Gestalt), WCAG 2.2 accessibility floors, and practitioner rules on hierarchy, spacing, colour and motion. Use when designing, building, reviewing or redesigning any UI, screen, component, form or layout.
---

# GUI design: 20 best practices

Compiled from Nielsen Norman Group, W3C WCAG 2.2, the Laws of UX literature, and
working designers on X. Sources at the bottom.

Each rule states the *check* — something you can actually verify in the code or
on screen — not just the principle. When reviewing a UI, walk the checklist at
the end.

## Usability foundations (Nielsen's heuristics)

**1. Show system status.** Never leave the user guessing what the app is doing.
Every action gets visible feedback. Under ~100ms feels instant and needs
nothing; past ~1s show a spinner, progress or a disabled "working…" state.
*Check:* click every control — does something visibly change within 100ms?

**2. Speak the user's language.** Use the words of the domain, not the
implementation. "Lines left", not "unclaimed edges". No internal identifiers,
error codes or jargon in user-facing text.
*Check:* would a non-programmer understand every string on screen?

**3. Give an exit from everything.** Users trigger things by mistake. Provide a
clearly marked way out — Cancel, Back, Undo. Confirm destructive or
irreversible actions, and make Cancel the safe default.
*Check:* can the user back out of every flow without losing work unexpectedly?

**4. Be consistent (Jakob's Law).** Users spend most of their time in *other*
apps, and expect yours to behave like those. The same word means the same
thing everywhere; the same action looks the same everywhere. Follow platform
convention rather than inventing.
*Check:* does any concept have two names? Does any control have two styles?

**5. Prevent errors rather than reporting them.** Disable what can't be used,
constrain input to what's valid, confirm what can't be undone. A prevented
error beats the best error message.
*Check:* is it possible to reach an invalid state at all?

**6. Recognition over recall.** Keep options, state and instructions visible.
Don't make people remember something from a previous screen.
*Check:* does any step require remembering information not on screen?

**7. Provide shortcuts for repeat users.** Accelerators — keyboard support,
sensible defaults, repeat actions — that don't get in a beginner's way.
*Check:* can a frequent action be done without a round trip through setup?

**8. Aesthetic and minimalist design.** Every element competes with every other
for attention. Remove what is irrelevant or rarely needed; what remains gets
more weight.
*Check:* can anything be deleted without losing meaning? Delete it.

**9. Help users recover from errors.** Plain language, name the actual problem,
suggest the fix. No codes, no blame.
*Check:* does every failure message say what to do next?

**10. Help and documentation.** When help is needed, keep it concise, contextual
and in concrete steps — right where the user is stuck.
*Check:* when the app reaches a dead end, does it tell the user how to proceed?

## Structure and hierarchy

**11. Make the hierarchy glanceable.** A user should know where to look within a
split second. Establish it with size, weight, colour and position — not
borders. Rank content deliberately: primary, secondary, tertiary.
*Check:* squint at the screen — is the most important thing still the most
prominent?

**12. One primary action per view.** If everything is emphasised, nothing is. Use
one filled/accent button for the main action; make the rest secondary, ghost
or plain text.
*Check:* count the accent-coloured buttons on screen. More than one? Demote.

**13. Space on a consistent scale (8-point grid).** Use multiples of 4 or 8 for
padding, gaps and margins rather than arbitrary values. Consistent rhythm
reads as "designed" even when nothing else changes.
*Check:* do the spacing values come from a token set, or are they ad hoc?

**14. Use proximity to convey grouping (Gestalt).** Related things sit close
together; unrelated things get space. Whitespace, not dividers, is the primary
grouping tool — you don't need a border if spacing or background already
separates things.
*Check:* does spacing match the actual logical grouping?

**15. Limit simultaneous choices (Hick's + Miller's Law).** Decision time grows
with the number of options; working memory holds roughly 5–9 items. Group,
chunk, and reveal progressively instead of showing everything at once.
*Check:* does any screen present more than ~7 peer choices?

**16. Size and place targets by importance (Fitts's Law).** Time to hit a target
depends on its size and distance. Make frequent actions big and close;
deliberately make destructive ones smaller, further away, or gated behind
confirmation.
*Check:* is the most-used control the easiest to hit? Is the most dangerous one
the hardest?

## Accessibility floors (WCAG 2.2)

**17. Meet contrast minimums.** 4.5:1 for body text, 3:1 for large text (≥24px,
or ≥19px bold) and for UI component boundaries and focus indicators. Never
encode meaning in colour alone — pair it with text, shape or icon, so it
survives colour-blindness and greyscale.
*Check:* run the palette through a contrast checker; view the UI in greyscale
and confirm nothing becomes ambiguous.

**18. Give targets enough area.** WCAG 2.2 sets 24×24 CSS px as the floor;
Apple recommends 44pt and Google 48dp, and that larger figure is the real
usability target for anything touch-driven. A small visible control can carry a
larger invisible hit area.
*Check:* measure the smallest interactive element — ≥24px always, ≥44px on
touch.

**19. Support the keyboard, and show focus.** Everything actionable must be
reachable and operable by keyboard, in a logical order, with a visible focus
indicator at 3:1 contrast that isn't clipped or covered. Never remove an
outline without replacing it. Modals trap focus and close on Escape.
*Check:* unplug the mouse and complete the main flow. Can you always see where
you are?

**20. Respect motion preferences.** Honour `prefers-reduced-motion` — reduce
duration, swap movement for a fade, or drop the animation. Keep UI transitions
short (~150–300ms; never past 1s) and purposeful; nothing looping or blinking.
*Check:* does a reduced-motion media query exist, and does the UI still make
sense under it?

## Review checklist

Run this against any screen before calling it done:

- [ ] Every action gives feedback inside 100ms
- [ ] No jargon in user-facing copy
- [ ] Every flow has a visible way out; destructive actions confirm
- [ ] One name per concept, one style per control
- [ ] Invalid states are unreachable, not merely reported
- [ ] Exactly one primary action per view
- [ ] Spacing comes from a 4/8px scale
- [ ] Grouping is expressed by proximity before borders
- [ ] No more than ~7 peer choices at once
- [ ] Frequent actions large and near; destructive ones small and far
- [ ] Text contrast ≥4.5:1; UI boundaries and focus ≥3:1
- [ ] Meaning never carried by colour alone
- [ ] Interactive targets ≥24px, ≥44px for touch
- [ ] Full keyboard operation with a visible, unclipped focus ring
- [ ] Modals trap focus and close on Escape
- [ ] `prefers-reduced-motion` respected; transitions ≤300ms
- [ ] Layout holds from ~320px up without losing function

## Sources

- [NN/g — 10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [W3C WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [Deque — WCAG 2.2 updates and success criteria](https://dequeuniversity.com/resources/wcag-2.2/)
- [TestParty — WCAG 2.4.11 Focus Appearance](https://testparty.ai/blog/wcag-focus-appearance-minimum)
- [LogRocket — Accessible touch target sizes](https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/)
- [LogRocket — Essential GUI design principles](https://blog.logrocket.com/ux-design/essential-gui-design-principles/)
- [UX Design Institute — The laws of UX](https://www.uxdesigninstitute.com/blog/laws-of-ux/)
- [Toptal — The tried and true laws of UX](https://www.toptal.com/designers/ux/laws-of-ux-infographic)
- [CSS-Tricks — prefers-reduced-motion](https://css-tricks.com/almanac/rules/m/media/prefers-reduced-motion/)
- [IBM Design — Accessible motion](https://medium.com/design-ibm/accessible-motion-why-its-essential-and-how-to-do-it-right-ff38afcbc7a9)
- X/practitioner threads: [Adham Dannaway — 16 UI rules](https://x.com/AdhamDannaway/status/1635652394951254017),
  [Victor — don't overuse primary buttons](https://x.com/vponamariov/status/1439900748364517381),
  [Victor — primary action placement](https://x.com/vponamariov/status/1822256722607509618),
  [UX Links — 8-point grid spacing](https://x.com/uxlinks/status/1854074418512687481)
