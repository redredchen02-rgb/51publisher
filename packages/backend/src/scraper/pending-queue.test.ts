import { describe, expect, it } from "vitest";
import { WriteQueue } from "./pending-queue.js";

describe("WriteQueue", () => {
	it("resolves enqueued fn result", async () => {
		const q = new WriteQueue();
		const result = await q.enqueue(() => 42);
		expect(result).toBe(42);
	});

	it("rejects when fn throws an Error", async () => {
		const q = new WriteQueue();
		await expect(
			q.enqueue(() => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
	});

	it("rejects with wrapped Error when fn throws a non-Error", async () => {
		const q = new WriteQueue();
		await expect(
			q.enqueue(() => {
				// biome-ignore lint/complexity/noUselessCatch: intentional non-Error throw for test
				throw "string error";
			}),
		).rejects.toThrow("string error");
	});

	it("serializes concurrent enqueues", async () => {
		const q = new WriteQueue();
		const order: number[] = [];
		await Promise.all([
			q.enqueue(() => order.push(1)),
			q.enqueue(() => order.push(2)),
			q.enqueue(() => order.push(3)),
		]);
		expect(order).toEqual([1, 2, 3]);
	});
});
