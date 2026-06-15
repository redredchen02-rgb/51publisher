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

export async function fetchGossipSites(
	fetchFn?: typeof fetch,
): Promise<GossipSite[]> {
	const headers = await getAuthHeaders();
	const base = await getBackendUrl();
	const url = `${base}/api/v1/gossip/sites`;
	const res = fetchFn
		? await fetchFn(url, { headers })
		: await fetchWithTimeout(url, { headers, timeoutMs: 10_000 });
	if (res.status === 401) {
		await clearToken();
		throw new Error("Unauthorized");
	}
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
	fetchFn?: typeof fetch,
): Promise<GossipSite | null> {
	try {
		const headers = await getAuthHeaders();
		const base = await getBackendUrl();
		const url = `${base}/api/v1/gossip/sites`;
		const init = {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ name, listUrl }),
		};
		const res = fetchFn
			? await fetchFn(url, init)
			: await fetchWithTimeout(url, { ...init, timeoutMs: 10_000 });
		if (res.status === 401) {
			await clearToken();
			return null;
		}
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

export async function deleteGossipSite(
	id: string,
	fetchFn?: typeof fetch,
): Promise<void> {
	const headers = await getAuthHeaders();
	const base = await getBackendUrl();
	const url = `${base}/api/v1/gossip/sites/${id}`;
	const init = { method: "DELETE", headers };
	const res = fetchFn
		? await fetchFn(url, init)
		: await fetchWithTimeout(url, { ...init, timeoutMs: 10_000 });
	if (res.status === 401) {
		await clearToken();
		throw new Error("Unauthorized");
	}
	if (!res.ok) {
		const data = (await res.json()) as { error?: string };
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
}

export async function discoverGossipSite(
	siteId: string,
	fetchFn?: typeof fetch,
): Promise<DiscoveredItem[]> {
	try {
		const headers = await getAuthHeaders();
		const base = await getBackendUrl();
		const url = `${base}/api/v1/gossip/sites/${siteId}/discover`;
		const init = { method: "POST", headers };
		const res = fetchFn
			? await fetchFn(url, init)
			: await fetchWithTimeout(url, { ...init, timeoutMs: 30_000 });
		if (res.status === 401) {
			await clearToken();
			return [];
		}
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
	fetchFn?: typeof fetch,
): Promise<{ id: string; title: string }> {
	const headers = await getAuthHeaders();
	const base = await getBackendUrl();
	const endpoint = `${base}/api/v1/gossip/topics/from-url`;
	const init = {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify({ url, siteName }),
	};
	const res = fetchFn
		? await fetchFn(endpoint, init)
		: await fetchWithTimeout(endpoint, { ...init, timeoutMs: 60_000 });
	if (res.status === 401) {
		await clearToken();
		throw new Error("Unauthorized");
	}
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
