/**
 * 串行互斥队列:把并发 worker 的状态变更逐个排队执行,保证对共享 batch 累积态的「读→改→save」原子化,
 * 避免多个 worker 持过期 batch 互相覆盖。返回的函数 await 即等到本次变更落盘。
 */
export function createSerialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(fn: () => Promise<T>): Promise<T> => {
		const run = tail.then(fn) as Promise<T>;
		// 吞掉错误以免毒化队列;调用方各自 await run 拿真实结果/异常。
		tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};
}

/** 有界并发 map:最多 limit 个 worker 同时跑,顺序无关。worker 内部异常向上抛(由调用方 fail-open 包裹)。 */
export async function mapWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	async function runner(): Promise<void> {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			const item = items[i];
			if (item === undefined) return;
			await worker(item);
		}
	}
	const runners = Array.from({ length: Math.min(limit, items.length) }, runner);
	await Promise.all(runners);
}
