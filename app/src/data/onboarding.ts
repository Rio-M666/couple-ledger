import { businessDate } from './format.ts';

export function emailError(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? undefined : 'メールアドレスを正しい形式で入力してください。';
}

export function passwordError(value: string) {
  return value.trim() ? undefined : 'パスワードを入力してください。';
}

export function displayNameError(value: string) {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= 40 ? undefined : '表示名を1〜40字で入力してください。';
}

export function invitationCodeError(value: string) {
  const code = value.trim().toUpperCase().replaceAll('-', '');
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? undefined : '招待コードを英数字8文字で入力してください。';
}

export function sampleInvitation(now = new Date()) {
  // Fixture for display only. The API will issue and validate real invitations.
  return { code: 'K7M4R9T2', expiresOn: businessDate(new Date(now.getTime() + 7 * 86_400_000)) };
}
