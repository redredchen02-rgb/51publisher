import { fetchWithTimeout } from "@51publisher/shared";
import { clearToken, getAuthHeaders } from "./auth-client";
import { getBackendUrl } from "./backend-url";

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
	try {
		const headers = await getAuthHeaders();
		const base = await getBackendUrl();
		const res = await fetchWithTimeout(`${base}/api/v1/gossip/sites`, {
			headers,
			timeoutMs: 10_000,
		});
		if (res.status === 401) { await clearToken(); return []; }
		if (!res.ok) return [];
		const data = await res.json() as { ok: boolean; sites?: GossipSite[] };
		return data.ok && data.sites ? data.sites : [];
	} catch {
		return [];
	}
}

export async function createGossipSite(name: string, listUrl: string): Promise<GossipSite | null> {
	try {
		const headers = await getAuthHeaders();
		const base = await getBackendUrl();
		const res = await fetchWithTimeout(`${base}/api/v1/gossip/sites`, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ name, listUrl }),
			timeoutMs: 10_000,
		});
		if (res.status === 401) { await clearToken(); return null; }
		if (!res.ok) {
			const data = await res.json() as { error?: string };
			throw new Error(data.error ?? `HTTP ${res.status}`);
		}
		const data = await res.json() as { ok: boolean; site?: GossipSite };
		return data.site ?? null;
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e));
	}
}

export async function deleteGossipSite(id: string): Promise<boolean> {
	try {
		const headers = await getAuthHeaders();
		const base = await getBackendUrl();
		const res = await fetchWithTimeout(`${base}/api/v1/gossip/sites/${id}`, {
			method: "DELETE",
			headers,
			timeoutMs: 10_000,
		});
		if (res.status === 401) { await clearToken(); return false; }
		return res.ok;
	} catch {
		return false;
	}
}

export async function discoverGossipSite(siteId: string): Promise<DiscoveredItem[]> {
	try {
		const headers = await getAuthHeaders();
		const base = await getBackendUrl();
		const res = await fetchWithTimeout(`${base}/api/v1/gossip/sites/${siteId}/discover`, {
			method: "POST",
			headers,
			timeoutMs: 30_000,
		});
		if (res.status === 401) { await clearToken(); return []; }
		if (!res.ok) {
			const data = await res.json() as { error?: string };
			throw new Error(data.error ?? `HTTP ${res.status}`);
		}
		const data = await res.json() as { ok: boolean; discovered?: DiscoveredItem[] };
		return data.discovered ?? [];
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e));
	}
}

export async function fetchGossipTopicFromUrl(url: string, siteName: string): Promise<{ id: string; title: string }> {
	const headers = await getAuthHeaders();
	const base = await getBackendUrl();
	const res = await fetchWithTimeout(`${base}/api/v1/gossip/topics/from-url`, {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify({ url, siteName }),
		timeoutMs: 60_000,
	});
	if (res.status === 401) { await clearToken(); throw new Error("Unauthorized"); }
	if (!res.ok) {
		const data = await res.json() as { error?: string };
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
	const data = await res.json() as { ok: boolean; topic?: { id: string; title: string } };
	if (!data.ok || !data.topic) throw new Error("Empty response");
	return data.topic;
}
