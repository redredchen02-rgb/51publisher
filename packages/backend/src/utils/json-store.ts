import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface JsonFileStoreOptions<T> {
	dirPath: string;
	sanitize?: (id: string) => string;
	updatedAtKey?: keyof T;
}

function defaultSanitize(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class JsonFileStore<T extends { id: string }> {
	private readonly dirPath: string;
	private readonly sanitize: (id: string) => string;
	private readonly updatedAtKey: keyof T;

	constructor(options: JsonFileStoreOptions<T>) {
		this.dirPath = options.dirPath;
		this.sanitize = options.sanitize ?? defaultSanitize;
		this.updatedAtKey = (options.updatedAtKey ?? "updatedAt") as keyof T;
	}

	private filePath(id: string): string {
		const safe = this.sanitize(id);
		return join(this.dirPath, `${safe}.json`);
	}

	private async ensureDir(): Promise<void> {
		if (!existsSync(this.dirPath))
			await mkdir(this.dirPath, { recursive: true });
	}

	async read(id: string): Promise<T | null> {
		const fp = this.filePath(id);
		if (!existsSync(fp)) return null;
		try {
			const raw = await readFile(fp, "utf-8");
			return JSON.parse(raw) as T;
		} catch {
			return null;
		}
	}

	async write(data: T): Promise<void> {
		await this.ensureDir();
		(data as Record<string, unknown>)[this.updatedAtKey as string] =
			new Date().toISOString();
		await writeFile(
			this.filePath(data.id),
			JSON.stringify(data, null, 2),
			"utf-8",
		);
	}

	async delete(id: string): Promise<void> {
		const fp = this.filePath(id);
		if (existsSync(fp)) await unlink(fp);
	}

	async list(opts?: { limit?: number }): Promise<T[]> {
		await this.ensureDir();
		const files = await readdir(this.dirPath);
		const jsonFiles = files.filter((f) => f.endsWith(".json"));

		const items: T[] = [];
		for (const f of jsonFiles) {
			try {
				const raw = await readFile(join(this.dirPath, f), "utf-8");
				items.push(JSON.parse(raw) as T);
			} catch {
				// skip corrupt
			}
		}

		items.sort((a, b) => {
			const aTime = String(a[this.updatedAtKey] ?? "");
			const bTime = String(b[this.updatedAtKey] ?? "");
			return bTime.localeCompare(aTime);
		});

		return opts?.limit ? items.slice(0, opts.limit) : items;
	}
}
