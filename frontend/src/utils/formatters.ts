import { ScoreLabel } from '../types';
import Colors from '../theme/colors';

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} mins`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Thresholds chosen to be encouraging — 60% still gets a positive label
// so new drivers aren't immediately demoralized after their first few sessions.
export function getScoreLabel(score: number, maxScore = 5): ScoreLabel {
  const pct = (score / maxScore) * 100;
  if (pct >= 90) return 'EXCELLENT';
  if (pct >= 75) return 'GOOD';
  if (pct >= 60) return 'IMPROVING';
  return 'NEEDS WORK';
}

export function getScoreColor(score: number, maxScore = 5): string {
  const pct = (score / maxScore) * 100;
  if (pct >= 90) return Colors.score.excellent;
  if (pct >= 75) return Colors.score.good;
  if (pct >= 60) return Colors.score.improving;
  return Colors.score.poor;
}

export function formatScore(score: number, maxScore = 100): string {
  if (maxScore === 5) return score.toFixed(1);
  return Math.round(score).toString();
}

// Formats a stored +966XXXXXXXXX number into the readable +966 5X XXX XXXX style
// shown on the profile screen. Falls back to the raw string if it doesn't match.
export function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('966') && digits.length === 12) {
    return `+966 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  return phone;
}
