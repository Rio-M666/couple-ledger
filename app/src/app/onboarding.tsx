import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FieldInput, PrimaryButton, SecondaryButton, useControlStyles } from '@/components/controls';
import { Screen } from '@/components/screen';
import { formatShortDate } from '@/data/format';
import { acceptInvitation, saveDisplayName, signInLocally } from '@/data/home';
import {
  displayNameError, emailError, invitationCodeError, passwordError, sampleInvitation,
} from '@/data/onboarding';
import { useLedger } from '@/hooks/use-ledger';
import { colors, spacing, typography, useThemeScheme } from '@/theme';

export default function OnboardingScreen() {
  const { appState, partner } = useLedger();

  switch (appState.status) {
    case 'signed-out':
      return <SignIn />;
    case 'needs-name':
      return <DisplayName />;
    case 'unpaired':
      return <Invitation partnerName={partner.displayName} />;
    case 'paired':
      return null;
  }
}

function SignIn() {
  const controls = useControlStyles();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function submit() {
    setSubmitted(true);
    signInLocally(email, password);
  }

  return (
    <Screen>
      <Heading>新規登録・ログイン</Heading>
      <View style={styles.fields}>
        <FieldInput
          label="メールアドレス"
          value={email}
          onChangeText={setEmail}
          error={submitted ? emailError(email) : undefined}
          keyboardType="email-address"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <FieldInput
          label="パスワード"
          value={password}
          onChangeText={setPassword}
          error={submitted ? passwordError(password) : undefined}
          secureTextEntry
          autoComplete="current-password"
          onSubmitEditing={submit}
        />
        <Text style={controls.label}>開発用のログインです。</Text>
      </View>
      <PrimaryButton label="登録／ログイン" onPress={submit} />
    </Screen>
  );
}

function DisplayName() {
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function submit() {
    setSubmitted(true);
    saveDisplayName(name);
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
      <PrimaryButton label="保存" onPress={submit} />
    </Screen>
  );
}

function Invitation({ partnerName }: { partnerName: string }) {
  const controls = useControlStyles();
  const color = colors[useThemeScheme()];
  const [invitation, setInvitation] = useState<ReturnType<typeof sampleInvitation>>();
  const [entering, setEntering] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function review() {
    setSubmitted(true);
    if (!invitationCodeError(code)) setConfirming(true);
  }

  if (confirming) {
    return (
      <Screen>
        <Heading>招待確認</Heading>
        <Text style={controls.body}>{partnerName}さんと連携しますか？</Text>
        <View style={styles.actions}>
          <PrimaryButton label="連携する" onPress={() => acceptInvitation(code)} />
          <SecondaryButton label="やめる" onPress={() => setConfirming(false)} />
        </View>
      </Screen>
    );
  }

  function showCode() {
    setInvitation(sampleInvitation());
    setEntering(false);
  }

  return (
    <Screen>
      <Text style={controls.body}>パートナーと連携すると、2人の支払いを記録できます</Text>
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
