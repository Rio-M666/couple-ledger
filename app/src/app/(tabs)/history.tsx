import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChoiceGroup, Disclosure, FieldInput, PrimaryButton } from '@/components/controls';
import { Screen } from '@/components/screen';
import { TimelineRow } from '@/components/timeline-row';
import { expenseStatusLabels } from '@/data/expense';
import { formatDateHeading, isBusinessDate } from '@/data/format';
import { groupHistory, type ExpenseFilters, type HistoryKind } from '@/data/history';
import { useLedger } from '@/hooks/use-ledger';
import { colors, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

const kinds = [
  { value: 'all', label: 'すべて' },
  { value: 'expense', label: '支払い' },
  { value: 'settlement', label: '精算' },
  { value: 'promise', label: '約束' },
] as const;
const statuses = [
  { value: 'all', label: 'すべて' },
  { value: 'unpaid', label: expenseStatusLabels.unpaid },
  { value: 'partial', label: expenseStatusLabels.partial },
  { value: 'settled', label: expenseStatusLabels.settled },
  { value: 'gift', label: expenseStatusLabels.gift },
  { value: 'canceled', label: expenseStatusLabels.canceled },
] as const;
const initialFilters: ExpenseFilters = { payer: 'all', status: 'all', from: '', through: '' };
const dateInputProps = { placeholder: 'YYYY-MM-DD', autoCapitalize: 'none', autoCorrect: false } as const;

export default function HistoryScreen() {
  const styles = stylesByScheme[useThemeScheme()];
  const { viewer, partner, timeline } = useLedger();
  const [kind, setKind] = useState<HistoryKind>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const fromError = rangeDateError(filters.from);
  const throughError = rangeDateError(filters.through) ?? (
    !fromError && filters.from && filters.through && filters.through < filters.from
      ? '開始日以降の日付を入力してください。'
      : undefined
  );
  const groups = groupHistory(timeline, kind, query, {
    ...filters,
    from: fromError ? '' : filters.from,
    through: throughError ? '' : filters.through,
  });
  const now = new Date();

  function setFilter<Key extends keyof ExpenseFilters>(key: Key, value: ExpenseFilters[Key]) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  return (
    <Screen>
      <Text accessibilityRole="header" style={styles.title}>履歴</Text>
      <View style={styles.searchControls}>
        <ChoiceGroup label="記録の種類" options={kinds} value={kind} onChange={setKind} />
        <FieldInput
          label="タイトルで検索"
          placeholder="タイトルを入力"
          inputMode="search"
          autoCorrect={false}
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
        />
        {kind === 'expense' && (
          <View style={styles.filterControls}>
            <Disclosure label="支払いの絞り込み" expanded={expanded} onPress={() => setExpanded(!expanded)} />
            {expanded && (
              <>
                <View style={styles.choiceField}>
                  <Text style={styles.label}>支払者</Text>
                  <ChoiceGroup
                    label="支払者"
                    options={[
                      { value: 'all', label: 'すべて' },
                      { value: viewer.slot, label: viewer.displayName },
                      { value: partner.slot, label: partner.displayName },
                    ]}
                    value={filters.payer}
                    onChange={value => setFilter('payer', value)}
                  />
                </View>
                <View style={styles.choiceField}>
                  <Text style={styles.label}>精算状態</Text>
                  <ChoiceGroup
                    label="精算状態"
                    options={statuses}
                    value={filters.status}
                    onChange={value => setFilter('status', value)}
                  />
                </View>
                <View style={styles.dateRange}>
                  <FieldInput
                    {...dateInputProps}
                    label="開始日"
                    value={filters.from}
                    onChangeText={value => setFilter('from', value)}
                    error={fromError}
                    containerStyle={styles.dateField}
                  />
                  <FieldInput
                    {...dateInputProps}
                    label="終了日"
                    value={filters.through}
                    onChangeText={value => setFilter('through', value)}
                    error={throughError}
                    containerStyle={styles.dateField}
                  />
                </View>
              </>
            )}
          </View>
        )}
      </View>
      {groups.length === 0 ? (
        <View style={styles.searchControls}>
          <Text accessibilityLiveRegion="polite" style={styles.empty}>
            {timeline.length === 0 ? 'まだ記録がありません' : '条件に一致する記録がありません'}
          </Text>
          {timeline.length === 0 && (
            <PrimaryButton label="支払いを追加" onPress={() => router.push('/expense/new')} />
          )}
        </View>
      ) : (
        <View style={styles.timeline}>
          {groups.map(({ date, items }) => (
            <View key={date}>
              <View style={styles.dateHeader}>
                <Text accessibilityRole="header" style={styles.label}>{formatDateHeading(date, now)}</Text>
                <View aria-hidden style={styles.dateRule} />
              </View>
              {items.map((item, index) => (
                <TimelineRow key={item.id} item={item} first={index === 0} last={index === items.length - 1} />
              ))}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function rangeDateError(value: string) {
  return value && !isBusinessDate(value) ? 'YYYY-MM-DD形式で入力してください。' : undefined;
}

function createStyles(color: ColorTokens) {
  return StyleSheet.create({
    title: { ...typography.screenTitle, color: color.ink },
    label: { ...typography.small, color: color.inkMuted },
    empty: { ...typography.body, color: color.inkMuted },
    searchControls: { gap: spacing.md },
    filterControls: { gap: spacing.lg },
    choiceField: { gap: spacing.xs },
    dateRange: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    dateField: { flexGrow: 1, flexBasis: spacing.xxxl * 3 },
    timeline: { gap: spacing.lg },
    dateHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    dateRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.hairline },
  });
}

const stylesByScheme = {
  light: createStyles(colors.light),
  dark: createStyles(colors.dark),
};
