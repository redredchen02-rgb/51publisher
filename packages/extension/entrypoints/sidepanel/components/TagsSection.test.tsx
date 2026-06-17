// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TagsSection } from "./TagsSection";

describe("TagsSection", () => {
	it("renders tags textarea with given value", () => {
		render(
			<TagsSection
				tagsText="漢化"
				reviewCriteriaPrompt=""
				setTagsText={vi.fn()}
				setReviewCriteriaPrompt={vi.fn()}
			/>,
		);
		expect(screen.getByDisplayValue("漢化")).toBeTruthy();
	});

	it("calls setTagsText on change", () => {
		const setTagsText = vi.fn();
		render(
			<TagsSection
				tagsText="初始标签"
				reviewCriteriaPrompt=""
				setTagsText={setTagsText}
				setReviewCriteriaPrompt={vi.fn()}
			/>,
		);
		fireEvent.change(screen.getByDisplayValue("初始标签"), {
			target: { value: "新标签" },
		});
		expect(setTagsText).toHaveBeenCalledWith("新标签");
	});

	it("calls setReviewCriteriaPrompt on change", () => {
		const setReviewCriteriaPrompt = vi.fn();
		render(
			<TagsSection
				tagsText=""
				reviewCriteriaPrompt="旧标准"
				setTagsText={vi.fn()}
				setReviewCriteriaPrompt={setReviewCriteriaPrompt}
			/>,
		);
		fireEvent.change(screen.getByDisplayValue("旧标准"), {
			target: { value: "自定义标准" },
		});
		expect(setReviewCriteriaPrompt).toHaveBeenCalledWith("自定义标准");
	});
});
