import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Analysis } from "./analyze";
import type { Theme } from "./planner";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WORK = path.join(ROOT, "work", "projects");

export type Project = {
  id: string;
  mode: "drive" | "motion";
  source?: string;
  occasion: string;
  targetDuration: number;
  createdAt: string;
  themes: Theme[];
  videos: { themeId: string; url?: string; editUrl?: string; file: string; createdAt: string }[];
};

export const projectDir = (id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Bad project id: ${id}`);
  return path.join(WORK, id);
};

export function createProject(p: Omit<Project, "id" | "createdAt" | "themes" | "videos">): Project {
  const id = `prj-${crypto.randomBytes(3).toString("hex")}`;
  const project: Project = { ...p, id, createdAt: new Date().toISOString(), themes: [], videos: [] };
  fs.mkdirSync(projectDir(id), { recursive: true });
  saveProject(project);
  return project;
}

export function loadProject(id: string): Project {
  const file = path.join(projectDir(id), "project.json");
  if (!fs.existsSync(file)) throw new Error(`No project "${id}". Call analyze_drive_folder first.`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Project;
}

export function saveProject(p: Project) {
  fs.writeFileSync(path.join(projectDir(p.id), "project.json"), JSON.stringify(p, null, 2));
}

export function loadAnalysis(id: string): Analysis {
  const file = path.join(projectDir(id), "analysis.json");
  if (!fs.existsSync(file)) throw new Error(`Project "${id}" has no finished analysis yet. Use check_job to wait for it.`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Analysis;
}
