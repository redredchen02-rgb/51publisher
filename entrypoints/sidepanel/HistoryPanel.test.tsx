// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HistoryPanel } from './HistoryPanel';
import type { TrajectoryRecord } from '../../lib/trajectory';

vi.mock('../../lib/storage', () => ({
  getTrajectory: vi.fn(async () => []),
}));
vi.mock('../../lib/trajectory', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/trajectory')>();
  return {
    ...actual,
    verifyTrajectory: vi.fn(() => true),
    rollbackTargets: vi.fn((list: import('../../lib/trajectory').TrajectoryRecord[]) =>
      list.filter((r) => r.publishUrl),
    ),
  };
});

import { getTrajectory } from '../../lib/storage';

function makeRecord(id: string, topic: string, opts: Partial<TrajectoryRecord> = {}): TrajectoryRecord {
  return {
    id,
    topic,
    status: 'publish-confirmed',
    ts: '2026-06-04T10:00:00.000Z',
    publishedAsDraft: false,
    fields: [],
    seq: 1,
    hash: 'aabbccdd',
    ...opts,
  };
}

describe('HistoryPanel', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(getTrajectory).mockReset();
  });

  it('empty trajectory → 暂无发布记录 empty state', async () => {
    vi.mocked(getTrajectory).mockResolvedValue([]);
    const { findByText } = render(<HistoryPanel />);
    await findByText('暂无发布记录。');
  });

  it('3 records → renders 3 rows with topics', async () => {
    vi.mocked(getTrajectory).mockResolvedValue([
      makeRecord('r1', 'topic-a'),
      makeRecord('r2', 'topic-b'),
      makeRecord('r3', 'topic-c'),
    ]);
    render(<HistoryPanel />);
    expect(await screen.findByText(/topic-a/)).toBeTruthy();
    expect(screen.getByText(/topic-b/)).toBeTruthy();
    expect(screen.getByText(/topic-c/)).toBeTruthy();
  });

  it('record with publishUrl → 查看帖子 link rendered', async () => {
    vi.mocked(getTrajectory).mockResolvedValue([
      makeRecord('r1', 'topic-x', { publishUrl: 'https://example.com/post/1' }),
    ]);
    render(<HistoryPanel />);
    const link = await screen.findByText('查看帖子') as HTMLAnchorElement;
    expect(link.href).toContain('example.com');
  });

  it('record without publishUrl → no broken link', async () => {
    vi.mocked(getTrajectory).mockResolvedValue([
      makeRecord('r1', 'topic-x', { publishUrl: undefined }),
    ]);
    render(<HistoryPanel />);
    await screen.findByText(/topic-x/);
    expect(screen.queryByText('查看帖子')).toBeNull();
  });

  it('25 records → only 20 shown; 加载更多 button visible', async () => {
    const records = Array.from({ length: 25 }, (_, i) => makeRecord(`r${i}`, `topic-${i}`));
    vi.mocked(getTrajectory).mockResolvedValue(records);
    render(<HistoryPanel />);
    await screen.findByText(/topic-24/); // newest-first: index 24 shown first
    const moreBtn = screen.getByText('加载更多');
    expect(moreBtn).toBeTruthy();
    // Only 20 visible initially (25 - 5 beyond page = not visible)
    expect(screen.queryByText(/topic-0/)).toBeNull(); // oldest, not shown yet
    fireEvent.click(moreBtn);
    expect(await screen.findByText(/topic-0/)).toBeTruthy();
  });

  it('chain intact → ✓ 链完整 banner (single record)', async () => {
    vi.mocked(getTrajectory).mockResolvedValue([makeRecord('r1', 't')]);
    render(<HistoryPanel />);
    await screen.findByText(/链完整/);
  });
});
