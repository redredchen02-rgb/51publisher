import { DEFAULT_FIELD_MAPPING } from '../../../lib/field-mapping';

// 关键选择器清单 = 生产默认映射派生 + 发布按钮。
// 刻意「派生」而非手抄:否则 selectors 与映射会一起静默漂移,contract 沦为自证。
// 派生后,contract 验证的是「fixture 是否兑现生产真正用的那套选择器」,且选择器只有一处可编辑(lib/field-mapping.ts)。
export const PUBLISH_BUTTON_SELECTOR = '#pfa-publish';

export const KEY_SELECTORS: string[] = [
  ...Object.values(DEFAULT_FIELD_MAPPING).map((def) => def!.selector),
  PUBLISH_BUTTON_SELECTOR,
];
