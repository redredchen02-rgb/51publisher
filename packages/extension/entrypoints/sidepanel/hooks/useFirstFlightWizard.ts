import type {
	FirstFlightRehearseResult,
	FirstFlightRunResult,
} from "@51publisher/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api-fetch";
import {
	firstFlightRehearse,
	firstFlightRun,
	firstFlightStatus,
} from "../../../lib/messaging";
import type { PreflightResponse, Step } from "../firstflight/types";
import { lastLabel } from "../firstflight/types";

export interface UseFirstFlightWizardReturn {
	step: Step;
	setStep: (s: Step) => void;
	preflight: PreflightResponse | null;
	preflightError: string | null;
	rehearsing: boolean;
	rehearsal: FirstFlightRehearseResult | null;
	gesture: string;
	setGesture: (g: string) => void;
	dispatching: boolean;
	runResult: FirstFlightRunResult | null;
	resetNotice: string | null;
	warningRef: React.RefObject<HTMLDivElement | null>;
	gestureOk: boolean;
	canForwardFrom2: boolean;
	handleRehearse: () => Promise<void>;
	handleRun: () => Promise<void>;
	reRehearse: () => void;
}

export function useFirstFlightWizard(
	tabId: number,
	itemId: string,
	host: string,
): UseFirstFlightWizardReturn {
	const [step, setStep] = useState<Step>(1);
	const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
	const [preflightError, setPreflightError] = useState<string | null>(null);
	const [rehearsing, setRehearsing] = useState(false);
	const [rehearsal, setRehearsal] = useState<FirstFlightRehearseResult | null>(
		null,
	);
	const [gesture, setGesture] = useState("");
	const [dispatching, setDispatching] = useState(false);
	const [runResult, setRunResult] = useState<FirstFlightRunResult | null>(null);
	const [resetNotice, setResetNotice] = useState<string | null>(null);

	const warningRef = useRef<HTMLDivElement>(null);
	const selfArmingRef = useRef(false);

	useEffect(() => {
		let alive = true;
		void (async () => {
			try {
				const res = await apiFetch("/api/v1/preflight");
				if (!res.ok) {
					if (alive) setPreflightError(`preflight 自检不可达 (${res.status})`);
					return;
				}
				const data = (await res.json()) as PreflightResponse;
				if (alive) setPreflight(data);
			} catch {
				if (alive) setPreflightError("无法连接后端自检接口");
			}
		})();
		return () => {
			alive = false;
		};
	}, []);

	useEffect(() => {
		let alive = true;
		const tick = async () => {
			try {
				const s = await firstFlightStatus();
				if (!alive) return;
				if (s.bad) {
					setResetNotice("首飞授权被强制重置(检测到异常标记)");
					setStep((cur) => (cur > 2 ? 1 : cur));
				}
			} catch {
				/* ignore */
			}
		};
		const id = setInterval(() => void tick(), 1500);
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, []);

	useEffect(() => {
		if (step === 3) warningRef.current?.focus();
	}, [step]);

	const gestureOk = gesture.trim() === lastLabel(host);
	const canForwardFrom2 = rehearsal?.ok === true;

	const handleRehearse = useCallback(async () => {
		setRehearsing(true);
		setRehearsal(null);
		try {
			const res = await firstFlightRehearse(tabId, itemId);
			setRehearsal(res);
		} catch {
			setRehearsal({
				ok: false,
				dryRunGreen: false,
				groundingOk: false,
				reasons: [],
				error: "排演失败,请重试",
			});
		} finally {
			setRehearsing(false);
		}
	}, [tabId, itemId]);

	const handleRun = useCallback(async () => {
		if (!gestureOk) return;
		setDispatching(true);
		setStep(4);
		selfArmingRef.current = true;
		try {
			const res = await firstFlightRun(tabId, itemId);
			setRunResult(res);
			setStep(5);
		} catch {
			setRunResult({
				ok: false,
				phase: "arm",
				reverted: true,
				error: "执行失败,请重新排演并重试",
			});
			setStep(5);
		} finally {
			selfArmingRef.current = false;
			setDispatching(false);
		}
	}, [gestureOk, tabId, itemId]);

	const reRehearse = useCallback(() => {
		setRunResult(null);
		setRehearsal(null);
		setGesture("");
		setStep(2);
	}, []);

	return {
		step,
		setStep,
		preflight,
		preflightError,
		rehearsing,
		rehearsal,
		gesture,
		setGesture,
		dispatching,
		runResult,
		resetNotice,
		warningRef,
		gestureOk,
		canForwardFrom2,
		handleRehearse,
		handleRun,
		reRehearse,
	};
}
