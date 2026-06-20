import { BRANDING } from '../../config/branding';

const SIZE_PRESETS = {
  sidebar: 36,
  login: 72,
  header: 40,
  compact: 32,
};

export default function SentryLogo({
  size = 'header',
  height,
  className = '',
  alt,
}) {
  const pixelHeight = height ?? SIZE_PRESETS[size] ?? SIZE_PRESETS.header;

  return (
    <img
      src={BRANDING.logo}
      alt={alt ?? `${BRANDING.productName} logo`}
      className={`sentry-logo sentry-logo--${size}${className ? ` ${className}` : ''}`}
      height={pixelHeight}
      style={{ height: `${pixelHeight}px`, width: 'auto' }}
      draggable={false}
    />
  );
}
