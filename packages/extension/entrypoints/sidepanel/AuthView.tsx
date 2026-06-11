import { useState } from 'react';
import { login } from '../../lib/auth-client';

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  fontSize: 13,
  border: '1px solid #d9d9d9',
  borderRadius: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#555',
  display: 'block',
  margin: '8px 0 2px',
};

export function AuthView({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError('请输入密码');
      return;
    }
    setLoading(true);
    setError('');
    const result = await login(password);
    setLoading(false);
    if (result.ok) {
      onLogin();
    } else {
      setError(result.error ?? '登录失败');
    }
  }

  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>登录</h2>
      <form onSubmit={handleSubmit}>
        <label style={labelStyle}>密码</label>
        <input
          type="password"
          style={inputStyle}
          value={password}
          disabled={loading}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && (
          <p role="alert" style={{ color: '#cf1322', fontSize: 13, margin: '8px 0 0' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: 16,
            padding: '6px 20px',
            fontSize: 13,
            background: '#1677ff',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
