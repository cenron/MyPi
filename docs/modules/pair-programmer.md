# Pair programmer

**Status:** idea; design proposed 2026-10-31 from a live pairing session and published research, not yet agreed.

## Goal

A pi mode where I write the code and the agent works as my pair: it explains, navigates the codebase, reviews, and answers questions instead of taking over the keyboard.

## Observations so far

Notes from pairing while building MyPi, to feed the design:

- Plan first. The agent proposes, I approve, and only then does anything change.
- It verifies against official docs and current versions instead of answering from memory.
- It reuses patterns from my earlier projects rather than inventing new conventions.
- It asks when a choice is mine, and offers a recommendation with the options.
- Living docs (architecture, principles, module ideas) carry the shared context between sessions.

### Pairing with pi on a FastAPI backend (2026-10-31)

I wrote the code and asked questions; pi ran GPT-6 Luna on high thinking with every MyPi module on. Two sessions:

- **Without pairing rules**, a plain question ("check my code") got the full agentic treatment: a task, an explore
  subagent, LSP diagnostics on four files, then a review of the wrong file. I was in `main.py`; it reviewed the route
  handlers and listed syntax errors in lines I was still typing. A queued job notice also made it answer twice (fixed
  in `9f5ab7d`).
- **With a "Working with me" block in the project's `AGENTS.md`** (answer briefly, code is work in progress, no tasks or
  subagents for questions, no edits unless asked), the next 16 questions got answers of 20 to 250 words after 0 to 6
  reads each. It pushed back once with a reason when I moved the database to async, then followed my choice.
- **It still took over on a statement of intent.** "Ok now I want to build the models … the migration builds the
  tables" got three `task_create` calls, a workflow skill (`ripwire-before-you-build`), and 23 tool calls, with
  nothing said for over four minutes. The rule only covered questions. The two questions it finally asked (string or
  integer IDs; a membership table or fields on the person) were exactly a navigator's questions: the right content in
  the agentic form.
- **It doesn't know where I am.** It can't see my editor, so "check my code" is a guess, and "fixed it, check again"
  re-reads every file instead of looking at what changed.
- **`AGENTS.md` can't reach the setup.** The todo, subagent, and plan-build prompt sections and the skills list keep
  pulling toward agentic work, and the thinking level isn't something the model can change.

## Research

What the published work says, and what each finding asks of this mode:

