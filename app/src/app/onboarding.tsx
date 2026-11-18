import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FieldError, FieldInput, PrimaryButton, SecondaryButton, useControlStyles } from '@/components/controls';
import { Screen } from '@/components/screen';
import { formatShortDate } from '@/data/format';
import {
  acceptInvitation, issueInvitation, refreshLedger, reviewInvitation, saveDisplayName, signInLocally,
} from '@/data/ledger';
import {
  displayNameError, emailError, invitationCodeError, passwordError,
} from '@/data/onboarding';
import { pendingRevival } from '@/data/pair-lifecycle';
import type { ArchivedPair } from '@/data/types';
import { useLedger } from '@/hooks/use-ledger';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography, useThemeScheme } from '@/theme';

export default function OnboardingScreen() {
  const { appState, pastPairs, loading, loadError } = useLedger();

  if (loading || loadError) {
    return (
      <Screen>
        {loading ? <Heading>読み込み中</Heading> : <>
          <FieldError message={loadError} />
          <PrimaryButton label="再試行" onPress={refreshLedger} />
        </>}
      </Screen>
    );
  }

  switch (appState.status) {
    case 'signed-out':
      return <SignIn />;
    case 'needs-name':
      return <DisplayName />;
    case 'unpaired':
      return <Invitation pastPairs={pastPairs} />;
    case 'paired':
      return null;
  }
}

