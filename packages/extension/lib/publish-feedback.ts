import { storage } from "#imports";

export type FeedbackRating = "good" | "ok" | "bad";

export interface PublishFeedback {
	itemId: string;
	topic: string;
	rating: FeedbackRating;
	note?: string;
	ts: string;
}

const FEEDBACK_KEY = "local:publishFeedback";
const MAX_RECORDS = 500;

export async function getFeedback(): Promise<PublishFeedback[]> {
	const stored = await storage.getItem<PublishFeedback[]>(FEEDBACK_KEY);
	return Array.isArray(stored) ? stored : [];
}

export async function saveFeedback(entry: PublishFeedback): Promise<void> {
	const current = await getFeedback();
	// 同一 itemId 覆寫
	const filtered = current.filter((r) => r.itemId !== entry.itemId);
	const next = [entry, ...filtered].slice(0, MAX_RECORDS);
	await storage.setItem(FEEDBACK_KEY, next);
}

export async function getFeedbackForItem(itemId: string): Promise<PublishFeedback | undefined> {
	const all = await getFeedback();
	return all.find((r) => r.itemId === itemId);
}
