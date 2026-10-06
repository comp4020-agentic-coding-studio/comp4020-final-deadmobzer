# Process overview

<!-- SCAFFOLD (not the template comment check:evidence looks for): this is a
     skeleton for you to fill in your own voice. The brief wants ~900–1100 words
     at submission, rewritten (not appended) at each crit. An agent-written
     account marks down — the prompts below are to jog your memory, not to quote.
     Cite commits as links whose text is the short hash: put the hash in the
     link text and the commit URL as the target (check:evidence verifies each
     one exists in this repo). -->

## From the brief to a thesis

[What made you land on a private, once-a-day reflection diary rather than the
median "chat room with the nouns swapped"? What did reading about the small web /
calm software do to the idea? Link the commit where the README's first definition
of good appeared.]

## The stack, and why

[Why Node + a single WebSocket server + SQLite on one small machine with one
volume. What you traded away (no separate DB service, no SPA/build, server-rendered
HTML) and what that bought (fits 256 MB, boots from an empty volume, easy to reason
about). An ADR under `docs/` is a good place for the long version; link it. Why
these fit *this* app rather than being defaults.]

## The agentic workflow

[How you directed, grounded, and corrected the agent. What lived in `CLAUDE.md`
as a standing rule, what you pushed into `spec/` as a sensor, and a concrete
moment the agent got something wrong and the fix landed in the harness rather than
a retry. (Example from this repo's history: the daily-task insert dropped the
`day` column so prompts were keyed by user id; caught by inspecting the DB, then
fixed — link the fixing commit and consider the `spec/` check that would have
caught it sooner.)]

## What the checks protect

[Which promises you chose to enforce (privacy, the seal, real-time) and why those
and not others. Which parts of "good" you left to judgement. Link the commits
where the `spec/` checks went red, then green.]

## What's next

[What you'd do before the deadline: README in your own voice with sources,
server-side logging (crit 10), and anything the crit surfaces.]
