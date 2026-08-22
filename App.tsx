import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import {
  ActivityIndicator,
  FlatList,
  Linking,
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
  posRank: string;
  playerPageUrl: string | null;
  rank: number;
  adp: string;
  bye: number | null;
  accent: string;
};

const rosterSlots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WRT', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'signIn' | 'signUp' | 'forgotPassword' | 'updatePassword'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [activeView, setActiveView] = useState<'board' | 'players'>('players');
  const [position, setPosition] = useState<Position>('All');
  const [query, setQuery] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [draftedIds, setDraftedIds] = useState<Array<string | null>>(() => Array(rosterSlots.length).fill(null));
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);
  const [draftStateLoaded, setDraftStateLoaded] = useState(false);
  const [draftStateError, setDraftStateError] = useState('');
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      setSession(currentSession);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
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

      try {
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
              posRank: positionRankFromPayload(payload, playerPosition),
              playerPageUrl: playerPageUrlFromPayload(payload),
              rank: ranking.rank_ecr ?? 0,
              adp: adpFromRanking(ranking.rank_adp, payload),
              bye: byeWeekFromPayload(payload),
              accent: accentForPosition(playerPosition),
            };
          }));
        }
      } catch (error) {
        setPlayersError(error instanceof Error ? error.message : 'Unable to load rankings.');
      }

      setPlayersLoaded(true);
      setPlayersLoading(false);
    };

    loadPlayers();
  }, [session]);

  useEffect(() => {
    if (!supabase || !session) {
      setDraftStateLoaded(false);
      setDraftStateError('');
      setDraftedIds(Array(rosterSlots.length).fill(null));
      setUnavailableIds([]);
      return;
    }

    const client = supabase;
    setDraftStateLoaded(false);
    setDraftStateError('');
    client.from('draft_states').select('drafted_ids, unavailable_ids').eq('user_id', session.user.id).maybeSingle().then(({ data, error }) => {
      if (error) {
        setDraftStateError(`Unable to load draft: ${error.message}`);
        return;
      }
      if (data && Array.isArray(data.drafted_ids) && data.drafted_ids.length === rosterSlots.length) {
        setDraftedIds(data.drafted_ids.map((id: unknown) => typeof id === 'string' ? id : null));
      }
      if (data && Array.isArray(data.unavailable_ids)) {
        setUnavailableIds(data.unavailable_ids.filter((id: unknown): id is string => typeof id === 'string'));
      }
      setDraftStateLoaded(true);
    }, () => {
      setDraftStateError('Unable to load draft. Check your connection and try again.');
    });
  }, [session]);

  useEffect(() => {
    if (!session || !draftStateLoaded) return;
    supabase?.from('draft_states').upsert({
      user_id: session.user.id,
      drafted_ids: draftedIds,
      unavailable_ids: unavailableIds,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).then(({ error }) => {
      if (error) setDraftStateError(`Unable to save draft: ${error.message}`);
    }, () => {
      setDraftStateError('Unable to save draft. Check your connection and try again.');
    });
  }, [draftStateLoaded, draftedIds, session, unavailableIds]);

  useEffect(() => {
    if (session) {
      setActiveView(draftedIds.some(Boolean) ? 'board' : 'players');
    }
  }, [draftedIds, session]);

  const handleAuth = async () => {
    if (!supabase) return;

    setAuthBusy(true);
    setAuthError('');
    setAuthMessage('');

    if (authMode === 'forgotPassword') {
      const result = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      });
      if (result.error) setAuthError(result.error.message);
      else setAuthMessage('Check your email for a password reset link.');
      setAuthBusy(false);
      return;
    }

    if (authMode === 'updatePassword') {
      const result = await supabase.auth.updateUser({ password });
      if (result.error) setAuthError(result.error.message);
      else {
        setAuthMessage('Your password has been updated.');
        setPasswordRecovery(false);
        setAuthMode('signIn');
        setPassword('');
      }
      setAuthBusy(false);
      return;
    }

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
      const matchesAvailability = !availableOnly || (
        !unavailableIds.includes(player.id) && !draftedIds.includes(player.id)
      );
      return matchesPosition && matchesQuery && matchesAvailability;
    }),
    [availableOnly, draftedIds, players, position, query, unavailableIds],
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

  const openPlayerPage = (url: string) => {
    Linking.openURL(url);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <StatusBar style="dark" />
        {authLoading ? (
          <View style={styles.authLoading}><Text style={styles.authLoadingText}>Loading your league...</Text></View>
        ) : !supabase ? (
          <AuthSetup />
        ) : passwordRecovery ? (
          <AuthScreen
            authBusy={authBusy}
            authError={authError}
            authMessage={authMessage}
            authMode="updatePassword"
            email={email}
            password={password}
            onAuth={handleAuth}
            onEmailChange={setEmail}
            onForgotPassword={() => { setAuthMode('forgotPassword'); setAuthError(''); setAuthMessage(''); }}
            onModeChange={(mode) => { setAuthMode(mode); setAuthError(''); setAuthMessage(''); }}
            onPasswordChange={setPassword}
          />
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
            onForgotPassword={() => { setAuthMode('forgotPassword'); setAuthError(''); setAuthMessage(''); }}
            onModeChange={(mode) => { setAuthMode(mode); setAuthError(''); setAuthMessage(''); }}
            onPasswordChange={setPassword}
          />
        ) : (
          <>
      <View style={styles.accountBar}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.accountText}>{session.user.email ?? 'Account'}</Text>
        <Pressable onPress={handleSignOut} style={styles.signOutButton}><Text style={styles.signOutText}>SIGN OUT</Text></Pressable>
      </View>
      {playersLoading || !draftStateLoaded ? (
        <View style={styles.dataLoading}>
          <ActivityIndicator color="#d96b45" size="small" />
          <Text style={styles.dataLoadingText}>{draftStateError || playersError || 'Loading your draft...'}</Text>
        </View>
      ) : <>
      {draftStateError ? <Text style={styles.draftStateError}>{draftStateError}</Text> : null}
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Draft Hard</Text>
          <Text style={[styles.eyebrow, styles.headerSubtitle]}>Guess Confidently.{"\n"}Blame the Experts.</Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(draftedIds.filter(Boolean).length / rosterSlots.length) * 100}%` }]} />
      </View>
      <View style={styles.progressMeta}>
        <Text style={styles.progressText}>{draftedIds.filter(Boolean).length} of {rosterSlots.length} roster spots filled</Text>
      </View>

      <View style={styles.tabs}>
        {([['board', 'My Roster'], ['players', 'Player pool']] as const).map(([key, label]) => (
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
          renderItem={({ item, index }) => {
            const draftedPlayer = players.find((player) => player.id === draftedIds[index]);
            return (
              <View style={styles.rosterRow}>
                {draftedPlayer ? (
                  <View style={[styles.rosterAvatar, { backgroundColor: draftedPlayer.accent }]}>
                    <Text style={styles.avatarText}>{draftedPlayer.position}</Text>
                  </View>
                ) : <View style={styles.rosterAvatarPlaceholder} />}
                <View style={styles.slotContent}>
                  {draftedPlayer ? (
                    <>
                      {draftedPlayer.playerPageUrl ? (
                        <Pressable accessibilityLabel={`Open ${draftedPlayer.name} profile`} onPress={() => openPlayerPage(draftedPlayer.playerPageUrl!)}>
                          <Text style={[styles.rosterPlayer, styles.linkedPlayerName]}>{draftedPlayer.name}</Text>
                        </Pressable>
                      ) : <Text style={styles.rosterPlayer}>{draftedPlayer.name}</Text>}
                      <Text style={styles.rosterMeta}>{draftedPlayer.posRank}  /  {draftedPlayer.team}  /  BYE {draftedPlayer.bye ?? '—'}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.slotPosition}>{item}</Text>
                      <Text style={styles.emptySlot}>Open roster spot</Text>
                    </>
                  )}
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
          <View style={styles.searchRow}>
            <TextInput value={query} onChangeText={setQuery} placeholder="Search players" placeholderTextColor="#8e938c" style={styles.searchInput} />
            {query ? <Pressable accessibilityLabel="Clear player search" onPress={() => setQuery('')} style={styles.clearSearchButton}><Text style={styles.clearSearchText}>X</Text></Pressable> : null}
          </View>
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
              const hasByeConflict = item.bye !== null && players.some((player) => (
                player.id !== item.id && draftedIds.includes(player.id) && player.bye === item.bye
              ));
              return (
                <View style={[styles.playerRow, isUnavailable && styles.unavailablePlayerRow]}>
                  <View style={[styles.playerAvatar, { backgroundColor: item.accent }]}><Text style={styles.avatarText}>{item.position}</Text></View>
                  <View style={styles.playerInfo}>
                    {item.playerPageUrl ? (
                      <Pressable accessibilityLabel={`Open ${item.name} profile`} onPress={() => openPlayerPage(item.playerPageUrl!)}>
                        <Text style={[styles.playerName, styles.linkedPlayerName, isUnavailable && styles.unavailablePlayerName]}>{item.name}</Text>
                      </Pressable>
                    ) : <Text style={[styles.playerName, isUnavailable && styles.unavailablePlayerName]}>{item.name}</Text>}
                    <Text style={styles.playerMeta}>{item.posRank}  /  {item.team}  /  <Text style={hasByeConflict && styles.byeConflictHighlight}>BYE {item.bye ?? '—'}</Text></Text>
                  </View>
                  <View style={styles.rankBlock}><Text style={styles.rankText}>#{item.rank}</Text><Text style={styles.adpText}>ECR</Text></View>
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
      </>}
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
  authMode: 'signIn' | 'signUp' | 'forgotPassword' | 'updatePassword';
  email: string;
  password: string;
  onAuth: () => void;
  onEmailChange: (value: string) => void;
  onForgotPassword: () => void;
  onModeChange: (mode: 'signIn' | 'signUp' | 'forgotPassword' | 'updatePassword') => void;
  onPasswordChange: (value: string) => void;
};

function AuthScreen({ authBusy, authError, authMessage, authMode, email, password, onAuth, onEmailChange, onForgotPassword, onModeChange, onPasswordChange }: AuthScreenProps) {
  const isSignIn = authMode === 'signIn';
  const isForgotPassword = authMode === 'forgotPassword';
  const isUpdatePassword = authMode === 'updatePassword';
  const formIncomplete = isUpdatePassword ? !password : !email || (!isForgotPassword && !password);

  return (
    <View style={styles.authContainer}>
      <Text style={styles.authTitle}>{isUpdatePassword ? 'Choose a new password.' : isForgotPassword ? 'Reset your password.' : 'Draft Hard'}</Text>
      <Text style={styles.authIntro}>{isUpdatePassword ? 'Set a new password for your Draft Hard account.' : isForgotPassword ? 'Enter your email and we will send you a password reset link.' : <>Guess Confidently.{'\n'}Blame the Experts.</>}</Text>
      <View style={styles.authForm}>
        {!isUpdatePassword ? <>
          <Text style={styles.authLabel}>EMAIL</Text>
          <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={onEmailChange} placeholder="you@example.com" placeholderTextColor="#8e938c" style={styles.authInput} />
        </> : null}
        {!isForgotPassword ? <>
          <Text style={styles.authLabel}>PASSWORD</Text>
          <TextInput secureTextEntry value={password} onChangeText={onPasswordChange} placeholder="At least 6 characters" placeholderTextColor="#8e938c" style={styles.authInput} />
        </> : null}
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
        {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
        <Pressable disabled={authBusy || formIncomplete} onPress={onAuth} style={[styles.authButton, (authBusy || formIncomplete) && styles.authButtonDisabled]}>
          <Text style={styles.authButtonText}>{authBusy ? 'PLEASE WAIT' : isUpdatePassword ? 'UPDATE PASSWORD' : isForgotPassword ? 'SEND RESET LINK' : isSignIn ? 'SIGN IN' : 'CREATE ACCOUNT'}</Text>
        </Pressable>
      </View>
      {isSignIn ? <Pressable onPress={onForgotPassword}><Text style={styles.authSwitch}>Forgot your password?</Text></Pressable> : null}
      {!isUpdatePassword ? <Pressable onPress={() => onModeChange(isSignIn || isForgotPassword ? 'signUp' : 'signIn')}><Text style={styles.authSwitch}>{isSignIn || isForgotPassword ? 'New to Draft Hard? Create an account' : 'Already have an account? Sign in'}</Text></Pressable> : null}
      {isForgotPassword ? <Pressable onPress={() => onModeChange('signIn')}><Text style={styles.authSwitch}>Back to sign in</Text></Pressable> : null}
    </View>
  );
}

function AuthSetup() {
  return (
    <View style={styles.authContainer}>
      <Text style={styles.eyebrow}>DRAFT HARD</Text>
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
  dataLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  dataLoadingText: { color: '#777b73', fontSize: 14, textAlign: 'center' },
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
  accountBar: { paddingHorizontal: 24, paddingTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  accountText: { color: '#777b73', flex: 1, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  draftStateError: { color: '#b54e37', fontSize: 12, marginHorizontal: 24, marginTop: 6 },
  header: { paddingHorizontal: 24, paddingTop: 6, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  signOutButton: { flexShrink: 0, borderWidth: 1, borderColor: '#d4d3c9', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 7 },
  signOutText: { color: '#777b73', fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
  eyebrow: { color: '#777b73', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  headerSubtitle: { fontSize: 12, lineHeight: 17 },
  title: { color: '#1f2a25', fontSize: 38, fontWeight: '800', lineHeight: 44, marginTop: 7 },
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
  listContent: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 30 },
  sectionHeader: { paddingTop: 25, paddingBottom: 12, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { color: '#1f2a25', fontFamily: 'Georgia', fontSize: 24 },
  sectionHint: { color: '#a0a097', fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  rosterRow: { minHeight: 73, borderTopWidth: 1, borderTopColor: '#deddd4', flexDirection: 'row', alignItems: 'center' },
  rosterAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rosterAvatarPlaceholder: { width: 38, height: 38, marginRight: 10 },
  slotContent: { flex: 1 },
  slotPosition: { color: '#777b73', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  rosterPlayer: { color: '#1f2a25', fontSize: 16, fontWeight: '600', marginTop: 4 },
  rosterMeta: { color: '#8b8e85', fontSize: 10, marginTop: 4, fontWeight: '700' },
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
  searchRow: { position: 'relative' },
  searchInput: { height: 46, borderWidth: 1, borderColor: '#d4d3c9', backgroundColor: '#faf9f4', borderRadius: 4, paddingHorizontal: 14, paddingRight: 42, color: '#1f2a25', fontSize: 15 },
  clearSearchButton: { position: 'absolute', right: 7, top: 8, height: 30, width: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eeece3', borderWidth: 1, borderColor: '#d4d3c9', borderRadius: 3 },
  clearSearchText: { color: '#777b73', fontSize: 12, fontWeight: '800' },
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
  linkedPlayerName: { textDecorationLine: 'underline' },
  unavailablePlayerName: { textDecorationLine: 'line-through' },
  playerMeta: { color: '#8b8e85', fontSize: 10, marginTop: 4, fontWeight: '700' },
  byeConflictHighlight: { color: '#9d3f2b', backgroundColor: '#f4d8ce', fontWeight: '900' },
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

function positionRankFromPayload(payload: Record<string, unknown>, position: string) {
  const posRank = payload.pos_rank;
  return posRank === null || posRank === undefined || posRank === '' ? position : String(posRank);
}

function playerPageUrlFromPayload(payload: Record<string, unknown>): string | null {
  const sources = [payload, payload.player, payload.player_info].filter(isRecord);
  for (const source of sources) {
    const value = source.player_page_url ?? source.playerPageUrl ?? source.player_url ?? source.playerUrl;
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

function byeWeekFromPayload(payload: Record<string, unknown>): number | null {
  const sources = [payload, payload.player, payload.player_info].filter(isRecord);
  for (const source of sources) {
    const value = source.player_bye_week ?? source.playerByeWeek ?? source.bye_week ?? source.byeWeek ?? source.bye_week_number ?? source.byeWeekNumber ?? source.bye;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function adpFromRanking(rankAdp: number | null, payload: Record<string, unknown>) {
  const adp = rankAdp
    ?? payload.rank_adp
    ?? payload.adp
    ?? payload.average_draft_position
    ?? payload.avg_draft_position;
  const parsed = typeof adp === 'number' ? adp : typeof adp === 'string' ? Number(adp) : NaN;
  return Number.isFinite(parsed) ? String(parsed) : '—';
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
