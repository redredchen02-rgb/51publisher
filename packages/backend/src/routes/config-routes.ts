import type { FieldMapping } from "@51publisher/shared";
import { DEFAULT_FIELD_MAPPING } from "@51publisher/shared";
import type { FastifyInstance } from "fastify";
import { configGet, configSet } from "../services/config-store.js";
import { err } from "../utils/error-response.js";

const CONFIG_KEY_MAPPINGS = "field_mappings";

function loadMappings(): FieldMapping {
	const raw = configGet(CONFIG_KEY_MAPPINGS);
	if (raw) {
		try {
			return JSON.parse(raw) as FieldMapping;
		} catch {
			// 解析失败回退默认值
		}
	}
	return structuredClone(DEFAULT_FIELD_MAPPING);
}

function saveMappings(m: FieldMapping): void {
	configSet(CONFIG_KEY_MAPPINGS, JSON.stringify(m));
}

const VALID_FIELD_TYPES = new Set([
	"text",
	"textarea",
	"quill",
	"native-select",
	"checkbox-multi",
	"date",
	"custom-dropdown",
	"tag-input",
]);

function isValidFieldMapping(v: unknown): v is FieldMapping {
	if (!v || typeof v !== "object" || Array.isArray(v)) return false;
	for (const [, def] of Object.entries(v as Record<string, unknown>)) {
		if (!def || typeof def !== "object") return false;
		const d = def as Record<string, unknown>;
		if (typeof d.selector !== "string" || d.selector.trim() === "")
			return false;
		if (!VALID_FIELD_TYPES.has(d.fieldType as string)) return false;
	}
	return true;
}

export async function registerConfigRoutes(
	app: FastifyInstance,
): Promise<void> {
	app.get("/api/v1/config/mappings", async (_request, _reply) => {
		const mappings = loadMappings();
		return {
			ok: true,
			mappings,
			version: Date.now(),
		};
	});

	app.put<{ Body: unknown }>(
		"/api/v1/config/mappings",
		async (request, reply) => {
			const body = request.body as Record<string, unknown> | null;
			if (!body || !isValidFieldMapping(body.mappings)) {
				return err(
					reply,
					400,
					"Invalid mappings payload. Each field must have a non-empty selector and a valid fieldType.",
				);
			}
			saveMappings(body.mappings as FieldMapping);
			return { ok: true, mappings: loadMappings() };
		},
	);
}
