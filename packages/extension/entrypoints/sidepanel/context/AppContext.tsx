import type { ContentDraft, FieldFillResult } from "@51publisher/shared";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext } from "react";
import { usePersistedState } from "../hooks/usePersistedState";

type Mode = "empty" | "generating" | "draft" | "filling" | "filled" | "partial";

interface AppState {
	topic: string;
	draft: ContentDraft | null;
	mode: Mode;
	error: string;
	results: FieldFillResult[];
	authenticated: boolean;
}

interface AppContextType extends AppState {
	setTopic: (topic: string) => void;
	setDraft: (draft: ContentDraft | null) => void;
	setMode: (mode: Mode) => void;
	setError: (error: string) => void;
	setResults: (results: FieldFillResult[]) => void;
	setAuthenticated: (authenticated: boolean) => void;
	reset: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

interface AppProviderProps {
	children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
	const [topic, setTopicPersisted] = usePersistedState("app-topic", "");
	const [draft, setDraftPersisted] = usePersistedState<ContentDraft | null>(
		"app-draft",
		null,
	);
	const [mode, setModePersisted] = usePersistedState<Mode>("app-mode", "empty");
	const [error, setErrorPersisted] = usePersistedState("app-error", "");
	const [results, setResultsPersisted] = usePersistedState<FieldFillResult[]>(
		"app-results",
		[],
	);
	const [authenticated, setAuthenticatedPersisted] = usePersistedState(
		"app-authenticated",
		false,
	);

	const setTopic = useCallback(
		(value: string) => {
			setTopicPersisted(value);
		},
		[setTopicPersisted],
	);

	const setDraft = useCallback(
		(value: ContentDraft | null) => {
			setDraftPersisted(value);
		},
		[setDraftPersisted],
	);

	const setMode = useCallback(
		(value: Mode) => {
			setModePersisted(value);
		},
		[setModePersisted],
	);

	const setError = useCallback(
		(value: string) => {
			setErrorPersisted(value);
		},
		[setErrorPersisted],
	);

	const setResults = useCallback(
		(value: FieldFillResult[]) => {
			setResultsPersisted(value);
		},
		[setResultsPersisted],
	);

	const setAuthenticated = useCallback(
		(value: boolean) => {
			setAuthenticatedPersisted(value);
		},
		[setAuthenticatedPersisted],
	);

	const reset = useCallback(() => {
		setTopicPersisted("");
		setDraftPersisted(null);
		setModePersisted("empty");
		setErrorPersisted("");
		setResultsPersisted([]);
		setAuthenticatedPersisted(false);
	}, [
		setTopicPersisted,
		setDraftPersisted,
		setModePersisted,
		setErrorPersisted,
		setResultsPersisted,
		setAuthenticatedPersisted,
	]);

	return (
		<AppContext.Provider
			value={{
				topic,
				draft,
				mode,
				error,
				results,
				authenticated,
				setTopic,
				setDraft,
				setMode,
				setError,
				setResults,
				setAuthenticated,
				reset,
			}}
		>
			{children}
		</AppContext.Provider>
	);
}

export function useAppContext() {
	const context = useContext(AppContext);
	if (!context) {
		throw new Error("useAppContext must be used within an AppProvider");
	}
	return context;
}
