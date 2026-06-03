// 三层(side panel / background / content script)共享的类型定义。

/** 草稿在本插件内的生命周期状态(注意与后台表单的"显示/隐藏"状态 postStatus 区分)。 */
export type DraftStatus = 'draft' | 'filled' | 'published';

/**
 * 一条内容草稿。AI 生成 title/subtitle/category/body/tags/description;
 * postStatus/publishedAt/mediaId 由人工在 side panel 填写或取默认值(非 AI 生成)。
 */
export interface ContentDraft {
  id: string;
  title: string;
  subtitle: string;
  /** 后台分类(对应 select[name=type] 的 value,如 "2"/"4")。 */
  category: string;
  /** 仅作预览参考,MVP 不填进表单(封面为 file 上传)。 */
  coverImageUrl: string;
  /** 正文 HTML(写入 Quill 前需消毒)。 */
  body: string;
  tags: string[];
  /** 描述/摘要(AI 生成)。 */
  description: string;
  /** 后台显示状态:'0'=隐藏,'1'=显示。 */
  postStatus: string;
  /** 发布时间 yyyy-MM-dd。 */
  publishedAt: string;
  /** 关联作品 id。 */
  mediaId: string;
  status: DraftStatus;
  /** ISO 时间戳。 */
  createdAt: string;
}

/** 字段填充策略类型。U0 确认本后台用到 text/textarea/quill/native-select/checkbox-multi/date。 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'quill'
  | 'native-select'
  | 'checkbox-multi'
  | 'date'
  | 'custom-dropdown'
  | 'tag-input';

/** 单个字段:稳定选择器 + 填充类型。 */
export interface FieldDefinition {
  selector: string;
  fieldType: FieldType;
  label?: string;
}

/** 草稿字段 → 页面元素的映射。键为 ContentDraft 的可填字段。 */
export type FieldMapping = Partial<
  Record<
    'title' | 'subtitle' | 'category' | 'body' | 'tags' | 'description' | 'postStatus' | 'publishedAt' | 'mediaId',
    FieldDefinition
  >
>;

/** 用户可配置的设置(API key 单独存取,不在此对象内)。 */
export interface Settings {
  /** 大模型 endpoint(OpenAI 兼容 chat/completions),须为 https。 */
  endpoint: string;
  /** 模型名。 */
  model: string;
  /** prompt 模板,用户主题会注入其中。 */
  promptTemplate: string;
  /** 字段映射(可在设置页编辑)。 */
  fieldMapping: FieldMapping;
}

// ---- 消息协议(side panel ↔ background ↔ content script) ----

/** 单字段填充结果。 */
export interface FieldFillResult {
  field: string;
  status: 'filled' | 'skipped' | 'degraded';
  note?: string;
}

export type RuntimeMessage =
  | { type: 'GENERATE_DRAFT'; prompt: string }
  | { type: 'FILL_PAGE'; draft: ContentDraft };

export type GenerateDraftResponse =
  | { ok: true; draft: ContentDraft }
  | { ok: false; error: string; kind?: 'no-key' | 'network' | 'format' };

export type FillPageResponse =
  | { ok: true; results: FieldFillResult[] }
  | { ok: false; error: string };
