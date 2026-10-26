import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  matchesKey,
  SelectList,
  type SelectListTheme,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { Session } from "#core/session";
import type { Command, JobInfo } from "#core/types";
import { jobDuration, jobEnding } from "#core/util/jobs";
import { DIALOG_LIST_ROWS, Dialog } from "#ui/components/dialog";

const OUTPUT_LINES = 100;

/** `/jobs` opens the session's background jobs, with an output view and stop action. */
export function jobsCmd(session: Session): Command {
  return {
    info: { name: "jobs", description: "View, open, or stop background jobs" },
    async execute(ctx) {
      if (ctx.mode !== "tui") throw new Error("/jobs requires TUI mode");
      return openJobs(ctx, session);
    },
  };
}

async function openJobs(ctx: ExtensionCommandContext, session: Session): Promise<string | undefined> {
  let stopped: JobInfo | undefined;
  await ctx.ui.custom<undefined>(
    (tui, theme, _keybindings, done) => {
      let refresh: ReturnType<typeof setInterval> | undefined;
      const close = (result: undefined) => {
        if (refresh) clearInterval(refresh);
        done(result);
      };
      const component = jobsDialog(theme, session, tui, close, (job) => (stopped = job));
      refresh = setInterval(() => {
        component.invalidate();
        tui.requestRender();
      }, 1000);
      return component;
    },
    { overlay: true, overlayOptions: { anchor: "center", width: 110, maxHeight: "80%" } },
  );
  return stopped
    ? stopped.status === "stopped"
      ? `Stopped job ${stopped.id}: ${stopped.label}`
      : `Job ${stopped.id} ended before it could be stopped: ${jobEnding(stopped)}.`
    : undefined;
}

function jobsDialog(
  theme: Theme,
  session: Session,
  tui: TUI,
  done: (result: undefined) => void,
  onStop: (job: JobInfo) => void,
): Component {
  const dialog = new Dialog(theme, { title: "Background jobs" });
  dialog.addChild(new JobsView(theme, session, tui, done, onStop));
  return dialog;
}

class JobsView implements Component {
  private opened: JobInfo | undefined;
  private message: string | undefined;
  private jobs: JobInfo[] = [];
  private list: SelectList;
  private readonly listTheme: SelectListTheme;

  constructor(
    private readonly theme: Theme,
    private readonly session: Session,
    private readonly tui: TUI,
    private readonly done: (result: undefined) => void,
    private readonly onStop: (job: JobInfo) => void,
  ) {
    this.listTheme = {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("dim", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("dim", text),
    };
    this.list = this.createList();
    this.refreshList();
  }

  render(width: number): string[] {
    if (!this.opened) {
      this.refreshList();
      if (!this.jobs.length) return ["No background jobs.", this.theme.fg("dim", "Esc close")];
      return [
        ...this.list.render(width),
        this.theme.fg("dim", "Enter open · x stop · Esc close"),
        ...(this.message ? [this.message] : []),
      ];
    }
    const job = this.session.jobs.get(this.opened.id);
    const lines = [
      `${this.opened.id} · ${this.opened.kind} · ${jobEnding(job?.info ?? this.opened).replace("exit code ", "exit ")} · ${this.opened.label}`,
      `Log: ${this.opened.logPath}`,
      "",
      ...(job?.tail(OUTPUT_LINES).split("\n") ?? []),
      "",
      this.theme.fg("dim", "Esc back"),
    ];
    // A log line can be any length; the dialog's frame can't.
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  invalidate() {
    this.list.invalidate();
  }

  handleInput(key: string) {
    if (!this.opened) this.refreshList();
    if (this.opened) {
      if (matchesKey(key, "escape")) {
        this.opened = undefined;
        this.tui.requestRender();
      }
      return;
    }
    if (matchesKey(key, "escape") && !this.jobs.length) {
      this.done(undefined);
      return;
    }
    if (matchesKey(key, "x")) {
      const selected = this.list.getSelectedItem();
      const job = this.jobs.find((item) => item.id === selected?.value);
      const current = job && this.session.jobs.get(job.id)?.info;
      if (current?.status !== "running") {
        this.message = "That job has already ended.";
        return;
      }
      void this.stop(current);
      return;
    }
    this.list.handleInput(key);
  }

  private createList(selectedId?: string): SelectList {
    const rows = this.jobs.map((job) => ({
      value: job.id,
      // No description column: SelectList gives it half the width, and the log path is in the opened view.
      label: `${job.id} · ${job.kind} · ${jobEnding(job).replace("exit code ", "exit ")} · ${jobDuration(job)} · ${job.label}`,
    }));
    const list = new SelectList(rows, DIALOG_LIST_ROWS, this.listTheme);
    list.setSelectedIndex(
      Math.max(
        0,
        rows.findIndex((row) => row.value === selectedId),
      ),
    );
    list.onSelect = (item) => {
      this.opened = this.jobs.find((job) => job.id === item.value);
      this.tui.requestRender();
    };
    list.onCancel = () => this.done(undefined);
    return list;
  }

  private refreshList() {
    const selectedId = this.list.getSelectedItem()?.value;
    this.jobs = this.session.jobs.list().reverse();
    this.list = this.createList(selectedId);
  }

  private async stop(job: JobInfo) {
    const ended = await this.session.jobs.stop(job.id);
    if (ended) this.onStop(ended);
    this.done(undefined);
  }
}
