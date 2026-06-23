import type { ContentDraft, FactsBlock } from "@51publisher/shared";

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="field-group">
			<div className="field-label">{label}</div>
			{children}
		</div>
	);
}

export function DraftPreview({
	draft,
	onChange,
	readonlyFields,
	facts,
}: {
	draft: ContentDraft;
	onChange: (d: ContentDraft) => void;
	/** Grounded fields that must not be hand-edited; operator must edit facts and regenerate. */
	readonlyFields?: ReadonlySet<keyof ContentDraft>;
	/** FactsBlock for the item; drives description dual-state (grounded vs prose). */
	facts?: FactsBlock;
}) {
	const set = (patch: Partial<ContentDraft>) =>
		onChange({ ...draft, ...patch });

	const ro = (field: keyof ContentDraft) => readonlyFields?.has(field) ?? false;

	// description is grounded (readOnly) when facts.简介 is present; prose-editable otherwise.
	const descReadOnly = ro("description") || !!facts?.简介?.trim();

	return (
		<div>
			<Field label="标题">
				<input
					className={`field-input${ro("title") ? " field-input--readonly" : ""}`}
					value={draft.title}
					readOnly={ro("title")}
					onChange={
						ro("title") ? undefined : (e) => set({ title: e.target.value })
					}
				/>
			</Field>
			<Field label="副标题">
				<input
					className={`field-input${ro("subtitle") ? " field-input--readonly" : ""}`}
					value={draft.subtitle}
					readOnly={ro("subtitle")}
					onChange={
						ro("subtitle")
							? undefined
							: (e) => set({ subtitle: e.target.value })
					}
				/>
			</Field>
			<Field label="分类(type 值,如 2=漫畫文章 / 4=動漫文章)">
				<input
					className={`field-input${ro("category") ? " field-input--readonly" : ""}`}
					value={draft.category}
					readOnly={ro("category")}
					onChange={
						ro("category")
							? undefined
							: (e) => set({ category: e.target.value })
					}
				/>
			</Field>
			<Field label="标签(逗号分隔)">
				<input
					className={`field-input${ro("tags") ? " field-input--readonly" : ""}`}
					value={draft.tags.join(", ")}
					readOnly={ro("tags")}
					onChange={
						ro("tags")
							? undefined
							: (e) =>
									set({
										tags: e.target.value
											.split(",")
											.map((t) => t.trim())
											.filter(Boolean),
									})
					}
				/>
			</Field>
			<Field label="描述">
				<textarea
					className={`field-input${descReadOnly ? " field-input--readonly" : ""}`}
					style={{ minHeight: 44 }}
					value={draft.description}
					readOnly={descReadOnly}
					onChange={
						descReadOnly
							? undefined
							: (e) => set({ description: e.target.value })
					}
				/>
			</Field>
			<Field label="正文(HTML,填充前自动消毒)">
				<textarea
					className={`field-input${ro("body") ? " field-input--readonly" : ""}`}
					style={{ minHeight: 120, fontFamily: "monospace" }}
					value={draft.body}
					readOnly={ro("body")}
					onChange={
						ro("body") ? undefined : (e) => set({ body: e.target.value })
					}
				/>
			</Field>
			<details style={{ marginBottom: "var(--space-md)" }}>
				<summary className="text-sm text-muted" style={{ cursor: "pointer" }}>
					非 AI 字段(人工设定)
				</summary>
				<div style={{ marginTop: "var(--space-lg)" }}>
					<Field label="状态(0=隐藏 / 1=显示)">
						<input
							className="field-input"
							value={draft.postStatus}
							onChange={(e) =>
								set({
									postStatus: e.target.value === "1" ? "1" : "0",
								})
							}
						/>
					</Field>
					<Field label="发布时间(yyyy-MM-dd)">
						<input
							className="field-input"
							value={draft.publishedAt}
							onChange={(e) => set({ publishedAt: e.target.value })}
						/>
					</Field>
					<Field label="作品 id">
						<input
							className="field-input"
							value={draft.mediaId}
							onChange={(e) => set({ mediaId: e.target.value })}
						/>
					</Field>
					<Field label="封面图 URL(仅预览,MVP 不自动填,请人工上传)">
						<input
							className="field-input"
							value={draft.coverImageUrl}
							onChange={(e) => set({ coverImageUrl: e.target.value })}
						/>
					</Field>
					{draft.coverImageUrl && (
						<img
							src={draft.coverImageUrl}
							alt="封面预览"
							style={{
								maxWidth: "100%",
								maxHeight: 120,
								borderRadius: "var(--radius-md)",
								marginTop: "var(--space-sm)",
							}}
						/>
					)}
				</div>
			</details>
		</div>
	);
}
