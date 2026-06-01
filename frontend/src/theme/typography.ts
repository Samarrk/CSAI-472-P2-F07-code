const Typography = {
  headlineLg: {
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 36,
  },
  headlineMd: {
    fontSize: 22,
    fontWeight: '600' as const,
    lineHeight: 28,
  },
  bodyLg: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  bodyMd: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  labelCaps: {
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  dataNum: {
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 30,
  },
} as const;

export default Typography;
