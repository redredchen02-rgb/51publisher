import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

// ---- 类型定义 ----

export interface PromptTemplate {
  id: string;
  name: string;
  template: string;
  fewShotExamples: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateCreate {
  name: string;
  template: string;
  fewShotExamples: string;
  model?: string;
}

export interface PromptTemplateUpdate {
  name?: string;
  template?: string;
  fewShotExamples?: string;
  model?: string;
}

// ---- 文件持久层（轻量 JSON，与 pending-store.ts 一致） ----

const DATA_DIR = process.env.PUBLISHER_DATA_DIR || join(dirname(new URL(import.meta.url).pathname), '..', 'data');
const PROMPTS_DIR = join(DATA_DIR, 'prompts');

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

function promptFilePath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return join(PROMPTS_DIR, `${safe}.json`);
}

export async function loadPrompt(id: string): Promise<PromptTemplate | null> {
  const fp = promptFilePath(id);
  if (!existsSync(fp)) return null;
  try {
    const raw = await readFile(fp, 'utf-8');
    return JSON.parse(raw) as PromptTemplate;
  } catch {
    return null;
  }
}

export async function savePrompt(template: PromptTemplate): Promise<void> {
  await ensureDir(PROMPTS_DIR);
  template.updatedAt = new Date().toISOString();
  await writeFile(promptFilePath(template.id), JSON.stringify(template, null, 2), 'utf-8');
}

export async function listPrompts(): Promise<PromptTemplate[]> {
  await ensureDir(PROMPTS_DIR);
  const files = await readdir(PROMPTS_DIR);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  const templates: PromptTemplate[] = [];
  for (const f of jsonFiles) {
    try {
      const raw = await readFile(join(PROMPTS_DIR, f), 'utf-8');
      const t = JSON.parse(raw) as PromptTemplate;
      templates.push(t);
    } catch {
      // skip corrupt
    }
  }

  // 最近更新排前
  templates.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return templates;
}

export async function deletePrompt(id: string): Promise<void> {
  const fp = promptFilePath(id);
  if (existsSync(fp)) {
    await unlink(fp);
  }
}