| Source | Finding | For this mode |
|---|---|---|
| IBM Research, The Programmer's Assistant ([Ross et al., IUI 2023](https://arxiv.org/abs/2302.07080)) | Kept reactive on purpose: early users feared unsolicited criticism of unfinished work and broken flow. Over 75% of the 42 participants still wanted some proactive suggestions. | Reactive by default; proactive only when I turn it on. |
| IBM Research, persona case study ([Ross et al., 2023](https://arxiv.org/abs/2301.10016)) | The persona that worked: "eager and helpful, but humble … doesn't assign work to the user, quiz the user, or ask questions except for clarification." Tentative wording curbed the model's false authority. | A written tone in the prompt; no quizzing; questions only to clarify or to put a decision to me. |
| IBM, watsonx Code Assistant in the enterprise ([2024](https://arxiv.org/abs/2412.06603)) | Developers used it most to explain code (72%) and answer questions (69%), ahead of generating code (56%). | Explaining and answering are the core, not generating. |
| Microsoft Research, CMU, MIT, Berkeley, "Need Help?" ([Chen et al., CHI 2025](https://arxiv.org/abs/2410.04596)) | Proactive suggestions raised task completion 12–18%, but showing them more often dropped preference to 47%. What worked: nothing while typing, a suggestion after a pause, at once on an error; a one-line summary first, detail on demand. Users asked to control the frequency. | Speak at pauses and errors only, under a budget I set; lead with one line. |
| Grounded Copilot ([Barke et al., OOPSLA 2023](https://www.microsoft.com/en-us/research/publication/grounded-copilot-how-programmers-interact-with-code-generating-models/)) | Two modes: acceleration (I know what to do and want it faster) and exploration (I'm unsure and want options). People switch between them constantly. | "Why can't I import it?" gets the one fix; "create_engine or connect?" gets the options and a recommendation. |
| Microsoft, [Guidelines for Human-AI Interaction](https://www.microsoft.com/research/project/guidelines-for-human-ai-interaction/) (Amershi et al., CHI 2019) | Time services to the context; scope them when in doubt; make dismissal cheap; remember recent interactions; learn from the user's behavior. | Changed-files context, a session decisions list, and counting which remarks I take up. |
| Microsoft Research and CMU, critical thinking survey ([Lee et al., CHI 2025](https://www.microsoft.com/en-us/research/?p=1135061)); Sarkar, [AI Should Challenge, Not Obey](https://cacm.acm.org/opinion/ai-should-challenge-not-obey) (CACM 2024) | More confidence in the AI goes with less critical thinking. The AI should surface risks, shortcomings, and alternatives rather than comply. | Push back once, with the reason, when a choice has a cost; then follow my decision. |
| CodeAid ([Kazemitabaar et al., CHI 2024](https://arxiv.org/abs/2401.11314)); Claude Code's [Learning style](https://code.claude.com/docs/en/output-styles) | Learning tools hold back finished code: pseudo-code, notes on the learner's own code, or a `TODO(human)` spot to write with what to weigh. | An optional "hints first" setting; "show me" still gets code. |
| GitHub Copilot's [Ask mode](https://github.blog/ai-and-ml/github-copilot/copilot-ask-edit-and-agent-modes-what-they-do-and-when-to-use-them/) | The industry settled on a separate mode that answers without touching the code. | A mode, not instructions in a project file. |

## Inspiration

[pairing-buddy](../inspiration/pairing-buddy.md) (read 2026-10-27) is the closest design so far, built on the same pi
packages and at home in herdr. The ideas worth designing here: roles as modes with each role's tools enforced by a
rule (Navigator: no edits; Scout: read-only commands and approved checks; Driver: edits only on hand-over); speaking
rarely, scored first and held until the user pauses; triggers read from the user's herdr panes (a failed command in
another pane, the same error twice, editing a file the red test doesn't name); a written, tested tone; the session's
goal from the branch and a note at its end. What doesn't carry over is its Neovim plugin: MyPi can't draw under the
user's cursor.

## Proposed design

### The mode

- **`/pair` switches it on and off**, a mode like plan-build's Plan and Build, shown in the footer. On exit, everything
  it changed goes back: tools, prompt sections, thinking level.
- **Roles, enforced by a rule** on the `ToolGuard`, not by the prompt:
  - **Navigator** (the default): read, search, LSP, and web tools. No `edit`, `write`, todo, or subagent tools, and
    bash limited to read-only commands. The prompt explains the role; the rule enforces it.
  - **Driver**, only when I hand over one change ("go ahead and write it"): edits allowed for that change, then back to
    Navigator.
- **The prompt changes with the mode.** `PromptManager.apply` already writes into the run's whole section map (pi's
  `skills` and `tools`, every `mypi-*` section), so the mode can drop the todo, subagent, and plan-build sections and
  workflow skills, and add its own section. A spike checks that dropping pi's sections is safe.
- **Thinking goes to low or medium** through `pi.setThinkingLevel`, as plan-build does, and back on exit.

### How it talks

- **The answer first**, in one to three sentences. No recap of what it read. More on request, or an offer of more.
- **Acceleration or exploration.** "Why is this broken?" gets the one fix. "How should I…?" or "What's the difference?"
  gets the options and a recommendation.
- **A statement of intent means I'm driving.** "I want to…", "Now I'll…", "I need to…" get the one to three decisions I
  face, each with a recommendation, and my first step. No tasks, no plan, no long exploration first.
- **Code is work in progress.** A review names the most important issue and offers the rest. Lines I'm still typing
  aren't errors.
- **Challenge once, then follow.** When a choice has a cost, say it once with the reason; after I decide, work with my
  decision.
- **A written tone**, kept in the prompt section and tested: humble and direct, fact first, `file:line`, no quizzing,
  no praise or filler, questions only to clarify or to put a decision to me.

### Knowing where I am

- **Changed files each turn.** Before each run, the mode adds the files I changed since its last turn (from
  `git diff --stat` and file times) to the prompt. "Check my code" means those files; "check again" means the diff
  since its last look, not a re-read of everything.
- **A session decisions list.** Decisions I make while pairing ("the database is async", "no repositories yet",
  "string IDs") go into a short list the prompt carries, so the pair doesn't contradict them. The
  [memory](memory.md) module can keep the lasting ones.

### Later

- **Proactive remarks, opt-in.** Off by default; when on, only at a pause (a run ended, a command finished in a herdr
  pane, a quiet stretch) or on an error, within a budget I set. Triggers from pairing-buddy.
- **Hints first**, a setting: pseudo-code, the API to look at, or a `TODO(human)` spot with what to weigh, instead of
  finished code.
- **Measured with [analytics](analytics.md).** Per answer: tool calls, words, seconds to the first word, and how often
  I had to correct it ("no, I'm in `main.py`"). Tasks and subagents in Navigator should be zero by rule.

## Milestones

1. **The mode.** `/pair`, the Navigator rule, the prompt swap, the thinking level, the tone, the answer shape, and the
   intent rule. Everything seen on 2026-10-31 is fixed here.
2. **Knowing where I am.** Changed files each turn, reviews of work in progress, the session decisions list, and Driver
   hand-over.
3. **Proactive and learning.** Opt-in remarks at pauses through herdr, the hints-first setting, and the analytics
   counts.

## Open questions

- Answered by the proposal above, to confirm: a command switches the mode; by default it waits for questions; it edits
  only on hand-over; it remembers how I work through global memories in the [memory](memory.md) module.
- Does Driver need its own role, or is it switching to Build for one change and back?
- Should bash in Navigator run the project's approved checks (like pairing-buddy's Scout), or only read-only commands?
- Where does the changed-files context come from outside Git?
