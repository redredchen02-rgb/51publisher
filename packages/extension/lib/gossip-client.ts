import { apiFetch } from "./api-fetch";

export interface GossipSite {
	id: string;
	name: string;
	listUrl: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface DiscoveredItem {
	url: string;
	title?: string;
}

export async function fetchGossipSites(): Promise<GossipSite[]> {
	const res = await apiFetch("/api/v1/gossip/sites", { timeoutMs: 10_000 });
	if (res.status === 401) throw new Error("Unauthorized");
	if (!res.ok) {
		const data = (await res.json()) as { error?: string };
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
	const data = (await res.json()) as { ok: boolean; sites?: GossipSite[] };
	return data.ok && data.sites ? data.sites : [];
}

export async function createGossipSite(
	name: string,
	listUrl: string,
): Promise<GossipSite | null> {
	try {
		const res = await apiFetch("/api/v1/gossip/sites", {
			method: "POST",
			body: JSON.stringify({ name, listUrl }),
			timeoutMs: 10_000,
		});
		if (res.status === 401) return null;
		if (!res.ok) {
			const data = (await res.json()) as { error?: string };
			throw new Error(data.error ?? `HTTP ${res.status}`);
		}
		const data = (await res.json()) as { ok: boolean; site?: GossipSite };
		return data.site ?? null;
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e));
	}
}

export async function deleteGossipSite(id: string): Promise<void> {
	const res = await apiFetch(`/api/v1/gossip/sites/${id}`, {
		method: "DELETE",
		timeoutMs: 10_000,
	});
	if (res.status === 401) throw new Error("Unauthorized");
	if (!res.ok) {
		const data = (await res.json()) as { error?: string };
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
}

export async function discoverGossipSite(
	siteId: string,
): Promise<DiscoveredItem[]> {
	try {
		const res = await apiFetch(`/api/v1/gossip/sites/${siteId}/discover`, {
			method: "POST",
			timeoutMs: 30_000,
		});
		if (res.status === 401) return [];
		if (!res.ok) {
			const data = (await res.json()) as { error?: string };
			throw new Error(data.error ?? `HTTP ${res.status}`);
		}
		const data = (await res.json()) as {
			ok: boolean;
			discovered?: DiscoveredItem[];
		};
		return data.discovered ?? [];
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e));
	}
}

export async function fetchGossipTopicFromUrl(
	url: string,
	siteName: string,
): Promise<{ id: string; title: string }> {
	const res = await apiFetch("/api/v1/gossip/topics/from-url", {
		method: "POST",
		body: JSON.stringify({ url, siteName }),
		timeoutMs: 60_000,
	});
	if (res.status === 401) throw new Error("Unauthorized");
	if (res.status === 409) throw new Error("DUPLICATE_URL");
	if (!res.ok) {
		const data = (await res.json()) as { error?: string };
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
	const data = (await res.json()) as {
		ok: boolean;
		topic?: { id: string; title: string };
	};
	if (!data.ok || !data.topic) throw new Error("Empty response");
	return data.topic;
}
