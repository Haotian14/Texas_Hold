import { useCallback, useState } from 'react';
import {
  isBgmOn,
  isMuted,
  setBgmOn,
  setMuted,
} from '../sound';
import {
  aiModePref,
  autoReviewPref,
  fastModePref,
  setAiModePref,
  setAutoReviewPref,
  setFastModePref,
  setShowEquityPref,
  setVibratePref,
  showEquityPref,
  vibratePref,
  type AiMode,
} from '../prefs';

export const VIBRATE_MS = 30;

/**
 * Owns the persisted UI preferences and their side effects.
 *
 * App consumes one state source for both the table and SettingsPage, so a toggle
 * cannot display one value while the table behavior reads another from storage.
 */
export function useAppPreferences() {
  const [muted, setMutedState] = useState(isMuted);
  const [bgm, setBgmState] = useState(isBgmOn);
  const [showEquity, setShowEquityState] = useState(showEquityPref);
  const [fastMode, setFastModeState] = useState(fastModePref);
  const [vibrate, setVibrateState] = useState(vibratePref);
  const [autoReview, setAutoReviewState] = useState(autoReviewPref);
  const [aiMode, setAiModeState] = useState<AiMode>(aiModePref);

  const onToggleMute = useCallback(() => {
    setMutedState(previous => {
      const next = !previous;
      setMuted(next);
      return next;
    });
  }, []);

  const onToggleEquity = useCallback(() => {
    setShowEquityState(previous => {
      const next = !previous;
      setShowEquityPref(next);
      return next;
    });
  }, []);

  const onSetShowEquity = useCallback((value: boolean) => {
    setShowEquityState(value);
    setShowEquityPref(value);
  }, []);

  const onSetMuted = useCallback((value: boolean) => {
    setMutedState(value);
    setMuted(value);
  }, []);

  const onSetBgm = useCallback((value: boolean) => {
    setBgmState(value);
    setBgmOn(value);
  }, []);

  const onSetFastMode = useCallback((value: boolean) => {
    setFastModeState(value);
    setFastModePref(value);
  }, []);

  const onSetVibrate = useCallback((value: boolean) => {
    setVibrateState(value);
    setVibratePref(value);
    if (value) navigator.vibrate?.(VIBRATE_MS);
  }, []);

  const onSetAutoReview = useCallback((value: boolean) => {
    setAutoReviewState(value);
    setAutoReviewPref(value);
  }, []);

  const onSetAiMode = useCallback((value: AiMode) => {
    setAiModeState(value);
    setAiModePref(value);
  }, []);

  return {
    aiMode,
    autoReview,
    bgm,
    fastMode,
    muted,
    showEquity,
    vibrate,
    onSetAiMode,
    onSetAutoReview,
    onSetBgm,
    onSetFastMode,
    onSetMuted,
    onSetShowEquity,
    onSetVibrate,
    onToggleEquity,
    onToggleMute,
  };
}
