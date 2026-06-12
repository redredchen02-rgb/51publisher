// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useAutoSave } from "./useAutoSave";
import { saveCurrentDraft } from "../../../lib/storage";

vi.mock("../../../lib/storage", () => ({
  saveCurrentDraft: vi.fn().mockResolvedValue(undefined),
}));

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves draft after delay', async () => {
    const { result } = renderHook(() => useAutoSave());
    const draft = { id: '1', title: '测试' };
    
    act(() => {
      result.current.saveDraft(draft as any);
    });
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(saveCurrentDraft).toHaveBeenCalledWith(draft);
  });

  it('debounces multiple saves', async () => {
    const { result } = renderHook(() => useAutoSave());
    const draft1 = { id: '1', title: '测试1' };
    const draft2 = { id: '2', title: '测试2' };
    
    act(() => {
      result.current.saveDraft(draft1 as any);
    });
    
    act(() => {
      vi.advanceTimersByTime(500);
    });
    
    act(() => {
      result.current.saveDraft(draft2 as any);
    });
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(saveCurrentDraft).toHaveBeenCalledTimes(1);
    expect(saveCurrentDraft).toHaveBeenCalledWith(draft2);
  });

  it('saves immediately when saveImmediately is true', async () => {
    const { result } = renderHook(() => useAutoSave());
    const draft = { id: '1', title: '测试' };
    
    act(() => {
      result.current.saveDraft(draft as any, true);
    });
    
    expect(saveCurrentDraft).toHaveBeenCalledWith(draft);
  });
});