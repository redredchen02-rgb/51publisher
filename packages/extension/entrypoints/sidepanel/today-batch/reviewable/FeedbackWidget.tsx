import { useEffect, useState } from "react";
import {
	type FeedbackRating,
	getFeedbackForItem,
	type PublishFeedback,
	saveFeedback,
} from "../../../../lib/publish-feedback";

const RATING_EMOJI: Record<FeedbackRating, string> = {
	good: "👍",
	ok: "🤔",
	bad: "👎",
};
const RATING_LABEL: Record<FeedbackRating, string> = {
	good: "不错",
	ok: "一般",
	bad: "需改进",
};

export function FeedbackWidget({
	itemId,
	topic,
}: {
	itemId: string;
	topic: string;
}) {
	const [feedback, setFeedback] = useState<PublishFeedback | undefined>(
		undefined,
	);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		void getFeedbackForItem(itemId).then(setFeedback);
	}, [itemId]);

	async function rate(rating: FeedbackRating) {
		setSaving(true);
		const fb: PublishFeedback = {
			itemId,
			topic,
			rating,
			ts: new Date().toISOString(),
		};
		await saveFeedback(fb);
		setFeedback(fb);
		setSaving(false);
	}

	return (
		<div style={{ marginTop: 6 }}>
			<div style={{ display: "flex", gap: 4, alignItems: "center" }}>
				<span
					className="text-xs text-muted"
					style={{ marginRight: 2, userSelect: "none" }}
				>
					发布质量:
				</span>
				{(["good", "ok", "bad"] as FeedbackRating[]).map((r) => (
					<button
						key={r}
						type="button"
						disabled={saving}
						onClick={() => void rate(r)}
						title={RATING_LABEL[r]}
						className="btn-icon"
						style={{
							fontSize: 16,
							opacity: feedback?.rating === r ? 1 : 0.35,
							filter: feedback?.rating === r ? "none" : "grayscale(80%)",
							transition: "opacity 0.15s, filter 0.15s",
							padding: "0 2px",
						}}
					>
						{RATING_EMOJI[r]}
					</button>
				))}
				{feedback && (
					<span className="text-xs text-muted" style={{ marginLeft: 4 }}>
						已评分
					</span>
				)}
			</div>
			{feedback?.note && (
				<div
					style={{
						marginTop: 4,
						display: "flex",
						gap: 4,
					}}
				>
					<span className="text-xs text-muted">{feedback.note}</span>
				</div>
			)}
		</div>
	);
}
