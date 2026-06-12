import { useState, useCallback } from 'react';

type LoadingState = 'idle' | 'loading' | 'error';

interface UseLoadingStateReturn {
	state: LoadingState;
	progress: number;
	message: string;
	error: string;
	startLoading: (message: string) => void;
	updateProgress: (progress: number) => void;
	completeLoading: () => void;
	handleError: (error: string) => void;
}

export function useLoadingState(): UseLoadingStateReturn {
	const [state, setState] = useState<LoadingState>('idle');
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState('');
	const [error, setError] = useState('');

	const startLoading = useCallback((msg: string) => {
		setState('loading');
		setProgress(0);
		setMessage(msg);
		setError('');
	}, []);

	const updateProgress = useCallback((p: number) => {
		setProgress(p);
	}, []);

	const completeLoading = useCallback(() => {
		setState('idle');
		setProgress(0);
		setMessage('');
		setError('');
	}, []);

	const handleError = useCallback((err: string) => {
		setState('error');
		setError(err);
		setProgress(0);
	}, []);

	return {
		state,
		progress,
		message,
		error,
		startLoading,
		updateProgress,
		completeLoading,
		handleError,
	};
}
