import type { ContentDraft } from './types';

export interface SlotDiff {
  changedSlots: string[];
  totalSlots: number;
  /** aiDraft 为 undefined（旧记录 / pre-Phase2）时为 true。 */
  unknown?: true;
}

// 可编辑内容字段（排除元数据 id/status/createdAt）。
const CONTENT_SLOTS: ReadonlyArray<keyof ContentDraft> = [
  'title', 'subtitle', 'category', 'coverImageUrl', 'body',
  'tags', 'description', 'postStatus', 'publishedAt', 'mediaId',
];

function slotsEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * 比较 AI 原稿与最终发布草稿，返回变更字段列表。
 * aiDraft 为 undefined（旧 BatchItem 无快照）时返回 unknown:true，不报错。
 */
export function computeSlotDiff(
  aiDraft: ContentDraft | undefined,
  finalDraft: ContentDraft,
): SlotDiff {
  if (aiDraft === undefined) {
    return { changedSlots: [], totalSlots: 0, unknown: true };
  }
  const changedSlots: string[] = [];
  for (const slot of CONTENT_SLOTS) {
    if (!slotsEqual(aiDraft[slot], finalDraft[slot])) {
      changedSlots.push(slot);
    }
  }
  return { changedSlots, totalSlots: CONTENT_SLOTS.length };
}
