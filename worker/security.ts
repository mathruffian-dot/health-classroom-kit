import { assert } from './validation';
import { type StorageEnv, supabaseUrl } from './storage';
const encoder = new TextEncoder();
export async function hash(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
export function checkOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    assert(origin === new URL(request.url).origin, '來源驗證失敗，請從相同網站操作', 403);
    assert(
      request.method === 'DELETE' ||
        request.headers.get('Content-Type')?.split(';')[0] === 'application/json',
      '請使用 JSON 請求',
      415,
    );
  }
  assert(request.headers.get('Sec-Fetch-Site') !== 'cross-site', '不接受跨網站請求', 403);
}
export function demoAllowed(request: Request, env: StorageEnv): boolean {
  return (
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname) ||
    env.ALLOW_PUBLIC_DEMO === 'true'
  );
}
export function teacherAllowed(email: string, env: StorageEnv): boolean {
  return (env.TEACHER_EMAILS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .includes(email.toLowerCase());
}
export async function verifyCloudTeacher(
  accessToken: string,
  env: StorageEnv,
): Promise<{ id: string; email: string }> {
  assert(env.SUPABASE_PUBLISHABLE_KEY, '尚未設定 SUPABASE_PUBLISHABLE_KEY', 503);
  const r = await fetch(`${supabaseUrl(env)}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  assert(r.ok, '教師登入已失效，請重新登入', 401);
  const user = (await r.json()) as { id: string; email: string };
  assert(
    typeof user.id === 'string' &&
      typeof user.email === 'string' &&
      teacherAllowed(user.email, env),
    '此帳號未列入教師名單',
    403,
  );
  return user;
}
