import { getDb, initAppDb } from './migrations/db.js';

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

interface PromptRow {
  id: string;
  name: string;
  template: string;
  few_shot_examples: string;
  model: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: PromptRow): PromptTemplate {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    fewShotExamples: row.few_shot_examples,
    model: row.model ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadPrompt(id: string): PromptTemplate | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) as PromptRow | undefined;
  return row ? rowToTemplate(row) : null;
}

export function savePrompt(template: PromptTemplate): void {
  const db = getDb();
  template.updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO prompt_templates (id, name, template, few_shot_examples, model, created_at, updated_at)
    VALUES (@id, @name, @template, @fewShotExamples, @model, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      template = excluded.template,
      few_shot_examples = excluded.few_shot_examples,
      model = excluded.model,
      updated_at = excluded.updated_at
  `).run({
    id: template.id,
    name: template.name,
    template: template.template,
    fewShotExamples: template.fewShotExamples,
    model: template.model ?? null,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  });
}

export function listPrompts(): PromptTemplate[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM prompt_templates ORDER BY updated_at DESC').all() as PromptRow[];
  return rows.map(rowToTemplate);
}

export function deletePrompt(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
}
