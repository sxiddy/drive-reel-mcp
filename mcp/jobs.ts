import crypto from "node:crypto";
import { EventEmitter } from "node:events";

export type Job<R = unknown> = {
  id: string;
  kind: "analyze" | "generate";
  projectId: string;
  status: "running" | "done" | "error";
  stage: string;
  progress: number;
  result?: R;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

const jobs = new Map<string, Job>();
const bus = new EventEmitter();
bus.setMaxListeners(100);

/** Starts `work` in the background; analysis and rendering take minutes, longer than one tool call should block. */
export function startJob<R>(kind: Job["kind"], projectId: string, work: (update: (stage: string, progress: number) => void) => Promise<R>): Job<R> {
  const job: Job<R> = { id: `job_${crypto.randomBytes(4).toString("hex")}`, kind, projectId, status: "running", stage: "Starting", progress: 0, startedAt: Date.now() };
  jobs.set(job.id, job as Job);
  const update = (stage: string, progress: number) => {
    job.stage = stage;
    job.progress = Math.max(job.progress, Math.min(1, progress));
    bus.emit(job.id);
  };
  work(update)
    .then((r) => {
      job.result = r;
      job.status = "done";
      job.progress = 1;
    })
    .catch((e: Error) => {
      job.status = "error";
      job.error = e.message;
    })
    .finally(() => {
      job.finishedAt = Date.now();
      bus.emit(job.id, "end");
    });
  return job;
}

export const getJob = (id: string) => jobs.get(id);

/** Waits until the job finishes or `ms` passes, whichever comes first. */
export function waitForJob(id: string, ms: number): Promise<Job | undefined> {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return Promise.resolve(job);
  return new Promise((resolve) => {
    const onEvent = (what?: string) => {
      if (what === "end") finish();
    };
    const finish = () => {
      clearTimeout(timer);
      bus.off(id, onEvent);
      resolve(jobs.get(id));
    };
    const timer = setTimeout(finish, ms);
    bus.on(id, onEvent);
  });
}

export const activeJobFor = (projectId: string, kind: Job["kind"]) =>
  [...jobs.values()].find((j) => j.projectId === projectId && j.kind === kind && j.status === "running");
