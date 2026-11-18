import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FieldError, FieldInput, PrimaryButton, SecondaryButton, useControlStyles } from '@/components/controls';
import { InlineConfirmation } from '@/components/inline-confirmation';
import { Screen, SheetHeader } from '@/components/screen';
import { formatFullDate } from '@/data/format';
import { archiveActivePair, logOut, resetOnboarding, saveDisplayName, simulateIncomingRevival, usesApi } from '@/data/ledger';
import { displayNameError } from '@/data/onboarding';
import { useLedger } from '@/hooks/use-ledger';
import { colors, spacing, typography, useThemeScheme } from '@/theme';

const archiveMessage = '記録と残高は残ります。解散後は記録を変更できません。復活申請が承認されると、同じペアを再開できます。';

export function SettingsScreen({ onClose }: { onClose?: () => void }) {
  const controls = useControlStyles();
  const color = colors[useThemeScheme()];
  const { viewer, activePair } = useLedger();
  const [name, setName] = useState(viewer.displayName);
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState<'archive' | 'fixture'>();
  const [error, setError] = useState<string>();
  const [profileError, setProfileError] = useState<string>();
  const [sessionError, setSessionError] = useState<string>();

  async function save() {
    setSubmitted(true);
    setProfileError(undefined);
    if (displayNameError(name)) return;
    try {
      await saveDisplayName(name);
      setName(name.trim());
      setSaved(true);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : '表示名を保存できませんでした。');
    }
  }

  function discardConfirmation() {
    setConfirmation(undefined);
    setError(undefined);
  }

  async function archive() {
    if (!activePair) return;
    try {
      await archiveActivePair();
      router.replace({ pathname: '/past-pairs/[id]', params: { id: activePair.id } });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'ペアを解散できませんでした。');
    }
  }

  async function closeSession(reset: boolean) {
    setSessionError(undefined);
    try {
      await (reset ? resetOnboarding() : logOut());
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'ログアウトできませんでした。');
    }
  }

  function simulate() {
    try {
      simulateIncomingRevival();
    } catch (error) {
      setError(error instanceof Error ? error.message : '復活申請を作れませんでした。');
    }
  }

  return (
    <Screen>
      {onClose ? <SheetHeader title="設定" onClose={onClose} /> : (
        <Text accessibilityRole="header" style={[typography.screenTitle, { color: color.ink }]}>設定</Text>
      )}
      <View style={styles.section}>
        <FieldInput
          label="表示名"
          value={name}
          onChangeText={value => { setName(value); setSaved(false); }}
          error={submitted ? displayNameError(name) : undefined}
          onSubmitEditing={save}
        />
        <FieldError message={profileError} />
        <PrimaryButton label="保存" onPress={save} />
        {saved && <Text accessibilityLiveRegion="polite" style={controls.label}>表示名を保存しました。</Text>}
      </View>

      {activePair && (
        <View style={[styles.section, styles.divider, { borderColor: color.hairline }]}>
          <Text accessibilityRole="header" style={controls.label}>ペア情報</Text>
          <Text style={controls.body}>{activePair.partner.displayName}</Text>
          <Text style={[controls.label, typography.numbers]}>連携した日 {formatFullDate(activePair.linkedOn)}</Text>
          {confirmation === 'archive' ? (
            <InlineConfirmation
              title="ペアを解散しますか？"
              message={archiveMessage}
              label="解散する"
              onConfirm={archive}
              onCancel={discardConfirmation}
              danger
              error={error}
            />
          ) : <SecondaryButton label="ペアを解散する" onPress={() => setConfirmation('archive')} danger />}
        </View>
      )}

      <View style={[styles.section, styles.divider, { borderColor: color.hairline }]}>
        <SecondaryButton label="過去のペア" onPress={() => router.push('/past-pairs')} />
        <SecondaryButton label="ログアウト" onPress={() => closeSession(false)} />
        <FieldError message={sessionError} />
      </View>

      {!usesApi && <View style={[styles.section, styles.divider, { borderColor: color.hairline }]}>
        <Text accessibilityRole="header" style={controls.label}>連携フローを試す（開発用）</Text>
        <SecondaryButton label="最初から（未ログイン）" onPress={() => closeSession(true)} />
        {activePair && (confirmation === 'fixture' ? (
          <InlineConfirmation
            title="復活申請が届いた状態にしますか？"
            message="現在のペアを解散し、パートナーからの復活申請を1件追加します。記録と残高はそのまま残ります。"
            label="試す"
            onConfirm={simulate}
            onCancel={discardConfirmation}
            error={error}
          />
        ) : <SecondaryButton label="届いた復活申請を試す" onPress={() => setConfirmation('fixture')} />)}
      </View>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  divider: { paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
