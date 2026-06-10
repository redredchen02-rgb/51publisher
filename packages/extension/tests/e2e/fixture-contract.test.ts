// @vitest-environment jsdom
// U5 contract 测试:断言「生产映射用到的每个选择器」在当前 fixture 中都存在。
// 与 U3/U4 分工:contract 只查存在性(点名哪个选择器没了,定位快),U3/U4 查「真能填进去」。
// 诚实边界:绿只代表 fixture 兑现了"冻结快照"那套选择器,不代表真后台当前仍是这套(漂移被动发现)。
import { describe, it, expect, afterEach } from 'vitest';
import { loadFixture } from './helpers/quill-fixture';
import { KEY_SELECTORS } from './fixtures/selectors';

describe('fixture contract', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('KEY_SELECTORS(派生自 DEFAULT_FIELD_MAPPING)在 fixture 中全部命中', () => {
    const { document: doc } = loadFixture();
    const missing = KEY_SELECTORS.filter((sel) => !doc.querySelector(sel));
    expect(missing, `fixture 缺失选择器:${missing.join('、')}`).toEqual([]);
  });

  it('防假绿:删掉某字段后 contract 能点名缺失的选择器', () => {
    const { document: doc } = loadFixture();
    doc.querySelector('select[name="type"]')!.remove();
    const missing = KEY_SELECTORS.filter((sel) => !doc.querySelector(sel));
    expect(missing).toContain('select[name="type"]');
  });

  it('派生额外好处:映射改了 selector 但 fixture 没跟上 → 也能抓', () => {
    // 模拟 KEY_SELECTORS 里有一个 fixture 不存在的选择器(等价于映射改了名)
    const probe = ['input[name="title"]', 'input[name="renamed_field"]'];
    const { document: doc } = loadFixture();
    const missing = probe.filter((sel) => !doc.querySelector(sel));
    expect(missing).toEqual(['input[name="renamed_field"]']);
  });
});
