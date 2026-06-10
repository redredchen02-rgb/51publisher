import { Type } from '@sinclair/typebox';

// ── Shared ────────────────────────────────────────────
export const OkStatus = Type.Literal(true);
export const ErrorBody = Type.Object({
  ok: Type.Literal(false),
  error: Type.String(),
  kind: Type.Optional(Type.String()),
});

// ── Settings ──────────────────────────────────────────
export const SettingsSchema = Type.Object({
  endpoint: Type.String(),
  model: Type.String(),
  apiKey: Type.Optional(Type.String()),
  promptTemplate: Type.Optional(Type.String()),
  facts: Type.Optional(Type.String()),
  fewShot: Type.Optional(Type.String()),
  extraInstructions: Type.Optional(Type.String()),
  publishMode: Type.Optional(Type.Union([Type.Literal('off'), Type.Literal('dry-run'), Type.Literal('authorized')])),
});

// ── FactsBlock ────────────────────────────────────────
export const FactsBlockSchema = Type.Object({
  intro: Type.Optional(Type.String()),
  highlights: Type.Optional(Type.Array(Type.String())),
  characters: Type.Optional(Type.String()),
  workTitle: Type.Optional(Type.String()),
  episodeNumber: Type.Optional(Type.String()),
});

// ── Drafts ────────────────────────────────────────────
export const GenerateDraftBody = Type.Object({
  prompt: Type.String({ minLength: 1 }),
  settings: SettingsSchema,
  facts: Type.Optional(FactsBlockSchema),
});

export const GenerateDraftResponse = Type.Object({
  ok: OkStatus,
  draft: Type.Object({
    title: Type.String(),
    content: Type.String(),
    intro: Type.String(),
    highlights: Type.Array(Type.String()),
    tags: Type.Array(Type.String()),
  }),
});

// ── Auth ──────────────────────────────────────────────
export const LoginBody = Type.Object({
  password: Type.String({ minLength: 1 }),
});

export const LoginResponse = Type.Object({
  ok: OkStatus,
  token: Type.String(),
});

export const AuthStatusResponse = Type.Object({
  ok: OkStatus,
  authenticated: Type.Boolean(),
});

// ── Models ────────────────────────────────────────────
export const ModelsResponse = Type.Object({
  ok: OkStatus,
  models: Type.Optional(Type.Array(Type.Unknown())),
});

// ── Batch ─────────────────────────────────────────────
export const CreateBatchBody = Type.Object({
  id: Type.String({ minLength: 1 }),
  tabId: Type.Number(),
  authorizedHost: Type.String({ minLength: 1 }),
  topics: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  facts: Type.Optional(Type.Array(Type.Optional(Type.Record(Type.String(), Type.Unknown())))),
});

// ── Scraper ──────────────────────────────────────────
export const TriggerScrapeBody = Type.Object({
  siteName: Type.String({ minLength: 1 }),
  url: Type.Optional(Type.String()),
});
