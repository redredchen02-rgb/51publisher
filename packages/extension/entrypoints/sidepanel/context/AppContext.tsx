import type { ContentDraft, FieldFillResult } from "@51publisher/shared";
import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

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

const initialState: AppState = {
	topic: "",
	draft: null,
	mode: "empty",
	error: "",
	results: [],
	authenticated: false,
};

interface AppProviderProps {
	children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
	const [state, setState] = useState<AppState>(initialState);

	const setTopic = useCallback((topic: string) => {
		setState((prev) => ({ ...prev, topic }));
	}, []);

	const setDraft = useCallback((draft: ContentDraft | null) => {
		setState((prev) => ({ ...prev, draft }));
	}, []);

	const setMode = useCallback((mode: Mode) => {
		setState((prev) => ({ ...prev, mode }));
	}, []);

	const setError = useCallback((error: string) => {
		setState((prev) => ({ ...prev, error }));
	}, []);

	const setResults = useCallback((results: FieldFillResult[]) => {
		setState((prev) => ({ ...prev, results }));
	}, []);

	const setAuthenticated = useCallback((authenticated: boolean) => {
		setState((prev) => ({ ...prev, authenticated }));
	}, []);

	const reset = useCallback(() => {
		setState(initialState);
	}, []);

	return (
		<AppContext.Provider
			value={{
				...state,
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
