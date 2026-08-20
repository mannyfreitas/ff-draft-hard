import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type Position = 'All' | 'QB' | 'RB' | 'WR' | 'TE';

type Player = {
  id: string;
  name: string;
  team: string;
  position: Exclude<Position, 'All'>;
  rank: number;
  adp: string;
  bye: number;
  accent: string;
};

const players: Player[] = [
  { id: '1', name: 'Bijan Robinson', team: 'ATL', position: 'RB', rank: 1, adp: '1.02', bye: 5, accent: '#d96b45' },
  { id: '2', name: 'Ja\'Marr Chase', team: 'CIN', position: 'WR', rank: 2, adp: '1.03', bye: 10, accent: '#5e79c8' },
  { id: '3', name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', rank: 3, adp: '1.05', bye: 8, accent: '#d9a441' },
  { id: '4', name: 'CeeDee Lamb', team: 'DAL', position: 'WR', rank: 4, adp: '1.06', bye: 10, accent: '#5880a8' },
  { id: '5', name: 'Amon-Ra St. Brown', team: 'DET', position: 'WR', rank: 5, adp: '1.08', bye: 8, accent: '#d9a441' },
  { id: '6', name: 'Jalen Hurts', team: 'PHI', position: 'QB', rank: 6, adp: '2.04', bye: 9, accent: '#74a86b' },
  { id: '7', name: 'Brock Bowers', team: 'LV', position: 'TE', rank: 7, adp: '2.06', bye: 8, accent: '#7897a9' },
  { id: '8', name: 'Malik Nabers', team: 'NYG', position: 'WR', rank: 8, adp: '2.08', bye: 14, accent: '#6b86bd' },
];

const rosterSlots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'];

export default function App() {
  const [activeView, setActiveView] = useState<'board' | 'players'>('board');
  const [position, setPosition] = useState<Position>('All');
  const [query, setQuery] = useState('');
  const [draftedIds, setDraftedIds] = useState<string[]>([]);

  const availablePlayers = useMemo(
    () => players.filter((player) => {
      const matchesPosition = position === 'All' || player.position === position;
      const matchesQuery = player.name.toLowerCase().includes(query.toLowerCase());
      return matchesPosition && matchesQuery;
    }),
    [position, query],
  );

  const draftPlayer = (playerId: string) => {
    if (draftedIds.length < rosterSlots.length && !draftedIds.includes(playerId)) {
      setDraftedIds((current) => [...current, playerId]);
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>SUNDAY LEAGUE  /  2025</Text>
          <Text style={styles.title}>Draft day.</Text>
        </View>
        <View style={styles.roundBadge}>
          <Text style={styles.roundNumber}>04</Text>
          <Text style={styles.roundLabel}>ROUND</Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(draftedIds.length / rosterSlots.length) * 100}%` }]} />
      </View>
      <View style={styles.progressMeta}>
        <Text style={styles.progressText}>{draftedIds.length} of {rosterSlots.length} roster spots filled</Text>
        <Text style={styles.pickText}>YOUR PICK  04.06</Text>
      </View>

      <View style={styles.tabs}>
        {([['board', 'My board'], ['players', 'Player pool']] as const).map(([key, label]) => (
          <Pressable key={key} onPress={() => setActiveView(key)} style={[styles.tab, activeView === key && styles.activeTab]}>
            <Text style={[styles.tabText, activeView === key && styles.activeTabText]}>{label}</Text>
          </Pressable>
        ))}
      </View>

        {activeView === 'board' ? (
        <FlatList
          data={rosterSlots}
          keyExtractor={(slot, index) => `${slot}-${index}`}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={<View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Your roster</Text><Text style={styles.sectionHint}>AUTOPICK OFF</Text></View>}
          renderItem={({ item, index }) => {
            const draftedPlayer = players.find((player) => player.id === draftedIds[index]);
            return (
              <View style={styles.rosterRow}>
                <Text style={styles.slotNumber}>0{index + 1}</Text>
                <View style={styles.slotContent}>
                  <Text style={styles.slotPosition}>{item}</Text>
                  {draftedPlayer ? <Text style={styles.rosterPlayer}>{draftedPlayer.name} <Text style={styles.teamText}>{draftedPlayer.team}</Text></Text> : <Text style={styles.emptySlot}>Open roster spot</Text>}
                </View>
                <Text style={draftedPlayer ? styles.filledMark : styles.emptyMark}>{draftedPlayer ? 'READY' : '—'}</Text>
              </View>
            );
          }}
          ListFooterComponent={<View style={styles.boardFooter}><Text style={styles.footerTitle}>Draft note</Text><Text style={styles.footerBody}>Build your core before chasing upside. The best value is still on the board.</Text></View>}
        />
      ) : (
        <View style={styles.poolView}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search players" placeholderTextColor="#8e938c" style={styles.searchInput} />
          <View style={styles.filters}>
            {(['All', 'QB', 'RB', 'WR', 'TE'] as Position[]).map((item) => (
              <Pressable key={item} onPress={() => setPosition(item)} style={[styles.filter, position === item && styles.activeFilter]}>
                <Text style={[styles.filterText, position === item && styles.activeFilterText]}>{item}</Text>
              </Pressable>
            ))}
          </View>
          <FlatList
            data={availablePlayers}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.playerList}
            renderItem={({ item }) => {
              const isDrafted = draftedIds.includes(item.id);
              return (
                <View style={styles.playerRow}>
                  <View style={[styles.playerAvatar, { backgroundColor: item.accent }]}><Text style={styles.avatarText}>{item.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</Text></View>
                  <View style={styles.playerInfo}><Text style={styles.playerName}>{item.name}</Text><Text style={styles.playerMeta}>{item.position}  /  {item.team}  /  BYE {item.bye}</Text></View>
                  <View style={styles.rankBlock}><Text style={styles.rankText}>#{item.rank}</Text><Text style={styles.adpText}>{item.adp} ADP</Text></View>
                  <Pressable disabled={isDrafted || draftedIds.length >= rosterSlots.length} onPress={() => draftPlayer(item.id)} style={[styles.draftButton, isDrafted && styles.draftedButton]}><Text style={[styles.draftButtonText, isDrafted && styles.draftedButtonText]}>{isDrafted ? 'DRAFTED' : 'DRAFT'}</Text></Pressable>
                </View>
              );
            }}
          />
        </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f1e9',
  },
  header: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow: { color: '#777b73', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: '#1f2a25', fontFamily: 'Georgia', fontSize: 42, lineHeight: 48, marginTop: 7 },
  roundBadge: { backgroundColor: '#24463d', width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  roundNumber: { color: '#f4f1e9', fontFamily: 'Georgia', fontSize: 21 },
  roundLabel: { color: '#bfd4c4', fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  progressTrack: { height: 4, backgroundColor: '#d8d8cc', marginHorizontal: 24, borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: '#d96b45', borderRadius: 2 },
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 9, paddingBottom: 21 },
  progressText: { color: '#777b73', fontSize: 12 },
  pickText: { color: '#d96b45', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#dad8ce', paddingHorizontal: 24 },
  tab: { paddingBottom: 12, marginRight: 25 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#24463d' },
  tabText: { color: '#999b93', fontSize: 14, fontWeight: '700' },
  activeTabText: { color: '#24463d' },
  listContent: { paddingHorizontal: 24, paddingBottom: 30 },
  sectionHeader: { paddingTop: 25, paddingBottom: 12, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { color: '#1f2a25', fontFamily: 'Georgia', fontSize: 24 },
  sectionHint: { color: '#a0a097', fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  rosterRow: { minHeight: 65, borderTopWidth: 1, borderTopColor: '#deddd4', flexDirection: 'row', alignItems: 'center' },
  slotNumber: { width: 33, color: '#a0a097', fontSize: 11, fontWeight: '700' },
  slotContent: { flex: 1 },
  slotPosition: { color: '#777b73', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  rosterPlayer: { color: '#1f2a25', fontSize: 16, fontWeight: '600', marginTop: 4 },
  teamText: { color: '#92968d', fontSize: 12, fontWeight: '500' },
  emptySlot: { color: '#afb0a7', fontSize: 14, marginTop: 4 },
  filledMark: { color: '#609369', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  emptyMark: { color: '#c2c2b8', fontSize: 18 },
  boardFooter: { marginTop: 25, borderLeftWidth: 3, borderLeftColor: '#d96b45', paddingLeft: 14, paddingVertical: 2 },
  footerTitle: { color: '#1f2a25', fontSize: 12, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase' },
  footerBody: { color: '#777b73', fontSize: 14, lineHeight: 20, marginTop: 5, maxWidth: 310 },
  poolView: { flex: 1, paddingHorizontal: 24, paddingTop: 18 },
  searchInput: { height: 46, borderWidth: 1, borderColor: '#d4d3c9', backgroundColor: '#faf9f4', borderRadius: 4, paddingHorizontal: 14, color: '#1f2a25', fontSize: 15 },
  filters: { flexDirection: 'row', paddingVertical: 16, gap: 8 },
  filter: { borderWidth: 1, borderColor: '#d4d3c9', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  activeFilter: { backgroundColor: '#24463d', borderColor: '#24463d' },
  filterText: { color: '#777b73', fontSize: 11, fontWeight: '800' },
  activeFilterText: { color: '#f4f1e9' },
  playerList: { paddingBottom: 30 },
  playerRow: { minHeight: 73, borderTopWidth: 1, borderTopColor: '#deddd4', flexDirection: 'row', alignItems: 'center', gap: 10 },
  playerAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  playerInfo: { flex: 1 },
  playerName: { color: '#1f2a25', fontSize: 14, fontWeight: '700' },
  playerMeta: { color: '#8b8e85', fontSize: 10, marginTop: 4, fontWeight: '700' },
  rankBlock: { alignItems: 'flex-end', marginRight: 2 },
  rankText: { color: '#1f2a25', fontFamily: 'Georgia', fontSize: 15 },
  adpText: { color: '#a0a097', fontSize: 9, marginTop: 3 },
  draftButton: { backgroundColor: '#d96b45', borderRadius: 3, paddingHorizontal: 9, paddingVertical: 9 },
  draftedButton: { backgroundColor: '#d9d9cf' },
  draftButtonText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  draftedButtonText: { color: '#777b73' },
});
