// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppProvider, useAppContext } from "./AppContext";

function TestComponent() {
	const { topic, setTopic, draft, setDraft } = useAppContext();

	return (
		<div>
			<span data-testid="topic">{topic}</span>
			<span data-testid="draft">{draft?.title ?? "无草稿"}</span>
			<button type="button" onClick={() => setTopic("测试主题")}>
				设置主题
			</button>
			<button
				type="button"
				onClick={() => setDraft({ id: "1", title: "测试草稿" } as any)}
			>
				设置草稿
			</button>
		</div>
	);
}

describe("AppContext", () => {
	afterEach(() => {
		cleanup();
	});

	it("provides initial state", () => {
		render(
			<AppProvider>
				<TestComponent />
			</AppProvider>,
		);

		expect(screen.getByTestId("topic").textContent).toBe("");
		expect(screen.getByTestId("draft").textContent).toBe("无草稿");
	});

	it("updates topic", () => {
		render(
			<AppProvider>
				<TestComponent />
			</AppProvider>,
		);

		fireEvent.click(screen.getByText("设置主题"));

		expect(screen.getByTestId("topic").textContent).toBe("测试主题");
	});

	it("updates draft", () => {
		render(
			<AppProvider>
				<TestComponent />
			</AppProvider>,
		);

		fireEvent.click(screen.getByText("设置草稿"));

		expect(screen.getByTestId("draft").textContent).toBe("测试草稿");
	});
});
