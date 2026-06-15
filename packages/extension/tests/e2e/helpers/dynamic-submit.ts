// D2 动态提交插桩:模拟真后台可能挂的「字段事件 → 自动提交」handler。
//
// 真后台(layuiAdmin)的提交通常是显式点按钮,但无法排除某些字段挂了
// blur/keydown 自动提交。本 helper 给表单所有字段(+表单本身)挂上对指定事件
// 类型的合成 handler,handler 内调用 form.requestSubmit()——配合既有
// installSubmitSpy 的 requestSubmit 计数,即可断言填充流程是否触发了它们。

export interface AutoSubmitProbe {
	/** 还原所有挂上的 handler。 */
	restore(): void;
}

/**
 * 给 form 及其所有字段挂上「在 eventTypes 触发时调用 form.requestSubmit()」的 handler。
 * @param form 目标表单
 * @param eventTypes 监听的事件类型(如 ["blur","keydown"] 或 ["change","input"])
 */
export function attachAutoSubmitOn(
	form: HTMLFormElement,
	eventTypes: string[],
): AutoSubmitProbe {
	const handler = () => {
		// 真 handler 可能直接 form.requestSubmit();这里复用同一路径,交给 spy 计数。
		form.requestSubmit?.();
	};

	const targets: EventTarget[] = [
		form,
		...Array.from(form.querySelectorAll("input, select, textarea, button")),
	];

	for (const t of targets) {
		for (const type of eventTypes) {
			t.addEventListener(type, handler);
		}
	}

	return {
		restore() {
			for (const t of targets) {
				for (const type of eventTypes) {
					t.removeEventListener(type, handler);
				}
			}
		},
	};
}
