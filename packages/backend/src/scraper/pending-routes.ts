import type { RejectionReason } from "@51publisher/shared";
import type { FastifyInstance } from "fastify";
import { err } from "../error-response.js";
import {
	deletePendingTopic,
	listPendingTopics,
	loadPendingTopic,
	type PendingStatus,
	type PendingTopic,
	type PendingTopicPatch,
	savePendingTopic,
	updatePendingTopicStatus,
} from "./pending-store.js";

const VALID_REJECTION_REASONS = new Set<RejectionReason>([
	"duplicate",
	"quality",
	"topic_mismatch",
	"missing_facts",
	"other",
]);

interface CreatePendingBody {
	sourceUrl: string;
	siteName: string;
	title: string;
	facts?: Record<string, unknown>;
	confidence?: number;
}

interface UpdatePendingBody extends PendingTopicPatch {}

interface PendingIdParams {
	id: string;
}

export async function registerPendingRoutes(
	app: FastifyInstance,
): Promise<void> {
	// 列出所有待审核选题（可按 status 筛选、score 排序、fold_threshold 折叠低分）
	app.get<{
		Querystring: {
			limit?: string;
			status?: string;
			sort_by?: string;
			fold_threshold?: string;
		};
	}>("/api/v1/pending-topics", async (request) => {
		const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
		const status = request.query.status as PendingStatus | undefined;
		const sortBy =
			request.query.sort_by === "score"
				? ("score" as const)
				: ("created_at" as const);
		const foldThreshold =
			request.query.fold_threshold !== undefined
				? Number(request.query.fold_threshold)
				: undefined;

		const rawTopics = await listPendingTopics(limit, status, sortBy);

		const topics =
			foldThreshold !== undefined && !Number.isNaN(foldThreshold)
				? rawTopics.map((t) => ({
						...t,
						folded: (t.score ?? 0) < foldThreshold,
					}))
				: rawTopics;

		return { ok: true, topics };
	});

	// 获取单个待审核选题
	app.get<{ Params: PendingIdParams }>(
		"/api/v1/pending-topics/:id",
		async (request, reply) => {
			const topic = await loadPendingTopic(request.params.id);
			if (!topic) return err(reply, 404, "Pending topic not found");
			return { ok: true, topic };
		},
	);

	// 手动创建待审核选题
	app.post<{ Body: CreatePendingBody }>(
		"/api/v1/pending-topics",
		async (request, reply) => {
			const { sourceUrl, siteName, title, facts, confidence } = request.body;

			if (!sourceUrl || !siteName || !title) {
				return err(
					reply,
					400,
					"Missing required fields: sourceUrl, siteName, title",
				);
			}

			const now = new Date().toISOString();
			const id = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			const topic: PendingTopic = {
				id,
				sourceUrl,
				siteName,
				title,
				facts: (facts ?? {}) as PendingTopic["facts"],
				confidence: confidence ?? 0,
				status: "pending",
				createdAt: now,
				updatedAt: now,
			};

			await savePendingTopic(topic);
			return { ok: true, topic };
		},
	);

	// 更新待审核选题（approve / reject）
	app.patch<{ Params: PendingIdParams; Body: UpdatePendingBody }>(
		"/api/v1/pending-topics/:id",
		async (request, reply) => {
			const { id } = request.params;
			const body = request.body;

			if (body.status) {
				// 拒绝时校验 rejectedReason（若提供）必须是合法枚举值
				if (
					body.status === "rejected" &&
					body.rejectedReason !== undefined &&
					!VALID_REJECTION_REASONS.has(body.rejectedReason as RejectionReason)
				) {
					return err(
						reply,
						400,
						`Invalid rejectedReason "${body.rejectedReason}". Must be one of: ${[...VALID_REJECTION_REASONS].join(", ")}`,
					);
				}

				const updated = await updatePendingTopicStatus(
					id,
					body.status,
					body.rejectedReason,
				);
				if (!updated) return err(reply, 404, "Pending topic not found");
				return { ok: true, topic: updated };
			}

			// Partial update for facts/confidence
			const topic = await loadPendingTopic(id);
			if (!topic) return err(reply, 404, "Pending topic not found");

			if (body.facts) topic.facts = body.facts;
			if (body.confidence !== undefined) topic.confidence = body.confidence;
			await savePendingTopic(topic);
			return { ok: true, topic };
		},
	);

	// 删除待审核选题
	app.delete<{ Params: PendingIdParams }>(
		"/api/v1/pending-topics/:id",
		async (request, reply) => {
			const topic = await loadPendingTopic(request.params.id);
			if (!topic) return err(reply, 404, "Pending topic not found");
			await deletePendingTopic(request.params.id);
			return { ok: true };
		},
	);
}
