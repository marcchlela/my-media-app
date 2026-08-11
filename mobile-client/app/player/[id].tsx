import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Loading } from '../../src/components/ui';
import { useMyFlix } from '../../src/context/MyFlixContext';
import { findNextEpisode } from '../../src/lib/library';
import { initialPlaybackModel, playbackReducer } from '../../src/lib/playback-machine';
import { activeSubtitle, parseWebVtt, type SubtitleCue } from '../../src/lib/webvtt';
import { colors } from '../../src/theme';

type QualityChoice = { label: string; mode: 'direct' | 'adaptive' | 'manual'; height?: number };
type SubtitleTrack = { id?: string; label?: string; language?: string };

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useMyFlix();
  const item = app.library.find((entry) => entry.id === id) || null;
  const nextEpisode = item ? findNextEpisode(app.library, item) : null;
  const player = useVideoPlayer(null, (instance) => { instance.timeUpdateEventInterval = 1; });
  const videoRef = useRef<VideoView>(null);
  const statusEvent = useEvent(player, 'statusChange', { status: player.status, error: undefined });
  const playingEvent = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const timeEvent = useEvent(player, 'timeUpdate', { currentTime: 0, bufferedPosition: 0, currentLiveTimestamp: null, currentOffsetFromLive: null });
  const [model, dispatch] = useReducer(playbackReducer, initialPlaybackModel);
  const [message, setMessage] = useState('Loading original quality...');
  const [generationProgress, setGenerationProgress] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [quality, setQuality] = useState('Original');
  const [qualityChoices, setQualityChoices] = useState<QualityChoice[]>([{ label: 'Original', mode: 'direct' }]);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const [externalCues, setExternalCues] = useState<SubtitleCue[]>([]);
  const [externalSubtitleId, setExternalSubtitleId] = useState('');
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playbackModeRef = useRef<'direct' | 'hls-auto' | 'hls-manual' | 'hls-fallback'>('direct');
  const fallbackAttemptedRef = useRef(false);
  const requestRef = useRef(0);
  const subtitleRequestRef = useRef(0);
  const replacementQueueRef = useRef<Promise<void>>(Promise.resolve());
  const streamSessionRef = useRef('');
  const lastSaveRef = useRef(0);
  const mountedRef = useRef(true);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const nativePlayer = player as typeof player & { availableSubtitleTracks?: SubtitleTrack[]; subtitleTrack?: SubtitleTrack | null };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      subtitleRequestRef.current += 1;
      player.pause();
    };
  }, []);

  async function replaceSource(source: VideoSource, resumeAt: number, requestId: number) {
    const operation = replacementQueueRef.current.catch(() => {}).then(async () => {
      if (!mountedRef.current || requestRef.current !== requestId) throw new Error('Playback request cancelled.');
      await player.replaceAsync(source);
      if (!mountedRef.current || requestRef.current !== requestId) throw new Error('Playback request cancelled.');
      if (resumeAt > 0) player.currentTime = resumeAt;
      player.play();
    });
    replacementQueueRef.current = operation.catch(() => {});
    return operation;
  }

  async function loadDirect(resetFallback = true) {
    if (!item?.streamUrl) return;
    const requestId = ++requestRef.current;
    if (resetFallback) fallbackAttemptedRef.current = false;
    playbackModeRef.current = 'direct';
    dispatch({ type: 'LOAD_DIRECT' });
    setQuality('Original');
    setGenerationProgress(null);
    setMessage('Loading original quality...');
    try {
      await replaceSource({ uri: app.api.absoluteUrl(item.streamUrl), headers: app.api.mediaHeaders() }, Number(item.watchProgress?.position) || 0, requestId);
    } catch (reason) {
      if ((reason as Error).message === 'Playback request cancelled.') return;
      await handleFatalPlaybackError('direct');
    }
  }

  async function pollHls(mediaId: string, cacheKey: string, requestId: number) {
    let response = await app.api.hlsStatus(mediaId, cacheKey);
    while (!['ready', 'failed', 'cancelled'].includes(response.status.state)) {
      if (!mountedRef.current || requestRef.current !== requestId) throw new Error('Playback request cancelled.');
      if (!['queued', 'running'].includes(response.status.state)) throw new Error('The server no longer has this stream-generation job. Try the quality again.');
      setGenerationProgress(Number(response.status.progress) || 0);
      setMessage(response.status.message || 'Preparing compatible stream...');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await app.api.hlsStatus(mediaId, cacheKey);
    }
    if (response.status.state !== 'ready' || !response.status.masterUrl) throw new Error(response.status.error || 'The server could not prepare this stream.');
    return response.status;
  }

  async function prepareHls(mode: 'adaptive' | 'manual' | 'compatibility', height?: number) {
    if (!item) return;
    const requestId = ++requestRef.current;
    if (mode === 'compatibility') fallbackAttemptedRef.current = true;
    playbackModeRef.current = mode === 'adaptive' ? 'hls-auto' : mode === 'manual' ? 'hls-manual' : 'hls-fallback';
    dispatch({ type: 'PREPARE_HLS' });
    setMessage(mode === 'compatibility' ? 'Preparing compatible stream...' : 'Preparing selected quality...');
    setGenerationProgress(0);
    try {
      const started = await app.api.startHls(item.id, { mode, quality: height });
      const status = started.status.state === 'ready' ? started.status : await pollHls(item.id, started.status.cacheKey, requestId);
      if (!mountedRef.current || requestRef.current !== requestId || !status.masterUrl) return;
      const resumeAt = Number(player.currentTime) || Number(item.watchProgress?.position) || 0;
      await replaceSource({ uri: app.api.absoluteUrl(status.masterUrl), headers: app.api.mediaHeaders(), contentType: 'hls' }, resumeAt, requestId);
      dispatch({ type: 'HLS_PLAYING' });
      setGenerationProgress(null);
      setQuality(mode === 'adaptive' ? 'Auto' : mode === 'manual' ? `${height}p` : status.qualities?.[0] || 'Compatible');
      setMessage('');
    } catch (reason) {
      if (requestRef.current !== requestId || (reason as Error).message === 'Playback request cancelled.') return;
      dispatch({ type: 'HLS_FATAL' });
      setGenerationProgress(null);
      setMessage(`${(reason as Error).message || 'Compatible playback failed.'} No further automatic fallback will be attempted.`);
    }
  }

  async function handleFatalPlaybackError(mode: 'direct' | 'hls') {
    if (mode === 'hls' || playbackModeRef.current !== 'direct') {
      dispatch({ type: 'HLS_FATAL' });
      setMessage('The compatible stream could not be played. No further automatic fallback will be attempted.');
      return;
    }
    if (fallbackAttemptedRef.current) return;
    fallbackAttemptedRef.current = true;
    dispatch({ type: 'DIRECT_FATAL' });
    setMessage('Original format is not supported. Checking compatibility playback...');
    try {
      const options = await app.api.playbackOptions(item?.id || '');
      if (!options.compatibilityFallback.available) throw new Error('This server cannot create a compatible stream because FFmpeg is unavailable.');
      await prepareHls('compatibility');
    } catch (reason) {
      dispatch({ type: 'HLS_FATAL' });
      setMessage((reason as Error).message || 'This title cannot be played on this device.');
    }
  }

  useEffect(() => {
    if (!item) return;
    setDemoPlaying(false);
    setExternalCues([]);
    setExternalSubtitleId('');
    subtitleRequestRef.current += 1;
    if (app.isDemo) {
      requestRef.current += 1;
      playbackModeRef.current = 'direct';
      fallbackAttemptedRef.current = false;
      dispatch({ type: 'LOAD_DIRECT' });
      dispatch({ type: 'DIRECT_PLAYING' });
      setPosition(Number(item.watchProgress?.position) || 0);
      setDuration(Math.max(60, Number(item.watchProgress?.duration) || Number(item.runtime) * 60 || 2_880));
      setQuality('Original');
      setQualityChoices([{ label: 'Original', mode: 'direct' }]);
      setMessage('Development preview only. No video or server request is being used.');
      return;
    }
    loadDirect();
    app.api.playbackOptions(item.id).then((options) => {
      const choices: QualityChoice[] = [{ label: 'Original', mode: 'direct' }];
      if (options.hlsAvailable) {
        choices.push({ label: 'Auto', mode: 'adaptive' });
        choices.push(...options.qualities.map((entry) => ({ label: entry.label, mode: 'manual' as const, height: entry.height })));
      }
      setQualityChoices(choices);
    }).catch(() => {});
  }, [item?.id, app.isDemo]);

  useEffect(() => {
    if (app.isDemo) return;
    if (statusEvent?.status === 'error') handleFatalPlaybackError(playbackModeRef.current === 'direct' ? 'direct' : 'hls');
    if (statusEvent?.status === 'readyToPlay' && playbackModeRef.current === 'direct') setMessage('');
  }, [statusEvent?.status, app.isDemo]);

  useEffect(() => {
    if (app.isDemo) return;
    if (playingEvent.isPlaying) dispatch({ type: playbackModeRef.current === 'direct' ? 'DIRECT_PLAYING' : 'HLS_PLAYING' });
  }, [playingEvent.isPlaying, app.isDemo]);

  useEffect(() => {
    if (app.isDemo) return;
    const current = Number(timeEvent.currentTime) || 0;
    const total = Number(player.duration) || 0;
    setPosition(current);
    setDuration(total);
    if (item && app.user && total > 0 && Date.now() - lastSaveRef.current > 10_000) {
      lastSaveRef.current = Date.now();
      app.saveProgress(item, current, total).catch(() => {});
    }
  }, [timeEvent.currentTime, item?.id, app.user?.id, app.isDemo]);

  useEffect(() => {
    if (!app.isDemo || !demoPlaying) return;
    const timer = setInterval(() => setPosition((current) => Math.min(duration, current + 1)), 1000);
    return () => clearInterval(timer);
  }, [app.isDemo, demoPlaying, duration]);

  useEffect(() => {
    positionRef.current = position;
    durationRef.current = duration;
    if (app.isDemo && demoPlaying && duration > 0 && position >= duration) {
      setDemoPlaying(false);
      if (item && app.user) app.saveProgress(item, duration, duration, true).catch(() => {});
    }
  }, [position, duration, app.isDemo, demoPlaying, item?.id, app.user?.id]);

  useEffect(() => {
    if (!app.isDemo || !item || !app.user || duration <= 0 || Date.now() - lastSaveRef.current <= 10_000) return;
    lastSaveRef.current = Date.now();
    app.saveProgress(item, position, duration).catch(() => {});
  }, [app.isDemo, position, duration, item?.id, app.user?.id]);

  useEffect(() => {
    if (!item || app.isDemo) return;
    const heartbeat = async () => {
      try {
        const result = await app.api.heartbeat({
          sessionId: streamSessionRef.current,
          mediaId: item.id,
          title: item.isShow ? `${item.showName}: ${item.title}` : item.title,
          mode: playbackModeRef.current,
          quality,
          position: Number(player.currentTime) || 0,
          duration: Number(player.duration) || 0,
          paused: !player.playing,
        });
        streamSessionRef.current = result.sessionId || streamSessionRef.current;
      } catch { /* Monitoring must never interrupt playback. */ }
    };
    heartbeat();
    const timer = setInterval(heartbeat, 10_000);
    return () => clearInterval(timer);
  }, [item?.id, quality, app.isDemo]);

  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => {
      if (item && app.user && player.duration > 0) app.saveProgress(item, player.duration, player.duration, true).catch(() => {});
    });
    return () => subscription.remove();
  }, [item?.id, app.user?.id]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      if (app.isDemo) setDemoPlaying(false);
      else player.pause();
    });
    return () => subscription.remove();
  }, [app.isDemo]);

  useEffect(() => {
    return () => {
      requestRef.current += 1;
      subtitleRequestRef.current += 1;
      player.pause();
      const finalPosition = app.isDemo ? positionRef.current : player.currentTime;
      const finalDuration = app.isDemo ? durationRef.current : player.duration;
      if (item && app.user && finalDuration > 0) app.saveProgress(item, finalPosition, finalDuration).catch(() => {});
      const sessionId = streamSessionRef.current;
      streamSessionRef.current = '';
      if (sessionId) app.api.endPlaybackSession(sessionId).catch(() => {});
    };
  }, [item?.id]);

  if (!item?.streamUrl) return <SafeAreaView style={styles.screen}><Text style={styles.error}>This title is unavailable.</Text><Button label="Go Back" icon="arrow-back" onPress={() => router.back()} /></SafeAreaView>;

  const markers = item.playbackMarkers;
  const showSkipIntro = Number.isFinite(markers?.introEnd) && position >= Math.max(0, Number(markers?.introStart) - 2) && position < Number(markers?.introEnd);
  const showNext = !!nextEpisode && Number.isFinite(markers?.creditsStart) && position >= Number(markers?.creditsStart);
  const subtitles = nativePlayer.availableSubtitleTracks || [];
  const externalSubtitles = item.subtitles || [];
  const subtitleText = activeSubtitle(externalCues, position);
  const isPlaying = app.isDemo ? demoPlaying : playingEvent.isPlaying;

  function selectQuality(choice: QualityChoice) {
    setQualityOpen(false);
    if (app.isDemo) {
      setQuality('Original');
      return;
    }
    if (choice.mode === 'direct') loadDirect(true);
    else prepareHls(choice.mode, choice.height);
  }

  function seekBy(seconds: number) {
    if (app.isDemo) setPosition((current) => Math.max(0, Math.min(duration, current + seconds)));
    else player.currentTime = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + seconds));
  }

  function togglePlayback() {
    if (app.isDemo) setDemoPlaying((playing) => !playing);
    else if (player.playing) player.pause();
    else player.play();
  }

  async function selectExternalSubtitle(subtitleId: string) {
    if (!item) return;
    const requestId = ++subtitleRequestRef.current;
    setSubtitleOpen(false);
    nativePlayer.subtitleTrack = null;
    setExternalCues([]);
    setExternalSubtitleId(subtitleId);
    setMessage('Loading subtitles...');
    try {
      const source = await app.api.subtitleText(item.id, subtitleId);
      if (requestId !== subtitleRequestRef.current) return;
      const cues = parseWebVtt(source);
      if (!cues.length) throw new Error('This subtitle file contains no readable cues.');
      setExternalCues(cues);
      setMessage('');
    } catch (reason) {
      if (requestId !== subtitleRequestRef.current) return;
      setExternalSubtitleId('');
      setMessage((reason as Error).message || 'Subtitles could not be loaded.');
    }
  }

  function disableSubtitles() {
    subtitleRequestRef.current += 1;
    nativePlayer.subtitleTrack = null;
    setExternalSubtitleId('');
    setExternalCues([]);
    setSubtitleOpen(false);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topbar}><Pressable style={styles.iconButton} onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.text} /></Pressable><Text numberOfLines={1} style={styles.title}>{item.isShow ? `${item.showName} - ${item.title}` : item.title}</Text></View>
      <View style={styles.stage}>
        <VideoView ref={videoRef} player={player} style={styles.video} nativeControls={isFullscreen} contentFit="contain" allowsFullscreen onFullscreenEnter={() => setIsFullscreen(true)} onFullscreenExit={() => setIsFullscreen(false)} />
        {app.isDemo && <View style={styles.demoStage}><View style={styles.demoReel}><Ionicons name="film-outline" size={42} color={colors.gold} /></View><Text style={styles.demoTitle}>{item.isShow ? item.showName : item.title}</Text><Text style={styles.demoCopy}>Interactive player preview · no media loaded</Text></View>}
        {!app.isDemo && model.state === 'hls-preparing' && <View style={styles.loadingOverlay}><Loading label={generationProgress === null ? 'Preparing compatible stream...' : `${message} ${Math.round(generationProgress)}%`} /></View>}
        {!!subtitleText && <View pointerEvents="none" style={styles.subtitleOverlay}><Text style={styles.subtitleText}>{subtitleText}</Text></View>}
        {showSkipIntro && <Pressable style={styles.markerButton} onPress={() => { const end = Number(markers?.introEnd) || position; if (app.isDemo) { setPosition(end); setDemoPlaying(true); } else { player.currentTime = end; player.play(); } }}><Text style={styles.markerText}>Skip Intro</Text><Ionicons name="play-skip-forward" color={colors.text} size={18} /></Pressable>}
        {showNext && <Pressable style={[styles.markerButton, styles.nextButton]} onPress={() => router.replace({ pathname: '/player/[id]', params: { id: nextEpisode.id } })}><Text style={styles.markerText}>Next Episode</Text><Ionicons name="play-skip-forward" color={colors.text} size={18} /></Pressable>}
      </View>
      <View style={styles.timeline}><View style={[styles.timelineFill, { width: `${duration ? Math.min(100, position / duration * 100) : 0}%` }]} /></View>
      <View style={styles.timeRow}><Text style={styles.time}>{formatTime(position)}</Text><Text style={styles.time}>{formatTime(duration)}</Text></View>
      <View style={styles.controls}>
        <Pressable style={styles.iconButton} onPress={() => seekBy(-10)}><Ionicons name="play-back" size={25} color={colors.text} /></Pressable>
        <Pressable style={styles.playButton} onPress={togglePlayback}><Ionicons name={isPlaying ? 'pause' : 'play'} size={32} color={colors.text} /></Pressable>
        <Pressable style={styles.iconButton} onPress={() => seekBy(10)}><Ionicons name="play-forward" size={25} color={colors.text} /></Pressable>
        <Pressable style={styles.qualityButton} onPress={() => setQualityOpen(true)}><Text style={styles.qualityText}>{quality}</Text></Pressable>
        {!!(subtitles.length || externalSubtitles.length) && <Pressable style={styles.iconButton} onPress={() => setSubtitleOpen(true)}><Ionicons name="chatbox-ellipses-outline" size={23} color={externalSubtitleId || nativePlayer.subtitleTrack ? colors.gold : colors.text} /></Pressable>}
        <Pressable style={styles.iconButton} onPress={() => { if (app.isDemo) { setMessage('Fullscreen needs an actual video source; this screen is a development-only preview.'); return; } setIsFullscreen(true); videoRef.current?.enterFullscreen().catch(() => { setIsFullscreen(false); setMessage('Fullscreen is unavailable on this device.'); }); }}><Ionicons name="expand" size={23} color={colors.text} /></Pressable>
      </View>
      {!!message && model.state !== 'hls-preparing' && <Text style={[styles.message, model.state.endsWith('failed') && styles.error]}>{message}</Text>}
      <SelectionModal visible={qualityOpen} title="Playback Quality" onClose={() => setQualityOpen(false)} options={qualityChoices.map((choice) => ({ label: choice.label, active: choice.label === quality, onPress: () => selectQuality(choice) }))} />
      <SelectionModal visible={subtitleOpen} title="Subtitles" onClose={() => setSubtitleOpen(false)} options={[{ label: 'Off', active: !nativePlayer.subtitleTrack && !externalSubtitleId, onPress: disableSubtitles }, ...subtitles.map((track, index) => ({ label: `${track.label || track.language || `Track ${index + 1}`} · embedded`, active: nativePlayer.subtitleTrack === track && !externalSubtitleId, onPress: () => { subtitleRequestRef.current += 1; setExternalSubtitleId(''); setExternalCues([]); nativePlayer.subtitleTrack = track; setSubtitleOpen(false); } })), ...externalSubtitles.map((track) => ({ label: `${track.name || track.language || 'Subtitle'} · MyFlix`, active: externalSubtitleId === track.id, onPress: () => selectExternalSubtitle(track.id) }))]} />
    </SafeAreaView>
  );
}

