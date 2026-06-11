import { assertUrlSafe } from './scraper/ssrf-guard.js';

export async function sendAlert(message: string): Promise<void> {
  if (process.env.TG_ENABLED !== 'true') return;

  const token = process.env.TG_BOT_TOKEN ?? '';
  const chatId = process.env.TG_CHAT_ID ?? '';

  // Redact admin domain from message (self-protection against accidental leaks)
  const adminHost = extractHost(process.env.CORS_ORIGIN ?? '');
  const safeMessage = adminHost ? message.replaceAll(adminHost, '[REDACTED]') : message;
  if (safeMessage !== message) {
    console.warn('[telegram] admin domain redacted from alert message');
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    // assertUrlSafe: checks resolved IP is not in private ranges (closes redirect-chain SSRF)
    await assertUrlSafe(url);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: safeMessage }),
      redirect: 'error',
    });
  } catch (e) {
    console.warn('[telegram] sendAlert failed (fire-and-forget):', e instanceof Error ? e.message : e);
  }
}

function extractHost(corsOrigin: string): string {
  // CORS_ORIGIN may be like 'chrome-extension://...' or 'https://admin.example.com'
  // Extract just the hostname for redaction matching
  const first = corsOrigin.split(',')[0]!.trim();
  try {
    return new URL(first).hostname;
  } catch {
    return '';
  }
}