function SignIn() {
  const controls = useControlStyles();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const pending = useRef(false);

  async function submit() {
    if (pending.current) return;
    setSubmitted(true);
    setError(undefined);
    setNotice(undefined);
    if (emailError(email) || passwordError(password)) return;
    if (!supabase) {
      signInLocally(email, password);
      return;
    }

    pending.current = true;
    setBusy(true);
    const credentials = { email: email.trim(), password };
    try {
      const { data, error } = registering
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;
      if (registering && !data.session) setNotice('確認メールのリンクを開いてからログインしてください。');
    } catch (error) {
      setError(error instanceof Error ? error.message : '認証できませんでした。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Heading>新規登録・ログイン</Heading>
      <View style={styles.fields}>
        <FieldInput
          label="メールアドレス"
          value={email}
          onChangeText={value => { setEmail(value); setError(undefined); }}
          error={submitted ? emailError(email) : undefined}
          keyboardType="email-address"
          autoComplete={supabase ? 'username' : 'email'}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <FieldInput
          label="パスワード"
          value={password}
          onChangeText={value => { setPassword(value); setError(undefined); }}
          error={submitted ? passwordError(password) : undefined}
          secureTextEntry
          autoComplete={registering ? 'new-password' : 'current-password'}
          onSubmitEditing={submit}
        />
        {!supabase && <Text style={controls.label}>開発用のログインです。</Text>}
        <FieldError message={error} />
        {notice && <Text accessibilityLiveRegion="polite" style={controls.label}>{notice}</Text>}
      </View>
      <PrimaryButton label={busy ? '認証中…' : supabase ? (registering ? '登録' : 'ログイン') : '登録／ログイン'} onPress={submit} />
      {supabase && (
        <SecondaryButton label={registering ? 'ログインに戻る' : '新規登録する'} onPress={() => {
          if (pending.current) return;
          setRegistering(!registering);
          setSubmitted(false);
          setPassword('');
          setError(undefined);
          setNotice(undefined);
        }} />
      )}
    </Screen>
  );
}

function DisplayName() {
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setSubmitted(true);
    setError(undefined);
    if (displayNameError(name)) return;
    try {
      await saveDisplayName(name);
    } catch (error) {
      setError(error instanceof Error ? error.message : '表示名を保存できませんでした。');
    }
  }

  return (
    <Screen>
      <Heading>表示名を設定</Heading>
      <FieldInput
        label="表示名"
        value={name}
        onChangeText={setName}
        error={submitted ? displayNameError(name) : undefined}
        onSubmitEditing={submit}
      />
      <FieldError message={error} />
      <PrimaryButton label="保存" onPress={submit} />
    </Screen>
  );
}

function Invitation({ pastPairs }: { pastPairs: readonly ArchivedPair[] }) {
  const controls = useControlStyles();
  const color = colors[useThemeScheme()];
  const [invitation, setInvitation] = useState<Awaited<ReturnType<typeof issueInvitation>>>();
  const [entering, setEntering] = useState(false);
  const [confirming, setConfirming] = useState<(Awaited<ReturnType<typeof reviewInvitation>> & { reviewedCode: string })>();
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);

  async function review() {
    if (pending.current) return;
    setSubmitted(true);
    setError(undefined);
    if (invitationCodeError(code)) return;
    pending.current = true;
    try {
      const reviewedCode = code.trim();
      setConfirming({ ...await reviewInvitation(reviewedCode), reviewedCode });
    } catch (error) {
      setError(error instanceof Error ? error.message : '招待を確認できませんでした。');
    } finally {
      pending.current = false;
    }
  }

  if (confirming) {
    const { partnerName, archivedPairId, reviewedCode } = confirming;

    async function continueInvitation() {
      if (pending.current) return;
      if (archivedPairId) {
        setConfirming(undefined);
        router.push({ pathname: '/past-pairs/[id]', params: { id: archivedPairId } });
        return;
      }
      pending.current = true;
      try {
        const result = await acceptInvitation(reviewedCode);
        if (result?.archivedPairId) {
          setConfirming(undefined);
          router.push({ pathname: '/past-pairs/[id]', params: { id: result.archivedPairId } });
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : '連携できませんでした。');
      } finally {
        pending.current = false;
      }
    }

    return (
      <Screen>
        <Heading>招待確認</Heading>
        <Text style={controls.body}>
          {archivedPairId ? `${partnerName}さんとの過去のペアがあります。` : `${partnerName}さんと連携しますか？`}
        </Text>
        <View style={styles.actions}>
          <PrimaryButton label={archivedPairId ? '復活申請に進む' : '連携する'} onPress={continueInvitation} />
          <SecondaryButton label="やめる" onPress={() => {
            if (pending.current) return;
            setConfirming(undefined);
            setError(undefined);
          }} />
        </View>
        <FieldError message={error} />
      </Screen>
    );
  }

  async function showCode() {
    if (pending.current) return;
    pending.current = true;
    setError(undefined);
    try {
      setInvitation(await issueInvitation());
      setEntering(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : '招待コードを発行できませんでした。');
    } finally {
      pending.current = false;
    }
  }

  return (
    <Screen>
      <Text style={controls.body}>パートナーと連携すると、2人の支払いを記録できます</Text>
      {pastPairs.map(pair => {
        const request = pendingRevival(pair);
        if (!request) return null;
        return (
          <View key={pair.id} style={styles.fields}>
            <Text style={controls.body}>{request.requesterSlot === pair.viewer.slot
              ? `${pair.partner.displayName}への復活申請は承認待ちです。`
              : `${pair.partner.displayName}から復活申請が届いています。`}</Text>
            <SecondaryButton
              label="復活申請を確認する"
              onPress={() => router.push({ pathname: '/revival/[pairId]', params: { pairId: pair.id, requestId: request.id } })}
            />
          </View>
        );
      })}
      <View style={styles.fields}>
        <View style={styles.actions}>
          {entering
            ? <SecondaryButton label="招待コードを作る" onPress={showCode} />
            : <PrimaryButton label="招待コードを作る" onPress={showCode} />}
          <SecondaryButton label="招待コードを入力" onPress={() => setEntering(true)} />
        </View>
        {invitation && !entering && (
          <View style={[styles.code, { borderColor: color.hairline }]}>
            <Text style={controls.label}>招待コード</Text>
            <Text selectable style={[controls.body, typography.heading, typography.numbers]}>{invitation.code}</Text>
            <Text style={controls.label}>有効期限 {formatShortDate(invitation.expiresOn)}（7日間）</Text>
          </View>
        )}
        <FieldError message={error} />
        {entering && (
          <>
            <FieldInput
              label="招待コード（8文字）"
              value={code}
              onChangeText={setCode}
              error={submitted ? invitationCodeError(code) : undefined}
              autoCapitalize="characters"
              autoCorrect={false}
              onSubmitEditing={review}
            />
            <PrimaryButton label="確認する" onPress={review} />
          </>
        )}
      </View>
      <View style={styles.actions}>
        <SecondaryButton label="過去のペア" onPress={() => router.push('/past-pairs')} />
        <SecondaryButton label="設定" onPress={() => router.push('/account-settings')} />
      </View>
    </Screen>
  );
}

function Heading({ children }: { children: string }) {
  const color = colors[useThemeScheme()];
  return <Text accessibilityRole="header" style={[typography.screenTitle, { color: color.ink }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  code: { gap: spacing.xs, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
