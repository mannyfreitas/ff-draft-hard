import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from './lib/supabase';

type Position = 'All' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

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

const rosterSlots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WRT', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [activeView, setActiveView] = useState<'board' | 'players'>('board');
  const [position, setPosition] = useState<Position>('All');
  const [query, setQuery] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [draftedIds, setDraftedIds] = useState<Array<string | null>>(() => Array(rosterSlots.length).fill(null));
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const [playersError, setPlayersError] = useState('');

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    const client = supabase;

    const loadPlayers = async () => {
      setPlayersLoading(true);
      setPlayersError('');
      setPlayersLoaded(false);

      const { data, error } = await client
        .from('fantasypros_rankings')
        .select('id, player_name, position, rank_ecr, rank_adp, payload')
        .eq('season', 2026)
        .eq('format', 'redraft')
        .eq('scoring', 'HALF')
        .order('rank_ecr', { ascending: true, nullsFirst: false });

      if (error) {
        setPlayersError(error.message);
      } else {
        setPlayers(data.map((ranking) => {
          const payload = isRecord(ranking.payload) ? ranking.payload : {};
          const playerPosition = normalizePosition(ranking.position);
          return {
            id: String(ranking.id),
            name: ranking.player_name,
            team: teamFromPayload(payload),
            position: playerPosition,
            rank: ranking.rank_ecr ?? 0,
            adp: ranking.rank_adp === null ? '—' : String(ranking.rank_adp),
            bye: Number(payload.bye_week ?? payload.bye ?? 0),
            accent: accentForPosition(playerPosition),
          };
        }));
      }

      setPlayersLoaded(true);
      setPlayersLoading(false);
    };

    loadPlayers();
  }, [session]);

  const handleAuth = async () => {
    if (!supabase) return;

    setAuthBusy(true);
    setAuthError('');
    setAuthMessage('');

    const result = authMode === 'signIn'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password });

    if (result.error) {
      setAuthError(result.error.message);
    } else if (authMode === 'signUp' && !result.data.session) {
      setAuthMessage('Check your email to confirm your account, then sign in.');
      setAuthMode('signIn');
    }

    setAuthBusy(false);
  };

  const handleSignOut = async () => {
    await supabase?.auth.signOut();
  };

  const availablePlayers = useMemo(
    () => players.filter((player) => {
      const matchesPosition = position === 'All' || player.position === position;
      const matchesQuery = player.name.toLowerCase().includes(query.toLowerCase());
      const matchesAvailability = !availableOnly || !unavailableIds.includes(player.id);
      return matchesPosition && matchesQuery && matchesAvailability;
    }),
    [availableOnly, players, position, query, unavailableIds],
  );

  const draftPlayer = (playerId: string) => {
    if (draftedIds.includes(playerId)) return;
    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) return;

    setDraftedIds((current) => {
      const openSlot = current.findIndex((draftedId, index) => (
        draftedId === null && rosterSlotAcceptsPlayer(rosterSlots[index], player.position)
      ));
      if (openSlot === -1) return current;

      const next = [...current];
      next[openSlot] = playerId;
      return next;
    });
  };

  const undraftPlayer = (rosterIndex: number) => {
    setDraftedIds((current) => {
      const next = [...current];
      next[rosterIndex] = null;
      return next;
    });
  };

  const markUnavailable = (playerId: string) => {
    setUnavailableIds((current) => current.includes(playerId) ? current : [...current, playerId]);
  };

  const markAvailable = (playerId: string) => {
    setUnavailableIds((current) => current.filter((id) => id !== playerId));
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <StatusBar style="dark" />
        {authLoading ? (
          <View style={styles.authLoading}><Text style={styles.authLoadingText}>Loading your league...</Text></View>
        ) : !supabase ? (
          <AuthSetup />
        ) : !session ? (
          <AuthScreen
            authBusy={authBusy}
            authError={authError}
            authMessage={authMessage}
            authMode={authMode}
            email={email}
            password={password}
            onAuth={handleAuth}
            onEmailChange={setEmail}
            onModeChange={(mode) => { setAuthMode(mode); setAuthError(''); setAuthMessage(''); }}
            onPasswordChange={setPassword}
          />
        ) : (
          <>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>SUNDAY LEAGUE  /  2025</Text>
          <Text style={styles.title}>Draft day.</Text>
        </View>
        <Pressable onPress={handleSignOut} style={styles.signOutButton}><Text style={styles.signOutText}>SIGN OUT</Text></Pressable>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(draftedIds.filter(Boolean).length / rosterSlots.length) * 100}%` }]} />
      </View>
      <View style={styles.progressMeta}>
        <Text style={styles.progressText}>{draftedIds.filter(Boolean).length} of {rosterSlots.length} roster spots filled</Text>
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
                <Text style={styles.slotNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <View style={styles.slotContent}>
                  <Text style={styles.slotPosition}>{item}</Text>
                  {draftedPlayer ? <Text style={styles.rosterPlayer}>{draftedPlayer.name} <Text style={styles.teamText}>{draftedPlayer.team}</Text></Text> : <Text style={styles.emptySlot}>Open roster spot</Text>}
                </View>
                {draftedPlayer ? (
                  <Pressable onPress={() => undraftPlayer(index)} style={styles.undraftButton}>
                    <Text style={styles.undraftButtonText}>UNDRAFT</Text>
                  </Pressable>
                ) : <Text style={styles.emptyMark}>—</Text>}
              </View>
            );
          }}
          ListFooterComponent={<View style={styles.boardFooter}><Text style={styles.footerTitle}>Draft note</Text><Text style={styles.footerBody}>Build your core before chasing upside. The best value is still on the board.</Text></View>}
        />
      ) : (
        <View style={styles.poolView}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search players" placeholderTextColor="#8e938c" style={styles.searchInput} />
          <View style={styles.filters}>
            {(['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'] as Position[]).map((item) => (
              <Pressable key={item} onPress={() => setPosition(item)} style={[styles.filter, position === item && styles.activeFilter]}>
                <Text style={[styles.filterText, position === item && styles.activeFilterText]}>{item}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setAvailableOnly((current) => !current)} style={[styles.availabilityToggle, availableOnly && styles.activeAvailabilityToggle]}>
            <Text style={[styles.availabilityToggleText, availableOnly && styles.activeAvailabilityToggleText]}>AVAILABLE ONLY</Text>
          </Pressable>
          <FlatList
            data={availablePlayers}
            keyExtractor={(item) => item.id}
            extraData={[playersLoaded, playersLoading, playersError, position, query, availableOnly, unavailableIds, draftedIds]}
            contentContainerStyle={styles.playerList}
            ListEmptyComponent={<View style={styles.playerState}><Text style={styles.playerStateText}>{!playersLoaded || playersLoading ? 'Loading rankings...' : playersError || 'No synced rankings found.'}</Text></View>}
            renderItem={({ item }) => {
              const isDrafted = draftedIds.includes(item.id);
              const isUnavailable = unavailableIds.includes(item.id);
              const hasOpenRosterSlot = draftedIds.some((draftedId, index) => (
                draftedId === null && rosterSlotAcceptsPlayer(rosterSlots[index], item.position)
              ));
              return (
                <View style={[styles.playerRow, isUnavailable && styles.unavailablePlayerRow]}>
                  <View style={[styles.playerAvatar, { backgroundColor: item.accent }]}><Text style={styles.avatarText}>{item.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</Text></View>
                  <View style={styles.playerInfo}><Text style={[styles.playerName, isUnavailable && styles.unavailablePlayerName]}>{item.name}</Text><Text style={styles.playerMeta}>{item.position}  /  {item.team}  /  BYE {item.bye}</Text></View>
                  <View style={styles.rankBlock}><Text style={styles.rankText}>#{item.rank}</Text><Text style={styles.adpText}>{item.adp} ADP</Text></View>
                  {isDrafted ? (
                    <Pressable disabled style={[styles.draftButton, styles.draftedButton]}><Text style={styles.draftedButtonText}>DRAFTED</Text></Pressable>
                  ) : isUnavailable ? (
                    <Pressable onPress={() => markAvailable(item.id)} style={styles.unavailableButton}><Text style={styles.unavailableButtonText}>UNMARK</Text></Pressable>
                  ) : (
                    <View style={styles.playerActions}>
                      <Pressable disabled={!hasOpenRosterSlot} onPress={() => draftPlayer(item.id)} style={[styles.draftButton, !hasOpenRosterSlot && styles.disabledDraftButton]}><Text style={styles.draftButtonText}>DRAFT</Text></Pressable>
                      <Pressable onPress={() => markUnavailable(item.id)} style={styles.markUnavailableButton}><Text style={styles.markUnavailableButtonText}>TAKEN</Text></Pressable>
                    </View>
                  )}
                </View>
              );
            }}
          />
        </View>
        )}
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

type AuthScreenProps = {
  authBusy: boolean;
  authError: string;
  authMessage: string;
  authMode: 'signIn' | 'signUp';
  email: string;
  password: string;
  onAuth: () => void;
  onEmailChange: (value: string) => void;
  onModeChange: (mode: 'signIn' | 'signUp') => void;
  onPasswordChange: (value: string) => void;
};

function AuthScreen({ authBusy, authError, authMessage, authMode, email, password, onAuth, onEmailChange, onModeChange, onPasswordChange }: AuthScreenProps) {
  const isSignIn = authMode === 'signIn';

  return (
    <View style={styles.authContainer}>
      <Text style={styles.eyebrow}>SUNDAY LEAGUE  /  2025</Text>
      <Text style={styles.authTitle}>Draft together.</Text>
      <Text style={styles.authIntro}>Sign in to keep your leagues and picks ready wherever draft day takes you.</Text>
      <View style={styles.authForm}>
        <Text style={styles.authLabel}>EMAIL</Text>
        <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={onEmailChange} placeholder="you@example.com" placeholderTextColor="#8e938c" style={styles.authInput} />
        <Text style={styles.authLabel}>PASSWORD</Text>
        <TextInput secureTextEntry value={password} onChangeText={onPasswordChange} placeholder="At least 6 characters" placeholderTextColor="#8e938c" style={styles.authInput} />
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
        {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
        <Pressable disabled={authBusy || !email || !password} onPress={onAuth} style={[styles.authButton, (authBusy || !email || !password) && styles.authButtonDisabled]}>
          <Text style={styles.authButtonText}>{authBusy ? 'PLEASE WAIT' : isSignIn ? 'SIGN IN' : 'CREATE ACCOUNT'}</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => onModeChange(isSignIn ? 'signUp' : 'signIn')}>
        <Text style={styles.authSwitch}>{isSignIn ? 'New to Sunday League? Create an account' : 'Already have an account? Sign in'}</Text>
      </Pressable>
    </View>
  );
}

function AuthSetup() {
  return (
    <View style={styles.authContainer}>
      <Text style={styles.eyebrow}>SUNDAY LEAGUE  /  2025</Text>
      <Text style={styles.authTitle}>Almost ready.</Text>
      <Text style={styles.authIntro}>Add your Supabase project values to the app environment to enable league accounts.</Text>
      <View style={styles.setupNote}><Text style={styles.setupNoteTitle}>BACKEND SETUP NEEDED</Text><Text style={styles.setupNoteBody}>Copy .env.example to .env and add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f1e9',
  },
  authLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  authLoadingText: { color: '#777b73', fontSize: 14 },
  authContainer: { flex: 1, paddingHorizontal: 24, paddingTop: 76 },
  authTitle: { color: '#1f2a25', fontFamily: 'Georgia', fontSize: 42, lineHeight: 48, marginTop: 10 },
  authIntro: { color: '#777b73', fontSize: 16, lineHeight: 23, marginTop: 14, maxWidth: 340 },
  authForm: { marginTop: 38 },
  authLabel: { color: '#777b73', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 7, marginTop: 17 },
  authInput: { height: 48, borderWidth: 1, borderColor: '#d4d3c9', backgroundColor: '#faf9f4', borderRadius: 4, paddingHorizontal: 14, color: '#1f2a25', fontSize: 15 },
  authError: { color: '#b54e37', fontSize: 13, lineHeight: 19, marginTop: 14 },
  authMessage: { color: '#527e5b', fontSize: 13, lineHeight: 19, marginTop: 14 },
  authButton: { alignItems: 'center', backgroundColor: '#d96b45', borderRadius: 3, marginTop: 22, paddingVertical: 14 },
  authButtonDisabled: { opacity: 0.45 },
  authButtonText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  authSwitch: { color: '#24463d', fontSize: 13, fontWeight: '700', marginTop: 24 },
  setupNote: { borderLeftWidth: 3, borderLeftColor: '#d96b45', marginTop: 38, paddingLeft: 14, paddingVertical: 2 },
  setupNoteTitle: { color: '#1f2a25', fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  setupNoteBody: { color: '#777b73', fontSize: 14, lineHeight: 20, marginTop: 6, maxWidth: 330 },
  header: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  signOutButton: { borderWidth: 1, borderColor: '#d4d3c9', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 7 },
  signOutText: { color: '#777b73', fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
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
  undraftButton: { borderWidth: 1, borderColor: '#d4d3c9', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 7 },
  undraftButtonText: { color: '#b54e37', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
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
  availabilityToggle: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#d4d3c9', borderRadius: 3, marginBottom: 10, paddingHorizontal: 9, paddingVertical: 7 },
  activeAvailabilityToggle: { backgroundColor: '#24463d', borderColor: '#24463d' },
  availabilityToggleText: { color: '#777b73', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  activeAvailabilityToggleText: { color: '#f4f1e9' },
  playerList: { paddingBottom: 30 },
  playerState: { paddingVertical: 40, alignItems: 'center' },
  playerStateText: { color: '#777b73', fontSize: 14, textAlign: 'center' },
  playerRow: { minHeight: 73, borderTopWidth: 1, borderTopColor: '#deddd4', flexDirection: 'row', alignItems: 'center', gap: 10 },
  unavailablePlayerRow: { opacity: 0.62 },
  playerAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  playerInfo: { flex: 1 },
  playerName: { color: '#1f2a25', fontSize: 14, fontWeight: '700' },
  unavailablePlayerName: { textDecorationLine: 'line-through' },
  playerMeta: { color: '#8b8e85', fontSize: 10, marginTop: 4, fontWeight: '700' },
  rankBlock: { alignItems: 'flex-end', marginRight: 2 },
  rankText: { color: '#1f2a25', fontFamily: 'Georgia', fontSize: 15 },
  adpText: { color: '#a0a097', fontSize: 9, marginTop: 3 },
  draftButton: { backgroundColor: '#d96b45', borderRadius: 3, paddingHorizontal: 9, paddingVertical: 9 },
  disabledDraftButton: { opacity: 0.45 },
  draftedButton: { backgroundColor: '#d9d9cf' },
  draftButtonText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  draftedButtonText: { color: '#777b73' },
  playerActions: { alignItems: 'flex-end', gap: 4 },
  markUnavailableButton: { borderWidth: 1, borderColor: '#d4d3c9', borderRadius: 3, paddingHorizontal: 7, paddingVertical: 5 },
  markUnavailableButtonText: { color: '#b54e37', fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
  unavailableButton: { borderWidth: 1, borderColor: '#d4d3c9', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 7 },
  unavailableButtonText: { color: '#777b73', fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function teamFromPayload(payload: Record<string, unknown>) {
  const team = payload.player_team_id ?? payload.player_team ?? payload.team_abbr ?? payload.team;
  return typeof team === 'string' && team.trim().length > 0 ? team : 'FA';
}

function normalizePosition(value: string): Exclude<Position, 'All'> {
  const position = value.toUpperCase();
  return ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(position)
    ? position as Exclude<Position, 'All'>
    : 'WR';
}

function rosterSlotAcceptsPlayer(slot: string, position: Exclude<Position, 'All'>) {
  if (slot === 'BN') return true;
  if (slot === 'WRT') return ['RB', 'WR', 'TE'].includes(position);
  if (slot === 'DEF') return position === 'DST';
  return slot === position;
}

function accentForPosition(position: Exclude<Position, 'All'>) {
  const accents: Record<Exclude<Position, 'All'>, string> = {
    QB: '#74a86b',
    RB: '#d9a441',
    WR: '#5e79c8',
    TE: '#7897a9',
    K: '#d96b45',
    DST: '#5880a8',
  };
  return accents[position];
}