function SelectionModal({ visible, title, onClose, options }: { visible: boolean; title: string; onClose: () => void; options: { label: string; active: boolean; onPress: () => void }[] }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.modalShade} onPress={onClose}><View style={styles.sheet} onStartShouldSetResponder={() => true}><Text style={styles.sheetTitle}>{title}</Text>{options.map((option) => <Pressable key={option.label} style={[styles.option, option.active && styles.optionActive]} onPress={option.onPress}><Text style={styles.optionText}>{option.label}</Text>{option.active && <Ionicons name="checkmark" size={20} color={colors.gold} />}</Pressable>)}</View></Pressable></Modal>;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.floor(seconds % 60);
  return `${hours ? `${hours}:` : ''}${hours ? String(minutes).padStart(2, '0') : minutes}:${String(remaining).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#060505', paddingHorizontal: 10, gap: 10 },
  topbar: { height: 54, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '800' },
  stage: { flex: 1, minHeight: 220, maxHeight: 520, backgroundColor: '#000', borderWidth: 1, borderColor: colors.line, borderRadius: 14, overflow: 'hidden', justifyContent: 'center' },
  video: { ...StyleSheet.absoluteFillObject },
  demoStage: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 26, backgroundColor: '#14090c' },
  demoReel: { width: 78, height: 78, borderRadius: 39, borderWidth: 1, borderColor: colors.goldDim, backgroundColor: colors.burgundy, alignItems: 'center', justifyContent: 'center' },
  demoTitle: { color: colors.text, fontSize: 23, lineHeight: 28, fontWeight: '900', textAlign: 'center' },
  demoCopy: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050303dd' },
  subtitleOverlay: { position: 'absolute', left: 18, right: 18, bottom: 16, alignItems: 'center' },
  subtitleText: { color: '#fff', backgroundColor: '#000000cc', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, fontSize: 17, lineHeight: 22, textAlign: 'center', textShadowColor: '#000', textShadowRadius: 2 },
  controls: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  playButton: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.burgundy, borderWidth: 1, borderColor: colors.goldDim },
  qualityButton: { height: 42, minWidth: 50, paddingHorizontal: 7, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.goldDim, backgroundColor: colors.surface },
  qualityText: { color: colors.gold, fontWeight: '900', fontSize: 11 },
  timeline: { height: 6, borderRadius: 4, backgroundColor: '#3b3430', borderWidth: 1, borderColor: colors.goldDim, overflow: 'hidden' },
  timelineFill: { height: '100%', backgroundColor: colors.burgundyBright },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  markerButton: { position: 'absolute', right: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 18, height: 45, borderRadius: 7, backgroundColor: colors.burgundy, borderWidth: 1, borderColor: colors.gold },
  nextButton: { bottom: 65 },
  markerText: { color: colors.text, fontWeight: '900' },
  message: { color: colors.muted, textAlign: 'center', lineHeight: 18, paddingBottom: 8 },
  error: { color: colors.danger },
  modalShade: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 38, gap: 8, borderTopWidth: 1, borderColor: colors.goldDim },
  sheetTitle: { color: colors.text, fontSize: 21, fontWeight: '900', marginBottom: 8 },
  option: { minHeight: 50, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, borderBottomWidth: 1, borderColor: colors.line },
  optionActive: { backgroundColor: colors.surfaceRaised },
  optionText: { flex: 1, color: colors.text, fontWeight: '700' },
});
