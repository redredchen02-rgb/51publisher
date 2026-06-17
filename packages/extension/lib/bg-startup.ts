import { logger } from "./logger";

/**
 * SW 啟動恢復(empty after batch pipeline removal)。
 * 保留空殼避免 caller 改動;無 batch 可恢復。
 */
export async function runStartupGeneratingRecovery(_deps?: {
	getBatch: () => unknown;
	saveBatch: (b: unknown) => Promise<void>;
}): Promise<void> {
	logger.debug(
		"bg",
		"runStartupGeneratingRecovery: no-op (batch pipeline removed)",
	);
}
