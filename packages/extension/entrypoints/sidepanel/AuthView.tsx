import { useState } from "react";
import { login } from "../../lib/auth-client";

export function AuthView({ onLogin }: { onLogin: () => void }) {
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!password.trim()) {
			setError("请输入密码");
			return;
		}
		setLoading(true);
		setError("");
		const result = await login(password);
		setLoading(false);
		if (result.ok) {
			onLogin();
		} else {
			setError(result.error ?? "登录失败");
		}
	}

	return (
		<div style={{ padding: "var(--space-2xl)", textAlign: "center" }}>
			<h2 style={{ fontSize: "var(--font-xl)", margin: "0 0 var(--space-xl)" }}>
				登录
			</h2>
			<form onSubmit={handleSubmit}>
				<div className="field-label">密码</div>
				<input
					type="password"
					className="field-input"
					value={password}
					disabled={loading}
					onChange={(e) => setPassword(e.target.value)}
				/>
				{error && (
					<p
						role="alert"
						className="text-error text-base"
						style={{ margin: "var(--space-md) 0 0" }}
					>
						{error}
					</p>
				)}
				<button
					type="submit"
					disabled={loading}
					className="btn btn-primary"
					style={{ marginTop: "var(--space-xl)" }}
				>
					{loading ? "登录中…" : "登录"}
				</button>
			</form>
		</div>
	);
}
